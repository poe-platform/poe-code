import assert from "node:assert/strict";
import { test } from "node:test";
import { success, withFixture, writableAdapters } from "../../../integration/adapter-tools/fixtures.js";
import { evidence } from "./evidence.js";

const native = evidence.cases.find(fixture => fixture.id === "matrix-raw-lines")!;
for (const backend of writableAdapters) {
  test(`split aggregate dispatch: ${backend} stdin, files and coding pipeline`, { timeout: 20000 }, async () => {
    await withFixture(backend, async ({ exec, fs, dispatched }) => {
      const result = await exec("jq -R -s 'split(\"\\n\") | map(select(length > 0))'", { stdin: native.input });
      assert.equal(result.exitCode, native.status, result.stderr);
      assert.deepEqual(Buffer.from(result.stdout), Buffer.from(native.stdout));
      assert.equal(result.stderr, native.stderr);
      assert.ok(dispatched.includes("jq"));
      const filter = "jq -R -s 'split(\"\\n\") | map(select(length > 0))'";
      success(await exec(`${filter} old.txt`), native.stdout);
      success(await exec(`set -o pipefail; cat old.txt | ${filter} > split-lines.json`), "");
      assert.deepEqual(Buffer.from(await fs.readFile("/work/split-lines.json")), Buffer.from(native.stdout));
      success(await exec("jq -r '.[]' < split-lines.json"), native.input);
      const pipeline = "find src -type f -name '*.txt' | xargs rg --no-heading --no-filename '^TODO' | sed 's/^TODO //' | awk '{ print $1 \":\" $2 }'";
      success(await exec(`set -o pipefail; ${pipeline} | ${filter} > split-report.json`), "");
      assert.deepEqual(JSON.parse(Buffer.from(await fs.readFile("/work/split-report.json")).toString()), ["alpha:2", "beta:3"]);
      success(await exec("jq -r '.[]' split-report.json"), "alpha:2\nbeta:3\n");
      for (const command of ["find", "xargs", "rg", "sed", "awk", "jq", "cat"]) assert.ok(dispatched.includes(command));
    });
  });
}
