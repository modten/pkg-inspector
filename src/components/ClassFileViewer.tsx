import { useEffect, useState } from "react";
import type { ParsedFile } from "../types";
import { useClassParser } from "../hooks/useClassParser";
import type { ClassInfo } from "../hooks/useClassParser";

interface ClassFileViewerProps {
  file: ParsedFile;
}

type Tab = "metadata" | "bytecode";

export function ClassFileViewer({ file }: ClassFileViewerProps) {
  const { parseClass, loading: wasmLoading } = useClassParser();
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("metadata");

  useEffect(() => {
    if (!file.rawBase64) {
      setError("No raw bytes available for this .class file");
      return;
    }

    let cancelled = false;
    setParsing(true);
    setError(null);
    setClassInfo(null);

    parseClass(file.rawBase64)
      .then((info) => {
        if (!cancelled) {
          setClassInfo(info);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to parse class file",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file.rawBase64, parseClass]);

  const isLoading = wasmLoading || parsing;

  if (isLoading) {
    return (
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
        {wasmLoading ? "Loading class parser..." : "Parsing class file..."}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm px-4">
        <div className="bg-red-950/30 border border-red-900 rounded-lg px-6 py-4 max-w-md text-center">
          {error}
        </div>
      </div>
    );
  }

  if (!classInfo) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "metadata"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
          onClick={() => setActiveTab("metadata")}
        >
          Class Metadata
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "bytecode"
              ? "text-blue-400 border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
          onClick={() => setActiveTab("bytecode")}
        >
          Bytecode
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "metadata" ? (
          <MetadataView info={classInfo} />
        ) : (
          <BytecodeView info={classInfo} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata tab
// ---------------------------------------------------------------------------

function MetadataView({ info }: { info: ClassInfo }) {
  return (
    <div className="p-4 text-sm space-y-4">
      {/* Class header */}
      <Section title="Class">
        <Row label="Name" value={info.className} />
        <Row label="Super class" value={info.superClass || "---"} />
        <Row label="Java version" value={`${info.javaVersion} (${info.majorVersion}.${info.minorVersion})`} />
        <Row label="Access" value={info.accessFlags.join(" ") || "---"} />
        {info.sourceFile && <Row label="Source file" value={info.sourceFile} />}
        {info.signature && <Row label="Signature" value={info.signature} mono />}
        {info.isDeprecated && (
          <div className="text-yellow-500 text-xs mt-1">Deprecated</div>
        )}
      </Section>

      {/* Interfaces */}
      {info.interfaces.length > 0 && (
        <Section title={`Interfaces (${info.interfaces.length})`}>
          {info.interfaces.map((iface) => (
            <div key={iface} className="text-gray-300 font-mono text-xs py-0.5">
              {iface}
            </div>
          ))}
        </Section>
      )}

      {/* Fields */}
      <Section title={`Fields (${info.fields.length})`}>
        {info.fields.length === 0 ? (
          <div className="text-gray-600 text-xs">No fields</div>
        ) : (
          <div className="space-y-1">
            {info.fields.map((f, i) => (
              <div
                key={i}
                className="font-mono text-xs py-1 border-b border-gray-800 last:border-0"
              >
                <span className="text-purple-400">
                  {f.accessFlags.join(" ")}
                </span>{" "}
                <span className="text-blue-300">{f.typeName}</span>{" "}
                <span className="text-gray-200">{f.name}</span>
                {f.signature && (
                  <span className="text-gray-600 ml-2">// {f.signature}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Methods */}
      <Section title={`Methods (${info.methods.length})`}>
        {info.methods.length === 0 ? (
          <div className="text-gray-600 text-xs">No methods</div>
        ) : (
          <div className="space-y-1">
            {info.methods.map((m, i) => (
              <div
                key={i}
                className="font-mono text-xs py-1 border-b border-gray-800 last:border-0"
              >
                <span className="text-purple-400">
                  {m.accessFlags.join(" ")}
                </span>{" "}
                <span className="text-blue-300">{m.returnType}</span>{" "}
                <span className="text-gray-200">{m.name}</span>
                <span className="text-gray-400">
                  ({m.paramTypes.join(", ")})
                </span>
                {m.exceptions && m.exceptions.length > 0 && (
                  <span className="text-yellow-400 ml-1">
                    throws {m.exceptions.join(", ")}
                  </span>
                )}
                {m.signature && (
                  <span className="text-gray-600 ml-2">// {m.signature}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bytecode tab
// ---------------------------------------------------------------------------

function BytecodeView({ info }: { info: ClassInfo }) {
  const methodsWithCode = info.methods.filter((m) => m.bytecode);

  if (methodsWithCode.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 text-sm">
        No bytecode available (all methods are abstract or native)
      </div>
    );
  }

  return (
    <div className="p-4 text-sm space-y-6">
      {methodsWithCode.map((m, i) => (
        <div key={i}>
          <div className="font-mono text-xs text-gray-400 mb-1">
            <span className="text-purple-400">
              {m.accessFlags.join(" ")}
            </span>{" "}
            <span className="text-blue-300">{m.returnType}</span>{" "}
            <span className="text-gray-200 font-medium">{m.name}</span>
            <span className="text-gray-500">
              ({m.paramTypes.join(", ")})
            </span>
            {m.maxStack !== undefined && (
              <span className="text-gray-600 ml-3">
                stack={m.maxStack} locals={m.maxLocals}
              </span>
            )}
          </div>
          <pre className="font-mono text-xs text-gray-300 bg-gray-900/50 rounded p-3 overflow-x-auto whitespace-pre border border-gray-800">
            {m.bytecode}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </h3>
      <div className="bg-gray-800/40 rounded-lg p-3 border border-gray-800">
        {children}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="text-gray-500 w-24 flex-shrink-0">{label}</span>
      <span
        className={`text-gray-200 ${mono ? "font-mono text-xs break-all" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
