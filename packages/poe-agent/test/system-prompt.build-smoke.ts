import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");

describe("poe-agent built system prompt", () => {
  it("imports the built system-prompt module in plain node", () => {
    const modulePath = path.join(packageRoot, "dist/system-prompt.js");
    const moduleUrl = pathToFileURL(modulePath).href;
    const command = `await import(${JSON.stringify(moduleUrl)});`;

    const result = spawnSync(process.execPath, ["--input-type=module", "-e", command], {
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });
});
