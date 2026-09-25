import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { agentCommands } from "../../../src/plugins/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { byteChunks, makeFileSystem, runVirtual } from "./helpers.js";

for (const separator of ["\n", "\0"]) {
  for (const payload of ["DifferentTail", "Different\xfeTail"]) {
    for (const ending of ["", separator]) {
      // Byte-exact GNU sed 4.9 outputs; termination belongs to the resulting space.
      const first = `First${separator}`;
      const mode = separator === "\0" ? "-z " : "";
      for (const [program, input, expected] of [
        ["", payload, payload + ending],
        ["G", payload, payload + separator + separator],
        ["g", payload, separator],
        ["x", payload, separator],
        ["G", first + payload, first + separator + payload + separator + separator],
        ["g", first + payload, separator + separator],
        ["x", first + payload, separator + first],
        ["1h;2x", first + payload, first + first],
        ["1h;2g", first + payload, first + first],
        ["1h;2G", first + payload, first + payload + separator + first],
        ["h;g", payload, payload + ending],
        ["h;G", payload, payload + separator + payload + ending],
        ["H;g", payload, separator + payload + ending],
        ["x;x", payload, payload + ending],
        ["x;g", payload, payload + ending],
        ["x;G", payload, separator + payload + ending],
        ["x;H;g", payload, payload + separator + separator],
      ] as const) {
        test(`sed hold termination ${mode}${program}: ${JSON.stringify(input + ending)}`, async () => {
          const original = Buffer.from(input + ending, "latin1");
          const fs = await makeFileSystem({ input: original });
          const shell = new Shell({ fs, cwd: "/work" }).use(textProgramCommands());
          const result = await shell.exec(`sed ${mode}'${program}' input > actual.bin`);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.equal(result.stderr, "");
          assert.equal(result.stdout, "");
          assert.deepEqual(Buffer.from(await fs.readFile("/work/actual.bin")), Buffer.from(expected, "latin1"));
          assert.deepEqual(Buffer.from(await fs.readFile("/work/input")), original);
        });
      }
    }
  }
}

for (const [program, expected] of [["g", "\n"], ["G", "tail\n\n"], ["x", "\n"]] as const) {
  for (const print of ["p", "P", "s/^/prefix/p"]) {
    test(`sed hold termination reaches explicit printing: ${program};${print}`, async () => {
      const result = await runVirtual("sed", { args: ["-n", `${program};${print}`], stdin: "tail" });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, Buffer.from(print === "P" && program === "G" ? "tail\n" : (print.startsWith("s/") ? "prefix" : "") + expected));
    });
  }
  test(`sed hold termination reaches in-place output: ${program}`, async () => {
    const result = await runVirtual("sed", { args: ["-i.bak", program, "input"], files: { input: "tail" } });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(result.files, { input: Buffer.from(expected), "input.bak": Buffer.from("tail") });
  });
}

test("sed hold termination and raw bytes survive reused input buffers", async () => {
  const storage = Buffer.alloc(2);
  let closed = false;
  const source = (async function* () {
    try {
      storage.set([0xff, 10]); yield storage;
      storage.set([0xfe, 10]); yield storage.subarray(0, 1);
    } finally { storage.fill(88); closed = true; }
  })();
  const result = await runVirtual("sed", { args: ["1h;2G"] }, {}, source);
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from([0xff, 10, 0xfe, 10, 0xff, 10]));
  assert.equal(closed, true);
});

for (const program of ["G", "H;g"]) {
  test(`sed hold termination retains buffer limits: ${program}`, async () => {
    for (const maxBufferBytes of [4, 5]) {
      const result = await runVirtual("sed", { args: [program], stdin: "tail" }, { maxBufferBytes });
      assert.equal(result.exitCode, maxBufferBytes === 4 ? 2 : 0, result.stderr.toString());
      if (maxBufferBytes === 4) {
        assert.match(result.stderr.toString(), /text buffer limit exceeded/u);
        assert.equal(result.stdout.length, 0);
      } else assert.deepEqual(result.stdout, Buffer.from(program === "G" ? "tail\n\n" : "\ntail"));
    }
  });
}

for (const option of ["--separate", "-s"]) {
  test(`sed ${option} resets last addresses, numbering, ranges and hold space per file`, async () => {
    const files = { input: "a\nb\n", empty: "", second: "c\nd\n" };
    for (const [program, expected] of [["$p", "b\nd\n"], ["=", "1\n2\n1\n2\n"], ["2,$p", "b\nd\n"], ["1{x;p;};h", "\n\n"]] as const) {
      const result = await runVirtual("sed", { args: [option, "-n", program, "input", "empty", "second"], files });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      assert.deepEqual(result.stdout, Buffer.from(expected));
    }
  });
}

for (const args of [["--line-length=5"], ["--line-length", "5"], ["-l5"], ["-l", "5"], ["-nl5"]]) {
  test(`sed list length: ${args.join(" ")}`, async () => {
    const result = await runVirtual("sed", { args: [...args, "-n", "l"], stdin: "12345678\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.deepEqual(result.stdout, Buffer.from("1234\\\n5678$\n"));
  });
}

test("sed zero list length disables wrapping, including escaped bytes and NUL records", async () => {
  const result = await runVirtual("sed", { args: ["-zn", "--line-length=0", "l"], stdin: "a".repeat(80) + "\t\0" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.deepEqual(result.stdout, Buffer.from("a".repeat(80) + "\\t$\0"));
});

test("sed reported long options compose through agentCommands", async () => {
  const fs = await makeFileSystem({ input: "a\nb\n", second: "c\nd\n", numbers: "12345678\n" });
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  for (const [command, expected] of [["sed --separate -n '$p' input second", "b\nd\n"], ["sed --line-length=5 -n l numbers", "1234\\\n5678$\n"]] as const) {
    const result = await shell.exec(command);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

for (const args of [["--line-length"], ["-l"], ["--line-length="], ["--line-length=-1"], ["--line-length=abc"], ["--line-length=9007199254740992"]]) {
  test(`sed rejects invalid list length before effects: ${args.join(" ")}`, async () => {
    const result = await runVirtual("sed", { args: ["-i.bak", "-e", "l", "input", ...args], files: { input: "abc\n" } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout.length, 0);
    assert.deepEqual(result.files, { input: Buffer.from("abc\n") });
  });
}

for (const [args, expected] of [
  [["--quiet", "p", "input"], "a\n"],
  [["--quiet", "", "input"], ""],
  [["--regexp-extended", "s/(a)/X/", "input"], "X\n"],
  [["--quiet", "--regexp-extended", "-e", "s/(a)/X/p", "input"], "X\n"],
  [["-f", "program", "--regexp-extended", "--quiet", "input"], "X\n"],
] as const) {
  test(`sed long aliases: ${args.join(" ")}`, async () => {
    const files = { input: "a\n", program: "s/(a)/X/p" };
    const result = await runVirtual("sed", { args, files });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.stdout, Buffer.from(expected));
    assert.deepEqual(result.files, { input: Buffer.from(files.input), program: Buffer.from(files.program) });
  });
}

test("sed long aliases preserve NUL records and non-UTF-8 bytes in shell pipelines", async () => {
  const fs = await makeFileSystem({ input: Uint8Array.of(0xff, 0x61, 0, 0x62, 0) });
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("cat input | sed --quiet --regexp-extended --null-data 's/(a)/X/p' > output");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/work/output"), Uint8Array.of(0xff, 0x58, 0));
});

test("sed treats long aliases after -- as filenames", async () => {
  const result = await runVirtual("sed", {
    args: ["-e", "p", "--", "--quiet", "--regexp-extended"],
    files: { "--quiet": "a\n", "--regexp-extended": "b\n" },
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stderr.length, 0);
  assert.deepEqual(result.stdout, Buffer.from("a\na\nb\nb\n"));
});

for (const option of ["--quiet=yes", "--regexp-extended=yes"]) {
  test(`sed rejects an argument on the flag ${option}`, async () => {
    const result = await runVirtual("sed", { args: [option, "p"], stdin: "a\n" });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stderr.toString(), `sed: unsupported option '${option}'\n`);
    assert.equal(result.stdout.length, 0);
  });
}

for (const [replacement, expected] of [
  [String.raw`\n`, "\n"],
  [String.raw`\t`, "\t"],
  [String.raw`\,`, ","],
  [String.raw`\;`, ";"],
  [String.raw`\\n`, String.raw`\n`],
  [String.raw`\\`, "\\"],
  ["<&>", "<x>"],
  [String.raw`\&`, "&"],
  [String.raw`\\&`, "\\x"],
  [String.raw`\\\&`, "\\&"],
  [String.raw`\1`, "x"],
] as const) {
  test(`sed retains replacement semantics for ${JSON.stringify(replacement)}`, async () => {
    const result = await runVirtual("sed", { args: ["-E", `s/(x)/${replacement}/g`], stdin: "xx\n" });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stderr.length, 0);
    assert.deepEqual(result.stdout, Buffer.from(`${expected}${expected}\n`));
  });
}

test("sed rejects unsupported or malformed programs before stdout, input, backup or file effects", async () => {
  for (const program of ["p;s/a/b/e", "p;w", "p;{", "p;b missing", "p;s/(/x/", "p;s/a/\\9/"]) {
    let consumed = false;
    const source = (async function* () { consumed = true; yield Buffer.from("a\n"); })();
    const result = await runVirtual("sed", { args: ["-E", "-i.bak", program, "input"], files: { input: "a\n" } }, {}, source);
    assert.notEqual(result.exitCode, 0, program);
    assert.equal(result.stdout.length, 0, program);
    assert.equal(consumed, false, program);
    assert.deepEqual(result.files, { input: Buffer.from("a\n") }, program);
  }
});

test("sed branch and regex work are budgeted and failed in-place execution preserves originals", async () => {
  const loop = await runVirtual("sed", { args: ["-i.bak", ":again\nb again", "input"], files: { input: "a\n" } }, { maxSteps: 50 });
  assert.equal(loop.exitCode, 2);
  assert.match(loop.stderr.toString(), /step limit/u);
  assert.deepEqual(loop.files, { input: Buffer.from("a\n") });
  const regex = await runVirtual("sed", { args: ["-E", "s/(a+)+b/X/"], stdin: "a".repeat(1000) }, { maxSteps: 2000 });
  assert.equal(regex.exitCode, 2);
  assert.match(regex.stderr.toString(), /step limit/u);
});

test("sed accepts one-byte input chunks and composes with the virtual shell", async () => {
  const streamed = await runVirtual("sed", { args: ["s/pear/apple/g"], stdin: "pear\npear" }, {}, byteChunks("pear\npear"));
  assert.equal(streamed.stdout.toString(), "apple\napple");
  const fs = await makeFileSystem();
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(textProgramCommands());
  const result = await shell.exec("printf 'keep:pear\\nskip:no\\nkeep:apple\\n' | sed -n '/^keep:/{s/^keep://;p;}' | sort | tee result");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "apple\npear\n");
  assert.equal(new TextDecoder().decode(await fs.readFile("/work/result")), result.stdout);
});

test("sed handles bracket backslashes, leading ], repeated inner captures, and escaped control delimiters", async () => {
  assert.equal((await runVirtual("sed", { args: ["s/[\\d]/X/g"], stdin: "\\d\n" })).stdout.toString(), "XX\n");
  assert.equal((await runVirtual("sed", { args: ["s/[\\1]/X/g"], stdin: "\\1\n" })).stdout.toString(), "XX\n");
  assert.equal((await runVirtual("sed", { args: ["s/[]\\(]/X/g"], stdin: "\\\n" })).stdout.toString(), "X\n");
  assert.equal((await runVirtual("sed", { args: ["-E", "s/((a)|b)+/\\2/"], stdin: "ab\n" })).stdout.toString(), "\n");
  assert.equal((await runVirtual("sed", { args: ["-E", "s/((a)|b)+\\2/X/"], stdin: "aba\n" })).stdout.toString(), "aba\n");
  assert.equal((await runVirtual("sed", { args: ["sn\\nnXn"], stdin: "anb\n" })).stdout.toString(), "aXb\n");
  assert.equal((await runVirtual("sed", { args: ["s/[/]/_/g"], stdin: "a/b/c\n" })).stdout.toString(), "a_b_c\n");
  assert.equal((await runVirtual("sed", { args: ["-n", "/[/]/p"], stdin: "a/b\ncd\n" })).stdout.toString(), "a/b\n");
  assert.equal((await runVirtual("sed", { args: ["s/[\\d]/_/g"], stdin: "a\\bd\n" })).stdout.toString(), "a_b_\n");
  assert.equal((await runVirtual("sed", { args: ["s/[d\\]/_/g"], stdin: "a\\bd\n" })).stdout.toString(), "a_b_\n");
  assert.equal((await runVirtual("sed", { args: ["s/[]\\(]/_/g"], stdin: "a\\b(c]d\n" })).stdout.toString(), "a_b_c_d\n");
});
