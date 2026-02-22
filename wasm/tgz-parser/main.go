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

// parseTgzBytes decompresses a .tgz (gzip+tar) archive and extracts all entries.
func parseTgzBytes(data []byte) (*ParseResult, error) {
	gz, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
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

func main() {
	// Register parseTgz as a global JS function.
	// Signature: __wasm_parseTgz(Uint8Array) → Promise<string>
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

	// Block forever — WASM instance must stay alive to serve calls.
	select {}
}

func jsError(msg string) any {
	return js.Global().Get("Promise").Call("reject",
		js.Global().Get("Error").New(msg))
}
