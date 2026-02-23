// ===== User-configurable settings (persisted to localStorage) =====

const STORAGE_KEY = "pkg-inspector-settings";

/** Per-registry CORS override flags. */
export interface CorsOverride {
  metadataNeedsCors: boolean;
  archiveNeedsCors: boolean;
}

/** Application settings schema. */
export interface Settings {
  /**
   * Custom registry URLs keyed by registry id (e.g. "npm", "pypi").
   * Empty string means "use the default URL".
   */
  registryUrls: Record<string, string>;

  /**
   * Custom CORS proxy URL.
   * When non-empty this proxy is tried first; built-in proxies are used as
   * fallback.  The target URL is appended directly after this prefix.
   * Example: "https://my-proxy.example.com/?url="
   */
  corsProxyUrl: string;

  /**
   * Per-registry CORS flag overrides.
   * `null` means "use the adapter default".
   */
  corsOverrides: Record<string, CorsOverride | null>;
}

// ----- Default registry URLs (kept in sync with each adapter) -----

export const DEFAULT_REGISTRY_URLS: Record<string, string> = {
  npm: "https://registry.npmjs.org",
  pypi: "https://pypi.org/pypi",
  crates: "https://crates.io/api/v1/crates",
  golang: "https://proxy.golang.org",
  maven: "https://search.maven.org/solrsearch/select",
};

/**
 * Secondary URLs that some registries need (download / repo servers).
 * These are separate from the primary API URL.
 */
export const DEFAULT_SECONDARY_URLS: Record<string, string> = {
  crates: "https://static.crates.io/crates",
  maven: "https://repo1.maven.org/maven2",
};

// ----- Default CORS flags per registry -----

export const DEFAULT_CORS_FLAGS: Record<string, CorsOverride> = {
  npm: { metadataNeedsCors: false, archiveNeedsCors: false },
  pypi: { metadataNeedsCors: false, archiveNeedsCors: true },
  crates: { metadataNeedsCors: false, archiveNeedsCors: false },
  golang: { metadataNeedsCors: false, archiveNeedsCors: false },
  maven: { metadataNeedsCors: true, archiveNeedsCors: true },
};

// ----- Factory / load / save -----

export function getDefaultSettings(): Settings {
  return {
    registryUrls: {},
    corsProxyUrl: "",
    corsOverrides: {},
  };
}

/** Load settings from localStorage, falling back to defaults. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultSettings();
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      registryUrls: parsed.registryUrls ?? {},
      corsProxyUrl: parsed.corsProxyUrl ?? "",
      corsOverrides: parsed.corsOverrides ?? {},
    };
  } catch {
    return getDefaultSettings();
  }
}

/** Persist settings to localStorage. */
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silently ignore quota errors etc.
  }
}

// ----- Helpers used by registry adapters at runtime -----

/** Resolve the effective primary registry URL for a given registry id. */
export function getRegistryUrl(registryId: string): string {
  const settings = loadSettings();
  const custom = settings.registryUrls[registryId]?.trim();
  if (custom) return custom.replace(/\/+$/, ""); // strip trailing slashes
  return DEFAULT_REGISTRY_URLS[registryId] ?? "";
}

/** Resolve the effective secondary URL (download server) for a given registry id. */
export function getSecondaryUrl(registryId: string): string {
  // Secondary URLs are not user-configurable for now — only primary URLs are.
  return DEFAULT_SECONDARY_URLS[registryId] ?? "";
}

/** Resolve effective CORS flags for a given registry id. */
export function getCorsFlags(registryId: string): CorsOverride {
  const settings = loadSettings();
  const override = settings.corsOverrides[registryId];
  if (override) return override;
  return DEFAULT_CORS_FLAGS[registryId] ?? { metadataNeedsCors: false, archiveNeedsCors: false };
}
