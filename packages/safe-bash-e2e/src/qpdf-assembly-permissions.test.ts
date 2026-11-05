import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";
import { runQpdfCli } from "../../safe-bash-command-qpdf/src/index.js";

for (const [flag, mask] of [["--modify=assembly", -300], ["--assemble=n", -1028]] as const) {
  it(`native qpdf verifies ${flag} permissions written by safe-bash`, async () => {
    const out = fileURLToPath(new URL("../../../out/", import.meta.url));
    await mkdir(out, { recursive: true });
    const directory = await mkdtemp(join(out, "qpdf-assembly-"));
    try {
      const input = join(directory, "input.pdf");
      const native = join(directory, "native.pdf");
      const actual = join(directory, "actual.pdf");
      execFileSync("qpdf", ["--empty", input]);
      const flags = ["--encrypt", "reader", "owner", "256", flag, "--"];
      execFileSync("qpdf", [...flags, input, native]);
      const files = new Map([[input, new Uint8Array(await readFile(input))]]);
      const result = await runQpdfCli([...flags, input, actual], files);
      assert.equal(result.exitCode, 0, result.stderr);
      await writeFile(actual, files.get(actual)!);
      const inspect = ["--password=reader", "--show-encryption"];
      const expected = execFileSync("qpdf", [...inspect, native], { encoding: "utf8" });
      assert.ok(expected.includes(`P = ${mask}\n`));
      assert.equal(execFileSync("qpdf", [...inspect, actual], { encoding: "utf8" }), expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
