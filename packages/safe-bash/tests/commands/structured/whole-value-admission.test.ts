import assert from "node:assert/strict";
import { test } from "node:test";
import { run } from "./helpers.js";

for (const filter of ["to_entries | empty", "try (to_entries | empty) catch 99", "(to_entries)? | empty"]) {
  test(`whole-value command admission survives ${filter}`, async () => {
    const refused = await run(["-c", filter], '{"a":0,"b":0}', { limits: { maxValueBytes: 44 } });
    assert.equal(refused.exitCode, 5);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /maxValueBytes limit exceeded/);
    const admitted = await run(["-c", filter], '{"a":0,"b":0}', { limits: { maxValueBytes: 45 } });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdout, "");
  });
}

for (const filter of ["tojson | empty", "tostring | empty"]) {
  test(`whole-value command admission measures string encoding for ${filter}`, async () => {
    const refused = await run(["-c", filter], '["\\n"]', { limits: { maxValueBytes: 7 } });
    assert.equal(refused.exitCode, 5);
    assert.equal(refused.stdout, "");
    assert.match(refused.stderr, /maxValueBytes limit exceeded/);
    const admitted = await run(["-c", filter], '["\\n"]', { limits: { maxValueBytes: 11 } });
    assert.equal(admitted.exitCode, 0, admitted.stderr);
    assert.equal(admitted.stdout, "");
  });
}
