import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { directory, hash, hashes, save } from "./support.js";

const before = await hashes();
const results = [];
for (const mutation of ["baseline", "buffer-slice", "split-stdin"]) {
  const snapshot = await mkdtemp(`${directory}/.snapshot-`);
  const copied: Record<string, string> = {};
  for (const name of await readdir("src/commands/table-text")) {
    if (!name.endsWith(".ts")) continue;
    let source = await readFile(`src/commands/table-text/${name}`, "utf8");
    if (name === "internal.ts" && mutation !== "baseline") {
      const needle = mutation === "buffer-slice" ? "Uint8Array.from(result.value)" : 'if (name === "-" && this.stdin) return this.stdin;';
      assert.equal(source.split(needle).length, 2, "mutation must match exactly one production location");
      source = source.replace(needle, mutation === "buffer-slice" ? "result.value.slice()" : "");
    }
    source = source.replaceAll('"../../contracts/index.js"', JSON.stringify(resolve("src/contracts/index.js"))).replaceAll('"../internal.js"', JSON.stringify(resolve("src/commands/internal.js")));
    copied[name] = hash(source);
    const patch = `*** Begin Patch\n*** Add File: ${snapshot}/${name}\n${source.trimEnd().split("\n").map(line => `+${line}`).join("\n")}\n*** End Patch\n`;
    const applied = spawnSync("apply_patch", [], { input: patch, encoding: "utf8" });
    assert.equal(applied.status, 0, applied.stderr);
  }
  const result = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", "--test", "--test-name-pattern=fragmented reused Buffer|shared stdin creates", "tests/commands/table-text-stress/contracts.test.ts"], { encoding: "utf8", timeout: 20000, env: { ...process.env, TABLE_TEXT_CONTROL_MODULE: pathToFileURL(`${snapshot}/index.ts`).href } });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, mutation === "baseline" ? 0 : 1);
  assert.match(result.stdout, mutation === "baseline" ? /# pass 4\n/u : mutation === "buffer-slice" ? /# fail 3\n/u : /# fail 1\n/u);
  if (mutation !== "baseline") {
    assert.match(result.stdout, /ERR_ASSERTION/u);
    assert.doesNotMatch(result.stdout + result.stderr, /ERR_MODULE_NOT_FOUND|SyntaxError|ReferenceError|TypeError/u);
  }
  results.push({ mutation, copied, exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
}
const after = await hashes();
save(process.argv[2] ?? "mutation-evidence.json", { before, after, results, limitation: "Preliminary worker controls only; different root-assigned reviewer must independently run final controls. No live production mutation." });
console.log(results.map(result => ({ mutation: result.mutation, exitCode: result.exitCode })));
