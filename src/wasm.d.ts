// Type declarations for Go's wasm_exec.js

declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

// Global functions registered by the Go WASM modules
interface Window {
  // --- tgz-parser exports ---
  /** Original: parse from in-memory bytes */
  __wasm_parseTgz: (data: Uint8Array) => Promise<string>;
  /** Phase 1: fetch URL and parse via streaming — no JS ArrayBuffer copy */
  __wasm_fetchAndParseTgz: (url: string) => Promise<string>;
  /** Phase 2: fetch URL, stream decompressed tar chunks to onChunk, return file index */
  __wasm_indexTgz: (url: string, onChunk: (chunk: Uint8Array) => void) => Promise<string>;
  /** Phase 2: read a single file from the uncompressed tar Blob */
  __wasm_readFileFromTar: (blob: Blob, offset: number, size: number) => Promise<string>;

  // --- zip-parser exports ---
  /** Parse a zip archive from in-memory bytes */
  __wasm_parseZip: (data: Uint8Array) => Promise<string>;

  // --- class-parser exports ---
  /** Parse a Java .class file from raw bytes, returns JSON ClassInfo */
  __wasm_parseClass: (data: Uint8Array) => Promise<string>;
}
