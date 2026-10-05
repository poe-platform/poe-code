import { yieldTurn } from "safe-bash-contracts/yield";
import type { LlmServiceModel } from "./service.js";

/** Combine catalog and persisted aliases with the same matching rules for every API. */
export function getLlmModelAliases({ provider, model }: LlmServiceModel, configured: Readonly<Record<string, string>>): readonly string[] {
  const aliases = new Set(model.aliases);
  for (const [alias, target] of Object.entries(configured)) {
    if (target === model.id || target === `${provider.name}/${model.id}` || model.aliases?.includes(target)) aliases.add(alias);
  }
  return [...aliases];
}

/** Select the shortest matching ID, preserving catalog order for equal lengths. */
export async function selectLlmModelByQuery(
  models: readonly LlmServiceModel[], queries: readonly string[],
  configuredAliases: Readonly<Record<string, string>> = {}, signal?: AbortSignal,
): Promise<LlmServiceModel> {
  if (!queries.length) throw new TypeError("Model selection requires a query");
  let selected: LlmServiceModel | undefined;
  const normalized = queries.map(query => query.toLowerCase());
  for (let index = 0; index < models.length; index++) {
    signal?.throwIfAborted();
    if (signal && index && index % 256 === 0) await yieldTurn(signal);
    const entry = models[index]!;
    const terms = [(entry.model.displayName ?? `${entry.provider.name}: ${entry.model.id}`), ...getLlmModelAliases(entry, configuredAliases), ...(entry.model.asyncModel ? [entry.model.id] : [])].map(value => value.toLowerCase());
    if (normalized.every(query => terms.some(term => term.includes(query))) &&
        (!selected || [...entry.model.id].length < [...selected.model.id].length)) selected = entry;
  }
  signal?.throwIfAborted();
  if (!selected) throw new Error(`No model found matching queries ${queries.join(", ")}`);
  return selected;
}
