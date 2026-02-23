import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";
import { getRegistryUrl, getCorsFlags } from "../lib/settings";

export const pypiAdapter: RegistryAdapter = {
  id: "pypi",
  label: "PyPI",
  placeholder: "Enter package name, e.g. six, click, idna",
  examples: ["six", "click", "toml", "idna"],
  parserType: "tgz",
  metaFileName: "PKG-INFO",

  get metadataNeedsCors() { return getCorsFlags("pypi").metadataNeedsCors; },
  get archiveNeedsCors() { return getCorsFlags("pypi").archiveNeedsCors; },

  async fetchPackageInfo(name: string): Promise<RegistryPackageInfo> {
    const api = getRegistryUrl("pypi");
    const url = `${api}/${encodeURIComponent(name)}/json`;
    const res = await corsFetch(url, this.metadataNeedsCors);

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Package "${name}" not found on PyPI`);
      }
      throw new Error(`PyPI API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const info = data.info ?? {};
    const latestVersion: string = info.version ?? "";

    // Find sdist (source distribution) URL — prefer sdist over wheel
    const urls: { packagetype: string; url: string }[] = data.urls ?? [];
    const sdist = urls.find((u) => u.packagetype === "sdist");
    const tarballUrl = sdist?.url ?? urls[0]?.url ?? "";

    // Version list from releases keys
    const versions = Object.keys(data.releases ?? {}).filter((v) => {
      const releaseFiles = data.releases[v];
      return Array.isArray(releaseFiles) && releaseFiles.length > 0;
    });

    return {
      name: info.name ?? name,
      version: latestVersion,
      description: info.summary ?? "",
      tarballUrl,
      versions,
    };
  },

  async fetchVersionInfo(name: string, version: string): Promise<RegistryPackageInfo> {
    const api = getRegistryUrl("pypi");
    const url = `${api}/${encodeURIComponent(name)}/${version}/json`;
    const res = await corsFetch(url, this.metadataNeedsCors);

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Version "${version}" not found for "${name}" on PyPI`);
      }
      throw new Error(`PyPI API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const info = data.info ?? {};

    // Find sdist URL for this specific version
    const urls: { packagetype: string; url: string }[] = data.urls ?? [];
    const sdist = urls.find((u) => u.packagetype === "sdist");
    const tarballUrl = sdist?.url ?? urls[0]?.url ?? "";

    return {
      name: info.name ?? name,
      version: info.version ?? version,
      description: info.summary ?? "",
      tarballUrl,
      versions: [],
    };
  },

  async fetchArchive(
    _name: string,
    _version: string,
    tarballUrl?: string,
  ): Promise<Uint8Array> {
    if (!tarballUrl) {
      throw new Error("No archive URL provided");
    }

    // files.pythonhosted.org lacks CORS — use proxy
    const res = await corsFetch(tarballUrl, this.archiveNeedsCors);
    if (!res.ok) {
      throw new Error(
        `Failed to download archive: ${res.status} ${res.statusText}`,
      );
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // sdist archives have paths like "{name}-{version}/PKG-INFO"
    const pkgInfoFile = files.find(
      (f) =>
        !f.isDir &&
        f.path.endsWith("/PKG-INFO") &&
        f.path.split("/").length <= 2,
    );

    if (!pkgInfoFile || !pkgInfoFile.content) {
      // Fall back to pyproject.toml if available
      return this._extractFromPyproject(files);
    }

    try {
      return this._parsePkgInfo(pkgInfoFile.content, files);
    } catch {
      return null;
    }
  },

  /** Parse RFC 822-style PKG-INFO metadata. */
  _parsePkgInfo(
    content: string,
    files: ParsedFile[],
  ): PackageInfo | null {
    const headers = new Map<string, string[]>();
    const lines = content.split("\n");
    let currentKey = "";

    for (const line of lines) {
      // Continuation line (starts with whitespace)
      if (/^\s+/.test(line) && currentKey) {
        const existing = headers.get(currentKey);
        if (existing) {
          existing[existing.length - 1] += "\n" + line.trimStart();
        }
        continue;
      }

      const match = line.match(/^([\w-]+):\s*(.*)/);
      if (match) {
        currentKey = match[1];
        const value = match[2];
        const existing = headers.get(currentKey);
        if (existing) {
          existing.push(value);
        } else {
          headers.set(currentKey, [value]);
        }
      }
    }

    const get = (key: string): string => headers.get(key)?.[0] ?? "";
    const getAll = (key: string): string[] => headers.get(key) ?? [];

    // Parse Requires-Dist into dependencies
    const dependencies: Record<string, string> = {};
    for (const req of getAll("Requires-Dist")) {
      // Format: "package-name (>=1.0)" or "package-name; extra == 'foo'"
      const depMatch = req.match(/^([a-zA-Z0-9_.-]+)\s*(.*)/);
      if (depMatch) {
        const depName = depMatch[1];
        let version = depMatch[2].trim();
        // Strip extras/conditions after semicolon
        const semiIdx = version.indexOf(";");
        if (semiIdx !== -1) version = version.substring(0, semiIdx).trim();
        // Clean up parens: (>=1.0) -> >=1.0
        version = version.replace(/^\(/, "").replace(/\)$/, "");
        dependencies[depName] = version || "*";
      }
    }

    // Try to extract scripts from setup.cfg or pyproject.toml
    const scripts = this._extractScripts(files);

    // Project URLs from PKG-INFO
    const projectUrls: Record<string, string> = {};
    for (const pu of getAll("Project-URL")) {
      const commaIdx = pu.indexOf(",");
      if (commaIdx !== -1) {
        projectUrls[pu.substring(0, commaIdx).trim()] =
          pu.substring(commaIdx + 1).trim();
      }
    }

    const homepage =
      get("Home-page") ||
      projectUrls["Homepage"] ||
      projectUrls["Home"] ||
      "";
    const repository =
      projectUrls["Repository"] ||
      projectUrls["Source"] ||
      projectUrls["Source Code"] ||
      "";

    return {
      name: get("Name"),
      version: get("Version"),
      description: get("Summary"),
      license: get("License"),
      homepage,
      repository,
      dependencies,
      devDependencies: {},
      scripts,
      metadata: {
        author: get("Author"),
        "author-email": get("Author-email"),
        "requires-python": get("Requires-Python"),
        classifiers: getAll("Classifier"),
        "project-urls": Object.keys(projectUrls).length
          ? projectUrls
          : undefined,
      },
    };
  },

  /** Try to extract console_scripts from setup.cfg or pyproject.toml. */
  _extractScripts(files: ParsedFile[]): Record<string, string> {
    // Best-effort — not critical if it fails
    const pyproject = files.find(
      (f) =>
        !f.isDir &&
        f.path.endsWith("/pyproject.toml") &&
        f.path.split("/").length <= 2,
    );
    if (pyproject?.content) {
      const scripts: Record<string, string> = {};
      const scriptSection = pyproject.content.match(
        /\[project\.scripts\]\s*\n([\s\S]*?)(?:\n\[|\n*$)/,
      );
      if (scriptSection) {
        for (const line of scriptSection[1].split("\n")) {
          const m = line.match(/^(\S+)\s*=\s*"(.+)"/);
          if (m) scripts[m[1]] = m[2];
        }
      }
      return scripts;
    }
    return {};
  },

  /** Fallback: extract metadata from pyproject.toml if PKG-INFO is missing. */
  _extractFromPyproject(files: ParsedFile[]): PackageInfo | null {
    const pyproject = files.find(
      (f) =>
        !f.isDir &&
        f.path.endsWith("/pyproject.toml") &&
        f.path.split("/").length <= 2,
    );
    if (!pyproject?.content) return null;

    try {
      // Import dynamically to avoid issues if smol-toml is not available
      // But since we already have it installed, use a simple regex approach
      // to avoid circular dependency issues with the TOML parser
      const content = pyproject.content;

      const getName = () => {
        const m = content.match(/^name\s*=\s*"(.+)"/m);
        return m?.[1] ?? "";
      };
      const getVersion = () => {
        const m = content.match(/^version\s*=\s*"(.+)"/m);
        return m?.[1] ?? "";
      };
      const getDesc = () => {
        const m = content.match(/^description\s*=\s*"(.+)"/m);
        return m?.[1] ?? "";
      };

      return {
        name: getName(),
        version: getVersion(),
        description: getDesc(),
        license: "",
        homepage: "",
        repository: "",
        dependencies: {},
        devDependencies: {},
        scripts: {},
        metadata: {},
      };
    } catch {
      return null;
    }
  },
} as RegistryAdapter & {
  _parsePkgInfo(content: string, files: ParsedFile[]): PackageInfo | null;
  _extractScripts(files: ParsedFile[]): Record<string, string>;
  _extractFromPyproject(files: ParsedFile[]): PackageInfo | null;
};
