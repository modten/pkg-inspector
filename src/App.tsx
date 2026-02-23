import { useState, useCallback, useRef, useEffect } from "react";
import type {
  ParsedFile,
  PackageInfo,
  RegistryAdapter,
  AppStatus,
  LoadingStep,
} from "./types";
import { useWasm } from "./hooks/useWasm";
import { useUrlState, parseUrl, pushUrl, replaceUrl, pushIdle } from "./hooks/useUrlState";
import { TarStore } from "./lib/tar-store";
import { corsProxy } from "./lib/cors";
import { SearchBar } from "./components/SearchBar";
import { FileTree } from "./components/FileTree";
import { FilePreview } from "./components/FilePreview";
import { PackageInfoPanel } from "./components/PackageInfo";
import { Loading } from "./components/Loading";
import { registries, getRegistry } from "./registries";

/** Tarball size threshold for lazy loading (5 MB). */
const LAZY_THRESHOLD = 5 * 1024 * 1024;

export default function App() {
  const {
    ready: wasmReady,
    loading: wasmLoading,
    error: wasmError,
    fetchAndParseTgz,
    indexTgz,
    parseZip,
  } = useWasm();

  const urlState = useUrlState();

  const [status, setStatus] = useState<AppStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<LoadingStep[]>([]);
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<ParsedFile | null>(null);
  const [packageInfo, setPackageInfo] = useState<PackageInfo | null>(null);
  const [inspectedName, setInspectedName] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [currentRegistry, setCurrentRegistry] = useState<RegistryAdapter | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [selectedRegistry, setSelectedRegistry] = useState<RegistryAdapter>(
    () => {
      // Initialize from URL if a valid registry is in the path
      const initial = urlState.registryId ? getRegistry(urlState.registryId) : null;
      return initial ?? registries[0];
    }
  );

  // TarStore ref for lazy mode — persists across renders, cleaned up on new search.
  const tarStoreRef = useRef<TarStore | null>(null);

  const updateStep = useCallback(
    (index: number, done: boolean) => {
      setSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, done } : s))
      );
    },
    []
  );

  /**
   * Resolve the tarball URL, applying CORS proxy if needed.
   */
  const resolveUrl = useCallback(
    (tarballUrl: string, registry: RegistryAdapter): string => {
      return registry.archiveNeedsCors ? corsProxy(tarballUrl) : tarballUrl;
    },
    []
  );

  /**
   * Check tarball size via HEAD request to decide eager vs lazy path.
   * Returns content-length in bytes, or 0 if unavailable.
   */
  const getTarballSize = useCallback(async (url: string): Promise<number> => {
    try {
      const res = await fetch(url, { method: "HEAD" });
      const cl = res.headers.get("content-length");
      return cl ? parseInt(cl, 10) : 0;
    } catch {
      return 0;
    }
  }, []);

  /**
   * Reset all state back to idle (used by registry change and popstate).
   */
  const resetToIdle = useCallback(
    (registry?: RegistryAdapter) => {
      // Clean up previous lazy store.
      if (tarStoreRef.current) {
        tarStoreRef.current.dispose();
        tarStoreRef.current = null;
      }

      if (registry) setSelectedRegistry(registry);
      setStatus("idle");
      setError(null);
      setFiles([]);
      setSelectedFile(null);
      setPackageInfo(null);
      setInspectedName("");
      setFileLoading(false);
      setAvailableVersions([]);
      setCurrentRegistry(null);
      setVersionLoading(false);
    },
    []
  );

  /**
   * Handle registry change — reset to idle state with the new registry's examples.
   */
  const handleRegistryChange = useCallback(
    (registry: RegistryAdapter) => {
      resetToIdle(registry);
      pushIdle();
    },
    [resetToIdle]
  );

  const handleSearch = useCallback(
    async (registry: RegistryAdapter, name: string, version?: string) => {
      // Verify required parsers are available.
      if (registry.parserType === "tgz" && (!fetchAndParseTgz || !indexTgz)) return;
      if (registry.parserType === "zip" && !parseZip) return;

      // Clean up previous lazy store.
      if (tarStoreRef.current) {
        tarStoreRef.current.dispose();
        tarStoreRef.current = null;
      }

      setStatus("loading");
      setError(null);
      setFiles([]);
      setSelectedFile(null);
      setPackageInfo(null);
      setInspectedName(name);
      setFileLoading(false);
      setCurrentRegistry(registry);
      setSelectedRegistry(registry);
      setAvailableVersions([]);

      const loadingSteps: LoadingStep[] = [
        { label: "Fetching package info...", done: false },
        { label: "Downloading & parsing archive...", done: false },
      ];
      setSteps(loadingSteps);

      try {
        // Step 1: Fetch package info from registry (always needed for version list)
        const pkgInfo = await registry.fetchPackageInfo(name);
        updateStep(0, true);

        // Store sorted version list (newest first)
        const sortedVersions = [...pkgInfo.versions].sort((a, b) =>
          b.localeCompare(a, undefined, { numeric: true, sensitivity: "base" })
        );
        setAvailableVersions(sortedVersions);

        // If a specific version was requested, fetch that version's info instead
        const targetVersion = version ?? pkgInfo.version;
        const versionInfo = version
          ? await registry.fetchVersionInfo(name, version)
          : pkgInfo;

        if (registry.parserType === "zip") {
          // --- Zip path: always eager (download bytes in JS, parse in WASM) ---
          const archiveBytes = await registry.fetchArchive(
            versionInfo.name,
            versionInfo.version,
            versionInfo.tarballUrl,
          );
          const result = await parseZip!(archiveBytes);
          updateStep(1, true);

          const metadata = registry.extractMetadata(result.files);

          setFiles(result.files);
          setPackageInfo(metadata);
          setStatus("success");
        } else {
          // --- Tgz path: eager or lazy based on size ---
          const url = resolveUrl(versionInfo.tarballUrl, registry);

          // Determine eager vs lazy path based on tarball size.
          const tarballSize = await getTarballSize(url);
          const useLazy = tarballSize > LAZY_THRESHOLD;

          if (useLazy) {
            // --- Lazy path (Phase 2): index only, load files on demand ---
            const { index, store } = await indexTgz!(url);
            tarStoreRef.current = store;
            updateStep(1, true);

            const lazyFiles = store.toFiles(index.files);

            // Extract metadata — need to eagerly load the metadata file.
            const metaFile = lazyFiles.find(
              (f) =>
                !f.isDir &&
                (f.path === "package/" + registry.metaFileName ||
                  f.path.endsWith("/" + registry.metaFileName)) &&
                f.path.split("/").length <= 2
            );

            if (metaFile && metaFile.lazy) {
              const { content, isBinary } = await store.readFile(metaFile.path);
              metaFile.content = content;
              metaFile.isBinary = isBinary;
              metaFile.lazy = false;
            }

            const metadata = registry.extractMetadata(lazyFiles);

            setFiles(lazyFiles);
            setPackageInfo(metadata);
            setStatus("success");
          } else {
            // --- Eager path (Phase 1): fetch + parse everything in WASM ---
            const result = await fetchAndParseTgz!(url);
            updateStep(1, true);

            const metadata = registry.extractMetadata(result.files);

            setFiles(result.files);
            setPackageInfo(metadata);
            setStatus("success");
          }
        }

        // Update URL: replaceState to include the resolved version
        replaceUrl(registry.id, name, targetVersion);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStatus("error");
      }
    },
    [fetchAndParseTgz, indexTgz, parseZip, updateStep, resolveUrl, getTarballSize]
  );

  /**
   * Handle file selection — in lazy mode, load content on demand.
   */
  const handleSelectFile = useCallback(
    async (file: ParsedFile) => {
      if (file.lazy && tarStoreRef.current) {
        setSelectedFile({ ...file, content: "" });
        setFileLoading(true);

        try {
          const { content, isBinary } = await tarStoreRef.current.readFile(
            file.path
          );
          const loadedFile: ParsedFile = {
            ...file,
            content,
            isBinary,
            lazy: false,
          };
          setSelectedFile(loadedFile);

          // Update the file in the files array so it's cached for re-selection.
          setFiles((prev) =>
            prev.map((f) => (f.path === file.path ? loadedFile : f))
          );
        } catch (err) {
          setSelectedFile({
            ...file,
            content: `Error loading file: ${err instanceof Error ? err.message : String(err)}`,
            isBinary: false,
            lazy: false,
          });
        } finally {
          setFileLoading(false);
        }
      } else {
        setSelectedFile(file);
      }
    },
    []
  );

  /**
   * Handle version change — re-fetch and re-parse the archive for the selected version.
   */
  const handleVersionChange = useCallback(
    async (version: string) => {
      if (!currentRegistry) return;

      // Verify required parsers are available.
      if (currentRegistry.parserType === "tgz" && (!fetchAndParseTgz || !indexTgz)) return;
      if (currentRegistry.parserType === "zip" && !parseZip) return;

      // Skip if same version is already loaded.
      if (packageInfo?.version === version) return;

      // Clean up previous lazy store.
      if (tarStoreRef.current) {
        tarStoreRef.current.dispose();
        tarStoreRef.current = null;
      }

      setVersionLoading(true);
      setFiles([]);
      setSelectedFile(null);
      setFileLoading(false);

      try {
        // Fetch version-specific info (tarball URL)
        const versionInfo = await currentRegistry.fetchVersionInfo(inspectedName, version);

        if (currentRegistry.parserType === "zip") {
          // --- Zip path: always eager ---
          const archiveBytes = await currentRegistry.fetchArchive(
            versionInfo.name,
            versionInfo.version,
            versionInfo.tarballUrl,
          );
          const result = await parseZip!(archiveBytes);
          const metadata = currentRegistry.extractMetadata(result.files);

          setFiles(result.files);
          setPackageInfo(metadata);
        } else {
          // --- Tgz path: eager or lazy based on size ---
          const url = resolveUrl(versionInfo.tarballUrl, currentRegistry);
          const tarballSize = await getTarballSize(url);
          const useLazy = tarballSize > LAZY_THRESHOLD;

          if (useLazy) {
            const { index, store } = await indexTgz!(url);
            tarStoreRef.current = store;

            const lazyFiles = store.toFiles(index.files);

            // Eagerly load metadata file.
            const metaFile = lazyFiles.find(
              (f) =>
                !f.isDir &&
                (f.path === "package/" + currentRegistry.metaFileName ||
                  f.path.endsWith("/" + currentRegistry.metaFileName)) &&
                f.path.split("/").length <= 2
            );

            if (metaFile && metaFile.lazy) {
              const { content, isBinary } = await store.readFile(metaFile.path);
              metaFile.content = content;
              metaFile.isBinary = isBinary;
              metaFile.lazy = false;
            }

            const metadata = currentRegistry.extractMetadata(lazyFiles);

            setFiles(lazyFiles);
            setPackageInfo(metadata);
          } else {
            const result = await fetchAndParseTgz!(url);
            const metadata = currentRegistry.extractMetadata(result.files);

            setFiles(result.files);
            setPackageInfo(metadata);
          }
        }

        // Update URL with the new version (replaceState — no new history entry)
        if (currentRegistry) {
          replaceUrl(currentRegistry.id, inspectedName, version);
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "An unexpected error occurred"
        );
        setStatus("error");
      } finally {
        setVersionLoading(false);
      }
    },
    [currentRegistry, inspectedName, packageInfo?.version, fetchAndParseTgz, indexTgz, parseZip, resolveUrl, getTarballSize]
  );

  // --- URL-driven initial load ---
  // When the app mounts with a URL like /npm/lodash@4.17.21, auto-trigger search.
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!wasmReady || initialLoadDone.current) return;
    initialLoadDone.current = true;

    const { registryId, packageName, version } = parseUrl(window.location.pathname);
    if (!registryId || !packageName) return;

    const registry = getRegistry(registryId);
    if (!registry) return;

    handleSearch(registry, packageName, version ?? undefined);
  }, [wasmReady, handleSearch]);

  // --- Handle popstate (browser back/forward) ---
  // The urlState from useUrlState() updates reactively on popstate.
  // We compare it against current app state to decide what to do.
  const prevUrlRef = useRef(urlState);
  useEffect(() => {
    const prev = prevUrlRef.current;
    prevUrlRef.current = urlState;

    // Skip the initial render (handled by the mount effect above)
    if (prev === urlState) return;

    // If URL is now idle (e.g., user went back to /)
    if (!urlState.registryId || !urlState.packageName) {
      resetToIdle();
      return;
    }

    const registry = getRegistry(urlState.registryId);
    if (!registry) {
      resetToIdle();
      return;
    }

    // If registry or package changed, do a full search
    handleSearch(registry, urlState.packageName, urlState.version ?? undefined);
  }, [urlState, handleSearch, resetToIdle]);

  const isLoading = status === "loading";

  /**
   * Wrapper for user-initiated searches (from SearchBar submit).
   * Pushes a new URL history entry, then triggers the actual search.
   */
  const handleUserSearch = useCallback(
    (registry: RegistryAdapter, name: string) => {
      pushUrl(registry.id, name);
      handleSearch(registry, name);
    },
    [handleSearch]
  );

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
              Inspect packages in your browser
            </span>
          </div>
          <SearchBar
            onSearch={handleUserSearch}
            onRegistryChange={handleRegistryChange}
            disabled={isLoading || !wasmReady}
            registryId={selectedRegistry.id}
            packageName={inspectedName}
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
                {selectedRegistry.examples.map((example) => (
                  <button
                    key={example}
                    onClick={() => {
                      pushUrl(selectedRegistry.id, example);
                      handleSearch(selectedRegistry, example);
                    }}
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
            <div className="flex-1 flex flex-col min-h-0 max-w-screen-2xl mx-auto w-full">
              {/* Package info bar — collapsible */}
              {packageInfo && (
                <div className="px-4 py-2 flex-shrink-0">
                  <PackageInfoPanel
                    info={packageInfo}
                    versions={availableVersions}
                    onVersionChange={handleVersionChange}
                    versionLoading={versionLoading}
                  />
                </div>
              )}

              {/*
                File explorer — explicit max height ensures it always has
                a bounded visible area. Both file tree and file preview
                scroll independently within this container.
                14rem ~= header(~5rem) + package info collapsed(~3.5rem) + padding(~5.5rem)
              */}
              <div className="flex min-h-80 flex-1 max-h-[calc(100vh-14rem)] mx-4 mb-4 rounded-lg overflow-hidden border border-gray-700">
                {/* File tree (left panel) */}
                <div className="w-72 xl:w-80 border-r border-gray-800 overflow-auto flex-shrink-0 bg-gray-900/50">
                  <FileTree
                    files={files}
                    selectedPath={selectedFile?.path ?? null}
                    onSelectFile={handleSelectFile}
                  />
                </div>

                {/* File preview (right panel) */}
                <div className="flex-1 overflow-hidden bg-gray-900">
                  <FilePreview file={selectedFile} loading={fileLoading} />
                </div>
              </div>
            </div>
          )}
        </main>
      )}
    </div>
  );
}
