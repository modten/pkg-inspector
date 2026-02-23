import { useState, useEffect, useCallback } from "react";
import type { Settings, CorsOverride } from "../lib/settings";
import {
  loadSettings,
  saveSettings,
  getDefaultSettings,
  DEFAULT_REGISTRY_URLS,
  DEFAULT_CORS_FLAGS,
} from "../lib/settings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Called after settings are saved so the parent can react. */
  onSave?: () => void;
}

/** Registry display metadata for the settings form. */
const REGISTRY_META: { id: string; label: string }[] = [
  { id: "npm", label: "npm" },
  { id: "pypi", label: "PyPI" },
  { id: "crates", label: "crates.io" },
  { id: "golang", label: "Go Modules" },
  { id: "maven", label: "Maven" },
];

export function SettingsModal({ open, onClose, onSave }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings>(getDefaultSettings);

  // Load settings from localStorage when modal opens
  useEffect(() => {
    if (open) {
      setSettings(loadSettings());
    }
  }, [open]);

  const handleRegistryUrlChange = useCallback(
    (registryId: string, value: string) => {
      setSettings((prev) => ({
        ...prev,
        registryUrls: { ...prev.registryUrls, [registryId]: value },
      }));
    },
    [],
  );

  const handleCorsProxyChange = useCallback((value: string) => {
    setSettings((prev) => ({ ...prev, corsProxyUrl: value }));
  }, []);

  const handleCorsOverrideChange = useCallback(
    (
      registryId: string,
      field: keyof CorsOverride,
      value: boolean,
    ) => {
      setSettings((prev) => {
        const existing = prev.corsOverrides[registryId];
        const defaults = DEFAULT_CORS_FLAGS[registryId] ?? {
          metadataNeedsCors: false,
          archiveNeedsCors: false,
        };
        const current = existing ?? { ...defaults };
        return {
          ...prev,
          corsOverrides: {
            ...prev.corsOverrides,
            [registryId]: { ...current, [field]: value },
          },
        };
      });
    },
    [],
  );

  const handleSave = useCallback(() => {
    saveSettings(settings);
    onSave?.();
    onClose();
  }, [settings, onSave, onClose]);

  const handleReset = useCallback(() => {
    const defaults = getDefaultSettings();
    setSettings(defaults);
    saveSettings(defaults);
    onSave?.();
  }, [onSave]);

  /** Resolve the effective CORS flags for a registry. */
  const getCorsFlag = useCallback(
    (registryId: string, field: keyof CorsOverride): boolean => {
      const override = settings.corsOverrides[registryId];
      if (override) return override[field];
      return DEFAULT_CORS_FLAGS[registryId]?.[field] ?? false;
    },
    [settings],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between rounded-t-xl z-10">
          <h2 className="text-lg font-semibold text-gray-100">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors p-1"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-8">
          {/* ===== Section: Registry URLs ===== */}
          <section>
            <h3 className="text-sm font-medium text-gray-300 mb-1">
              Registry URLs
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Override the default registry URL for each ecosystem. Leave empty to use the default.
            </p>

            <div className="space-y-3">
              {REGISTRY_META.map(({ id, label }) => (
                <div key={id}>
                  <label className="block text-xs text-gray-400 mb-1">
                    {label}
                  </label>
                  <input
                    type="text"
                    value={settings.registryUrls[id] ?? ""}
                    onChange={(e) =>
                      handleRegistryUrlChange(id, e.target.value)
                    }
                    placeholder={DEFAULT_REGISTRY_URLS[id]}
                    className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm
                               placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500
                               focus:border-transparent"
                  />
                </div>
              ))}
            </div>
          </section>

          {/* ===== Section: CORS Proxy ===== */}
          <section>
            <h3 className="text-sm font-medium text-gray-300 mb-1">
              CORS Proxy
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Set a custom CORS proxy URL. The target URL will be appended
              directly after this prefix. Falls back to built-in proxies if this
              fails.
            </p>

            <input
              type="text"
              value={settings.corsProxyUrl}
              onChange={(e) => handleCorsProxyChange(e.target.value)}
              placeholder="e.g. https://my-cors-proxy.example.com/?url="
              className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm
                         placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500
                         focus:border-transparent"
            />
          </section>

          {/* ===== Section: CORS Overrides ===== */}
          <section>
            <h3 className="text-sm font-medium text-gray-300 mb-1">
              CORS Settings per Registry
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Toggle whether metadata or archive requests go through a CORS
              proxy for each registry.
            </p>

            <div className="border border-gray-800 rounded-lg overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-3 gap-4 px-4 py-2 bg-gray-800/50 text-xs text-gray-400 font-medium">
                <span>Registry</span>
                <span className="text-center">Metadata CORS</span>
                <span className="text-center">Archive CORS</span>
              </div>

              {/* Table rows */}
              {REGISTRY_META.map(({ id, label }) => (
                <div
                  key={id}
                  className="grid grid-cols-3 gap-4 px-4 py-2.5 border-t border-gray-800 items-center"
                >
                  <span className="text-sm text-gray-300">{label}</span>
                  <div className="flex justify-center">
                    <Toggle
                      checked={getCorsFlag(id, "metadataNeedsCors")}
                      onChange={(v) =>
                        handleCorsOverrideChange(id, "metadataNeedsCors", v)
                      }
                    />
                  </div>
                  <div className="flex justify-center">
                    <Toggle
                      checked={getCorsFlag(id, "archiveNeedsCors")}
                      onChange={(v) =>
                        handleCorsOverrideChange(id, "archiveNeedsCors", v)
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex items-center justify-between rounded-b-xl">
          <button
            onClick={handleReset}
            className="text-sm text-gray-400 hover:text-gray-200 transition-colors"
          >
            Reset to defaults
          </button>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-300 hover:text-gray-100 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors
                         focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== Toggle component =====

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
        checked ? "bg-blue-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
          checked ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
