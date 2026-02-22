import { useState, useCallback } from "react";
import type {
  ParsedFile,
  PackageInfo,
  RegistryAdapter,
  AppStatus,
  LoadingStep,
} from "./types";
import { useWasm } from "./hooks/useWasm";
import { SearchBar } from "./components/SearchBar";
import { FileTree } from "./components/FileTree";
import { FilePreview } from "./components/FilePreview";
import { PackageInfoPanel } from "./components/PackageInfo";
import { Loading } from "./components/Loading";
import { registries } from "./registries";

export default function App() {
  const { ready: wasmReady, loading: wasmLoading, error: wasmError, parseTgz } = useWasm();

  const [status, setStatus] = useState<AppStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<LoadingStep[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ParsedFile | null>(null);
  const [packageInfo, setPackageInfo] = useState<PackageInfo | null>(null);
  const [inspectedName, setInspectedName] = useState("");

  const updateStep = useCallback(
    (index: number, done: boolean) => {
      setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, done } : s)));
    },
    []
  );

  const handleSearch = useCallback(
    async (registry: RegistryAdapter, name: string) => {
      if (!parseTgz) return;

      setStatus("loading");
      setError(null);
      setFiles([]);
      setSelectedFile(null);
      setPackageInfo(null);
      setInspectedName(name);

      const loadingSteps: LoadingStep[] = [
        { label: "Fetching package info...", done: false },
        { label: "Downloading archive...", done: false },
        { label: "Parsing contents...", done: false },
      ];
      setSteps(loadingSteps);

      try {
        // Step 1: Fetch package info from registry
        const pkgInfo = await registry.fetchPackageInfo(name);
        updateStep(0, true);

        // Step 2: Download the archive
        const archiveData = await registry.fetchArchive(
          pkgInfo.name,
          pkgInfo.version,
          pkgInfo.tarballUrl
        );
        updateStep(1, true);

        // Step 3: Parse with WASM
        const result = await parseTgz(archiveData);
        updateStep(2, true);

        // Extract metadata from parsed files
        const metadata = registry.extractMetadata(result.files);

        setFiles(result.files);
        setPackageInfo(metadata);
        setStatus("success");
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStatus("error");
      }
    },
    [parseTgz, updateStep]
  );

  const isLoading = status === "loading";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4 mb-3">
            <h1 className="text-lg font-bold text-gray-100 tracking-tight whitespace-nowrap">
              pkg-inspector
            </h1>
            <span className="text-xs text-gray-600 hidden sm:inline">
              Inspect packages in your browser &mdash; powered by Go WASM
            </span>
          </div>
          <SearchBar
            onSearch={handleSearch}
            disabled={isLoading || !wasmReady}
          />
        </div>
      </header>

      {/* WASM loading / error state */}
      {wasmLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loading steps={[]} message="Loading WASM module..." />
        </div>
      )}

      {wasmError && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-red-400 text-sm bg-red-950/30 border border-red-900 rounded-lg px-6 py-4 max-w-md">
            {wasmError}
          </div>
        </div>
      )}

      {/* Main content */}
      {wasmReady && (
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Idle state */}
          {status === "idle" && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-4 px-4">
              <svg className="w-16 h-16 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
              </svg>
              <p className="text-sm text-center">
                Enter a package name above to inspect its contents
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {["lodash", "react", "express", "chalk"].map((example) => (
                  <button
                    key={example}
                    onClick={() => handleSearch(registries[0], example)}
                    className="text-xs text-blue-400 hover:text-blue-300 bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded-md transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading state */}
          {status === "loading" && <Loading steps={steps} />}

          {/* Error state */}
          {status === "error" && (
            <div className="flex-1 flex items-center justify-center px-4">
              <div className="text-center max-w-md">
                <div className="text-red-400 text-sm bg-red-950/30 border border-red-900 rounded-lg px-6 py-4">
                  <p className="font-medium mb-1">
                    Failed to inspect &quot;{inspectedName}&quot;
                  </p>
                  <p className="text-red-300/70">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Success state */}
          {status === "success" && (
            <div className="flex-1 flex flex-col overflow-hidden max-w-screen-2xl mx-auto w-full">
              {/* Package info bar */}
              {packageInfo && (
                <div className="px-4 py-3 border-b border-gray-800">
                  <PackageInfoPanel info={packageInfo} />
                </div>
              )}

              {/* File explorer */}
              <div className="flex-1 flex overflow-hidden">
                {/* File tree (left panel) */}
                <div className="w-72 xl:w-80 border-r border-gray-800 overflow-auto flex-shrink-0 bg-gray-900/50">
                  <FileTree
                    files={files}
                    selectedPath={selectedFile?.path ?? null}
                    onSelectFile={setSelectedFile}
                  />
                </div>

                {/* File preview (right panel) */}
                <div className="flex-1 overflow-hidden bg-gray-900">
                  <FilePreview file={selectedFile} />
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
