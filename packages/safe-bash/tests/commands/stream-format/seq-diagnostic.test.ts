import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { quote, shell } from "./helpers.js";

interface Observation { exitCode: number; stdoutHex: string; stderr: string }
const captured: { cases: { args: string[]; source: Observation }[] } = JSON.parse(await readFile(new URL("./evidence/seq-diagnostic-initial.json", import.meta.url), "utf8"));
const extraDirectiveFormats = new Set(["%f %f", "%g %e", "%f %", "%f %s", "%f %% %g", "%f %%%"]);
for (const fixture of captured.cases) {
  const format = fixture.args[1]!;
  test(`seq diagnostic static regression: ${JSON.stringify(format)}`, async () => {
    const instance = shell();
    try {
      const actual = await instance.exec(["seq", ...fixture.args.map(quote)].join(" "));
      assert.equal(actual.exitCode, fixture.source.exitCode);
      assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), fixture.source.stdoutHex);
      if (extraDirectiveFormats.has(format)) {
        assert.equal(actual.stderr, `seq: format '${format}' has too many % directives\n`);
      } else {
        assert.equal(actual.stderr, fixture.source.stderr);
        if (["", "literal", "%%", "%%f"].includes(format)) assert.equal(actual.stderr, "seq: format must contain exactly one conversion\n");
        else if (["%", "%%%", "%s", "%%%s"].includes(format)) assert.equal(actual.stderr, "seq: format requires one f, e or g conversion\n");
      }
    } finally { await instance.dispose(); }
  });
}
