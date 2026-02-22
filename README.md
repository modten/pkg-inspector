# pkg-inspector

A browser-native package inspector powered by Go WASM. Enter a package name, and it downloads, decompresses, and parses the archive entirely in your browser — no backend server required.

**Current support:** npm. Designed with a plugin architecture to extend to Go Modules, PyPI, crates.io, and Maven.

## Tech Stack

| Layer | Technology |
|---|---|
| Archive Parsing | Go compiled to WASM (`GOOS=js GOARCH=wasm`) |
| Frontend | React 18 + TypeScript |
| Styling | Tailwind CSS v4 |
| Build | Vite |
| Deployment | Pure static files |

## Quick Start

**Prerequisites:** Go 1.21+, Node.js 18+

```bash
# Install frontend dependencies
npm install

# Start dev server (compiles WASM + launches Vite)
make dev
```

Open `http://localhost:5173`, type a package name (e.g. `lodash`), and click **Inspect**.

### Other Commands

```bash
make build        # Production build → dist/
make build-wasm   # Compile Go WASM only
make clean        # Remove build artifacts
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser                          │
│                                                      │
│  ┌──────────────────┐    ┌────────────────────────┐ │
│  │    React App      │───▶│    Go WASM Module      │ │
│  │    (Vite)         │    │                        │ │
│  │  - SearchBar      │    │  - fetch() via JS      │ │
│  │  - FileTree       │◀───│  - Stream decompress   │ │
│  │  - FilePreview    │    │  - Parse tar archive   │ │
│  │  - PackageInfo    │    │  - On-demand file read │ │
│  └──────────────────┘    └────────────────────────┘ │
│                                                      │
│    registry.npmjs.org / proxy.golang.org / ...       │
└─────────────────────────────────────────────────────┘
```

### Plugin System

The core abstraction is the `RegistryAdapter` interface (`src/types.ts`). Each package ecosystem implements one adapter that handles:

1. **`fetchPackageInfo(name)`** — Query the registry API for metadata and tarball URL
2. **`fetchArchive(name, version)`** — Download the archive as raw bytes
3. **`extractMetadata(files)`** — Parse ecosystem-specific metadata from the extracted files (e.g. `package.json`, `Cargo.toml`)

The UI components are ecosystem-agnostic. The `SearchBar` ecosystem dropdown is auto-populated from the registered adapters.

```
Plugin Manager
      │
      ├── npm adapter        → tgz-parser.wasm  (gzip + tar)
      ├── Go Modules adapter → zip-parser.wasm  (zip)       [planned]
      ├── PyPI adapter       → tgz or zip parser             [planned]
      ├── crates.io adapter  → tgz-parser.wasm               [planned]
      └── Maven adapter      → zip-parser.wasm               [planned]
```

## Project Structure

```
pkg-inspector/
├── wasm/
│   └── tgz-parser/              # Go WASM source for tar.gz parsing
│       ├── main.go              #   Exports WASM functions (see below)
│       └── go.mod
├── src/
│   ├── main.tsx                 # React entry point
│   ├── App.tsx                  # Main app component (state + orchestration)
│   ├── index.css                # Tailwind entry (@import "tailwindcss")
│   ├── types.ts                 # Shared types: ParsedFile, FileIndexEntry, PackageInfo, RegistryAdapter
│   ├── wasm.d.ts                # Type declarations for Go WASM exports
│   ├── components/
│   │   ├── SearchBar.tsx        # Ecosystem dropdown + package name input + Inspect button
│   │   ├── FileTree.tsx         # Recursive file tree with expand/collapse
│   │   ├── FilePreview.tsx      # File content viewer with line numbers
│   │   ├── PackageInfo.tsx      # Metadata card (name, version, deps, scripts, etc.)
│   │   └── Loading.tsx          # Multi-step loading indicator
│   ├── hooks/
│   │   └── useWasm.ts           # WASM initialization + parseTgz/fetchAndParseTgz/indexTgz wrappers
│   ├── registries/              # Plugin directory
│   │   ├── index.ts             #   Registry list + lookup
│   │   └── npm.ts               #   npm adapter (implemented)
│   └── lib/
│       ├── cors.ts              # CORS proxy with automatic fallback
│       └── tar-store.ts         # Lazy-loading tar archive manager (Blob + index)
├── public/
│   ├── tgz-parser.wasm          # Compiled Go WASM (3.5 MB)
│   └── wasm_exec.js             # Go official WASM glue code
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── Makefile
```

## How It Works

The data pipeline uses two modes depending on tarball size:

### Eager mode (tarballs < 5 MB)

1. User selects an ecosystem (npm) and enters a package name
2. The app fetches package metadata from the registry API
3. Go WASM calls `fetch()` internally via `syscall/js` and streams the response body through `ReadableStream.getReader()`
4. Gzip decompression and tar parsing happen incrementally as chunks arrive — the full tarball never exists as a single buffer
5. Results are returned as JSON: file paths, sizes, and text content
6. React renders the file tree, metadata card, and file previewer

### Lazy mode (tarballs >= 5 MB)

1. Steps 1-2 are the same; a HEAD request determines the tarball size
2. Go WASM fetches and decompresses the archive, streaming the raw uncompressed tar data back to JS via `onChunk()` callbacks
3. JS accumulates chunks into a `Blob` (backed by browser memory, not the JS heap)
4. Go simultaneously builds a file index recording each file's byte offset within the tar
5. Only `package.json` (or the ecosystem's metadata file) is eagerly loaded
6. When the user clicks a file, `Blob.slice(offset, size)` extracts just that file's bytes, which Go processes for binary detection and returns the content
7. Loaded files are cached in React state — clicking the same file twice doesn't re-read from the Blob

### WASM Exports

| Function | Signature | Purpose |
|---|---|---|
| `__wasm_parseTgz` | `(Uint8Array) -> Promise<string>` | Original: parse from in-memory bytes (drag-and-drop, etc.) |
| `__wasm_fetchAndParseTgz` | `(url) -> Promise<string>` | Eager: fetch + stream-decompress + parse, no JS ArrayBuffer copy |
| `__wasm_indexTgz` | `(url, onChunk) -> Promise<string>` | Lazy: fetch + decompress + stream tar to JS + build file index |
| `__wasm_readFileFromTar` | `(blob, offset, size) -> Promise<string>` | Lazy: read a single file from the uncompressed tar Blob |

## CORS Strategy

| Registry | Metadata API | Archive Download | Strategy |
|---|---|---|---|
| npm | `Access-Control-Allow-Origin: *` | `*` | Direct fetch |
| Go Modules | `*` | `*` | Direct fetch |
| PyPI | `*` | No CORS (`files.pythonhosted.org`) | Metadata direct, archive via proxy |
| crates.io | `*` | No CORS (`static.crates.io`) | Metadata direct, archive via proxy |
| Maven Central | No CORS | No CORS | All via proxy |

The CORS proxy layer (`src/lib/cors.ts`) supports multiple proxies with automatic fallback:
- Primary: `corsproxy.io`
- Fallback: `allorigins.win`

## Adding a New Ecosystem

To add support for a new package ecosystem (e.g. Go Modules):

### 1. Add WASM parser (if needed)

Only two parser types exist — `tgz` (gzip+tar) and `zip`. If the new ecosystem uses one of these, skip this step.

For a new archive format, create `wasm/<format>-parser/main.go`, compile with:

```bash
cd wasm/zip-parser && GOOS=js GOARCH=wasm go build -o ../../public/zip-parser.wasm .
```

### 2. Create the registry adapter

Create `src/registries/<ecosystem>.ts` implementing the `RegistryAdapter` interface:

```typescript
import type { RegistryAdapter, RegistryPackageInfo, ParsedFile, PackageInfo } from "../types";
import { corsFetch } from "../lib/cors";

export const myAdapter: RegistryAdapter = {
  id: "my-ecosystem",
  label: "My Ecosystem",
  placeholder: "Enter package name...",
  examples: ["example-pkg"],
  parserType: "tgz",                    // or "zip"
  metaFileName: "package-manifest.json", // primary metadata file
  metadataNeedsCors: false,
  archiveNeedsCors: true,

  async fetchPackageInfo(name: string): Promise<RegistryPackageInfo> {
    // Query registry API, return { name, version, tarballUrl, versions, description }
  },

  async fetchArchive(name: string, version: string, tarballUrl?: string): Promise<Uint8Array> {
    // Download archive, return raw bytes
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // Find and parse the metadata file from extracted contents
  },
};
```

### 3. Register the adapter

Add to `src/registries/index.ts`:

```typescript
import { myAdapter } from "./my-ecosystem";

export const registries: RegistryAdapter[] = [
  npmAdapter,
  myAdapter, // ← add here
];
```

No UI changes required. The ecosystem dropdown, search flow, and file viewer all work automatically.

## Registry API Reference

Quick reference for each planned ecosystem:

### npm
```
Metadata:  GET https://registry.npmjs.org/{package}
Tarball:   GET https://registry.npmjs.org/{package}/-/{package}-{version}.tgz
Format:    .tgz (gzip + tar)
CORS:      ✓ all endpoints
```

### Go Modules
```
Versions:  GET https://proxy.golang.org/{module}/@v/list
Info:      GET https://proxy.golang.org/{module}/@latest
Archive:   GET https://proxy.golang.org/{module}/@v/{version}.zip
Format:    .zip
CORS:      ✓ all endpoints
Note:      Capital letters escaped with ! (e.g. github.com/!azure)
```

### PyPI
```
Metadata:  GET https://pypi.org/pypi/{package}/json
Archive:   URL from metadata → files.pythonhosted.org/...
Format:    .tar.gz (sdist) or .whl (zip)
CORS:      ✓ metadata, ✗ downloads
```

### crates.io
```
Metadata:  GET https://crates.io/api/v1/crates/{crate}
Archive:   GET https://static.crates.io/crates/{crate}/{crate}-{version}.crate
Format:    .crate (gzip + tar)
CORS:      ✓ API, ✗ CDN downloads
Note:      Requires User-Agent header
```

### Maven Central
```
Search:    GET https://search.maven.org/solrsearch/select?q=g:{groupId}+AND+a:{artifactId}&wt=json
Archive:   GET https://repo1.maven.org/maven2/{group/path}/{artifact}/{version}/{artifact}-{version}.jar
Format:    .jar (zip)
CORS:      ✗ all endpoints
```

## Key Design Decisions

1. **WASM-side HTTP fetching** — Go calls `fetch()` via `syscall/js` and reads the response as a `ReadableStream`, eliminating the JS-side full-tarball `ArrayBuffer` copy. This avoids importing `net/http` which would inflate the binary from ~3.5 MB to ~10 MB
2. **Two-mode loading** — Packages under 5 MB are fully extracted in one pass (eager). Packages over 5 MB use lazy loading: decompress once to a Blob, build an index, and serve file content on demand via `Blob.slice()`. This keeps memory bounded for large packages like `typescript` (11 MB tarball)
3. **Two WASM modules** (tgz + zip) loaded on demand rather than one monolithic binary, keeping initial load small
4. **CORS proxy with fallback** — npm and Go Modules are CORS-friendly and connect directly; others route through configurable proxies
5. **Ecosystem-agnostic UI** — all components render from the unified `ParsedFile[]` and `PackageInfo` types, no ecosystem-specific UI code
6. **Binary detection** — files are checked for null bytes and invalid UTF-8 in the first 512 bytes; files >512KB skip content extraction entirely
7. **Static deployment** — the entire `dist/` output is pure static files deployable to GitHub Pages, Netlify, Vercel, or any CDN

## License

MIT
