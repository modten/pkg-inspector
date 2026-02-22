import type { RegistryAdapter } from "../types";
import { npmAdapter } from "./npm";

/**
 * All registered ecosystem adapters.
 * To add a new ecosystem, import its adapter and add it here.
 */
export const registries: RegistryAdapter[] = [
  npmAdapter,
  // Future: golangAdapter, pypiAdapter, cratesAdapter, mavenAdapter
];

/**
 * Look up a registry adapter by its ID.
 */
export function getRegistry(id: string): RegistryAdapter | undefined {
  return registries.find((r) => r.id === id);
}

/**
 * The default registry to show on first load.
 */
export const defaultRegistryId = "npm";
