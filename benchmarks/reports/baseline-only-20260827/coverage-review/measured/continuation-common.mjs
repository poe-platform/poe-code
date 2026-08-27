import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { owned } from "./common.mjs";

export * from "./common.mjs";
export function publish(filename, value) {
  assert.ok(filename.startsWith(`${owned}/`) && !filename.includes(".."));
  assert.ok(!existsSync(filename), `Immutable review evidence already exists: ${filename}`);
  const text = typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  const patch = `*** Begin Patch\n*** Add File: ${filename}\n${text.replace(/\n$/, "").split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
  const result = spawnSync("apply_patch", [], { input: patch, encoding: "utf8", timeout: 30000, killSignal: "SIGTERM", maxBuffer: 32 * 1024 * 1024 });
  assert.equal(result.status, 0, `Publication failed: ${filename}; ${result.error?.message ?? ""}; signal=${result.signal}; ${result.stdout}\n${result.stderr}`);
}
