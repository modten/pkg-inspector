// Type declarations for Go's wasm_exec.js

declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

// Global function registered by the Go WASM module
interface Window {
  __wasm_parseTgz: (data: Uint8Array) => Promise<string>;
}
