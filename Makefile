WASM_EXEC_JS := $(shell find $$(go env GOROOT) -name "wasm_exec.js" 2>/dev/null | head -1)

.PHONY: build-wasm copy-glue dev build clean

## Build the tgz-parser Go WASM module
build-wasm:
	cd wasm/tgz-parser && GOOS=js GOARCH=wasm go build -o ../../public/tgz-parser.wasm .

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
	rm -f public/tgz-parser.wasm public/wasm_exec.js
	rm -rf dist
