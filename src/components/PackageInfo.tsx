import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);

  const depCount = Object.keys(info.dependencies).length;
  const devDepCount = Object.keys(info.devDependencies).length;
  const scriptCount = Object.keys(info.scripts).length;
  const rawKeywords = info.metadata.keywords;
  const keywords: string[] = Array.isArray(rawKeywords)
    ? rawKeywords
    : typeof rawKeywords === "string"
      ? rawKeywords.split(/,\s*/)
      : [];
  const peerDeps =
    (info.metadata.peerDependencies as Record<string, string>) ?? {};
  const peerDepCount = Object.keys(peerDeps).length;

  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
      {/* Header row — always visible */}
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Left: package identity */}
        <span className="font-semibold text-gray-100 text-sm">{info.name}</span>
        <span className="text-xs text-blue-400 font-mono">v{info.version}</span>
        {info.license && (
          <span className="text-xs bg-green-900/40 text-green-400 px-1.5 py-0.5 rounded">
            {info.license}
          </span>
        )}
        {depCount > 0 && (
          <span className="text-xs text-gray-500">{depCount} deps</span>
        )}
        {devDepCount > 0 && (
          <span className="text-xs text-gray-500">{devDepCount} dev</span>
        )}

        {/* Description (truncated, shown on wider screens) */}
        {info.description && (
          <span className="text-xs text-gray-500 truncate hidden lg:inline flex-1 ml-2">
            {info.description}
          </span>
        )}

        {/* Collapse / Expand toggle button */}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 bg-gray-700/60 hover:bg-gray-700 px-2.5 py-1 rounded transition-colors cursor-pointer flex-shrink-0"
        >
          {expanded ? "Collapse" : "Expand"}
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-700/50 max-h-64 overflow-auto space-y-4">
          {/* Description (full) */}
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
                main:{" "}
                <code className="text-gray-400">{info.metadata.main}</code>
              </span>
            )}
            {typeof info.metadata.module === "string" && (
              <span>
                module:{" "}
                <code className="text-gray-400">{info.metadata.module}</code>
              </span>
            )}
            {typeof info.metadata.types === "string" && (
              <span>
                types:{" "}
                <code className="text-gray-400">{info.metadata.types}</code>
              </span>
            )}
          </div>

          {/* Dependencies section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {depCount > 0 && (
              <DepSection
                title={`Dependencies (${depCount})`}
                deps={info.dependencies}
              />
            )}
            {devDepCount > 0 && (
              <DepSection
                title={`Dev Dependencies (${devDepCount})`}
                deps={info.devDependencies}
              />
            )}
            {peerDepCount > 0 && (
              <DepSection
                title={`Peer Dependencies (${peerDepCount})`}
                deps={peerDeps}
              />
            )}
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
      )}
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
