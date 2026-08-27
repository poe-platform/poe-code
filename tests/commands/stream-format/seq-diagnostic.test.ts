import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import test from "node:test";
import { native, nativeRoot, quote, shell } from "./helpers.js";

interface Observation { readonly exitCode: number; readonly stdoutHex: string; readonly stderr: string }
interface Fixture { readonly args: readonly string[]; readonly native: Observation; readonly source: Observation }
const initial = JSON.parse(readFileSync(new URL("./evidence/seq-diagnostic-initial.json", import.meta.url), "utf8")) as { cases: readonly Fixture[] };
const extraDirectiveFormats = new Set(["%f %f", "%g %e", "%f %", "%f %s", "%f %% %g", "%f %%%"]);

test("seq diagnostic oracle is pinned GNU 9.7 on Darwin arm64", () => {
  assert.equal(platform(), "darwin");
  assert.equal(release(), "25.4.0");
  assert.equal(arch(), "arm64");
  assert.equal(createHash("sha256").update(readFileSync(nativeRoot + "seq")).digest("hex"),
    "ffc2f2585818b4185924d73e839c93c44b9115f6e91a28b340760e4a0533f70f");
  const version = native("seq", { args: ["--version"] });
  assert.equal(version.exitCode, 0);
  assert.match(version.stdout.toString(), /^seq \(GNU coreutils\) 9\.7\n/u);
});

for (const fixture of initial.cases) {
  const format = fixture.args[1]!;
  test(`seq diagnostic ${JSON.stringify(format)}: ${extraDirectiveFormats.has(format) ? "identify extra directive operand" : "preserve negative distinction or escaped-percent output"}`, async () => {
    const reference = native("seq", { args: fixture.args });
    assert.deepEqual({ exitCode: reference.exitCode, stdoutHex: reference.stdout.toString("hex"), stderr: reference.stderr.toString() }, fixture.native);
    const instance = shell();
    try {
      const actual = await instance.exec(["seq", ...fixture.args.map(quote)].join(" "));
      assert.equal(actual.exitCode, fixture.source.exitCode);
      assert.equal(Buffer.from(actual.stdoutBytes).toString("hex"), fixture.source.stdoutHex);
      assert.equal(actual.exitCode, reference.exitCode);
      assert.deepEqual(Buffer.from(actual.stdoutBytes), reference.stdout);
      if (extraDirectiveFormats.has(format)) {
        assert.equal(actual.stderr, `seq: format '${format}' has too many % directives\n`);
        assert.deepEqual(Buffer.from(actual.stderrBytes), reference.stderr);
      } else {
        assert.equal(actual.stderr, fixture.source.stderr);
        if (["", "literal", "%%", "%%f"].includes(format)) {
          assert.equal(actual.stderr, "seq: format must contain exactly one conversion\n");
          assert.match(reference.stderr.toString(), /has no % directive\n$/u);
        } else if (["%", "%%%", "%s", "%%%s"].includes(format)) {
          assert.equal(actual.stderr, "seq: format requires one f, e or g conversion\n");
          assert.match(reference.stderr.toString(), /(?:ends in %|has unknown %s directive)\n$/u);
        } else assert.deepEqual(Buffer.from(actual.stderrBytes), reference.stderr);
      }
    } finally { await instance.dispose(); }
  });
}
