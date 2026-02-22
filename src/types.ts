// ===== Parsed archive types =====

export interface ParsedFile {
  path: string;
  size: number;
  isDir: boolean;
  content: string;
  isBinary: boolean;
}

export interface ParseResult {
  files: ParsedFile[];
}

// ===== Package metadata (unified across ecosystems) =====

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  license: string;
  homepage: string;
  repository: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  /** Ecosystem-specific extra fields */
  metadata: Record<string, unknown>;
}

// ===== Registry adapter interface =====

export type ParserType = "tgz" | "zip";

export interface RegistryAdapter {
  /** Unique identifier, e.g. "npm", "golang", "pypi" */
  id: string;
  /** Display label, e.g. "npm", "Go Modules" */
  label: string;
  /** Input placeholder text */
  placeholder: string;
  /** Example package names */
  examples: string[];
  /** Which WASM parser this ecosystem needs */
  parserType: ParserType;
  /** The primary metadata file to extract, e.g. "package.json" */
  metaFileName: string;
  /** Whether metadata API needs CORS proxy */
  metadataNeedsCors: boolean;
  /** Whether archive download needs CORS proxy */
  archiveNeedsCors: boolean;

  /** Fetch package metadata from registry */
  fetchPackageInfo(name: string): Promise<RegistryPackageInfo>;

  /** Download the archive as raw bytes */
  fetchArchive(
    name: string,
    version: string,
    tarballUrl?: string
  ): Promise<Uint8Array>;

  /** Extract structured PackageInfo from parsed files */
  extractMetadata(files: ParsedFile[]): PackageInfo | null;
}

/** Intermediate metadata returned by registry adapter */
export interface RegistryPackageInfo {
  name: string;
  version: string;
  description: string;
  tarballUrl: string;
  versions: string[];
}

// ===== File tree node (derived from flat file list) =====

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children: TreeNode[];
  file?: ParsedFile;
}

// ===== App state =====

export type AppStatus = "idle" | "loading" | "success" | "error";

export interface LoadingStep {
  label: string;
  done: boolean;
}
