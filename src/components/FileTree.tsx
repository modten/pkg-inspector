import { useState, useMemo, useCallback } from "react";
import type { ParsedFile, TreeNode } from "../types";

interface FileTreeProps {
  files: ParsedFile[];
  selectedPath: string | null;
  onSelectFile: (file: ParsedFile) => void;
}

/**
 * Build a tree structure from a flat list of file paths.
 */
function buildTree(files: ParsedFile[]): TreeNode[] {
  const root: TreeNode = {
    name: "",
    path: "",
    isDir: true,
    size: 0,
    children: [],
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const partPath = parts.slice(0, i + 1).join("/");

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: partPath,
          isDir: isLast ? file.isDir : true,
          size: isLast ? file.size : 0,
          children: [],
          file: isLast && !file.isDir ? file : undefined,
        };
        current.children.push(child);
      }

      if (isLast) {
        child.size = file.size;
        child.isDir = file.isDir;
        if (!file.isDir) child.file = file;
      }

      current = child;
    }
  }

  // Sort: directories first, then alphabetically
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children.length > 0) sortTree(node.children);
    }
  }

  sortTree(root.children);

  // If there's a single top-level directory (e.g. "package/"), flatten it
  if (
    root.children.length === 1 &&
    root.children[0].isDir &&
    root.children[0].children.length > 0
  ) {
    return root.children[0].children;
  }

  return root.children;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TreeNodeItemProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onSelectFile: (file: ParsedFile) => void;
}

function TreeNodeItem({
  node,
  depth,
  selectedPath,
  expanded,
  onToggle,
  onSelectFile,
}: TreeNodeItemProps) {
  const isExpanded = expanded.has(node.path);
  const isSelected = selectedPath === node.path;

  function handleClick() {
    if (node.isDir) {
      onToggle(node.path);
    } else if (node.file) {
      onSelectFile(node.file);
    }
  }

  return (
    <div>
      <div
        onClick={handleClick}
        className={`flex items-center gap-1.5 py-0.5 px-2 cursor-pointer text-sm hover:bg-gray-700/50 rounded
                    ${isSelected ? "bg-blue-600/20 text-blue-300" : "text-gray-300"}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {/* Chevron / spacer */}
        {node.isDir ? (
          <svg
            className={`w-3 h-3 flex-shrink-0 text-gray-500 transition-transform ${isExpanded ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
          </svg>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Icon */}
        {node.isDir ? (
          isExpanded ? (
            <svg className="w-4 h-4 flex-shrink-0 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 00-3-3h-3.879a.75.75 0 01-.53-.22L11.47 3.66A2.25 2.25 0 009.879 3H6a3 3 0 00-3 3v3.162A3.756 3.756 0 014.094 9h15.812z" />
              <path fillRule="evenodd" d="M4.094 10.5a2.25 2.25 0 00-2.227 2.568l.857 6A2.25 2.25 0 004.951 21H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-2.227-2.568H4.094zM10 14a.75.75 0 000 1.5h4a.75.75 0 000-1.5h-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-4 h-4 flex-shrink-0 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
            </svg>
          )
        ) : (
          <svg className="w-4 h-4 flex-shrink-0 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
          </svg>
        )}

        {/* Name */}
        <span className="truncate flex-1">{node.name}</span>

        {/* Size (files only) */}
        {!node.isDir && (
          <span className="text-gray-600 text-xs flex-shrink-0 ml-2">
            {formatSize(node.size)}
          </span>
        )}
      </div>

      {/* Children */}
      {node.isDir && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              expanded={expanded}
              onToggle={onToggle}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelectFile }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);

  // Auto-expand first 2 levels
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    function expand(nodes: TreeNode[], depth: number) {
      for (const node of nodes) {
        if (node.isDir && depth < 2) {
          initial.add(node.path);
          expand(node.children, depth + 1);
        }
      }
    }
    expand(tree, 0);
    return initial;
  });

  const handleToggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="py-2 overflow-auto h-full text-sm font-mono">
      {tree.map((node) => (
        <TreeNodeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath}
          expanded={expanded}
          onToggle={handleToggle}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}
