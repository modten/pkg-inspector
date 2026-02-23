# pkg-inspector

A browser-native package inspector powered by Go WASM. Enter a package name, and it downloads, decompresses, and parses the archive entirely in your browser -- no backend server required.

## Supported Registries

| Registry | Archive Format | CORS | Status |
|---|---|---|---|
| npm | `.tgz` (gzip + tar) | Direct | Implemented |
| PyPI | `.tar.gz` / `.whl` (zip) | Proxy for downloads | Implemented |
| crates.io | `.crate` (gzip + tar) | Proxy for downloads | Implemented |
| Go Modules | `.zip` | Direct | Implemented |
| Maven Central | `.jar` (zip) | Proxy for all | Implemented |

## Quick Start

**Prerequisites:** Go 1.21+, Node.js 18+

```bash
npm install
make dev
```

Open `http://localhost:5173`, pick a registry, type a package name (e.g. `lodash`), and click **Inspect**.

### Other Commands

```bash
make build        # Production build -> dist/
make build-wasm   # Compile Go WASM modules only
make clean        # Remove build artifacts
```

## Tech Stack

| Layer | Technology |
|---|---|
| Archive parsing | Go compiled to WASM (`GOOS=js GOARCH=wasm`) -- two modules: tgz-parser and zip-parser |
| Frontend | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Syntax highlighting | Shiki (TextMate grammars, github-dark theme) |
| Build | Vite 6 |
| Deployment | Pure static files (GitHub Pages, Netlify, Vercel, any CDN) |

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        Browser                           │
│                                                          │
│  ┌───────────────────┐     ┌──────────────────────────┐  │
│  │    React App       │────>│    Go WASM Modules       │  │
│  │                    │     │                          │  │
│  │  SearchBar         │     │  tgz-parser.wasm         │  │
│  │  PackageInfo       │<────│    stream decompress     │  │
│  │  FileTree          │     │    parse tar archive     │  │
│  │  FilePreview       │     │                          │  │
│  │                    │     │  zip-parser.wasm          │  │
│  │  URL state sync    │     │    parse zip archive     │  │
│  └───────────────────┘     └──────────────────────────┘  │
│                                                          │
│  registry.npmjs.org / pypi.org / crates.io /             │
│  proxy.golang.org / search.maven.org                     │
└──────────────────────────────────────────────────────────┘
```

## How It Works

### Eager mode (archives < 5 MB)

1. User selects a registry and enters a package name
2. The app fetches package metadata from the registry API
3. Go WASM calls `fetch()` via `syscall/js` and streams the response through `ReadableStream.getReader()`
4. Decompression and archive parsing happen incrementally -- the full archive never exists as a single buffer
5. Results are returned as JSON: file paths, sizes, and text content
6. React renders the file tree, metadata card, and syntax-highlighted file preview

### Lazy mode (archives >= 5 MB)

1. A HEAD request determines the archive size
2. Go WASM fetches and decompresses the archive, streaming raw tar data back to JS via `onChunk()` callbacks
3. JS accumulates chunks into a `Blob` (browser memory, not the JS heap)
4. Go simultaneously builds a file index recording each file's byte offset
5. Only the metadata file (e.g. `package.json`, `Cargo.toml`) is eagerly loaded
6. When the user clicks a file, `Blob.slice()` extracts just that file's bytes on demand
7. Loaded files are cached in React state

### URL State

Package inspections are encoded in the URL path (`/{registryId}/{package}@{version}`), making results shareable and browser back/forward navigation functional.

## Project Structure

```
pkg-inspector/
├── wasm/
│   ├── tgz-parser/               # Go WASM: gzip + tar parsing
│   │   ├── main.go
│   │   └── go.mod
│   └── zip-parser/               # Go WASM: zip parsing
│       ├── main.go
│       └── go.mod
├── src/
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Main app component (state + orchestration)
│   ├── index.css                 # Tailwind entry
│   ├── types.ts                  # Shared types: ParsedFile, RegistryAdapter, PackageInfo, etc.
│   ├── wasm.d.ts                 # Type declarations for Go WASM exports
│   ├── components/
│   │   ├── SearchBar.tsx         # Registry dropdown + package name input + Inspect button
│   │   ├── FileTree.tsx          # Recursive file tree with expand/collapse and file sizes
│   │   ├── FilePreview.tsx       # Syntax-highlighted file viewer with line numbers
│   │   ├── PackageInfo.tsx       # Collapsible metadata panel with version switcher
│   │   └── Loading.tsx           # Multi-step progress indicator
│   ├── hooks/
│   │   ├── useWasm.ts            # WASM initialization + parser function wrappers
│   │   ├── useUrlState.ts        # URL-based routing and history management
│   │   └── useHighlighter.ts     # Shiki syntax highlighter with on-demand language loading
│   ├── registries/               # Registry adapters (one per ecosystem)
│   │   ├── index.ts              #   Registry list + lookup
│   │   ├── npm.ts                #   npm
│   │   ├── pypi.ts               #   PyPI
│   │   ├── crates.ts             #   crates.io
│   │   ├── golang.ts             #   Go Modules
│   │   └── maven.ts              #   Maven Central
│   └── lib/
│       ├── cors.ts               # CORS proxy with multi-backend fallback
│       └── tar-store.ts          # Lazy-loading tar archive manager (Blob + index)
├── public/
│   ├── tgz-parser.wasm           # Pre-built Go WASM binary
│   └── zip-parser.wasm           # Pre-built Go WASM binary
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── Makefile
```

## Adding a New Ecosystem

Implement the `RegistryAdapter` interface from `src/types.ts`:

```typescript
import type { RegistryAdapter, RegistryPackageInfo, ParsedFile, PackageInfo } from "../types";

export const myAdapter: RegistryAdapter = {
  id: "my-ecosystem",
  label: "My Ecosystem",
  placeholder: "Enter package name...",
  examples: ["example-pkg"],
  parserType: "tgz",                    // or "zip"
  metaFileName: "manifest.json",
  metadataNeedsCors: false,
  archiveNeedsCors: true,

  async fetchPackageInfo(name) { /* query registry API for latest version */ },
  async fetchVersionInfo(name, version) { /* query registry API for specific version */ },
  async fetchArchive(name, version, tarballUrl?) { /* download archive bytes */ },
  extractMetadata(files) { /* parse metadata from extracted files */ },
};
```

Then register it in `src/registries/index.ts`:

```typescript
import { myAdapter } from "./my-ecosystem";
export const registries: RegistryAdapter[] = [npmAdapter, myAdapter];
```

No UI changes needed -- the registry dropdown, search flow, and file viewer all adapt automatically.

If the new ecosystem uses an archive format other than tgz or zip, add a new WASM parser in `wasm/<format>-parser/`.

## Key Design Decisions

1. **WASM-side HTTP fetching** -- Go calls `fetch()` via `syscall/js` and reads the response as a `ReadableStream`, eliminating a full-archive `ArrayBuffer` copy on the JS side. This avoids importing `net/http` which would inflate the WASM binary from ~3.5 MB to ~10 MB.
2. **Two-mode loading** -- archives under 5 MB are fully extracted in one pass (eager); archives over 5 MB use lazy loading via a `Blob` + file index with on-demand `Blob.slice()` reads.
3. **Separate WASM modules** -- tgz-parser and zip-parser are loaded on demand based on the selected registry, keeping initial load small.
4. **CORS proxy with fallback** -- npm and Go Modules connect directly; other registries route through configurable proxies (corsfix, whateverorigin, corsproxy.io, allorigins) with automatic fallback.
5. **Ecosystem-agnostic UI** -- all components render from unified `ParsedFile[]` and `PackageInfo` types with no ecosystem-specific UI code.
6. **Binary detection** -- files are checked for null bytes and invalid UTF-8 in the first 512 bytes; files over 512 KB skip content extraction entirely.

## License

MIT
