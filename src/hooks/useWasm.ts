import { useEffect, useRef, useState } from "react";
import type { ParseResult } from "../types";

interface WasmState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  parseTgz: ((data: Uint8Array) => Promise<ParseResult>) | null;
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

  const parseTgz = ready
    ? async (data: Uint8Array): Promise<ParseResult> => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr: string = await (window as any).__wasm_parseTgz(data);
        return JSON.parse(jsonStr) as ParseResult;
      }
    : null;

  return { ready, loading, error, parseTgz };
}
