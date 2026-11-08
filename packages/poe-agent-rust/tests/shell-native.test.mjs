import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ownShell from "../dist/plugin-shell.js";
import referenceShell from "../../poe-agent/dist/plugins/poe-agent-plugin-shell.js";
const native = createRequire(import.meta.url)("../dist/poe-agent-rust.node");
const policy = (factory) => factory().tools[0].policy.validate;
test("seeded shell-policy commands agree with original shell-quote policy", () => {
  const own = policy(ownShell),
    reference = policy(referenceShell);
  const commands = [
    "",
    " ",
    "# comment",
    "pwd",
    "git status",
    "git -C . status",
    "git --git-dir=.git diff",
    "git diff --output=x",
    "cd src",
    "cat file",
    "ls",
    "find .",
    "rg needle",
    "awk 'BEGIN {system(\"touch x\")}'",
    "rm -fr tmp",
    "rm --recursive --force tmp",
    "curl --request=POST url",
    "curl -X HEAD url",
    "curl --data-raw=x url",
    "wget --method=POST url",
    "bash -lc 'git status --short'",
    "bash -c 'pwd; echo x'",
    "python - <<'PY'\nprint(open(\"x\").read())\nPY",
    "echo $X",
    "${}",
    "${bad",
    "echo $?end",
    "head *",
    "head '*.txt'",
    "head \\*",
    'head "$X"',
    "pwd#hi",
    "p'w'd",
    "'pwd",
    "pwd'",
    "unknown\ud800"
  ];
  const prefixes = ["", "FOO=value ", "A='quoted value' "];
  const suffixes = [
    "",
    " #comment",
    " && pwd",
    "; mkdir tmp",
    " | wc -l",
    " > file",
    " < file",
    " &",
    " || true"
  ];
  const mismatches = [];
  for (const command of commands)
    for (const prefix of prefixes)
      for (const suffix of suffixes)
        for (const mode of ["read", "edit", "dangerous"]) {
          const text = prefix + command + suffix;
          const actual = own({ command: text }, mode),
            expected = reference({ command: text }, mode);
          if (actual !== expected) mismatches.push({ text, mode, actual, expected });
        }
  assert.deepEqual(mismatches, []);
});

test("native output buffer agrees with exact UTF16 tail retention across chunk sizes", () => {
  const state = new native.NativeAgentShellOutput();
  let value = "",
    omitted = 0;
  for (const chunk of ["", "🌍\ud800", "x".repeat(131070), "\udfff", "y".repeat(262144), "tail"]) {
    const combined = value + chunk;
    const overflow = Math.max(0, combined.length - 131072);
    omitted += overflow;
    value = combined.slice(overflow);
    state.append(chunk);
    assert.equal(
      state.format(),
      (omitted ? `[output truncated: ${omitted} characters omitted]\n` : "") + value
    );
  }
});

test("retained native output is reported to the JavaScript garbage collector", () => {
  const observer = new native.NativeAgentShellOutput();
  const before = observer.append("");
  const states = Array.from({ length: 16 }, () => new native.NativeAgentShellOutput());
  const chunk = "x".repeat(131072);
  for (const state of states) state.append(chunk);
  const retained = observer.append("") - before;
  assert.ok(retained >= 4 * 1024 * 1024 - 1024 * 1024, `Unreported retained bytes: ${retained}`);
  for (const state of states) assert.equal(state.format(), chunk);
});
