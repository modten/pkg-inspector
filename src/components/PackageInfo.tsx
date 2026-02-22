import type { PackageInfo } from "../types";

interface PackageInfoProps {
  info: PackageInfo;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded mr-1.5 mb-1.5">
      {children}
    </span>
  );
}

export function PackageInfoPanel({ info }: PackageInfoProps) {
  const depCount = Object.keys(info.dependencies).length;
  const devDepCount = Object.keys(info.devDependencies).length;
  const scriptCount = Object.keys(info.scripts).length;
  const rawKeywords = info.metadata.keywords;
  const keywords: string[] = Array.isArray(rawKeywords)
    ? rawKeywords
    : typeof rawKeywords === "string"
      ? rawKeywords.split(/,\s*/)
      : [];
  const peerDeps = (info.metadata.peerDependencies as Record<string, string>) ?? {};
  const peerDepCount = Object.keys(peerDeps).length;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg font-semibold text-gray-100">{info.name}</h2>
        <span className="text-sm text-blue-400 font-mono">v{info.version}</span>
        {info.license && (
          <span className="text-xs bg-green-900/40 text-green-400 px-2 py-0.5 rounded">
            {info.license}
          </span>
        )}
      </div>

      {/* Description */}
      {info.description && (
        <p className="text-sm text-gray-400">{info.description}</p>
      )}

      {/* Links */}
      <div className="flex flex-wrap gap-4 text-xs">
        {info.homepage && (
          <a
            href={info.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            Homepage
          </a>
        )}
        {info.repository && (
          <a
            href={
              info.repository.startsWith("http")
                ? info.repository
                : `https://github.com/${info.repository}`
            }
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
          >
            Repository
          </a>
        )}
      </div>

      {/* Keywords */}
      {keywords.length > 0 && (
        <div>
          <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-1.5">
            Keywords
          </h3>
          <div className="flex flex-wrap">
            {keywords.map((kw) => (
              <Badge key={kw}>{kw}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Entry points */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
        {typeof info.metadata.main === "string" && (
          <span>
            main: <code className="text-gray-400">{info.metadata.main}</code>
          </span>
        )}
        {typeof info.metadata.module === "string" && (
          <span>
            module: <code className="text-gray-400">{info.metadata.module}</code>
          </span>
        )}
        {typeof info.metadata.types === "string" && (
          <span>
            types: <code className="text-gray-400">{info.metadata.types}</code>
          </span>
        )}
      </div>

      {/* Dependencies section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* dependencies */}
        {depCount > 0 && (
          <DepSection
            title={`Dependencies (${depCount})`}
            deps={info.dependencies}
          />
        )}

        {/* devDependencies */}
        {devDepCount > 0 && (
          <DepSection
            title={`Dev Dependencies (${devDepCount})`}
            deps={info.devDependencies}
          />
        )}

        {/* peerDependencies */}
        {peerDepCount > 0 && (
          <DepSection
            title={`Peer Dependencies (${peerDepCount})`}
            deps={peerDeps}
          />
        )}

        {/* scripts */}
        {scriptCount > 0 && (
          <div>
            <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
              Scripts ({scriptCount})
            </h3>
            <div className="space-y-1 max-h-40 overflow-auto">
              {Object.entries(info.scripts).map(([key, val]) => (
                <div key={key} className="text-xs font-mono">
                  <span className="text-purple-400">{key}</span>
                  <span className="text-gray-600 mx-1">:</span>
                  <span className="text-gray-400">{val}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DepSection({
  title,
  deps,
}: {
  title: string;
  deps: Record<string, string>;
}) {
  return (
    <div>
      <h3 className="text-xs text-gray-500 uppercase tracking-wide mb-2">
        {title}
      </h3>
      <div className="flex flex-wrap max-h-40 overflow-auto">
        {Object.entries(deps).map(([name, ver]) => (
          <Badge key={name}>
            {name}
            <span className="text-gray-500 ml-1">{ver}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}
