import type { FileIndexEntry, ParsedFile } from "../types";

/**
 * TarStore manages the lifecycle of a lazily-loaded tar archive.
 *
 * During the indexing pass, the Go WASM module streams decompressed
 * tar chunks via onChunk(). TarStore accumulates them. After indexing
 * is complete, finalize() converts the chunks into a Blob.
 *
 * Individual files can then be read on demand via readFile(), which
 * calls __wasm_readFileFromTar with Blob.slice() — true random access.
 */
export class TarStore {
  private chunks: ArrayBuffer[] = [];
  private blob: Blob | null = null;
  private indexMap: Map<string, FileIndexEntry> = new Map();

  /** Callback for Go's onChunk — accumulates uncompressed tar data. */
  appendChunk = (chunk: Uint8Array): void => {
    // Copy the chunk since the underlying ArrayBuffer may be reused.
    // Slice via .buffer to get a plain ArrayBuffer copy.
    this.chunks.push(chunk.slice().buffer as ArrayBuffer);
  };

  /** Convert accumulated chunks into a Blob and build the lookup map. */
  finalize(index: FileIndexEntry[]): void {
    this.blob = new Blob(this.chunks, { type: "application/x-tar" });
    this.chunks = []; // Release chunk references — Blob owns the data now.

    this.indexMap.clear();
    for (const entry of index) {
      this.indexMap.set(entry.path, entry);
    }
  }

  /** Look up a file's index entry by path. */
  getEntry(path: string): FileIndexEntry | undefined {
    return this.indexMap.get(path);
  }

  /** Read a single file's content from the Blob via WASM. */
  async readFile(path: string): Promise<{ content: string; isBinary: boolean }> {
    if (!this.blob) {
      throw new Error("TarStore not finalized");
    }

    const entry = this.indexMap.get(path);
    if (!entry) {
      throw new Error(`File not in index: ${path}`);
    }

    if (entry.isDir) {
      return { content: "", isBinary: false };
    }

    if (entry.isBinary) {
      return { content: "", isBinary: true };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const jsonStr: string = await (window as any).__wasm_readFileFromTar(
      this.blob,
      entry.offset,
      entry.size,
    );
    return JSON.parse(jsonStr) as { content: string; isBinary: boolean };
  }

  /** Convert the index into ParsedFile[] with lazy markers. */
  toFiles(index: FileIndexEntry[]): ParsedFile[] {
    return index.map((entry) => ({
      path: entry.path,
      size: entry.size,
      isDir: entry.isDir,
      content: "",
      isBinary: entry.isBinary,
      lazy: !entry.isDir && !entry.isBinary,
    }));
  }

  /** Release the Blob and index. */
  dispose(): void {
    this.blob = null;
    this.chunks = [];
    this.indexMap.clear();
  }
}
