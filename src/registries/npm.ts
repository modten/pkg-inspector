import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";
import { getRegistryUrl, getCorsFlags } from "../lib/settings";

export const npmAdapter: RegistryAdapter = {
  id: "npm",
  label: "npm",
  placeholder: "Enter package name, e.g. lodash, react, @babel/core",
  examples: ["lodash", "react", "express", "@babel/core"],
  parserType: "tgz",
  metaFileName: "package.json",

  get metadataNeedsCors() { return getCorsFlags("npm").metadataNeedsCors; },
  get archiveNeedsCors() { return getCorsFlags("npm").archiveNeedsCors; },

  async fetchPackageInfo(name: string): Promise<RegistryPackageInfo> {
    const registry = getRegistryUrl("npm");
    const url = `${registry}/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}`;
    const res = await corsFetch(url, this.metadataNeedsCors);

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Package "${name}" not found on npm`);
      }
      throw new Error(`npm registry error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const latestVersion: string =
      data["dist-tags"]?.latest ?? Object.keys(data.versions ?? {}).pop() ?? "";

    const versionData = data.versions?.[latestVersion];
    const tarballUrl: string = versionData?.dist?.tarball ?? "";

    const versions = Object.keys(data.versions ?? {});

    return {
      name: data.name ?? name,
      version: latestVersion,
      description: data.description ?? "",
      tarballUrl,
      versions,
    };
  },

  async fetchVersionInfo(name: string, version: string): Promise<RegistryPackageInfo> {
    const registry = getRegistryUrl("npm");
    const url = `${registry}/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}/${version}`;
    const res = await corsFetch(url, this.metadataNeedsCors);

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Version "${version}" not found for "${name}" on npm`);
      }
      throw new Error(`npm registry error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const tarballUrl: string = data.dist?.tarball ?? "";

    return {
      name: data.name ?? name,
      version: data.version ?? version,
      description: data.description ?? "",
      tarballUrl,
      versions: [], // not needed for version switch
    };
  },

  async fetchArchive(
    _name: string,
    _version: string,
    tarballUrl?: string
  ): Promise<Uint8Array> {
    if (!tarballUrl) {
      throw new Error("No tarball URL provided");
    }

    const res = await corsFetch(tarballUrl, this.archiveNeedsCors);
    if (!res.ok) {
      throw new Error(
        `Failed to download tarball: ${res.status} ${res.statusText}`
      );
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // npm tgz files typically have paths like "package/package.json"
    const pkgJsonFile = files.find(
      (f) =>
        !f.isDir &&
        (f.path === "package/package.json" ||
          f.path.endsWith("/package.json")) &&
        f.path.split("/").length <= 2
    );

    if (!pkgJsonFile || !pkgJsonFile.content) return null;

    try {
      const pkg = JSON.parse(pkgJsonFile.content);
      return {
        name: pkg.name ?? "",
        version: pkg.version ?? "",
        description: pkg.description ?? "",
        license: typeof pkg.license === "string"
          ? pkg.license
          : typeof pkg.license === "object" && pkg.license?.type
            ? pkg.license.type
            : "",
        homepage: pkg.homepage ?? "",
        repository:
          typeof pkg.repository === "string"
            ? pkg.repository
            : pkg.repository?.url ?? "",
        dependencies: (typeof pkg.dependencies === "object" && pkg.dependencies) ? pkg.dependencies : {},
        devDependencies: (typeof pkg.devDependencies === "object" && pkg.devDependencies) ? pkg.devDependencies : {},
        scripts: (typeof pkg.scripts === "object" && pkg.scripts) ? pkg.scripts : {},
        metadata: {
          main: pkg.main,
          module: pkg.module,
          types: pkg.types ?? pkg.typings,
          exports: pkg.exports,
          keywords: pkg.keywords,
          author: pkg.author,
          engines: pkg.engines,
          peerDependencies: pkg.peerDependencies,
        },
      };
    } catch {
      return null;
    }
  },
};
