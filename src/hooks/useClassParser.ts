import { useCallback, useRef, useState } from "react";

// JSON shape returned by class-parser WASM
export interface ClassInfo {
  majorVersion: number;
  minorVersion: number;
  javaVersion: string;
  accessFlags: string[];
  className: string;
  superClass: string;
  interfaces: string[];
  sourceFile?: string;
  fields: FieldInfo[];
  methods: MethodInfo[];
  isDeprecated?: boolean;
  signature?: string;
}

export interface FieldInfo {
  accessFlags: string[];
  name: string;
  descriptor: string;
  typeName: string;
  signature?: string;
}

export interface MethodInfo {
  accessFlags: string[];
  name: string;
  descriptor: string;
  returnType: string;
  paramTypes: string[];
  exceptions?: string[];
  signature?: string;
  bytecode?: string;
  maxStack?: number;
  maxLocals?: number;
}

interface ClassParserState {
  /** Whether the class-parser WASM is loaded and ready */
  ready: boolean;
  /** Whether the WASM module is currently being loaded */
  loading: boolean;
  /** Error from loading or parsing */
  error: string | null;
  /** Parse a .class file from base64-encoded raw bytes */
  parseClass: (base64: string) => Promise<ClassInfo>;
}

/**
 * Lazy-loading hook for the class-parser WASM module.
 * The WASM is only fetched when parseClass() is first called.
 */
export function useClassParser(): ClassParserState {
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track init state across renders
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const readyRef = useRef(false);

  const ensureLoaded = useCallback(async () => {
    // Already loaded
    if (readyRef.current) return;

    // Already loading — wait for it
    if (initPromiseRef.current) {
      await initPromiseRef.current;
      return;
    }

    // Start loading
    const promise = (async () => {
      setLoading(true);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const GoClass = (globalThis as any).Go;
        const go = new GoClass();

        const result = await WebAssembly.instantiateStreaming(
          fetch("/class-parser.wasm"),
          go.importObject,
        );

        // Run the Go program (non-blocking — stays alive via select{})
        go.run(result.instance);

        readyRef.current = true;
        setReady(true);
      } catch (err) {
        const msg = `Failed to load class-parser WASM: ${err instanceof Error ? err.message : String(err)}`;
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    })();

    initPromiseRef.current = promise;
    await promise;
  }, []);

  const parseClass = useCallback(
    async (base64: string): Promise<ClassInfo> => {
      await ensureLoaded();

      // Decode base64 to Uint8Array
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jsonStr: string = await (window as any).__wasm_parseClass(bytes);
      return JSON.parse(jsonStr) as ClassInfo;
    },
    [ensureLoaded],
  );

  return { ready, loading, error, parseClass };
}
