import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { root, sourceEvidence } from "../helpers.js";
import { isolatedSpawn } from "../process.js";
import { cases } from "./cases.js";

function importedSource(): Record<string, string> {
  return Object.fromEntries(Object.entries(sourceEvidence().hashes).filter(([path]) =>
    path.startsWith("src/shell/") || path.startsWith("src/contracts/") || path.startsWith("src/fs/memory/")));
}

for (const name of Object.keys(cases)) {
  test(`independent script entrypoint: ${name}`, { timeout: 7000 }, async () => {
    const before = importedSource();
    const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--import", "tsx", fileURLToPath(new URL("./probe.ts", import.meta.url)), name], {
      cwd: root, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, timeout: 5000, maxBuffer: 65536,
    });
    assert.deepEqual(importedSource(), before, "Imported source changed during this probe; not stable evidence");
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr.toString());
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.deepEqual(JSON.parse(result.stdout.toString()), { passed: name });
  });
}
