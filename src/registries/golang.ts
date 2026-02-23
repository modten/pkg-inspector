import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";

const GO_PROXY = "https://proxy.golang.org";

/**
 * Encode a Go module path for use in proxy.golang.org URLs.
 * Uppercase letters are replaced with '!' followed by the lowercase letter.
 * e.g. "github.com/Azure/azure-sdk" -> "github.com/!azure/azure-sdk"
 */
function encodeModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (c) => "!" + c.toLowerCase());
}

export const golangAdapter: RegistryAdapter = {
  id: "golang",
  label: "Go Modules",
  placeholder: "Enter module path, e.g. github.com/gin-gonic/gin",
  examples: [
    "github.com/gin-gonic/gin",
    "golang.org/x/net",
    "github.com/gorilla/mux",
  ],
  parserType: "zip",
  metaFileName: "go.mod",
  metadataNeedsCors: false,
  archiveNeedsCors: false,

  async fetchPackageInfo(modulePath: string): Promise<RegistryPackageInfo> {
    const encoded = encodeModulePath(modulePath);

    // Fetch latest version info
    const latestUrl = `${GO_PROXY}/${encoded}/@latest`;
    const latestRes = await corsFetch(latestUrl, this.metadataNeedsCors);

    if (!latestRes.ok) {
      if (latestRes.status === 404 || latestRes.status === 410) {
        throw new Error(`Module "${modulePath}" not found on Go proxy`);
      }
      throw new Error(
        `Go proxy error: ${latestRes.status} ${latestRes.statusText}`,
      );
    }

    const latestData = await latestRes.json();
    const latestVersion: string = latestData.Version ?? "";

    // Fetch version list
    let versions: string[] = [];
    try {
      const listUrl = `${GO_PROXY}/${encoded}/@v/list`;
      const listRes = await corsFetch(listUrl, this.metadataNeedsCors);
      if (listRes.ok) {
        const listText = await listRes.text();
        versions = listText
          .split("\n")
          .map((v) => v.trim())
          .filter(Boolean);
      }
    } catch {
      // Version list is optional — just use latest
      versions = [latestVersion];
    }

    // If version list is empty, at least include the latest
    if (versions.length === 0) {
      versions = [latestVersion];
    }

    const tarballUrl = `${GO_PROXY}/${encoded}/@v/${latestVersion}.zip`;

    return {
      name: modulePath,
      version: latestVersion,
      description: "",
      tarballUrl,
      versions,
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

    const res = await corsFetch(tarballUrl, this.archiveNeedsCors);
    if (!res.ok) {
      throw new Error(
        `Failed to download module zip: ${res.status} ${res.statusText}`,
      );
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // Go module zips have paths like "module@version/go.mod"
    // e.g. "github.com/gin-gonic/gin@v1.11.0/go.mod"
    const goModFile = files.find(
      (f) => !f.isDir && f.path.endsWith("/go.mod"),
    );

    if (!goModFile || !goModFile.content) return null;

    try {
      return parseGoMod(goModFile.content);
    } catch {
      return null;
    }
  },
};

/**
 * Parse a go.mod file into PackageInfo.
 */
function parseGoMod(content: string): PackageInfo {
  const lines = content.split("\n");

  let moduleName = "";
  let goVersion = "";
  const dependencies: Record<string, string> = {};
  let inRequireBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // Module declaration
    const moduleMatch = line.match(/^module\s+(.+)/);
    if (moduleMatch) {
      moduleName = moduleMatch[1].trim();
      continue;
    }

    // Go version
    const goMatch = line.match(/^go\s+(.+)/);
    if (goMatch) {
      goVersion = goMatch[1].trim();
      continue;
    }

    // Require block start
    if (line === "require (") {
      inRequireBlock = true;
      continue;
    }

    // Require block end
    if (line === ")" && inRequireBlock) {
      inRequireBlock = false;
      continue;
    }

    // Single-line require
    const singleReq = line.match(/^require\s+(\S+)\s+(\S+)/);
    if (singleReq) {
      dependencies[singleReq[1]] = singleReq[2];
      continue;
    }

    // Inside require block
    if (inRequireBlock) {
      const reqMatch = line.match(/^(\S+)\s+(\S+)/);
      if (reqMatch && !line.startsWith("//")) {
        dependencies[reqMatch[1]] = reqMatch[2];
      }
    }
  }

  return {
    name: moduleName,
    version: "",
    description: "",
    license: "",
    homepage: "",
    repository: moduleName.startsWith("github.com")
      ? `https://${moduleName}`
      : "",
    dependencies,
    devDependencies: {},
    scripts: {},
    metadata: {
      "go-version": goVersion,
    },
  };
}
