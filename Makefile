WASM_EXEC_JS := $(shell find $$(go env GOROOT) -name "wasm_exec.js" 2>/dev/null | head -1)

.PHONY: build-tgz-wasm build-zip-wasm build-wasm copy-glue dev build clean

## Build the tgz-parser Go WASM module
build-tgz-wasm:
	cd wasm/tgz-parser && GOOS=js GOARCH=wasm go build -o ../../public/tgz-parser.wasm .

## Build the zip-parser Go WASM module
build-zip-wasm:
	cd wasm/zip-parser && GOOS=js GOARCH=wasm go build -o ../../public/zip-parser.wasm .

## Build all WASM modules
build-wasm: build-tgz-wasm build-zip-wasm

## Copy Go's wasm_exec.js glue code to public/
copy-glue:
	cp "$(WASM_EXEC_JS)" public/wasm_exec.js

## Start development server (rebuild WASM first)
dev: build-wasm copy-glue
	npx vite

## Production build
build: build-wasm copy-glue
	npx vite build

## Clean build artifacts
clean:
	rm -f public/tgz-parser.wasm public/zip-parser.wasm public/wasm_exec.js
	rm -rf dist
