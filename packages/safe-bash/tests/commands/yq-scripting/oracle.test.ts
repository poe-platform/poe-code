import assert from "node:assert/strict";
import { test } from "node:test";
import { authenticateOracle, native, nativeOptions, run } from "./helpers.js";

test("malformed oracle prerequisites fail, never silently skip", async () => {
  for (const env of [
    {}, { SAFE_BASH_TEST_YQ: "" }, { SAFE_BASH_TEST_YQ_SHA256: "0".repeat(64) },
    { SAFE_BASH_TEST_YQ: "relative", SAFE_BASH_TEST_YQ_SHA256: "0".repeat(64) },
    { SAFE_BASH_TEST_YQ: "/absent", SAFE_BASH_TEST_YQ_SHA256: "invalid" },
    { SAFE_BASH_TEST_YQ: "/absent", SAFE_BASH_TEST_YQ_SHA256: "0".repeat(64) },
  ]) await assert.rejects(authenticateOracle(env));
});

test("pinned Mike Farah v4.53.3 flow-comment comparisons", nativeOptions, async context => {
  assert.deepEqual(await native(["--version"]), {
    status: 0, stdout: "yq (https://github.com/mikefarah/yq/) version v4.53.3\n", stderr: "",
  });
  await assert.rejects(authenticateOracle({ ...process.env, SAFE_BASH_TEST_YQ_SHA256: "0".repeat(64) }), /SHA256 mismatch/u);
  for (const input of ["[\n  1, # comment\n  2\n]", "[\n  1, # [\n  2\n]", "{a: 1, # }\n b: [2, # [\n 3]}", "[1,# comment\n2]", "[# comment\n1]", '["a"# comment\n]']) {
    await context.test(JSON.stringify(input), async () => {
      assert.deepEqual(await run(["-o", "json", "-c", "."], input), await native(["-o=json", "-I=0", "."], input));
    });
  }
  for (const input of ["[foo # comment\nbar]", "[foo\n# comment\nbar]"]) {
    await context.test(`syntax rejection (profile-specific diagnostics): ${JSON.stringify(input)}`, async () => {
      assert.equal((await native(["-o=json", "-I=0", "."], input)).status, 1);
      assert.equal((await run(["-o", "json", "-c", "."], input)).status, 5);
    });
  }
});
