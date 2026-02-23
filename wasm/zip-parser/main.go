package main

import (
	"archive/zip"
	"bytes"
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

// parseZipBytes parses a zip archive from an in-memory byte slice.
func parseZipBytes(data []byte) (*ParseResult, error) {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}

	result := &ParseResult{
		Files: make([]ParsedFile, 0, len(r.File)),
	}

	for _, f := range r.File {
		entry := ParsedFile{
			Path:  f.Name,
			Size:  int64(f.UncompressedSize64),
			IsDir: f.FileInfo().IsDir(),
		}

		if !entry.IsDir {
			if entry.Size > maxFileContentSize {
				entry.IsBinary = true
			} else {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}

				buf, err := io.ReadAll(rc)
				rc.Close()
				if err != nil {
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

func jsError(msg string) any {
	return js.Global().Get("Promise").Call("reject",
		js.Global().Get("Error").New(msg))
}

// ---------------------------------------------------------------------------
// JS exports
// ---------------------------------------------------------------------------

func main() {
	// -----------------------------------------------------------------------
	// __wasm_parseZip(Uint8Array) -> Promise<string>
	// Parse a zip archive from in-memory bytes.
	// Returns JSON ParseResult.
	// -----------------------------------------------------------------------
	js.Global().Set("__wasm_parseZip", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return jsError("parseZip requires exactly 1 argument (Uint8Array)")
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

				result, err := parseZipBytes(data)
				if err != nil {
					reject.Invoke(js.Global().Get("Error").New("Failed to parse zip: " + err.Error()))
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
