import type { ParsedFile } from "../types";

interface FilePreviewProps {
  file: ParsedFile | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreview({ file }: FilePreviewProps) {
  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
        Select a file to preview
      </div>
    );
  }

  const lines = file.content ? file.content.split("\n") : [];
  const lineNumberWidth = String(lines.length).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm flex-shrink-0">
        <span className="text-gray-300 font-mono truncate">{file.path}</span>
        <span className="text-gray-500 text-xs ml-4 flex-shrink-0">
          {formatSize(file.size)}
        </span>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {file.isBinary ? (
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
            <pre className="flex-1 px-4 py-3 overflow-x-auto text-gray-300 whitespace-pre">
              {file.content}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
