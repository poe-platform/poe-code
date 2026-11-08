import test from "node:test";
import assert from "node:assert/strict";
import { utf8Codec } from "safe-bash-command-csvkit";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import reference from "../../../../docs/csvkit/python-regex-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unexpected inference"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 }
};

function csvCell(value: string): string {
  return !value || [",", '"', "\r", "\n"].some(char => value.includes(char))
    ? `"${value.replaceAll('"', '""')}"\n` : `${value}\n`;
}

// Replays authenticated primitive search observations through the actual Shell.
// CSV wrapping below tests transport; this does not create new native evidence.
for (const observation of reference.cases) {
  if (observation.disposition !== "supported" || !("matches" in observation.reference)) continue;
  test(`csvgrep independent frozen regex transport ${JSON.stringify(observation.pattern)}`, async () => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      for (const inverse of [false, true]) {
        const stdin = "value\n" + observation.texts.map(csvCell).join("");
        const expected = "value\n" + observation.texts.filter((_, index) => observation.reference.matches![index] !== inverse).map(csvCell).join("");
        const pattern = "'" + observation.pattern.replaceAll("'", "'\\''") + "'";
        const result = await shell.exec(`csvgrep -c value -r ${pattern}${inverse ? " -i" : ""}`, { stdin });
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
          stdout: expected, stderr: "", status: 0
        }, `inverse=${inverse}`);
      }
    } finally { await shell.dispose(); }
  });
}

test("csvgrep independent blockers close input without successful or partial matching claims", async () => {
  for (const pattern of ["(?P<name>a)", "(a)\\1", "(a)?(?(1)b|c)", "(?i:a)", "[z-a]"]) {
    let retired = 0;
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
    try {
      const result = await shell.exec(`csvgrep -c value -r '${pattern}'`, {
        stdin: { async *[Symbol.asyncIterator]() {
          try { yield new TextEncoder().encode("value\na\nab\nc\n"); }
          finally { retired++; }
        } }
      });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: "", stderr: "csvkit: unsupported or unqualified: Python regex syntax or diagnostic outside qualified subset\n", status: 78
      }, pattern);
      assert.equal(retired, 1, pattern);
    } finally { await shell.dispose(); }
  }
});

test("csvgrep independent omitted-minimum repetition respects anchored limits", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvgrep -c value -r '^a{,2}$'", { stdin: 'value\n""\na\naa\naaa\nb\n' });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: 'value\n""\na\naa\n', stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});
