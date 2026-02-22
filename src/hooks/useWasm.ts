import { useEffect, useRef, useState } from "react";
import type { ParseResult, IndexResult } from "../types";
import { TarStore } from "../lib/tar-store";

interface WasmState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Original: parse from in-memory bytes (kept for drag-and-drop, etc.) */
  parseTgz: ((data: Uint8Array) => Promise<ParseResult>) | null;
  /** Phase 1: fetch URL via streaming in WASM — no JS ArrayBuffer copy */
  fetchAndParseTgz: ((url: string) => Promise<ParseResult>) | null;
  /** Phase 2: index-only pass for lazy loading; returns index + TarStore */
  indexTgz: ((url: string) => Promise<{ index: IndexResult; store: TarStore }>) | null;
}

export function useWasm(): WasmState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const go = new (globalThis as any).Go();
        const result = await WebAssembly.instantiateStreaming(
          fetch("/tgz-parser.wasm"),
          go.importObject
        );
        // Run the Go program (non-blocking — it stays alive via select{})
        go.run(result.instance);
        setReady(true);
      } catch (err) {
        setError(
          `Failed to load WASM: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  // Original: parse from in-memory Uint8Array
  const parseTgz = ready
    ? async (data: Uint8Array): Promise<ParseResult> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr: string = await (window as any).__wasm_parseTgz(data);
        return JSON.parse(jsonStr) as ParseResult;
      }
    : null;

  // Phase 1: fetch + stream-parse in WASM
  const fetchAndParseTgz = ready
    ? async (url: string): Promise<ParseResult> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr: string = await (window as any).__wasm_fetchAndParseTgz(url);
        return JSON.parse(jsonStr) as ParseResult;
      }
    : null;

  // Phase 2: index-only pass for lazy loading
  const indexTgz = ready
    ? async (url: string): Promise<{ index: IndexResult; store: TarStore }> => {
        const store = new TarStore();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr: string = await (window as any).__wasm_indexTgz(
          url,
          store.appendChunk,
        );
        const index = JSON.parse(jsonStr) as IndexResult;
        store.finalize(index.files);

        return { index, store };
      }
    : null;

  return { ready, loading, error, parseTgz, fetchAndParseTgz, indexTgz };
}
