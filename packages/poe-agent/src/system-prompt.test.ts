import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadSystemPrompt, loadSystemPromptSync } from "./system-prompt.js";

describe("poe-agent system prompt", () => {
  it("returns the bundled prompt asynchronously", async () => {
    const prompt = await loadSystemPrompt();

    expect(prompt).toContain("You are a Poe agent, built by Poe");
    expect(prompt).toContain("Assist with defensive security only");
  });

  it("returns the bundled prompt synchronously", () => {
    const prompt = loadSystemPromptSync();

    expect(prompt).toContain("You are a Poe agent, built by Poe");
    expect(prompt).toContain("Assist with defensive security only");
  });

  it("can import built system-prompt module in plain node", () => {
    const modulePath = path.resolve(import.meta.dir, "../dist/system-prompt.js");
    const moduleUrl = pathToFileURL(modulePath).href;
    const command = `await import(${JSON.stringify(moduleUrl)});`;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", command], {
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
