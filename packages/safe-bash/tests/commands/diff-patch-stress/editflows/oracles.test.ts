import assert from "node:assert/strict";
import test from "node:test";
import { flows, replacement } from "./fixtures.js";
import { expectedBytes, isolated, native, nativeBytes } from "./helpers.js";

test("edit-flow native identities", async context => isolated({}, async root => {
  for (const tool of ["diff", "patch", "git"] as const) {
    const result = native(root, tool, ["--version"]);
    assert.equal(result.status, 0, result.stderr.toString());
    context.diagnostic(`${tool}: ${result.stdout.toString().trim()}`);
  }
}));

for (const flow of flows) test(`native golden: ${flow.name}`, async context => isolated(flow.files, async root => {
  const args = flow.oracle === "git" ? ["apply", "--no-index", "--whitespace=nowarn", "-p1", "-"]
    : ["-f", "-p0", "-F0", ...flow.args];
  const result = native(root, flow.oracle, args, flow.input);
  context.diagnostic(JSON.stringify({ tool: flow.oracle, args, status: result.status,
    stdout: result.stdout.toString(), stderr: result.stderr.toString() }));
  assert.deepEqual({ status: result.status, files: await nativeBytes(root, Object.keys(flow.expected)) },
    { status: 0, files: expectedBytes(flow.expected) }, result.stderr.toString());
}));

test("native default diff is normal-format change", async () => isolated({ before: "old\n", after: "new\n" }, async root => {
  const result = native(root, "diff", ["before", "after"]);
  assert.deepEqual(result, { status: 1, stdout: Buffer.from("1c1\n< old\n---\n> new\n"), stderr: Buffer.alloc(0) });
}));

test("native -l requires a nonempty blank run", async () => isolated({ target: "oldvalue\n" }, async root => {
  const result = native(root, "patch", ["-f", "-p0", "-F0", "-l"], replacement("target", "target", "old value", "new"));
  assert.deepEqual({ status: result.status, files: await nativeBytes(root, ["target"]) },
    { status: 1, files: expectedBytes({ target: "oldvalue\n" }) });
}));
