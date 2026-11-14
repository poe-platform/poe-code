import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

for (const [fixture, oracle, offset] of [["qpdf-prefixed-table.pdf", "qpdf-json-sections.json", 14], ["qpdf-json-pages.pdf", "qpdf-json-pages.json", 0]]) {
  const bytes = readFileSync(new URL(`../../pdf-ast/src/fixtures/${fixture}`, import.meta.url)).subarray(offset);
  const cases = JSON.parse(readFileSync(new URL(`../../pdf-ast/src/fixtures/${oracle}`, import.meta.url), "utf8"));
  for (const { version, keys, mode = "none", expected } of cases) test(`native-only Wasm JSON ${version}: ${fixture} / ${keys.join(",") || "default"}`, async () => {
    const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
    try {
      await bash.fs.writeFile("/in.pdf", bytes);
      const args = [`--json=${version}`, `--json-stream-data=${mode}`, ...keys.map(k => `--json-key=${k}`)];
      const result = await bash.exec(`qpdf /in.pdf ${args.join(" ")}`);
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, "");
      assert.deepEqual(JSON.parse(result.stdout), expected);
      if (keys.length && keys.every(k => k === "pages")) {
        const selected = await bash.exec(`qpdf /in.pdf ${args.join(" ")} --json-stream-data=file --json-stream-prefix=/stream-`);
        assert.equal(selected.exitCode, 0, selected.stderr); assert.deepEqual(JSON.parse(selected.stdout), expected);
        assert.equal((await bash.fs.readdir("/")).some(entry => entry.name.startsWith("stream-")), false);
      }
      await bash.fs.writeFile("/out.json", "unchanged");
      const limited = await bash.exec(`qpdf /in.pdf ${args.join(" ")} /out.json`, { limits: { maxOutputBytes: 64 } });
      assert.notEqual(limited.exitCode, 0);
      assert.equal(Buffer.from(await bash.fs.readFile("/out.json")).toString(), "unchanged");
      assert.deepEqual(Buffer.from(await bash.fs.readFile("/in.pdf")), bytes);
    } finally { await bash.dispose(); }
  });
}
