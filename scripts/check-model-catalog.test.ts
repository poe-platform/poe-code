import { describe, expect, it } from "vitest";

import { DECLARED_MODEL_IDS } from "../src/cli/constants.js";
import { findUnresolvedModelIds, type ModelCatalogEntry } from "./check-model-catalog.js";

/**
 * Mirrors the shape of https://api.poe.com/v1/models: bare `id` plus a display
 * `owned_by` owner, which the CLI renders as `${owned_by.toLowerCase()}/${id}`.
 */
const LIVE_CATALOG_SAMPLE: ModelCatalogEntry[] = [
  { id: "claude-opus-4.7", owned_by: "Anthropic" },
  { id: "claude-sonnet-4.6", owned_by: "Anthropic" },
  { id: "claude-sonnet-4.5", owned_by: "Anthropic" },
  { id: "claude-haiku-4.5", owned_by: "Anthropic" },
  { id: "gpt-5.3-codex", owned_by: "OpenAI" },
  { id: "gpt-5.4-pro", owned_by: "OpenAI" },
  { id: "gemini-3.1-pro", owned_by: "Google" },
  { id: "gemini-2.5-pro", owned_by: "Google" },
  { id: "kimi-k2.5", owned_by: "Novita AI" },
  { id: "kimi-k2-thinking", owned_by: "Novita AI" }
];

describe("findUnresolvedModelIds", () => {
  it("resolves every model id declared in constants against the live catalog", () => {
    expect(findUnresolvedModelIds(DECLARED_MODEL_IDS, LIVE_CATALOG_SAMPLE)).toEqual([]);
  });

  it("reports a namespaced id whose model is missing from the catalog", () => {
    expect(findUnresolvedModelIds(["anthropic/claude-sonnet-5"], LIVE_CATALOG_SAMPLE)).toEqual([
      "anthropic/claude-sonnet-5"
    ]);
  });

  it("reports a namespaced id whose owner does not match the catalog", () => {
    expect(findUnresolvedModelIds(["novitaai/kimi-k2.5"], LIVE_CATALOG_SAMPLE)).toEqual([
      "novitaai/kimi-k2.5"
    ]);
  });

  it("resolves an id declared without a namespace by its bare model id", () => {
    expect(findUnresolvedModelIds(["gemini-2.5-pro", "gemini-9.9-pro"], LIVE_CATALOG_SAMPLE)).toEqual(
      ["gemini-9.9-pro"]
    );
  });
});
