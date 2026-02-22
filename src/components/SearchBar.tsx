import { useState } from "react";
import type { RegistryAdapter } from "../types";
import { registries } from "../registries";

interface SearchBarProps {
  onSearch: (registry: RegistryAdapter, name: string) => void;
  disabled: boolean;
}

export function SearchBar({ onSearch, disabled }: SearchBarProps) {
  const [selectedRegistryId, setSelectedRegistryId] = useState(
    registries[0].id
  );
  const [packageName, setPackageName] = useState("");

  const registry = registries.find((r) => r.id === selectedRegistryId)!;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = packageName.trim();
    if (!name) return;
    onSearch(registry, name);
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      {/* Ecosystem selector */}
      <select
        value={selectedRegistryId}
        onChange={(e) => setSelectedRegistryId(e.target.value)}
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
          value={packageName}
          onChange={(e) => setPackageName(e.target.value)}
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
        disabled={disabled || !packageName.trim()}
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
