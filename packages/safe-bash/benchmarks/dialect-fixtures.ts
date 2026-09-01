import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { TextCase } from "../tests/commands/text-programs-stress/cases.js";
import type { Comparison } from "../tests/commands/text-programs-stress/model.js";
import type { BenchmarkCase } from "./model.js";

export function dialectFixtures(): BenchmarkCase[] {
  const evidence = JSON.parse(readFileSync(new URL("../tests/commands/text-programs-stress/dialect-evidence.json", import.meta.url), "utf8")) as {
    results: { fixture: TextCase; gnu: Comparison }[];
  };
  return ["sed-regex-70", "sed-inplace-quit-per-file"].map(name => {
    const recorded = evidence.results.find(record => record.fixture.name === name);
    assert.ok(recorded, "Missing captured dialect fixture");
    const native = recorded.gnu.native;
    assert.equal(native.status, "completed");
    if (native.status !== "completed") throw new Error("Missing independent GNU result");
    const files = Object.fromEntries(Object.entries(native.observation.files).map(([path, entry]) => {
      assert.equal(entry.type, "file", "The regular-file comparator must not silently omit directories or special entries");
      assert.equal(typeof entry.bytes, "string");
      return [path, entry.bytes!];
    }));
    return {
      name: `gnu-sed-4.9:${name}`, tier: "gnu-sed-4.9-policy", tags: [recorded.fixture.feature], source: "native-dialect",
      script: ["sed", ...recorded.fixture.args].map(argument => `'${argument.replace(/'/gu, "'\\''")}'`).join(" "),
      initialFiles: recorded.fixture.files ?? {}, stdin: recorded.fixture.stdin ?? "", env: {},
      expected: { stdout: native.observation.stdout, stderr: native.observation.stderr, exitCode: native.observation.exitCode, files },
    };
  });
}
