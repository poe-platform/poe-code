import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../hexdump/helpers.js";
import { nativeErrors } from "./native-errors.js";

for (const fixture of nativeErrors) test(`independent native missing argument: ${fixture.name}`, async () => {
  const result = await run([...fixture.args], Buffer.from(fixture.input, "hex"));
  assert.deepEqual(result, { exitCode: fixture.status, stdout: fixture.stdout, stderr: fixture.stderr });
});
