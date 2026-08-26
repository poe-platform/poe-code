import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { formatAuditOutput, parseAuditDiagnostic } from "./format.mjs";

const diagnostic = result => `# ${JSON.stringify(result).replaceAll("\\", "\\\\").replaceAll("#", "\\#")}`;

test("TAP escaping round-trips quoted output, backslashes, hashes, controls and Unicode", () => {
  const result = { name: "S08 escaped diagnostics", verdict: "PASS", durationMs: 1, pipelines: 1,
    events: ['settled:exit=0:stdout="first\\n"', "head.stdout:first\\n", "literal \\n vs newline\n", "# \\# \\\\#", "\b\f\t\r\v", "雪"] };
  assert.deepEqual(parseAuditDiagnostic(diagnostic(result)), result);
  const formatted = formatAuditOutput(diagnostic(result));
  assert.deepEqual(formatted.errors, []);
  assert.equal(formatted.lines[0], diagnostic(result));
  assert.deepEqual(JSON.parse(formatted.lines[1]).evidence, result.events.slice(0, 2));
});

test("JSON event values including serialized byte arrays are retained without string-method crashes", () => {
  const result = { name: "S08 mixed events", verdict: "PASS", events: [new Uint8Array([0, 10, 255]),
    [1, 2], { status: "ECANCELED", value: '"quoted" # \\' }, null, 42, true, "op:read", "source.return"] };
  const line = diagnostic(result);
  const formatted = formatAuditOutput(line);
  assert.deepEqual(formatted.errors, []);
  assert.equal(formatted.lines[0], line);
  assert.deepEqual(parseAuditDiagnostic(line), JSON.parse(JSON.stringify(result)));
  const summary = JSON.parse(formatted.lines[1]);
  assert.equal(summary.operations, 1);
  assert.equal(summary.returned, 1);
});

test("malformed JSON and invalid event shapes preserve raw diagnostics and signal formatter failure", () => {
  for (const line of ['# {"name":broken', diagnostic({ name: "S08", events: null }), diagnostic({ name: 8, events: [] })]) {
    const formatted = formatAuditOutput(`${line}\n# pass 0\n# fail 1`);
    assert.deepEqual(formatted.lines, [line, "# pass 0", "# fail 1"]);
    assert.equal(formatted.errors.length, 1);
    assert.match(formatted.errors[0], /^AUDIT FORMAT ERROR:/);
  }
});

test("unknown diagnostics, source identities, TAP failures and stderr are never suppressed", () => {
  const output = '# PINNED_SOURCE {"revision":"abc"}\nnot ok 1 - failure\n  ---\n  error: details\n  ...\n# unknown diagnostic\nSTDERR FAILURE\n';
  const formatted = formatAuditOutput(output);
  assert.equal(formatted.lines.join("\n"), output);
  assert.deepEqual(formatted.errors, []);
});

test("the installed Node TAP reporter round-trips real JSON diagnostics", () => {
  const result = { name: "S08 native reporter", verdict: "PASS", events: ['settled:exit=0:stdout="first\n"', "# \\# \\n", new Uint8Array([0, 255])] };
  const script = `import { test } from "node:test"; test("reporter control", context => context.diagnostic(${JSON.stringify(JSON.stringify(result))}));`;
  const env = { ...process.env, NODE_OPTIONS: "" };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--test-reporter=tap", "--input-type=module", "--eval", script],
    { encoding: "utf8", timeout: 5000, env });
  assert.equal(child.status, 0, child.stderr);
  const line = child.stdout.split("\n").find(value => value.startsWith('# {"name":'));
  assert.ok(line, child.stdout);
  assert.deepEqual(parseAuditDiagnostic(line), JSON.parse(JSON.stringify(result)));
  assert.deepEqual(formatAuditOutput(child.stdout).errors, []);
});
