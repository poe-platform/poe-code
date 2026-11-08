import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { utf8Codec } from "safe-bash-command-csvkit";

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  sniffing: { suppressWarnings: true }
};

test("csvkit sniff stress: actual registered engine retains quoted multibyte prefix", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvjson -I --stream -y 1024", { stdin: "name;city\n'😀';'Montréal'\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '{"name": "😀", "city": "Montréal"}\n', stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});

test("csvkit sniff stress: tabs override manual delimiter and inferred dialect", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const argv of ["-d ';' -t", "-t -d ';'"]) {
      const result = await shell.exec(`csvjson -I --stream ${argv}`, { stdin: "a\tb\nx\ty\n" });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: '{"a": "x", "b": "y"}\n', stderr: "", status: 0
      });
    }
    const manual = await shell.exec("csvjson -I --stream -d ';'", { stdin: "a,b;c\nx,y;z\n" });
    assert.deepEqual({ stdout: manual.stdout, stderr: manual.stderr, status: manual.exitCode }, {
      stdout: '{"a,b": "x,y", "c": "z"}\n', stderr: "", status: 0
    });
  } finally { await shell.dispose(); }
});

test("csvkit sniff stress: raw utilities omit sniffing and reject its argv", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const result = await shell.exec("csvcut", { stdin: "a;b\nx;y\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "a;b\nx;y\n", stderr: "", status: 0
    });
    const rejected = await shell.exec("csvcut -y 0", { stdin: "a;b\nx;y\n" });
    assert.equal(rejected.exitCode, 2);
    assert.equal(rejected.stdout, "");
    assert.match(rejected.stderr, /unrecognized arguments: -y/);
  } finally { await shell.dispose(); }
});

test("csvkit sniff stress: disabled and failed sniffing preserve fallback and suppress warnings", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const argv of ["-y 0", "-y -1"]) {
      const result = await shell.exec(`csvjson -I --stream ${argv}`, { stdin: "name\n😀\n" });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: '{"name": "😀"}\n', stderr: "", status: 0
      });
    }
  } finally { await shell.dispose(); }
});

test("csvkit sniff stress: failed inference writes injected warning before fallback output", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    ...options, sniffing: { warning: { path: "/reference/agate/csv_py3.py", line: 84, source: "warnings.warn(message, RuntimeWarning)" } }
  }));
  try {
    const result = await shell.exec("csvjson -I --stream", { stdin: "name\n😀\n" });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: '{"name": "😀"}\n', status: 0,
      stderr: "/reference/agate/csv_py3.py:84: RuntimeWarning: Error sniffing CSV dialect: Could not determine delimiter\n  warnings.warn(message, RuntimeWarning)\n"
    });
  } finally { await shell.dispose(); }
});
