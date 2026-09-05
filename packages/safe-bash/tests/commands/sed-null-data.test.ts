import assert from "node:assert/strict";
import test from "node:test";
import { sedCommand } from "../../src/commands/text-programs/sed.js";
import { textProgramCommands } from "../../src/commands/text-programs/index.js";
import { Budget } from "../../src/commands/text-programs/shared.js";
import { toByteSource, type ByteSource } from "../../src/contracts/index.js";
import { Shell, ShellLimitError } from "../../src/shell/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./text-programs/helpers.js";

for (const option of ["-z", "--null-data"]) {
  test(`sed ${option} selects NUL records without splitting filename newlines`, async () => {
    const result = await runVirtual("sed", {
      args: [option, "-n", "2p"], stdin: "first\nfilename\0second\nfilename\0tail",
    });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, Buffer.from("second\nfilename\0"));
  });
}

test("sed LF mode already preserves embedded NUL bytes", async () => {
  const input = "first\0second\nlast\0";
  const result = await runVirtual("sed", { args: [""], stdin: input }, {}, byteChunks(input));
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from(input));
});

const nativeCorpus: readonly [string, readonly string[], string, string][] = [
  ["empty", ["-z", ""], "", ""],
  ["empty records", ["-z", ""], "0000", "0000"],
  ["identity", ["--null-data", ""], "610a62007461696c", "610a62007461696c"],
  ["range", ["-zn", "2,3p"], "610a620063007461696c", "63007461696c"],
  ["last", ["-zn", "$p"], "610a62007461696c", "7461696c"],
  ["regex address", ["-zn", "/a\\nb/p"], "610a62007461696c", "610a6200"],
  ["P", ["-zn", "N;P"], "610a62007461696c00", "610a6200"],
  ["n", ["-zn", "n;p"], "610a62007461696c00746869726400", "7461696c00"],
  ["N EOF", ["-z", "N"], "610a6200", "610a6200"],
  ["D", ["-zn", "N;P;D"], "610a62007461696c00746869726400", "610a62007461696c00"],
  ["hold H", ["-z", "H;g"], "610a62007461696c", "00610a620000610a62007461696c"],
  ["hold G", ["-z", "h;G"], "610a62007461696c00", "610a6200610a62007461696c007461696c00"],
  ["exchange", ["-z", "1h;2x"], "610a62007461696c00", "610a6200610a6200"],
  ["insert", ["-z", "i before\\ninside"], "610a6200", "6265666f72650a696e7369646500610a6200"],
  ["change", ["-z", "c after\\ninside"], "610a6200", "61667465720a696e7369646500"],
  ["append", ["-z", "a after\\ninside"], "610a6200", "610a620061667465720a696e736964650a"],
  ["count", ["-zn", "="], "610a62007461696c", "31003200"],
  ["list", ["-zn", "N;l"], "610a62007461696c00", "615c6e625c3030307461696c2400"],
  ["dot", ["-z", "s/./X/g"], "610a62007461696c", "5858580058585858"],
  ["joined dot", ["-z", "N;s/./X/g"], "610a62007461696c00", "585858585858585800"],
  ["negated class", ["-z", "s/[^a]/X/g"], "610a62007461696c", "6158580058615858"],
  ["anchors", ["-zE", "s/^|$/X/g"], "610a62007461696c", "58610a625800587461696c58"],
  ["newline replacement", ["-z", "s/a/\\n/"], "610a6200", "0a0a6200"],
  ["translation", ["-z", "y/\\n/:/"], "610a6200", "613a6200"],
  ["sp", ["-zn", "s/a/A/p"], "610a62007461696c", "410a62007441696c"],
  ["capture", ["-zE", "s/(a).(b)/\\2-\\1/"], "610a6200", "622d6100"],
  ["blank and tail", ["-zn", "=;p"], "00610a007461696c", "3100003200610a0033007461696c"],
  ["numeric N", ["-zn", "N;=;p"], "610062006300", "320061006200"],
  ["change range", ["-z", "1,2c new"], "610062006300", "6e6577006300"],
];

for (const [name, args, inputHex, stdoutHex] of nativeCorpus) {
  test(`sed NUL GNU 4.7 byte capture: ${name}`, async () => {
    const result = await runVirtual("sed", { args, stdin: Buffer.from(inputHex, "hex") });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.toString("hex"), stdoutHex);
  });
}

test("sed NUL insert and append retain their distinct GNU text terminators", async () => {
  const result = await runVirtual("sed", { args: ["-z", "-e", "i before\\ninside", "-e", "a after\\ninside"], stdin: "a\nb\0" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("before\ninside\0a\nb\0after\ninside\n"));
});

test("sed NUL list retains the existing 60-column wrapping profile", async () => {
  const result = await runVirtual("sed", { args: ["-zn", "l"], stdin: "a".repeat(61) + "\0" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a".repeat(59) + "\\\0aa$\0"));
});

for (const separator of ["\n", "\0"]) {
  test(`sed preserves final termination with mode-specific repeated printing: ${JSON.stringify(separator)}`, async () => {
    const mode = separator === "\0" ? ["-z"] : [];
    for (const tail of ["", separator]) {
      const result = await runVirtual("sed", { args: [...mode, "-n", "p;p"], stdin: "a" + tail });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, Buffer.from(separator === "\0" && !tail ? "a\0a" : ("a" + tail).repeat(2)));
    }
  });
}

test("sed NUL multiple files, stdin operands, empty files and separate addresses", async () => {
  const files = { first: "a\nb", empty: "", last: "tail\0" };
  const combined = await runVirtual("sed", { args: ["-zn", "=;p", "first", "empty", "-", "last"], files, stdin: "middle\nname" });
  assert.equal(combined.exitCode, 0, combined.stderr.toString());
  assert.deepEqual(combined.stdout, Buffer.from(["1", "a\nb", "2", "middle\nname", "3", "tail", ""].join("\0")));
  const separate = await runVirtual("sed", { args: ["-zsn", "$p", "first", "empty", "last"], files });
  assert.equal(separate.exitCode, 0, separate.stderr.toString());
  assert.deepEqual(separate.stdout, Buffer.from("a\nb\0tail\0"));
  const joined = await runVirtual("sed", { args: ["-zn", "N;=;p", "first", "empty", "last"], files });
  assert.equal(joined.exitCode, 0, joined.stderr.toString());
  assert.deepEqual(joined.stdout, Buffer.from("2\0a\nb\0tail\0"));
});

test("sed NUL script files retain literal NUL regex and replacement bytes", async () => {
  const result = await runVirtual("sed", {
    args: ["-z", "-f", "script", "input"],
    files: { script: "N;s/\0/:/;s/:/\0/", input: "a\nb\0tail\0" },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a\nb\0tail\0"));
});

test("sed NUL read appends raw file bytes rather than reframing them", async () => {
  const result = await runVirtual("sed", { args: ["-z", "r raw"], stdin: "a\0", files: { raw: "raw\nbytes\0tail" } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a\0raw\nbytes\0tail"));
});

for (const program of ["w out", "s/a/A/pw out"]) {
  test(`sed NUL file output preserves final termination: ${program}`, async () => {
    const result = await runVirtual("sed", { args: ["-zn", program], stdin: "a\nb\0tail" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    const expected = Buffer.from(program.startsWith("s") ? "A\nb\0tAil" : "a\nb\0tail");
    assert.deepEqual(result.files.out, expected);
    assert.deepEqual(result.stdout, program.startsWith("s") ? expected : Buffer.alloc(0));
  });
}

test("sed NUL in-place edits, backups, file output and invocation-wide quit", async () => {
  const result = await runVirtual("sed", {
    args: ["-zi.bak", "-e", "s/a/A/w out", "-e", "1q", "first", "last"],
    files: { first: "a\nb\0tail", last: "a\0" },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.length, 0);
  assert.deepEqual(result.files, {
    first: Buffer.from("A\nb\0"), "first.bak": Buffer.from("a\nb\0tail"), last: Buffer.from("a\0"), out: Buffer.from("A\nb\0"),
  });
  const final = await runVirtual("sed", { args: ["--null-data", "-i", "s/a/A/", "input"], files: { input: "a\nb\0tail" } });
  assert.equal(final.exitCode, 0, final.stderr.toString());
  assert.deepEqual(final.files.input, Buffer.from("A\nb\0tAil"));
});

test("sed NUL byte ownership survives Buffer reuse, lookahead and producer finalization", async () => {
  let closed = false;
  const storage = Buffer.alloc(4);
  const source = (async function* (): ByteSource {
    try {
      for (const chunk of [Buffer.from([255, 10, 128, 0]), Buffer.from([97, 0, 0, 254])]) {
        storage.set(chunk);
        yield storage.subarray();
        storage.fill(88);
      }
    } finally { storage.fill(89); closed = true; }
  })();
  const result = await runVirtual("sed", { args: ["-z", "$s/./Z/"] }, {}, source);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from([255, 10, 128, 0, 97, 0, 0, 90]));
  assert.equal(closed, true);
});

test("sed NUL one-byte chunks preserve invalid UTF-8 and LF payload", async () => {
  const input = Buffer.from([255, 0, 128, 10, 97, 0, 254]);
  const source = (async function* (): ByteSource { for (const byte of input) yield Uint8Array.of(byte); })();
  const result = await runVirtual("sed", { args: ["--null-data", ""] }, {}, source);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, input);
});

test("sed NUL waits for the sink and quits without pulling the next chunk", async () => {
  let pulls = 0;
  let closed = false;
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const stdin = (async function* (): ByteSource {
    try { pulls++; yield Buffer.from("first\nname\0"); pulls++; assert.fail("unneeded input"); }
    finally { closed = true; }
  })();
  const pending = sedCommand().execute({
    command: "sed", args: ["-z", "1q"], cwd: "/work", env: {}, fs: await makeFileSystem(), stdin,
    signal: new AbortController().signal,
    stdout: { async write(chunk) { assert.deepEqual(chunk, Buffer.from("first\nname\0")); entered(); await blocked; } },
    stderr: { async write() { assert.fail("unexpected stderr"); } },
  });
  try {
    await Promise.race([writing, pending.then(() => assert.fail("command settled before writing"))]);
    assert.equal(pulls, 1);
    assert.equal(closed, false);
  } finally { release(); }
  assert.equal((await pending).exitCode, 0);
  assert.equal(closed, true);
});

for (const reason of [false, 0, "", null, undefined]) {
  test(`sed NUL retains abort identity and closes its source: ${String(reason)}`, async () => {
    const controller = new AbortController();
    let closed = false;
    let writes = 0;
    const source = (async function* (): ByteSource {
      try { yield Buffer.from("first\0second\0"); }
      finally { closed = true; }
    })();
    const pending = sedCommand().execute({
      command: "sed", args: ["-z", "p"], cwd: "/work", env: {}, fs: await makeFileSystem(), stdin: source,
      signal: controller.signal,
      stdout: { async write() { writes++; controller.abort(reason); } },
      stderr: { async write() { assert.fail("abort must not become stderr"); } },
    });
    await assert.rejects(pending, error => error === controller.signal.reason);
    assert.equal(writes, 1);
    assert.equal(closed, true);
  });
}

test("sed NUL record and pattern joins enforce caps before oversized strings", async context => {
  const check = context.mock.method(Budget.prototype, "check");
  for (const [program, input] of [["", "abcdef\0"], ["N", "abc\0de\0"], ["H", "abcde\0"], ["h;G", "abc\0"]] as const) {
    const result = await runVirtual("sed", { args: ["-z", program], stdin: input }, { maxBufferBytes: 5 });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr.toString(), /buffer limit/u);
    assert.equal(result.stdout.length, 0);
  }
  assert.equal(check.mock.calls.some(call => call.arguments[0].length > 5), false);
  for (const source of [toByteSource("abcde\0"), byteChunks("abcde\0")]) {
    const exact = await runVirtual("sed", { args: ["-z", ""] }, { maxBufferBytes: 5 }, source);
    assert.equal(exact.exitCode, 0, exact.stderr.toString());
    assert.deepEqual(exact.stdout, Buffer.from("abcde\0"));
  }
});

test("sed NUL branch and append queues retain work and buffer caps", async () => {
  const work = await runVirtual("sed", { args: ["-z", ":again;b again"], stdin: "a\0" }, { maxSteps: 16 });
  assert.equal(work.exitCode, 2);
  assert.match(work.stderr.toString(), /step limit/u);
  const queue = await runVirtual("sed", { args: ["-z", "-e", "a abc", "-e", "a def"], stdin: "a\0" }, { maxBufferBytes: 64 });
  assert.equal(queue.exitCode, 2);
  assert.match(queue.stderr.toString(), /append queue buffer limit/u);
});

for (const maxOutputBytes of [7, 8]) {
  test(`sed NUL stdout and file output share ${maxOutputBytes} bytes`, async () => {
    const fs = await makeFileSystem();
    const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes } }).use(textProgramCommands());
    let closed = false;
    const stdin = (async function* (): ByteSource {
      try { yield Buffer.from("a\nb\0"); }
      finally { closed = true; }
    })();
    const pending = shell.exec("sed -zn -e p -e 'w out'", { stdin });
    if (maxOutputBytes === 7) {
      await assert.rejects(pending, error => error instanceof ShellLimitError && error.message.includes("maxOutputBytes"));
      assert.equal((await fs.readFile("/work/out")).byteLength, 0);
    } else {
      const result = await pending;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from("a\nb\0"));
      assert.deepEqual(Buffer.from(await fs.readFile("/work/out")), Buffer.from("a\nb\0"));
    }
    assert.equal(closed, true);
  });
}

test("sed NUL rejects existing unsupported multiline regex flags before input", async () => {
  let consumed = false;
  const source = (async function* (): ByteSource { consumed = true; yield Buffer.from("a\0"); })();
  const result = await runVirtual("sed", { args: ["-z", "s/a/A/m"] }, {}, source);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /unsupported substitution flag 'm'/u);
  assert.equal(consumed, false);
});

test("sed NUL P and D do not treat payload LF as a record boundary", async () => {
  const printed = await runVirtual("sed", { args: ["-zn", "P"], stdin: "a\nb\0tail" });
  assert.equal(printed.exitCode, 0, printed.stderr.toString());
  assert.deepEqual(printed.stdout, Buffer.from("a\nb\0tail"));
  const deleted = await runVirtual("sed", { args: ["-z", "D"], stdin: "a\nb\0tail" });
  assert.equal(deleted.exitCode, 0, deleted.stderr.toString());
  assert.equal(deleted.stdout.length, 0);
});

test("sed NUL default n flushes queued text before the following record", async () => {
  const result = await runVirtual("sed", { args: ["-z", "-e", "a added\\ntext", "-e", "n;s/b/B/"], stdin: "a\nname\0b\0" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a\nname\0added\ntext\nB\0"));
});

test("sed NUL separate mode keeps successful quit invocation-wide", async () => {
  const result = await runVirtual("sed", { args: ["-zs", "1q", "first", "last"], files: { first: "a\nb\0tail", last: "later\0" } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a\nb\0"));
});

test("sed NUL explicit file output keeps arbitrary byte values", async () => {
  const input = Buffer.from([255, 10, 128, 0, 254]);
  const result = await runVirtual("sed", { args: ["-zn", "w out"], stdin: input });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.files.out, input);
});

test("sed NUL syntax and option failures precede input, truncation and backups", async () => {
  for (const args of [["-z", "--null-data=yes", "p"], ["-zi.bak", "-e", "w out", "-e", "s/a/A/e", "input"]]) {
    let consumed = false;
    const source = (async function* (): ByteSource { consumed = true; yield Buffer.from("a\0"); })();
    const result = await runVirtual("sed", { args, files: { input: "a\0", out: "keep" } }, {}, source);
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(consumed, false);
    assert.deepEqual(result.files, { input: Buffer.from("a\0"), out: Buffer.from("keep") });
  }
});

test("sed NUL joins admit exact separator-inclusive pattern capacity", async () => {
  for (const [program, input, expected] of [["N", "ab\0cd\0", "ab\0cd\0"], ["H;g", "abcd\0", "\0abcd\0"], ["h;G", "ab\0", "ab\0ab\0"]] as const) {
    const result = await runVirtual("sed", { args: ["-z", program], stdin: input }, { maxBufferBytes: 5 });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, Buffer.from(expected));
  }
});

test("sed NUL fragmented record overflow closes the producer without output", async () => {
  let closed = false;
  const source = (async function* (): ByteSource {
    try { yield Buffer.from("abc"); yield Buffer.from("def\0"); assert.fail("overflow must not pull again"); }
    finally { closed = true; }
  })();
  const result = await runVirtual("sed", { args: ["-z", ""] }, { maxBufferBytes: 5 }, source);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr.toString(), /buffer limit/u);
  assert.equal(result.stdout.length, 0);
  assert.equal(closed, true);
});

test("sed NUL cancellation while assembling a record retains falsey identity", async () => {
  const controller = new AbortController();
  let closed = false;
  const stdin = (async function* (): ByteSource {
    try { yield Buffer.from("first"); controller.abort(false); yield Buffer.from("\0"); }
    finally { closed = true; }
  })();
  await assert.rejects(sedCommand().execute({
    command: "sed", args: ["-z", ""], cwd: "/work", env: {}, fs: await makeFileSystem(), stdin, signal: controller.signal,
    stdout: { async write() { assert.fail("cancelled partial record must not print"); } },
    stderr: { async write() { assert.fail("abort must not become stderr"); } },
  }), error => error === false);
  assert.equal(closed, true);
});

test("sed NUL in-place output budget rejection preserves original bytes", async () => {
  const fs = await makeFileSystem({ input: "a\nb\0" });
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 3 } }).use(textProgramCommands());
  await assert.rejects(shell.exec("sed -zi 's/a/A/' input"), error => error instanceof ShellLimitError && error.message.includes("maxOutputBytes"));
  assert.deepEqual(Buffer.from(await fs.readFile("/work/input")), Buffer.from("a\nb\0"));
});

test("sed NUL empty input retains eager output truncation at zero capacity", async () => {
  const fs = await makeFileSystem({ out: "old" });
  const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes: 0 } }).use(textProgramCommands());
  const result = await shell.exec("sed -zn 'w out'", { stdin: new Uint8Array() });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal((await fs.readFile("/work/out")).byteLength, 0);
});

const nativeTransitions: readonly [string, readonly string[], string, string, Readonly<Record<string, string | Uint8Array>>?, string?][] = [
  ["a terminated", ["-z", "a before\\ninside"], "610a6200", "610a62006265666f72650a696e736964650a"],
  ["a unterminated", ["-z", "a before\\ninside"], "610a62", "610a62006265666f72650a696e736964650a"],
  ["a empty records", ["-z", "a before\\ninside"], "0000", "006265666f72650a696e736964650a006265666f72650a696e736964650a"],
  ["i terminated", ["-z", "i before\\ninside"], "610a6200", "6265666f72650a696e7369646500610a6200"],
  ["i unterminated", ["-z", "i before\\ninside"], "610a62", "6265666f72650a696e7369646500610a62"],
  ["i empty records", ["-z", "i before\\ninside"], "0000", "6265666f72650a696e7369646500006265666f72650a696e736964650000"],
  ["c terminated", ["-z", "c before\\ninside"], "610a6200", "6265666f72650a696e7369646500"],
  ["c unterminated", ["-z", "c before\\ninside"], "610a62", "6265666f72650a696e7369646500"],
  ["c empty records", ["-z", "c before\\ninside"], "0000", "6265666f72650a696e73696465006265666f72650a696e7369646500"],
  ["p twice", ["-zn", "p;p"], "7461696c", "7461696c007461696c"],
  ["default twice", ["-z", "p"], "7461696c", "7461696c007461696c"],
  ["P twice", ["-zn", "P;P"], "7461696c", "7461696c007461696c"],
  ["empty pattern", ["-zn", "s/.*//;p;p"], "7461696c", "00"],
  ["count after print", ["-zn", "p;="], "7461696c", "7461696c003100"],
  ["list after print", ["-zn", "p;l"], "7461696c", "7461696c007461696c2400"],
  ["insert after print", ["-zn", "-e", "p", "-e", "i text\\ninside"], "7461696c", "7461696c00746578740a696e7369646500"],
  ["change after print", ["-zn", "-e", "p", "-e", "c text\\ninside"], "7461696c", "7461696c00746578740a696e7369646500"],
  ["append after print", ["-zn", "-e", "p", "-e", "a text\\ninside"], "7461696c", "7461696c00746578740a696e736964650a"],
  ["empty append", ["-zn", "-e", "p", "-e", "a\\\n"], "7461696c", "7461696c000a"],
  ["insert then print", ["-zn", "-e", "i text", "-e", "p;p"], "7461696c", "74657874007461696c007461696c"],
  ["append and change", ["-zn", "-e", "p", "-e", "a after", "-e", "c changed"], "7461696c", "7461696c006368616e6765640061667465720a"],
  ["queued before N", ["-z", "-e", "a added", "-e", "N"], "610062", "61646465640a610062"],
  ["queued N EOF", ["-z", "-e", "a added", "-e", "N"], "7461696c", "7461696c0061646465640a"],
  ["q EOF", ["-z", "q"], "7461696c", "7461696c00"],
  ["quiet q EOF", ["-zn", "p;q"], "7461696c", "7461696c00"],
  ["terminated print append", ["-zn", "-e", "p;p", "-e", "a text"], "7461696c00", "7461696c007461696c00746578740a"],
  ["read after print", ["-zn", "-e", "p", "-e", "r raw"], "7461696c", "7461696c00ff0052", { raw: Buffer.from("ff0052", "hex") }],
  ["read empty", ["-zn", "-e", "p", "-e", "r raw"], "7461696c", "7461696c00", { raw: "" }],
  ["read raw only", ["-zn", "r raw"], "7461696c", "ff0052", { raw: Buffer.from("ff0052", "hex") }],
  ["read terminated raw", ["-zn", "-e", "p", "-e", "r raw"], "7461696c", "7461696c00ff00", { raw: Buffer.from("ff00", "hex") }],
  ["read before n", ["-zn", "-e", "p", "-e", "r raw", "-e", "n;p"], "6f6e650074776f", "6f6e6500ff005274776f", { raw: Buffer.from("ff0052", "hex") }],
  ["read before N", ["-z", "-e", "r raw", "-e", "N"], "6f6e650074776f", "ff00526f6e650074776f", { raw: Buffer.from("ff0052", "hex") }],
  ["read after repeated print", ["-zn", "-e", "p;p", "-e", "r raw"], "7461696c", "7461696c007461696c00ff0052", { raw: Buffer.from("ff0052", "hex") }],
  ["append after read", ["-zn", "-e", "p", "-e", "r raw", "-e", "a after"], "7461696c", "7461696c00ff005261667465720a", { raw: Buffer.from("ff0052", "hex") }],
  ["read after append", ["-zn", "-e", "p", "-e", "a before", "-e", "r raw"], "7461696c", "7461696c006265666f72650aff0052", { raw: Buffer.from("ff0052", "hex") }],
  ["file twice", ["-zn", "-e", "w out", "-e", "w out"], "7461696c", "", {}, "7461696c007461696c"],
  ["independent destinations", ["-zn", "-e", "p", "-e", "w out", "-e", "p", "-e", "w out"], "7461696c", "7461696c007461696c", {}, "7461696c007461696c"],
  ["substitution destinations", ["-zn", "-e", "s/tail/T/pw out", "-e", "s/T/U/pw out"], "7461696c", "540055", {}, "540055"],
  ["terminated file twice", ["-zn", "-e", "w out", "-e", "w out"], "7461696c00", "", {}, "7461696c007461696c00"],
  ["separate stdout", ["-zsn", "p;p", "first", "last"], "", "61006100620062", { first: "a", last: "b" }],
  ["separate file", ["-zsn", "-e", "p", "-e", "w out", "first", "last"], "", "610062", { first: "a", last: "b" }, "610062"],
  ["empty hold g", ["-z", "g"], "7461696c", "00"],
  ["empty hold x", ["-z", "x"], "7461696c", "00"],
  ["empty hold G", ["-z", "G"], "7461696c", "7461696c0000"],
  ["copy hold", ["-z", "h;g"], "7461696c", "7461696c"],
  ["append hold", ["-z", "H;g"], "7461696c", "007461696c"],
  ["g saved terminated", ["-z", "1h;2g"], "61007461696c", "61006100"],
  ["G saved terminated", ["-z", "1h;2G"], "61007461696c", "61007461696c006100"],
  ["x saved terminated", ["-z", "1h;2x"], "61007461696c", "61006100"],
  ["raw leading and trailing NUL", ["-zn", "-e", "p", "-e", "r raw"], "7461696c", "7461696c0000ff00", { raw: Buffer.from("00ff00", "hex") }],
];

for (const [name, args, inputHex, stdoutHex, files, outputHex] of nativeTransitions) {
  test(`sed NUL native output transition: ${name}`, async () => {
    const result = await runVirtual("sed", { args, stdin: Buffer.from(inputHex, "hex"), ...(files ? { files } : {}) });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.equal(result.stdout.toString("hex"), stdoutHex);
    if (outputHex !== undefined) assert.equal(result.files.out?.toString("hex"), outputHex);
  });
}

for (const destination of ["stdout", "file"]) {
  for (const maxOutputBytes of [8, 9]) {
    test(`sed NUL inserted separator consumes ${destination} capacity ${maxOutputBytes}`, async () => {
      const fs = await makeFileSystem();
      const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes } }).use(textProgramCommands());
      let closed = false;
      const stdin = (async function* (): ByteSource {
        try { yield Buffer.from("tail"); }
        finally { closed = true; }
      })();
      const pending = shell.exec(destination === "stdout" ? "sed -zn 'p;p'" : "sed -zn -e 'w out' -e 'w out'", { stdin });
      if (maxOutputBytes === 8) {
        await assert.rejects(pending, error => error instanceof ShellLimitError && error.message.includes("maxOutputBytes"));
        if (destination === "file") assert.deepEqual(Buffer.from(await fs.readFile("/work/out")), Buffer.from("tail"));
      } else {
        const result = await pending;
        assert.equal(result.exitCode, 0, result.stderr);
        const output = destination === "stdout" ? result.stdoutBytes : await fs.readFile("/work/out");
        assert.deepEqual(Buffer.from(output), Buffer.from("tail\0tail"));
      }
      assert.equal(closed, true);
    });
  }
}

test("sed NUL pending separators belong to individual file destinations", async () => {
  const result = await runVirtual("sed", { args: ["-zn", "-e", "w first", "-e", "w last", "-e", "w first"], stdin: "tail" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.files, { first: Buffer.from("tail\0tail"), last: Buffer.from("tail") });
});

test("sed NUL in-place streams reset separately while script file output persists", async () => {
  const result = await runVirtual("sed", { args: ["-zi", "w out", "first", "last"], files: { first: "a", last: "b" } });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.files, { first: Buffer.from("a"), last: Buffer.from("b"), out: Buffer.from("a\0b") });
});

for (const maxOutputBytes of [7, 8]) {
  test(`sed NUL raw reads account for the pending separator at capacity ${maxOutputBytes}`, async () => {
    const fs = await makeFileSystem({ raw: Buffer.from("00ff00", "hex") });
    const shell = new Shell({ fs, cwd: "/work", limits: { maxOutputBytes } }).use(textProgramCommands());
    const pending = shell.exec("sed -zn -e p -e 'r raw'", { stdin: "tail" });
    if (maxOutputBytes === 7) {
      await assert.rejects(pending, error => error instanceof ShellLimitError && error.message.includes("maxOutputBytes"));
    } else {
      const result = await pending;
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), "7461696c0000ff00");
    }
  });
}

test("sed NUL pending separator output is awaited and retains falsey cancellation", async () => {
  const controller = new AbortController();
  const chunks: Buffer[] = [];
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { entered = resolve; });
  const pending = sedCommand().execute({
    command: "sed", args: ["-zn", "p;p;p"], cwd: "/work", env: {}, fs: await makeFileSystem(),
    stdin: toByteSource("tail"), signal: controller.signal,
    stdout: { async write(chunk) {
      chunks.push(Buffer.from(chunk));
      if (chunks.length === 2) { entered(); await blocked; controller.abort(false); }
    } },
    stderr: { async write() { assert.fail("abort must not become stderr"); } },
  });
  try {
    await Promise.race([writing, pending.then(() => assert.fail("settled before second write"))]);
    assert.deepEqual(chunks, [Buffer.from("tail"), Buffer.from("\0tail")]);
  } finally { release(); }
  await assert.rejects(pending, error => error === false);
  assert.equal(chunks.length, 2);
});
