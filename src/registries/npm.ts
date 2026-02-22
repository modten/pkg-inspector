import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";

const NPM_REGISTRY = "https://registry.npmjs.org";

export const npmAdapter: RegistryAdapter = {
  id: "npm",
  label: "npm",
  placeholder: "Enter package name, e.g. lodash, react, @babel/core",
  examples: ["lodash", "react", "express", "@babel/core"],
  parserType: "tgz",
  metaFileName: "package.json",
  metadataNeedsCors: false,
  archiveNeedsCors: false,

  async fetchPackageInfo(name: string): Promise<RegistryPackageInfo> {
    const url = `${NPM_REGISTRY}/${encodeURIComponent(name).replace("%40", "@").replace("%2F", "/")}`;
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
        dependencies: pkg.dependencies ?? {},
        devDependencies: pkg.devDependencies ?? {},
        scripts: pkg.scripts ?? {},
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
