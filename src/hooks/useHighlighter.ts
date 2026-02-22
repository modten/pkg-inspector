import { useState, useEffect, useRef } from "react";
import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
} from "shiki";

/**
 * Map file extensions to Shiki language identifiers.
 * Covers the most common file types found in npm packages.
 */
const LANG_MAP: Record<string, BundledLanguage> = {
  // JavaScript / TypeScript
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",

  // Data / Config
  json: "json",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  csv: "csv",

  // Markup / Docs
  md: "markdown",
  mdx: "mdx",
  html: "html",
  htm: "html",
  svg: "xml",

  // Styles
  css: "css",
  scss: "scss",
  less: "less",
  sass: "sass",
  styl: "stylus",

  // Shell
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",

  // Other languages sometimes found in npm packages
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",

  // Config / Build
  graphql: "graphql",
  gql: "graphql",
  sql: "sql",
  dockerfile: "dockerfile",
  makefile: "makefile",
  cmake: "cmake",

  // Other
  diff: "diff",
  patch: "diff",
  ini: "ini",
  env: "dotenv",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  wasm: "wasm",
};

/** Well-known file names that map to a language (no extension). */
const FILENAME_MAP: Record<string, string> = {
  Makefile: "makefile",
  Dockerfile: "dockerfile",
  Jenkinsfile: "groovy",
  ".gitignore": "ignore",
  ".gitattributes": "ignore",
  ".npmrc": "ini",
  ".npmignore": "ignore",
  ".editorconfig": "ini",
  ".env": "dotenv",
  ".env.example": "dotenv",
};

const THEME = "github-dark";

/** Resolve language ID from a file path. Returns null if unknown. */
function resolveLanguage(filePath: string): string | null {
  const fileName = filePath.split("/").pop() ?? "";

  // Check exact filename matches first
  if (fileName in FILENAME_MAP) {
    return FILENAME_MAP[fileName];
  }

  // Handle .d.ts, .d.mts, .d.cts specially
  if (/\.d\.[cm]?ts$/.test(fileName)) {
    return "typescript";
  }

  // Extract extension
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const ext = fileName.slice(dotIndex + 1).toLowerCase();

  return LANG_MAP[ext] ?? null;
}

/**
 * A highlighted line: array of HTML strings, one per line of source code.
 * Each string contains `<span>` elements with inline color styles.
 */
export type HighlightedLines = string[];

// ---- Singleton highlighter instance ----

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: [], // lazy-load all languages
    });
  }
  return highlighterPromise;
}

/**
 * Highlight source code and return an array of HTML strings (one per line).
 * Loads the language grammar on demand if not already loaded.
 * Returns null if the language is not recognized (caller should use plain text).
 */
async function highlight(
  code: string,
  filePath: string
): Promise<HighlightedLines | null> {
  const lang = resolveLanguage(filePath);
  if (!lang || lang === "plaintext") return null;

  const highlighter = await getHighlighter();

  // Load language on demand
  if (!loadedLangs.has(lang)) {
    try {
      await highlighter.loadLanguage(lang as BundledLanguage);
      loadedLangs.add(lang);
    } catch {
      // Language not available in shiki — fall back to plain text
      return null;
    }
  }

  // Generate HTML
  const html = highlighter.codeToHtml(code, { lang: lang as BundledLanguage, theme: THEME });

  // Extract individual line contents from Shiki output.
  // Shiki format: <pre ...><code><span class="line">...tokens...</span>\n<span class="line">...tokens...</span></code></pre>
  // Each line span contains nested <span> elements for tokens, so we can't use
  // a simple non-greedy regex. Instead, we extract the <code> content and split
  // on the boundary between line spans.
  const codeMatch = html.match(/<code>([\s\S]*?)<\/code>/);
  if (!codeMatch) return null;

  const inner = codeMatch[1];
  const PREFIX = '<span class="line">';
  const SUFFIX = "</span>";

  // Strip the outermost line-span open/close and split on boundaries
  const stripped = inner.slice(PREFIX.length, inner.length - SUFFIX.length);
  const lines = stripped.split(SUFFIX + "\n" + PREFIX);

  if (lines.length === 0) return null;

  return lines;
}

// ---- React hook ----

interface UseHighlighterResult {
  /** Whether the highlighter core is ready */
  ready: boolean;
  /** Highlighted HTML lines for the current file, or null if plain text */
  highlightedLines: HighlightedLines | null;
  /** Whether highlighting is in progress (language loading) */
  highlighting: boolean;
}

/**
 * React hook that manages syntax highlighting for a given file.
 * Returns highlighted lines when available, falls back gracefully.
 */
export function useHighlighter(
  file: { path: string; content: string; isBinary: boolean } | null
): UseHighlighterResult {
  const [ready, setReady] = useState(false);
  const [highlightedLines, setHighlightedLines] =
    useState<HighlightedLines | null>(null);
  const [highlighting, setHighlighting] = useState(false);

  // Track the latest request to avoid stale updates
  const requestIdRef = useRef(0);

  // Initialize highlighter on mount
  useEffect(() => {
    getHighlighter().then(() => setReady(true));
  }, []);

  // Highlight whenever file changes
  useEffect(() => {
    if (!file || file.isBinary || !file.content) {
      setHighlightedLines(null);
      setHighlighting(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setHighlighting(true);

    highlight(file.content, file.path).then((lines) => {
      // Only apply if this is still the latest request
      if (requestId === requestIdRef.current) {
        setHighlightedLines(lines);
        setHighlighting(false);
      }
    });
  }, [file?.path, file?.content, file?.isBinary]);

  return { ready, highlightedLines, highlighting };
}

/** Exported for use outside React if needed */
export { resolveLanguage, highlight };
