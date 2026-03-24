import { describe, expect, it } from "vitest";
import { deepMergeDocuments } from "./merge.js";

describe("deepMergeDocuments", () => {
  it("returns the base document when override is empty", () => {
    const base = {
      core: { apiKey: "global-key" }
    };

    expect(deepMergeDocuments(base, {})).toEqual(base);
  });

  it("returns the override document when base is empty", () => {
    const override = {
      core: { apiKey: "project-key" }
    };

    expect(deepMergeDocuments({}, override)).toEqual(override);
  });

  it("unions disjoint scopes", () => {
    expect(
      deepMergeDocuments({ core: { apiKey: "global-key" } }, { ui: { darkMode: true } })
    ).toEqual({
      core: { apiKey: "global-key" },
      ui: { darkMode: true }
    });
  });

  it("merges disjoint keys within the same scope", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { codex: "openai/gpt-5.3-codex" }
        }
      )
    ).toEqual({
      models: {
        default: "anthropic/claude-sonnet-4.6",
        codex: "openai/gpt-5.3-codex"
      }
    });
  });

  it("prefers override values for overlapping keys", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { default: "anthropic/claude-opus-4.6" }
        }
      )
    ).toEqual({
      models: { default: "anthropic/claude-opus-4.6" }
    });
  });

  it("does not let undefined override clobber base values", () => {
    expect(
      deepMergeDocuments(
        {
          models: { default: "anthropic/claude-sonnet-4.6" }
        },
        {
          models: { default: undefined, codex: "openai/gpt-5.3-codex" }
        }
      )
    ).toEqual({
      models: {
        default: "anthropic/claude-sonnet-4.6",
        codex: "openai/gpt-5.3-codex"
      }
    });
  });

  it("returns the base document unchanged when override scope is empty", () => {
    const base = {
      core: { apiKey: "global-key" }
    };

    expect(deepMergeDocuments(base, { core: {} })).toEqual(base);
  });
});
