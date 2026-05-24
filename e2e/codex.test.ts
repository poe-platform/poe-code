import { readFileSync } from "node:fs";
import { describe, it, expect, beforeEach } from "vitest";
import { useContainer } from "@poe-code/e2e-test-runner";
import { DEFAULT_CODEX_MODEL, stripModelNamespace } from "../src/cli/constants.js";

const hookBridgeSettings = readFileSync(
  new URL("./fixtures/hook-bridge/.claude/settings.json", import.meta.url),
  "utf8"
);

describe("codex", () => {
  const container = useContainer({ testName: "codex" });

  beforeEach(async () => {
    const installResult = await container.exec("poe-code install codex");
    expect(installResult).toHaveExitCode(0);
  });

  it("configure and test", async () => {
    const result = await container.exec("poe-code configure codex --yes");
    expect(result).toHaveExitCode(0);

    await expect(container).toHaveFile(`${container.home}/.codex/config.toml`);
    const config = await container.readFile(`${container.home}/.codex/config.toml`);
    expect(config).toContain("model_provider");
    expect(config).toContain(`model = "${stripModelNamespace(DEFAULT_CODEX_MODEL)}"`);
    expect(config).toContain('model_verbosity = "medium"');
    expect(config).toContain("base_url");

    const testResult = await container.exec("poe-code test codex");
    expect(testResult).toSucceedWith("Tested Codex.");
  });

  it("test --isolated", async () => {
    const result = await container.exec("poe-code test codex --isolated");
    expect(result).toSucceedWith("Tested Codex.");
  });

  it("bridges Claude hooks through test spawn and cleans them up", async () => {
    await container.execOrThrow('mkdir -p .claude "$HOME/.local/bin" && git init -q');
    await container.writeFile(`${container.workspace}/.claude/settings.json`, hookBridgeSettings);
    await container.writeFile(
      `${container.home}/.local/bin/codex`,
      [
        "#!/bin/sh",
        "set -eu",
        'cp "$PWD/.codex/hooks.json" "$PWD/observed-hooks.json"',
        'cp "$PWD/.git/info/exclude" "$PWD/observed-exclude"',
        "printf 'CODEX_OK\\n'",
        ""
      ].join("\n")
    );
    await container.execOrThrow('chmod +x "$HOME/.local/bin/codex"');
    await container.execOrThrow("poe-code configure codex --yes");

    const result = await container.exec(
      "poe-code test codex --hooks-from claude-code --hooks-strategy transform"
    );
    expect(result).toHaveExitCode(0);
    const commandOutput = `${result.stdout}\n${result.stderr}`;
    expect(commandOutput).toContain('Dropped bridged hook event "PreToolUse"');
    expect(commandOutput).toContain('handler type "http"');
    expect(commandOutput).toContain('Dropped bridged hook event "SessionEnd"');

    const observedHooks = JSON.parse(
      await container.readFile(`${container.workspace}/observed-hooks.json`)
    ) as {
      hooks?: Record<string, Array<{ matcher?: string; hooks: Array<{ statusMessage?: string }> }>>;
    };
    expect(Object.keys(observedHooks.hooks ?? {})).toEqual(["PreToolUse"]);
    const observedPreToolUse = observedHooks.hooks?.PreToolUse ?? [];
    expect(observedPreToolUse).toHaveLength(1);
    expect(observedPreToolUse[0]?.matcher).toBe("Bash");
    expect(observedPreToolUse[0]?.hooks).toHaveLength(1);
    expect(observedPreToolUse[0]?.hooks[0]?.statusMessage).toMatch(/^\[generated:/);

    const observedExclude = await container.readFile(`${container.workspace}/observed-exclude`);
    expect(observedExclude).toContain("poe-code-spawn-hooks:");

    expect(await container.fileExists(`${container.workspace}/.codex/hooks.json`)).toBe(false);
    const cleanedExclude = await container.readFile(`${container.workspace}/.git/info/exclude`);
    expect(cleanedExclude).not.toContain("poe-code-spawn-hooks:");
  });
});
