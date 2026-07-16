#!/usr/bin/env tsx
import { fileURLToPath } from "node:url";

import { DECLARED_MODEL_IDS } from "../src/cli/constants.js";

export interface ModelCatalogEntry {
  id: string;
  owned_by: string;
}

/**
 * Returns the declared model ids that no live catalog entry resolves.
 * A namespaced id must match `${owned_by.toLowerCase()}/${id}` (how the models
 * command labels a model); a bare id must match the catalog `id`.
 */
export function findUnresolvedModelIds(
  declared: readonly string[],
  catalog: readonly ModelCatalogEntry[]
): string[] {
  const labels = new Set(catalog.map((entry) => `${entry.owned_by.toLowerCase()}/${entry.id}`));
  const ids = new Set(catalog.map((entry) => entry.id));
  return declared.filter((model) => !(model.includes("/") ? labels.has(model) : ids.has(model)));
}

async function fetchCatalog(): Promise<ModelCatalogEntry[]> {
  const apiKey = process.env.POE_API_KEY;
  if (!apiKey) {
    throw new Error("POE_API_KEY is required to check declared model ids against the catalog.");
  }
  const baseUrl = process.env.POE_BASE_URL ?? "https://api.poe.com";
  const response = await fetch(`${baseUrl}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch the Poe model catalog (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as { data?: ModelCatalogEntry[] };
  const catalog = body.data ?? [];
  if (catalog.length === 0) {
    throw new Error("The Poe model catalog returned no models.");
  }
  return catalog;
}

async function main(): Promise<void> {
  const catalog = await fetchCatalog();
  const unresolved = findUnresolvedModelIds(DECLARED_MODEL_IDS, catalog);
  if (unresolved.length > 0) {
    console.error(
      [
        `${unresolved.length} declared model id(s) do not exist in the live Poe catalog:`,
        ...unresolved.map((model) => `  - ${model}`),
        "Update src/cli/constants.ts to ids listed by `poe-code models`."
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `All ${DECLARED_MODEL_IDS.length} declared model ids resolve against ${catalog.length} catalog models.`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
