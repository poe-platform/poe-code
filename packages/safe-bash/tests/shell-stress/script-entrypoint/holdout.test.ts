import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileShellProbe, root, sourceEvidence } from "../helpers.js";
import { isolatedSpawn } from "../process.js";
import { cases } from "./cases.js";

function importedSource(): Record<string, string> {
  return Object.fromEntries(Object.entries(sourceEvidence().hashes).filter(([path]) =>
    path.startsWith("src/shell/") || path.startsWith("src/contracts/") || path.startsWith("src/fs/memory/")));
}

const before = importedSource();
const program = await compileShellProbe(fileURLToPath(new URL("./probe.ts", import.meta.url)));
after(() => assert.deepEqual(importedSource(), before, "Imported source changed during complete probe run; not stable evidence"));

for (const name of Object.keys(cases)) {
  test(`independent script entrypoint: ${name}`, { timeout: 7000 }, async () => {
    const result = await isolatedSpawn(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-", name], {
      cwd: root, input: program, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", TZ: "UTC" }, timeout: 5000, maxBuffer: 65536,
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null, result.stderr.toString());
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(result.stderr.toString(), "");
    assert.deepEqual(JSON.parse(result.stdout.toString()), { passed: name });
  });
}
