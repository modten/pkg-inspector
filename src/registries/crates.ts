import { parse as parseTOML } from "smol-toml";
import type {
  RegistryAdapter,
  RegistryPackageInfo,
  ParsedFile,
  PackageInfo,
} from "../types";
import { corsFetch } from "../lib/cors";

const CRATES_API = "https://crates.io/api/v1/crates";
const CRATES_DOWNLOAD = "https://static.crates.io/crates";

export const cratesAdapter: RegistryAdapter = {
  id: "crates",
  label: "crates.io",
  placeholder: "Enter crate name, e.g. serde, tokio, rand",
  examples: ["serde", "tokio", "rand", "clap"],
  parserType: "tgz",
  metaFileName: "Cargo.toml",
  metadataNeedsCors: false,
  archiveNeedsCors: false,

  async fetchPackageInfo(name: string): Promise<RegistryPackageInfo> {
    const url = `${CRATES_API}/${encodeURIComponent(name)}`;
    const res = await corsFetch(url, this.metadataNeedsCors);

    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(`Crate "${name}" not found on crates.io`);
      }
      throw new Error(`crates.io API error: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const crate = data.crate;
    const latestVersion: string = crate?.max_version ?? "";

    const versions: string[] = (data.versions ?? [])
      .map((v: { num: string }) => v.num)
      .filter(Boolean);

    const tarballUrl = `${CRATES_DOWNLOAD}/${encodeURIComponent(name)}/${encodeURIComponent(name)}-${latestVersion}.crate`;

    return {
      name: crate?.name ?? name,
      version: latestVersion,
      description: crate?.description ?? "",
      tarballUrl,
      versions,
    };
  },

  async fetchVersionInfo(name: string, version: string): Promise<RegistryPackageInfo> {
    const tarballUrl = `${CRATES_DOWNLOAD}/${encodeURIComponent(name)}/${encodeURIComponent(name)}-${version}.crate`;

    return {
      name,
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
      throw new Error("No tarball URL provided");
    }

    const res = await corsFetch(tarballUrl, this.archiveNeedsCors);
    if (!res.ok) {
      throw new Error(
        `Failed to download crate: ${res.status} ${res.statusText}`,
      );
    }

    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  extractMetadata(files: ParsedFile[]): PackageInfo | null {
    // .crate files have paths like "{name}-{version}/Cargo.toml"
    const cargoFile = files.find(
      (f) =>
        !f.isDir &&
        f.path.endsWith("/Cargo.toml") &&
        f.path.split("/").length <= 2,
    );

    if (!cargoFile || !cargoFile.content) return null;

    try {
      const toml = parseTOML(cargoFile.content);
      const pkg = (toml.package ?? {}) as Record<string, unknown>;

      // Dependencies can be simple ("version") or table ({version = "...", features = [...]})
      const extractDeps = (
        section: unknown,
      ): Record<string, string> => {
        if (!section || typeof section !== "object") return {};
        const deps: Record<string, string> = {};
        for (const [k, v] of Object.entries(
          section as Record<string, unknown>,
        )) {
          if (typeof v === "string") {
            deps[k] = v;
          } else if (typeof v === "object" && v !== null) {
            deps[k] = (v as Record<string, unknown>).version as string ?? "*";
          }
        }
        return deps;
      };

      const repository =
        typeof pkg.repository === "string" ? pkg.repository : "";
      const homepage =
        typeof pkg.homepage === "string" ? pkg.homepage : "";

      return {
        name: typeof pkg.name === "string" ? pkg.name : "",
        version: typeof pkg.version === "string" ? pkg.version : "",
        description:
          typeof pkg.description === "string" ? pkg.description : "",
        license: typeof pkg.license === "string" ? pkg.license : "",
        homepage,
        repository,
        dependencies: extractDeps(toml.dependencies),
        devDependencies: extractDeps(toml["dev-dependencies"]),
        scripts: {},
        metadata: {
          edition: pkg.edition,
          "rust-version": pkg["rust-version"],
          keywords: pkg.keywords,
          categories: pkg.categories,
          "build-dependencies": extractDeps(toml["build-dependencies"]),
        },
      };
    } catch {
      return null;
    }
  },
};
