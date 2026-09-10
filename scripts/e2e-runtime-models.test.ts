import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { resolveE2eModel, resolveE2eModelEnvironment } from "../e2e/runtime-models.js";

describe("live-test runtime models", () => {
  it("selects endpoint-compatible fixtures and preserves explicit overrides", () => {
    expect(resolveE2eModel("claude-code", {})).toBe("claude-sonnet-4.6");
    expect(resolveE2eModel("codex", {})).toBe("gpt-5.4");
    expect(resolveE2eModel("codex", { POE_CODE_E2E_CODEX_MODEL: "custom-alias" })).toBe("custom-alias");
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

  it.each(["claude-code", "codex", "opencode"] as const)("leaves %s runtime environment unchanged", (agent) => {
    expect(resolveE2eModelEnvironment(agent, "selected")).toEqual({});
  });
});
