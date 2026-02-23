import { useState, useEffect } from "react";
import type { RegistryAdapter } from "../types";
import { registries } from "../registries";

interface SearchBarProps {
  onSearch: (registry: RegistryAdapter, name: string) => void;
  onRegistryChange: (registry: RegistryAdapter) => void;
  disabled: boolean;
  /** Controlled registry id — syncs dropdown when URL changes */
  registryId?: string;
  /** Controlled package name — syncs input when URL changes */
  packageName?: string;
}

export function SearchBar({
  onSearch,
  onRegistryChange,
  disabled,
  registryId: controlledRegistryId,
  packageName: controlledPackageName,
}: SearchBarProps) {
  const [selectedRegistryId, setSelectedRegistryId] = useState(
    controlledRegistryId ?? registries[0].id
  );
  const [inputName, setInputName] = useState(controlledPackageName ?? "");

  // Sync registry dropdown when controlled prop changes (URL navigation)
  useEffect(() => {
    if (controlledRegistryId && controlledRegistryId !== selectedRegistryId) {
      setSelectedRegistryId(controlledRegistryId);
    }
  }, [controlledRegistryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync package name input when controlled prop changes (URL navigation)
  useEffect(() => {
    if (controlledPackageName !== undefined && controlledPackageName !== inputName) {
      setInputName(controlledPackageName);
    }
  }, [controlledPackageName]); // eslint-disable-line react-hooks/exhaustive-deps

  const registry = registries.find((r) => r.id === selectedRegistryId)!;

  function handleRegistrySelect(id: string) {
    setSelectedRegistryId(id);
    setInputName("");
    const newRegistry = registries.find((r) => r.id === id)!;
    onRegistryChange(newRegistry);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = inputName.trim();
    if (!name) return;
    onSearch(registry, name);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      {/* Ecosystem selector */}
      <select
        value={selectedRegistryId}
        onChange={(e) => handleRegistrySelect(e.target.value)}
        disabled={disabled}
        className="bg-gray-800 text-gray-200 border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   disabled:opacity-50 cursor-pointer"
      >
        {registries.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>

      {/* Package name input */}
      <div className="relative flex-1">
        <input
          type="text"
          value={inputName}
          onChange={(e) => setInputName(e.target.value)}
          placeholder={registry.placeholder}
          disabled={disabled}
          className="w-full bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-4 py-2.5 text-sm
                     placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500
                     focus:border-transparent disabled:opacity-50"
          autoFocus
        />
      </div>

      {/* Submit button */}
      <button
        type="submit"
        disabled={disabled || !inputName.trim()}
        className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-5 py-2.5 text-sm
                   transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                   focus:ring-offset-gray-950 disabled:opacity-50 disabled:cursor-not-allowed
                   whitespace-nowrap"
      >
        Inspect
      </button>
    </form>
  );
}
