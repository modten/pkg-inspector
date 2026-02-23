import { useMemo } from "react";
import type { ParsedFile } from "../types";
import { useHighlighter } from "../hooks/useHighlighter";
import { ClassFileViewer } from "./ClassFileViewer";

interface FilePreviewProps {
  file: ParsedFile | null;
  loading?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreview({ file, loading }: FilePreviewProps) {
  const { highlightedLines } = useHighlighter(
    file && !loading ? file : null
  );

  const lines = useMemo(
    () => (file?.content ? file.content.split("\n") : []),
    [file?.content]
  );

  const lineNumberWidth = String(lines.length).length;

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Select a file to preview
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm flex-shrink-0">
        <span className="text-gray-300 font-mono truncate">{file.path}</span>
        <div className="flex items-center gap-3 ml-4 flex-shrink-0">
          {loading && (
            <span className="text-blue-400 text-xs">Loading...</span>
          )}
          <span className="text-gray-500 text-xs">
            {formatSize(file.size)}
          </span>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            <svg
              className="w-5 h-5 mr-2 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading file content...
          </div>
        ) : file.isBinary && file.isClassFile && file.rawBase64 ? (
          <ClassFileViewer file={file} />
        ) : file.isBinary ? (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Binary file &mdash; preview not available
          </div>
        ) : (
          <div className="flex text-sm font-mono leading-relaxed">
            {/* Line numbers */}
            <div className="select-none text-right text-gray-600 bg-gray-900/50 px-3 py-3 border-r border-gray-800 flex-shrink-0">
              {lines.map((_, i) => (
                <div key={i} style={{ minWidth: `${lineNumberWidth}ch` }}>
                  {i + 1}
                </div>
              ))}
            </div>

            {/* Code content */}
            {highlightedLines ? (
              <pre className="flex-1 px-4 py-3 overflow-x-auto whitespace-pre shiki-code">
                {highlightedLines.map((lineHtml, i) => (
                  <div
                    key={i}
                    dangerouslySetInnerHTML={{ __html: lineHtml || "&nbsp;" }}
                  />
                ))}
              </pre>
            ) : (
              <pre className="flex-1 px-4 py-3 overflow-x-auto text-gray-300 whitespace-pre">
                {file.content}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
