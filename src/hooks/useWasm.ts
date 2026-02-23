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
  /** Parse a zip archive from in-memory bytes */
  parseZip: ((data: Uint8Array) => Promise<ParseResult>) | null;
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
        // Load both WASM modules in parallel — each needs its own Go() instance.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const GoClass = (globalThis as any).Go;

        const goTgz = new GoClass();
        const goZip = new GoClass();

        const [tgzResult, zipResult] = await Promise.all([
          WebAssembly.instantiateStreaming(
            fetch("/tgz-parser.wasm"),
            goTgz.importObject,
          ),
          WebAssembly.instantiateStreaming(
            fetch("/zip-parser.wasm"),
            goZip.importObject,
          ),
        ]);

        // Run both Go programs (non-blocking — they stay alive via select{})
        goTgz.run(tgzResult.instance);
        goZip.run(zipResult.instance);

        setReady(true);
      } catch (err) {
        setError(
          `Failed to load WASM: ${err instanceof Error ? err.message : String(err)}`,
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

  // Zip parser: parse from in-memory Uint8Array
  const parseZip = ready
    ? async (data: Uint8Array): Promise<ParseResult> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr: string = await (window as any).__wasm_parseZip(data);
        return JSON.parse(jsonStr) as ParseResult;
      }
    : null;

  return { ready, loading, error, parseTgz, fetchAndParseTgz, indexTgz, parseZip };
}
