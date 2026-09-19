import test from "node:test";
import assert from "node:assert/strict";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { csvkitCommands, type CsvkitCommandsOptions } from "../../src/commands/csvkit/index.js";
import { defaultSniffStreamProfile, utf8Codec } from "@poe-code/csvkit";
import parserReference from "../../../../docs/csvkit/oracle-3.14.2.json" with { type: "json" };
import expectationReference from "../../../../docs/csvkit/integration-expectation-reference.json" with { type: "json" };

const options: CsvkitCommandsOptions = {
  codecs: [utf8Codec],
  locale: { profile: "C", timezone: "UTC", formatNumber: () => { throw new Error("unqualified locale"); } },
  clock: { now: () => 0 },
  terminal: { stdinIsTTY: false, stdoutIsTTY: false, stderrIsTTY: false, columns: 80, lines: 24 },
  sniffing: { suppressWarnings: true }
};

test("csvkit user edge: explicit quote overrides inferred apostrophe with delimiter and tabs", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [argv, stdin] of [
      ["-d ';'", "a;b\n'x';'y'\n"],
      ["-d ';' -t", "a\tb\n'x'\t'y'\n"],
      ["-t -d ';'", "a\tb\n'x'\t'y'\n"]
    ] as const) {
      const inferred = await shell.exec(`csvjson -I --stream ${argv}`, { stdin });
      assert.deepEqual({ stdout: inferred.stdout, stderr: inferred.stderr, status: inferred.exitCode }, {
        stdout: '{"a": "x", "b": "y"}\n', stderr: "", status: 0
      });
      const manual = await shell.exec(`csvjson -I --stream ${argv} -q '"'`, { stdin });
      assert.deepEqual({ stdout: manual.stdout, stderr: manual.stderr, status: manual.exitCode }, {
        stdout: '{"a": "\'x\'", "b": "\'y\'"}\n', stderr: "", status: 0
      });
    }
  } finally { await shell.dispose(); }
});

test("csvkit user edge: ambiguous delimiter and quoted physical multiline keep exact cells", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const [stdin, stdout] of [
      ["a,b;c;d\nx,y;z;w\n", '{"a": "x", "b;c;d": "y;z;w"}\n'],
      ['a;b\n"x\n😀";"y;z"\n', '{"a": "x\\n😀", "b": "y;z"}\n']
    ] as const) {
      const result = await shell.exec("csvjson -I --stream -y -1", { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout, stderr: "", status: 0
      });
    }
  } finally { await shell.dispose(); }
});

test("csvkit user edge: raw executables reject sniff argv before acquiring input", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    for (const command of ["csvclean", "csvcut", "csvformat", "csvgrep", "csvstack"]) {
      const frozen = parserReference.find(item => item.command === command && item.status === 2);
      assert.ok(frozen, `missing frozen error usage for ${command}`);
      const usage = frozen.stderr.slice(0, frozen.stderr.indexOf(`${command}: error:`));
      const stdin = { async *[Symbol.asyncIterator]() { assert.fail("rejected argv acquired input"); yield new Uint8Array(); } };
      const result = await shell.exec(`${command} -y 0`, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: "", stderr: `${usage}${command}: error: unrecognized arguments: -y\n`, status: 2
      });
    }
  } finally { await shell.dispose(); }
});

test("csvkit user edge: character sampling differs from frozen byte peek without altering files", async () => {
  const fs = new MemoryFileSystem();
  const bytes = new TextEncoder().encode("é;é\nx;y\n");
  await fs.writeFile("/input.csv", bytes);
  const shell = new Shell({ fs }).use(csvkitCommands({ ...options, sniffing: {
    suppressWarnings: true, stream: { ...defaultSniffStreamProfile, name: "user-edge-six-byte-peek", peekBytes: 6 }
  }, columnWarnings: { utilsPath: expectationReference.warningPath } }));
  try {
    const named = await shell.exec("in2csv -I -f csv -y 5 /input.csv");
    assert.deepEqual({ stdout: named.stdout, stderr: named.stderr, status: named.exitCode }, {
      stdout: "é;é\nx;y\n", stderr: "", status: 0
    });
    for (const chunkSize of [1, 2, bytes.length]) {
      let closed = 0;
      const stdin = { async *[Symbol.asyncIterator]() {
        try { for (let offset = 0; offset < bytes.length; offset += chunkSize) yield bytes.slice(offset, offset + chunkSize); }
        finally { closed++; }
      } };
      const result = await shell.exec("in2csv -I -f csv -y 5", { stdin });
      const native = expectationReference.cases.find(item => item.name === 'six-byte-buffer-sniff')!;
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: native.stdout, stderr: native.stderr, status: native.status
      });
      assert.equal(closed, 1);
    }
    assert.deepEqual(await fs.readFile("/input.csv"), bytes);
  } finally { await shell.dispose(); }
});

test("csvkit user edge: producer buffer reuse cannot corrupt retained sniff prefix", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands(options));
  try {
    const bytes = new TextEncoder().encode("a;b\n😀;é\nx;y\n");
    for (const limit of [1024, -1]) {
      const reused = new Uint8Array(1);
      let closed = 0;
      const stdin = { async *[Symbol.asyncIterator]() {
        try {
          for (const byte of bytes) { reused[0] = byte; yield reused; }
        } finally { reused.fill(0); closed++; }
      } };
      const result = await shell.exec(`csvjson -I --stream -y ${limit}`, { stdin });
      assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
        stdout: '{"a": "😀", "b": "é"}\n{"a": "x", "b": "y"}\n', stderr: "", status: 0
      });
      assert.equal(closed, 1);
    }
  } finally { await shell.dispose(); }
});

test("csvkit user edge: failed sniff warnings reset per invocation and suppression wins", async () => {
  const warning = { path: "/reference/agate/csv_py3.py", line: 84, source: "warnings.warn(message, RuntimeWarning)" };
  for (const suppressWarnings of [false, true]) {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
      ...options, sniffing: { warning, suppressWarnings }
    }));
    try {
      for (let invocation = 0; invocation < 2; invocation++) {
        const result = await shell.exec("csvjson -I --stream", { stdin: "name\n😀\n" });
        assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
          stdout: '{"name": "😀"}\n', status: 0,
          stderr: suppressWarnings ? "" : "/reference/agate/csv_py3.py:84: RuntimeWarning: Error sniffing CSV dialect: Could not determine delimiter\n  warnings.warn(message, RuntimeWarning)\n"
        });
      }
      const disabled = await shell.exec("csvjson -I --stream -y 0", { stdin: "name\n😀\n" });
      assert.deepEqual({ stdout: disabled.stdout, stderr: disabled.stderr, status: disabled.exitCode }, {
        stdout: '{"name": "😀"}\n', stderr: "", status: 0
      });
    } finally { await shell.dispose(); }
  }
});

test("csvkit user edge: bounded full sniff closes producer and reports refusal", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(csvkitCommands({
    ...options, sniffing: { suppressWarnings: true, maxSampleCharacters: 4 }
  }));
  try {
    let closed = 0;
    const stdin = { async *[Symbol.asyncIterator]() {
      try { yield new TextEncoder().encode("a;b\nx;y\n"); }
      finally { closed++; }
    } };
    const result = await shell.exec("csvjson -I --stream -y -1", { stdin });
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, status: result.exitCode }, {
      stdout: "", stderr: "csvkit: unsupported or unqualified: sniff sample character budget exceeded\n", status: 78
    });
    assert.equal(closed, 1);
  } finally { await shell.dispose(); }
});
