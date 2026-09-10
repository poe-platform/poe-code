import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "smol-toml";
import { resolveE2eModel, resolveE2eModelEnvironment, registerKimiFixtureModel } from "../e2e/runtime-models.js";

describe("live-test runtime models", () => {
  it("selects endpoint-compatible fixtures and preserves explicit overrides", () => {
    expect(resolveE2eModel("claude-code", {})).toBe("claude-sonnet-4.6");
    expect(resolveE2eModel("codex", {})).toBe("gpt-5.4");
    expect(resolveE2eModel("kimi", { POE_CODE_E2E_KIMI_MODEL: "custom-alias" })).toBe("custom-alias");
  });

  it("registers the selected Kimi model without replacing provider credentials or preferences", () => {
    const original = {
      default_model: "personal", default_thinking: true,
      providers: { poe: { type: "openai_legacy", base_url: "https://api.poe.com/v1", api_key: "fixture-key" } },
      models: { personal: { provider: "poe", model: "other", max_context_size: 64000 } },
    };
    const result = parse(registerKimiFixtureModel(stringify(original), "gpt-5.4"));
    expect(result).toEqual({ ...original, models: { ...original.models,
      "gpt-5.4": { provider: "poe", model: "gpt-5.4", max_context_size: 131072 },
    } });
  });

  it("preserves a user-defined model alias and refuses a missing provider", () => {
    const config = stringify({ providers: { poe: {} }, models: { custom: { provider: "other", model: "selected", max_context_size: 12345 } } });
    expect(registerKimiFixtureModel(config, "custom")).toBe(config);
    expect(() => registerKimiFixtureModel("", "gpt-5.4")).toThrow("poe provider");
  });

  it("uses an explicit context bound for another fixture model and rejects invalid bounds", () => {
    const config = stringify({ providers: { poe: {} } });
    expect(parse(registerKimiFixtureModel(config, "another", 64000)).models).toEqual({
      another: { provider: "poe", model: "another", max_context_size: 64000 },
    });
    expect(() => registerKimiFixtureModel(config, "another", Number.NaN)).toThrow("positive integer");
  });
});


describe("native model environment for E2E", () => {
  it("forwards the selected Goose model and preserves its fixture override", () => {
    for (const override of [undefined, "custom/model; literal"]) {
      const model = resolveE2eModel("goose", { POE_CODE_E2E_GOOSE_MODEL: override });
      const env = resolveE2eModelEnvironment("goose", model);
      expect(env).toEqual({ GOOSE_MODEL: override ?? "gpt-5.4" });
      expect(execFileSync(process.execPath, ["-e", "process.stdout.write(process.env.GOOSE_MODEL ?? '')"], {
        encoding: "utf8", env: { ...process.env, ...env },
      })).toBe(model);
    }
  });

  it.each(["claude-code", "codex", "opencode", "kimi"] as const)("leaves %s runtime environment unchanged", (agent) => {
    expect(resolveE2eModelEnvironment(agent, "selected")).toEqual({});
  });
});
