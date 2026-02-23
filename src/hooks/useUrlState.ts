import { useState, useEffect, useCallback } from "react";
import { getRegistry } from "../registries";

// ===== URL state types =====

export interface UrlState {
  registryId: string | null;
  packageName: string | null;
  version: string | null;
}

const EMPTY_STATE: UrlState = {
  registryId: null,
  packageName: null,
  version: null,
};

// ===== Parsing =====

/**
 * Parse a pathname into registry / package / version components.
 *
 * URL format:
 *   /                                → idle
 *   /{registryId}/{packageName}      → latest version
 *   /{registryId}/{packageName}@{v}  → specific version
 *
 * The version delimiter is the *last* `@` where the text after it contains
 * no `/`. This correctly handles:
 *   - npm scoped packages:  /npm/@babel/core@7.26.0
 *   - Go modules:           /golang/github.com/gin-gonic/gin@v1.11.0
 *   - Maven coordinates:    /maven/com.google.guava:guava@33.0.0
 */
export function parseUrl(pathname: string): UrlState {
  // Strip leading slash, ignore trailing slash
  const path = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path) return EMPTY_STATE;

  // First segment is the registry id
  const slashIdx = path.indexOf("/");
  if (slashIdx === -1) {
    // Just a registry id, no package — treat as idle
    return EMPTY_STATE;
  }

  const registryId = path.slice(0, slashIdx);
  if (!getRegistry(registryId)) {
    // Unknown registry — treat as idle
    return EMPTY_STATE;
  }

  const rest = path.slice(slashIdx + 1); // everything after "registryId/"

  // Find the version: last `@` where the suffix has no `/`
  let version: string | null = null;
  let packageName = rest;

  const lastAt = rest.lastIndexOf("@");
  if (lastAt > 0) {
    const candidate = rest.slice(lastAt + 1);
    if (candidate && !candidate.includes("/")) {
      version = decodeURIComponent(candidate);
      packageName = rest.slice(0, lastAt);
    }
  }

  packageName = decodeURIComponent(packageName);

  if (!packageName) return EMPTY_STATE;

  return { registryId, packageName, version };
}

// ===== Building =====

/**
 * Build a URL pathname from components.
 */
export function buildUrl(
  registryId: string,
  packageName: string,
  version?: string
): string {
  const encoded = packageName; // keep slashes, colons, @ in scoped names as-is
  if (version) {
    return `/${registryId}/${encoded}@${version}`;
  }
  return `/${registryId}/${encoded}`;
}

// ===== History helpers =====

export function pushUrl(
  registryId: string,
  packageName: string,
  version?: string
): void {
  const path = buildUrl(registryId, packageName, version);
  history.pushState({ registryId, packageName, version: version ?? null }, "", path);
}

export function replaceUrl(
  registryId: string,
  packageName: string,
  version?: string
): void {
  const path = buildUrl(registryId, packageName, version);
  history.replaceState({ registryId, packageName, version: version ?? null }, "", path);
}

export function pushIdle(): void {
  history.pushState(null, "", "/");
}

export function replaceIdle(): void {
  history.replaceState(null, "", "/");
}

// ===== Hook =====

/**
 * Reactive hook that tracks the current URL state and updates on popstate
 * (browser back/forward).
 *
 * Returns the current parsed URL state. The consumer should use the
 * exported push/replace helpers to update the URL (which do NOT trigger
 * popstate — only browser navigation does).
 */
export function useUrlState() {
  const [urlState, setUrlState] = useState<UrlState>(() =>
    parseUrl(window.location.pathname)
  );

  const handlePopState = useCallback(() => {
    setUrlState(parseUrl(window.location.pathname));
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handlePopState]);

  return urlState;
}
