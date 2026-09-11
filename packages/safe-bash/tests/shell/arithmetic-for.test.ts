import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { ShellLimitError } from "../../src/shell/types.js";

for (const [name, source, expected, status] of [
  ["three clauses", 'for ((i=0; i<3; i++)); do say "$i"; done; say "end:$i"', "0\n1\n2\nend:3\n", 0],
  ["immediate do", 'for ((i=0;i<1;i++))do say yes; done', "yes\n", 0],
  ["empty clauses", 'i=0; for ((;;)); do say "$i"; break; done', "0\n", 0],
  ["false initial condition", 'for ((i=0;0;i++)); do say WRONG; done; say "$i:$?"', "0:0\n", 0],
  ["continue performs step", 'for ((i=0;i<3;i++)); do if ((i==1)); then continue; fi; say "$i"; done', "0\n2\n", 0],
  ["break skips step", 'for ((i=0;i<3;i++)); do break; done; say "$i"', "0\n", 0],
  ["last body status", 'for ((i=0;i<2;i++)); do false; done', "", 1],
  ["errexit ignores header truth status", 'set -e; for ((i=0;i<1;i++)); do say yes; done; say end', "yes\nend\n", 0],
  ["standalone condition parity", 'i=0; while ((i<2)); do say "$i"; ((i++)); done', "0\n1\n", 0],
  ["positional arithmetic", 'set -- 2; for ((i=0;i<$1;i++)); do say "$i"; done', "0\n1\n", 0],
  ["nested continue", 'for ((i=0;i<3;i++)); do for ((j=0;j<2;j++)); do say "$i,$j"; continue 2; done; done', "0,0\n1,0\n2,0\n", 0],
  ["nested break", 'for ((i=0;i<3;i++)); do for ((j=0;j<2;j++)); do break 2; done; done; say "$i,$j"', "0,0\n", 0],
  ["newlines", 'for ((i=0;\ni<2;\ni++))\ndo\nsay "$i"\ndone', "0\n1\n", 0],
  ["condition and step side effects", 'for ((i=0;(i+=1)<3;i+=1)); do say "$i"; done; say "$i"', "1\n3\n", 0],
  ["conditional body suppresses errexit", 'set -e; if for ((i=0;i<1;i++)); do false; say body; done; then say yes; fi', "body\nyes\n", 0],
  ["body errexit remains active", 'set -e; for ((i=0;i<1;i++)); do false; done; say WRONG', "", 1],
  ["return skips step", 'f() { for ((i=0;i<2;i++)); do return 7; done; }; f; say "$i:$?"', "0:7\n", 0],
] as const) test(`arithmetic for: ${name}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(source);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
    assert.equal(result.exitCode, status);
  } finally { await shell.dispose(); }
});

for (const header of ["i=1/0;1;i++", "i=0;1/0;i++", "i=0;i<1;i=1/0"]) test(`arithmetic for header error remains status 1 under errexit: ${header}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`set -e; for ((${header})); do :; done; say "after:$?"`);
    assert.equal(result.stdout, "after:1\n");
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /division by 0/u);
  } finally { await shell.dispose(); }
});

test("function display retains arithmetic for clauses", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('f() { for ((i=0;i<2;i++)); do say "$i"; done; }; type f');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /for \(\( i=0; i<2; i\+\+ \)\)/u);
  } finally { await shell.dispose(); }
});

for (const source of ['for ((i=0;i<2)); do :; done', 'for ((i=0;i<2;i++;i++)); do :; done', 'for ((i=0;i<2;i++); do :; done']) test(`arithmetic for rejects malformed header: ${source}`, async () => {
  const { shell } = setup();
  try { assert.equal((await shell.exec(source)).exitCode, 2); }
  finally { await shell.dispose(); }
});

for (const [limits, limit] of [
  [{ maxCommands: 2 }, "maxCommands"],
  [{ maxParseUnits: 10 }, "maxParseUnits"],
  [{ maxOutputBytes: 1 }, "maxOutputBytes"],
] as const) test(`arithmetic for preserves ${limit}`, async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('for ((i=0;i<3;i++)); do say "$i"; done', { limits }),
      error => error instanceof ShellLimitError && error.limit === limit);
  } finally { await shell.dispose(); }
});

for (const reason of [false, { cancelled: "arithmetic for" }]) test(`arithmetic for cancels with exact ${typeof reason} reason`, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  let bodies = 0;
  shell.register({ name: "count", execute() { bodies++; return { exitCode: 0 }; } });
  try {
    const pending = shell.exec('for ((;;)); do count; done', { signal: controller.signal });
    const rejection = assert.rejects(pending, error => error === reason);
    setTimeout(() => controller.abort(reason), 0);
    await rejection;
    const stopped = bodies;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(bodies, stopped);
    assert.equal((await shell.exec("say recovered")).stdout, "recovered\n");
  } finally { await shell.dispose(); }
});

test("arithmetic for uses the shared loop iteration cap", async () => {
  const { shell } = setup();
  try {
    await assert.rejects(shell.exec('for ((;;)); do :; done', { limits: { maxLoopIterations: 2 } }),
      error => error instanceof ShellLimitError && error.limit === "maxLoopIterations");
  } finally { await shell.dispose(); }
});
