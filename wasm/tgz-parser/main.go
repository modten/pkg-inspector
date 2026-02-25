package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"syscall/js"
	"unicode/utf8"
)

const (
	maxFileContentSize = 512 * 1024        // 512KB: skip content for larger files
	maxTotalSize       = 100 * 1024 * 1024 // 100MB: reject archives exceeding this
	binaryCheckSize    = 512               // bytes to inspect for binary detection
)

// ParsedFile represents a single file entry extracted from the archive.
type ParsedFile struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	IsDir    bool   `json:"isDir"`
	Content  string `json:"content"`
	IsBinary bool   `json:"isBinary"`
}

// ParseResult is the top-level structure returned to JavaScript.
type ParseResult struct {
	Files []ParsedFile `json:"files"`
}

// FileIndexEntry is a lightweight entry for lazy-loading mode.
// It records the byte offset within the uncompressed tar where the
// file's data block begins, so we can read it on demand via Blob.slice().
type FileIndexEntry struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	IsDir    bool   `json:"isDir"`
	IsBinary bool   `json:"isBinary"`
	Offset   int64  `json:"offset"`
}

// IndexResult is returned by the indexing pass.
type IndexResult struct {
	Files []FileIndexEntry `json:"files"`
}

// isBinaryContent detects binary data by checking for null bytes
// and invalid UTF-8 sequences in the first binaryCheckSize bytes.
func isBinaryContent(data []byte) bool {
	n := len(data)
	if n > binaryCheckSize {
		n = binaryCheckSize
	}
	for i := 0; i < n; i++ {
		if data[i] == 0 {
			return true
		}
	}
	return !utf8.Valid(data[:n])
}

// ---------------------------------------------------------------------------
// streamReader: an io.ReadCloser backed by a JS ReadableStreamDefaultReader.
// Each call to Read() invokes reader.read() on the JS side, awaits the
// resulting Promise via a Go channel, and copies the chunk into Go memory.
// ---------------------------------------------------------------------------

type streamReader struct {
	reader js.Value // ReadableStreamDefaultReader
	buf    []byte   // leftover bytes from previous chunk
	done   bool
}

func newStreamReader(readableStream js.Value) *streamReader {
	reader := readableStream.Call("getReader")
	return &streamReader{reader: reader}
}

func (sr *streamReader) Read(p []byte) (int, error) {
	// Drain leftover buffer first.
	if len(sr.buf) > 0 {
		n := copy(p, sr.buf)
		sr.buf = sr.buf[n:]
		return n, nil
	}
	if sr.done {
		return 0, io.EOF
	}

	// Call reader.read() and await the Promise.
	ch := make(chan struct{})
	var chunk js.Value
	var readErr error

	thenCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		chunk = args[0]
		close(ch)
		return nil
	})
	catchCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		readErr = js.Error{Value: args[0]}
		close(ch)
		return nil
	})
	defer thenCb.Release()
	defer catchCb.Release()

	sr.reader.Call("read").Call("then", thenCb).Call("catch", catchCb)
	<-ch

	if readErr != nil {
		return 0, readErr
	}

	if chunk.Get("done").Bool() {
		sr.done = true
		return 0, io.EOF
	}

	value := chunk.Get("value") // Uint8Array
	length := value.Get("length").Int()
	data := make([]byte, length)
	js.CopyBytesToGo(data, value)

	n := copy(p, data)
	if n < length {
		sr.buf = data[n:]
	}
	return n, nil
}

func (sr *streamReader) Close() error {
	sr.reader.Call("cancel")
	return nil
}

// ---------------------------------------------------------------------------
// jsFetch: call window.fetch(url) or window.fetch(url, options) from Go via
// syscall/js, return a streaming io.ReadCloser over the response body.
// options is a JS object with optional properties like headers, credentials, etc.
// Pass nil/undefined/null for options to use default fetch behavior.
// ---------------------------------------------------------------------------

func jsFetch(url string, options js.Value) (io.ReadCloser, int, error) {
	ch := make(chan struct{})
	var response js.Value
	var fetchErr error

	thenCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		response = args[0]
		close(ch)
		return nil
	})
	catchCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		fetchErr = js.Error{Value: args[0]}
		close(ch)
		return nil
	})
	defer thenCb.Release()
	defer catchCb.Release()

	var promise js.Value
	if !options.IsUndefined() && !options.IsNull() {
		promise = js.Global().Call("fetch", url, options)
	} else {
		promise = js.Global().Call("fetch", url)
	}
	promise.Call("then", thenCb).Call("catch", catchCb)
	<-ch

	if fetchErr != nil {
		return nil, 0, fetchErr
	}

	status := response.Get("status").Int()
	if !response.Get("ok").Bool() {
		statusText := response.Get("statusText").String()
		return nil, status, &fetchError{status: status, statusText: statusText}
	}

	body := response.Get("body")
	contentLength := 0
	clHeader := response.Get("headers").Call("get", "content-length")
	if !clHeader.IsNull() && !clHeader.IsUndefined() {
		cl := clHeader.String()
		for _, c := range cl {
			if c >= '0' && c <= '9' {
				contentLength = contentLength*10 + int(c-'0')
			}
		}
	}

	return newStreamReader(body), contentLength, nil
}

type fetchError struct {
	status     int
	statusText string
}

func (e *fetchError) Error() string {
	return "HTTP " + itoa(e.status) + " " + e.statusText
}

// Simple int-to-string without importing strconv (keeps binary small).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf) - 1
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	for n > 0 {
		buf[i] = byte('0' + n%10)
		i--
		n /= 10
	}
	if neg {
		buf[i] = '-'
		i--
	}
	return string(buf[i+1:])
}

// ---------------------------------------------------------------------------
// parseTgzBytes: decompress a .tgz archive from an in-memory byte slice.
// This is the original eager-loading path.
// ---------------------------------------------------------------------------

func parseTgzBytes(data []byte) (*ParseResult, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	return parseTar(gz)
}

// parseTgzStream: decompress a .tgz archive from a streaming reader.
// Used by fetchAndParseTgz (Phase 1).
func parseTgzStream(r io.Reader) (*ParseResult, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	return parseTar(gz)
}

// parseTar extracts all entries from an uncompressed tar stream.
func parseTar(r io.Reader) (*ParseResult, error) {
	tr := tar.NewReader(r)
	result := &ParseResult{
		Files: make([]ParsedFile, 0, 64),
	}

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		entry := ParsedFile{
			Path:  hdr.Name,
			Size:  hdr.Size,
			IsDir: hdr.Typeflag == tar.TypeDir,
		}

		if !entry.IsDir && hdr.Typeflag == tar.TypeReg {
			if hdr.Size > maxFileContentSize {
				entry.IsBinary = true
				io.Copy(io.Discard, tr)
			} else {
				buf := make([]byte, hdr.Size)
				if _, err := io.ReadFull(tr, buf); err != nil {
					return nil, err
				}
				if isBinaryContent(buf) {
					entry.IsBinary = true
				} else {
					entry.Content = string(buf)
				}
			}
		}

		result.Files = append(result.Files, entry)
	}

	return result, nil
}

// ---------------------------------------------------------------------------
// indexTgzStream: decompress a .tgz archive from a streaming reader,
// build a file index (without reading file content), and write
// uncompressed tar chunks to JS via onChunk callback.
//
// This is the Phase 2 lazy-loading path. The caller (JS) accumulates
// the chunks into a Blob for on-demand file reads.
// ---------------------------------------------------------------------------

// countingWriter wraps an io.Writer and tracks total bytes written.
type countingWriter struct {
	w     io.Writer
	count int64
}

func (cw *countingWriter) Write(p []byte) (int, error) {
	n, err := cw.w.Write(p)
	cw.count += int64(n)
	return n, err
}

// jsChunkWriter is an io.Writer that sends each Write() call to a JS
// callback as a Uint8Array. Used to stream uncompressed tar data to JS.
type jsChunkWriter struct {
	onChunk js.Value // JS function(Uint8Array)
}

func (w *jsChunkWriter) Write(p []byte) (int, error) {
	jsArr := js.Global().Get("Uint8Array").New(len(p))
	js.CopyBytesToJS(jsArr, p)
	w.onChunk.Invoke(jsArr)
	return len(p), nil
}

func indexTgzStream(r io.Reader, onChunk js.Value) (*IndexResult, error) {
	gz, err := gzip.NewReader(r)
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	// Tee: everything read from gz is also written to JS via onChunk.
	// We use a countingWriter to track the byte offset within the
	// uncompressed tar stream for each file's data block.
	chunkW := &jsChunkWriter{onChunk: onChunk}
	cw := &countingWriter{w: chunkW, count: 0}
	tee := io.TeeReader(gz, cw)

	tr := tar.NewReader(tee)
	result := &IndexResult{
		Files: make([]FileIndexEntry, 0, 64),
	}

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		entry := FileIndexEntry{
			Path:  hdr.Name,
			Size:  hdr.Size,
			IsDir: hdr.Typeflag == tar.TypeDir,
		}

		if !entry.IsDir && hdr.Typeflag == tar.TypeReg {
			// The current offset in the uncompressed tar is where
			// the file's data block starts (tar.Reader has just
			// consumed the header, tee has written it out).
			entry.Offset = cw.count

			if hdr.Size > maxFileContentSize {
				entry.IsBinary = true
				// Must drain data so the tee writes it to JS and offsets stay correct.
				io.Copy(io.Discard, tr)
			} else {
				// Read the first binaryCheckSize bytes to detect binary.
				checkSize := hdr.Size
				if checkSize > binaryCheckSize {
					checkSize = binaryCheckSize
				}
				peek := make([]byte, checkSize)
				if _, err := io.ReadFull(tr, peek); err != nil {
					return nil, err
				}
				entry.IsBinary = isBinaryContent(peek)
				// Drain remaining bytes so the tee writes them to JS.
				io.Copy(io.Discard, tr)
			}
		}

		result.Files = append(result.Files, entry)
	}

	return result, nil
}

// ---------------------------------------------------------------------------
// readFileContent reads a single file's bytes from a JS Blob at the
// given offset and size. Used for on-demand file loading in Phase 2.
// ---------------------------------------------------------------------------

func readFileContent(blob js.Value, offset, size int64) (string, bool, error) {
	// Blob.slice(start, end) returns a new Blob of that range.
	slice := blob.Call("slice", offset, offset+size)

	// slice.arrayBuffer() returns a Promise<ArrayBuffer>.
	ch := make(chan struct{})
	var arrBuf js.Value
	var readErr error

	thenCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		arrBuf = args[0]
		close(ch)
		return nil
	})
	catchCb := js.FuncOf(func(_ js.Value, args []js.Value) any {
		readErr = js.Error{Value: args[0]}
		close(ch)
		return nil
	})
	defer thenCb.Release()
	defer catchCb.Release()

	slice.Call("arrayBuffer").Call("then", thenCb).Call("catch", catchCb)
	<-ch

	if readErr != nil {
		return "", false, readErr
	}

	jsArr := js.Global().Get("Uint8Array").New(arrBuf)
	data := make([]byte, jsArr.Get("length").Int())
	js.CopyBytesToGo(data, jsArr)

	if isBinaryContent(data) {
		return "", true, nil
	}
	return string(data), false, nil
}

// ---------------------------------------------------------------------------
// JS exports
// ---------------------------------------------------------------------------

func main() {
	// -----------------------------------------------------------------------
	// __wasm_parseTgz(Uint8Array) -> Promise<string>
	// Original eager-loading from in-memory bytes. Kept for backward compat
	// and for future use cases like local file / drag-and-drop.
	// -----------------------------------------------------------------------
	js.Global().Set("__wasm_parseTgz", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return jsError("parseTgz requires exactly 1 argument (Uint8Array)")
		}

		handler := js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			reject := promise[1]

			go func() {
				jsArr := args[0]
				length := jsArr.Get("length").Int()

				if length > maxTotalSize {
					reject.Invoke(js.Global().Get("Error").New("Archive too large (>100MB)"))
					return
				}

				data := make([]byte, length)
				js.CopyBytesToGo(data, jsArr)

				result, err := parseTgzBytes(data)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to parse tgz: " + err.Error()))
					return
				}

				jsonBytes, err := json.Marshal(result)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to serialize result: " + err.Error()))
					return
				}

				resolve.Invoke(string(jsonBytes))
			}()

			return nil
		})

		return js.Global().Get("Promise").New(handler)
	}))

	// -----------------------------------------------------------------------
	// __wasm_fetchAndParseTgz(url: string, options?: object) -> Promise<string>
	// Phase 1: fetch via streaming, decompress, parse — no JS-side
	// ArrayBuffer copy. Returns JSON ParseResult.
	// options: { headers?: Record<string, string>, credentials?: string, ... }
	// -----------------------------------------------------------------------
	js.Global().Set("__wasm_fetchAndParseTgz", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) < 1 || len(args) > 2 {
			return jsError("fetchAndParseTgz requires 1 or 2 arguments (url, options?)")
		}

		handler := js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			reject := promise[1]

			go func() {
				url := args[0].String()
				var options js.Value
				if len(args) == 2 && !args[1].IsUndefined() && !args[1].IsNull() {
					options = args[1]
				}

				body, _, err := jsFetch(url, options)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Fetch failed: " + err.Error()))
					return
				}
				defer body.Close()

				result, err := parseTgzStream(body)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to parse tgz: " + err.Error()))
					return
				}

				jsonBytes, err := json.Marshal(result)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to serialize result: " + err.Error()))
					return
				}

				resolve.Invoke(string(jsonBytes))
			}()

			return nil
		})

		return js.Global().Get("Promise").New(handler)
	}))

	// -----------------------------------------------------------------------
	// __wasm_indexTgz(url: string, onChunk: Function) -> Promise<string>
	// Phase 2 lazy-loading: fetch, decompress, stream uncompressed tar
	// chunks to JS via onChunk(Uint8Array), build a file index with
	// byte offsets. Returns JSON IndexResult (no file content).
	// -----------------------------------------------------------------------
	js.Global().Set("__wasm_indexTgz", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 2 {
			return jsError("indexTgz requires 2 arguments (url, onChunk)")
		}

		handler := js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			reject := promise[1]

			go func() {
				url := args[0].String()
				onChunk := args[1]

				body, _, err := jsFetch(url, js.Undefined())
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Fetch failed: " + err.Error()))
					return
				}
				defer body.Close()

				result, err := indexTgzStream(body, onChunk)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to index tgz: " + err.Error()))
					return
				}

				jsonBytes, err := json.Marshal(result)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to serialize index: " + err.Error()))
					return
				}

				resolve.Invoke(string(jsonBytes))
			}()

			return nil
		})

		return js.Global().Get("Promise").New(handler)
	}))

	// -----------------------------------------------------------------------
	// __wasm_readFileFromTar(blob: Blob, offset: number, size: number) -> Promise<string>
	// Phase 2: read a single file from the uncompressed tar Blob.
	// Returns JSON {content: string, isBinary: bool}.
	// -----------------------------------------------------------------------
	js.Global().Set("__wasm_readFileFromTar", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 3 {
			return jsError("readFileFromTar requires 3 arguments (blob, offset, size)")
		}

		handler := js.FuncOf(func(_ js.Value, promise []js.Value) any {
			resolve := promise[0]
			reject := promise[1]

			go func() {
				blob := args[0]
				offset := int64(args[1].Float())
				size := int64(args[2].Float())

				content, binary, err := readFileContent(blob, offset, size)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to read file: " + err.Error()))
					return
				}

				// Return as JSON: {content, isBinary}
				result := map[string]any{
					"content":  content,
					"isBinary": binary,
				}
				jsonBytes, err := json.Marshal(result)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to serialize: " + err.Error()))
					return
				}

				resolve.Invoke(string(jsonBytes))
			}()

			return nil
		})

		return js.Global().Get("Promise").New(handler)
	}))

	// Block forever — WASM instance must stay alive to serve calls.
	select {}
}

func jsError(msg string) any {
	return js.Global().Get("Promise").Call("reject",
		js.Global().Get("Error").New(msg))
}
