import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";
import { getRegistryUrl, getSecondaryUrl, getCorsFlags } from "../lib/settings";

/**
 * Parse a "groupId:artifactId" input string.
 */
function parseGAV(input: string): { groupId: string; artifactId: string } {
  const parts = input.split(":");
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid Maven coordinate "${input}". Expected format: groupId:artifactId (e.g. org.slf4j:slf4j-api)`,
    );
  }
  return { groupId: parts[0], artifactId: parts[1] };
}

export const mavenAdapter: RegistryAdapter = {
  id: "maven",
  label: "Maven",
  placeholder:
    "Enter groupId:artifactId, e.g. org.slf4j:slf4j-api",
  examples: [
    "org.slf4j:slf4j-api",
    "com.google.code.gson:gson",
    "javax.annotation:javax.annotation-api",
  ],
  parserType: "zip",
  metaFileName: "pom.xml",

  get metadataNeedsCors() { return getCorsFlags("maven").metadataNeedsCors; },
  get archiveNeedsCors() { return getCorsFlags("maven").archiveNeedsCors; },

  async fetchPackageInfo(input: string): Promise<RegistryPackageInfo> {
    const { groupId, artifactId } = parseGAV(input);
    const search = getRegistryUrl("maven");

    // Search for the artifact
    const searchUrl = `${search}?q=g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}&rows=1&wt=json`;
    const searchRes = await corsFetch(searchUrl, this.metadataNeedsCors);

    if (!searchRes.ok) {
      throw new Error(
        `Maven search error: ${searchRes.status} ${searchRes.statusText}`,
      );
    }

    const searchData = await searchRes.json();
    const docs = searchData?.response?.docs ?? [];

    if (docs.length === 0) {
      throw new Error(
        `Artifact "${groupId}:${artifactId}" not found on Maven Central`,
      );
    }

    const doc = docs[0];
    const latestVersion: string = doc.latestVersion ?? doc.v ?? "";

    // Fetch version list
    let versions: string[] = [latestVersion];
    try {
      const versionsUrl = `${search}?q=g:${encodeURIComponent(groupId)}+AND+a:${encodeURIComponent(artifactId)}&core=gav&rows=50&wt=json`;
      const versionsRes = await corsFetch(
        versionsUrl,
        this.metadataNeedsCors,
      );
      if (versionsRes.ok) {
        const versionsData = await versionsRes.json();
        const vDocs = versionsData?.response?.docs ?? [];
        if (vDocs.length > 0) {
          versions = vDocs.map(
            (d: { v: string }) => d.v,
          ).filter(Boolean);
        }
      }
    } catch {
      // Version list is best-effort
    }

    // Build download URL
    const repo = getSecondaryUrl("maven");
    const groupPath = groupId.replace(/\./g, "/");
    const tarballUrl = `${repo}/${groupPath}/${artifactId}/${latestVersion}/${artifactId}-${latestVersion}.jar`;

    return {
      name: `${groupId}:${artifactId}`,
      version: latestVersion,
      description: "",
      tarballUrl,
      versions,
    };
  },

  async fetchVersionInfo(input: string, version: string): Promise<RegistryPackageInfo> {
    const { groupId, artifactId } = parseGAV(input);
    const repo = getSecondaryUrl("maven");
    const groupPath = groupId.replace(/\./g, "/");
    const tarballUrl = `${repo}/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.jar`;

    return {
      name: `${groupId}:${artifactId}`,
      version,
      description: "",
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

    // Maven Central lacks CORS — use proxy
    const res = await corsFetch(tarballUrl, this.archiveNeedsCors);
    if (!res.ok) {
      throw new Error(
        `Failed to download JAR: ${res.status} ${res.statusText}`,
      );
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // JAR files contain pom.xml at META-INF/maven/{groupId}/{artifactId}/pom.xml
    const pomFile = files.find(
      (f) => !f.isDir && f.path.endsWith("/pom.xml"),
    );

    // Also look for MANIFEST.MF for extra metadata
    const manifestFile = files.find(
      (f) => !f.isDir && f.path.endsWith("META-INF/MANIFEST.MF"),
    );

    if (!pomFile || !pomFile.content) {
      // Try manifest-only fallback
      if (manifestFile?.content) {
        return parseManifest(manifestFile.content);
      }
      return null;
    }

    try {
      const info = parsePomXml(pomFile.content);

      // Enrich with MANIFEST.MF data if available
      if (manifestFile?.content) {
        const manifest = parseManifestHeaders(manifestFile.content);
        if (!info.metadata.packaging) {
          info.metadata.packaging = manifest["Bundle-Name"] ? "bundle" : "jar";
        }
      }

      return info;
    } catch {
      return null;
    }
  },
};

/**
 * Parse a pom.xml file using the browser's DOMParser.
 */
function parsePomXml(content: string): PackageInfo {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "text/xml");

  // Helper: get text content of a direct child element of the given parent.
  // Uses a namespace-agnostic approach since pom.xml may or may not declare xmlns.
  const getText = (parent: Element, tagName: string): string => {
    // Try direct children first
    for (const child of Array.from(parent.children)) {
      if (child.localName === tagName) {
        return child.textContent?.trim() ?? "";
      }
    }
    return "";
  };

  const project = doc.documentElement;

  const groupId = getText(project, "groupId");
  const artifactId = getText(project, "artifactId");
  const version = getText(project, "version");
  const name = getText(project, "name") || `${groupId}:${artifactId}`;
  const description = getText(project, "description");
  const url = getText(project, "url");
  const packaging = getText(project, "packaging") || "jar";

  // License
  let license = "";
  const licensesEl = Array.from(project.children).find(
    (c) => c.localName === "licenses",
  );
  if (licensesEl) {
    const licenseEl = Array.from(licensesEl.children).find(
      (c) => c.localName === "license",
    );
    if (licenseEl) {
      license = getText(licenseEl, "name");
    }
  }

  // SCM / repository
  let repository = "";
  const scmEl = Array.from(project.children).find(
    (c) => c.localName === "scm",
  );
  if (scmEl) {
    repository =
      getText(scmEl, "url") || getText(scmEl, "connection") || "";
    // Clean up scm: prefix
    repository = repository.replace(/^scm:(git|svn):/, "");
  }

  // Dependencies
  const dependencies: Record<string, string> = {};
  const depsEl = Array.from(project.children).find(
    (c) => c.localName === "dependencies",
  );
  if (depsEl) {
    for (const depEl of Array.from(depsEl.children)) {
      if (depEl.localName !== "dependency") continue;
      const depGroup = getText(depEl, "groupId");
      const depArtifact = getText(depEl, "artifactId");
      const depVersion = getText(depEl, "version") || "*";
      const scope = getText(depEl, "scope");
      // Skip test/provided scope
      if (scope === "test" || scope === "provided") continue;
      if (depGroup && depArtifact) {
        dependencies[`${depGroup}:${depArtifact}`] = depVersion;
      }
    }
  }

  // Parent info
  const parentEl = Array.from(project.children).find(
    (c) => c.localName === "parent",
  );
  const parentInfo = parentEl
    ? {
        groupId: getText(parentEl, "groupId"),
        artifactId: getText(parentEl, "artifactId"),
        version: getText(parentEl, "version"),
      }
    : undefined;

  return {
    name,
    version,
    description,
    license,
    homepage: url,
    repository,
    dependencies,
    devDependencies: {},
    scripts: {},
    metadata: {
      groupId,
      artifactId,
      packaging,
      parent: parentInfo,
    },
  };
}

/**
 * Parse MANIFEST.MF headers into a key-value map.
 */
function parseManifestHeaders(content: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const lines = content.split("\n");
  let currentKey = "";

  for (const line of lines) {
    // Continuation line (starts with a single space)
    if (line.startsWith(" ") && currentKey) {
      headers[currentKey] += line.substring(1).trimEnd();
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      currentKey = line.substring(0, colonIdx).trim();
      headers[currentKey] = line.substring(colonIdx + 1).trim();
    }
  }

  return headers;
}

/**
 * Fallback: create PackageInfo from MANIFEST.MF only.
 */
function parseManifest(content: string): PackageInfo {
  const headers = parseManifestHeaders(content);

  return {
    name: headers["Bundle-SymbolicName"] ?? headers["Implementation-Title"] ?? "",
    version: headers["Bundle-Version"] ?? headers["Implementation-Version"] ?? "",
    description: headers["Bundle-Description"] ?? "",
    license: "",
    homepage: "",
    repository: "",
    dependencies: {},
    devDependencies: {},
    scripts: {},
    metadata: {
      "Created-By": headers["Created-By"],
      "Built-By": headers["Built-By"],
      "Build-Jdk": headers["Build-Jdk"],
      "Main-Class": headers["Main-Class"],
    },
  };
}
