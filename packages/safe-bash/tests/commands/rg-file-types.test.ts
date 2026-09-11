import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { registerYieldCheckpoint, scheduleTurn } from "../../src/contracts/yield.js";
import { type ByteSource } from "../../src/contracts/index.js";
import { virtual } from "./search/helpers.js";

const files = { "a.ts": "hit\n", "b.tsx": "hit\n", "c.json": "hit\n", "d.js": "hit\n", "e.untyped": "hit\n" };

test("rg includes types with short long attached and combined options", async () => {
  for (const flags of [["-t", "ts"], ["-tts"], ["--type", "ts"], ["--type=ts"], ["-lt", "typescript"]]) {
    const result = await virtual({ args: [...flags, "--files", "."], files });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), "./a.ts\n./b.tsx\n");
    assert.equal(result.stderr.length, 0);
  }
});

test("rg excludes types without requiring a positive selection", async () => {
  for (const flags of [["-T", "ts"], ["-Tts"], ["--type-not", "ts"], ["--type-not=typescript"]]) {
    const result = await virtual({ args: ["--files", ...flags, "."], files });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), "./c.json\n./d.js\n./e.untyped\n");
  }
});

test("rg type selection unions and last matching include or exclude wins", async () => {
  for (const [flags, expected] of [
    [["-t", "ts", "-t", "json"], "./a.ts\n./b.tsx\n./c.json\n"],
    [["-t", "ts", "-T", "ts"], ""],
    [["-T", "ts", "-t", "ts"], "./a.ts\n./b.tsx\n"],
    [["-t", "typescript", "-T", "ts"], ""],
    [["-T", "ts", "-t", "typescript"], "./a.ts\n./b.tsx\n"],
    [["-t", "ts", "-T", "typescript", "-t", "ts"], "./a.ts\n./b.tsx\n"],
    [["-T", "ts", "-T", "json"], "./d.js\n./e.untyped\n"],
    [["-t", "all", "-T", "ts"], "./c.json\n./d.js\n"],
    [["-T", "all", "-t", "ts"], "./a.ts\n./b.tsx\n"],
    [["-t", "ts", "-T", "all"], ""],
    [["-T", "all"], "./e.untyped\n"],
  ] as const) {
    const result = await virtual({ args: ["--files", ...flags, "."], files });
    assert.equal(result.code, expected ? 0 : 1, flags.join(" "));
    assert.equal(result.stdout.toString(), expected, flags.join(" "));
    assert.equal(result.stderr.length, 0);
  }
});

test("rg type order applies to overlapping different patterns not just aliases", async () => {
  const fixture = { "composer.lock": "", "Cargo.lock": "", "package-lock.json": "", "data.json": "" };
  for (const [flags, expected] of [
    [["-tjson", "-Tlock"], "./data.json\n"],
    [["-Tlock", "-tjson"], "./composer.lock\n./data.json\n./package-lock.json\n"],
    [["-tjson", "-Tlock", "-tjson"], "./composer.lock\n./data.json\n./package-lock.json\n"],
  ] as const) {
    const result = await virtual({ args: ["--files", ...flags, "."], files: fixture });
    assert.equal(result.code, 0);
    assert.equal(result.stdout.toString(), expected);
  }
});

test("rg glob overrides precede type selectors regardless of argument order", async () => {
  for (const [flags, expected] of [
    [["-tts", "-g", "*.json"], "./c.json\n"],
    [["-g", "*.json", "-tts"], "./c.json\n"],
    [["-Tts", "-g", "*.ts"], "./a.ts\n"],
    [["-tts", "-g", "!*.ts"], "./b.tsx\n"],
    [["-tts", "-g", "*.json", "-g", "!*.json"], ""],
  ] as const) {
    const result = await virtual({ args: ["--files", ...flags, "."], files });
    assert.equal(result.code, expected ? 0 : 1);
    assert.equal(result.stdout.toString(), expected);
  }
});

test("rg database includes aliases basenames character classes and multiple suffixes", async () => {
  const fixture = {
    "src/a.cts": "", "src/b.mts": "", "src/c.tsx": "", "Makefile": "", "gnumakefile": "",
    "CMakeLists.txt": "", "build.cmake": "", "Dockerfile.dev": "", "Containerfile": "",
    "COPYING": "", "LICENSE-MIT": "", "file.h.in": "", "file.cpp.in": "", "file.xml.dist": "",
    "composer.lock": "", "Cargo.lock": "", "module.pyi": "", "module.py": "", "module.PY": "",
  };
  for (const [name, expected] of [
    ["ts", "./src/a.cts\n./src/b.mts\n./src/c.tsx\n"],
    ["typescript", "./src/a.cts\n./src/b.mts\n./src/c.tsx\n"],
    ["make", "./Makefile\n./gnumakefile\n"],
    ["cmake", "./CMakeLists.txt\n./build.cmake\n"],
    ["container", "./Containerfile\n./Dockerfile.dev\n"],
    ["license", "./COPYING\n./LICENSE-MIT\n"],
    ["cpp", "./file.cpp.in\n./file.h.in\n"],
    ["xml", "./file.xml.dist\n"],
    ["json", "./composer.lock\n"],
    ["toml", "./Cargo.lock\n"],
    ["py", "./module.py\n./module.pyi\n"],
    ["python", "./module.py\n./module.pyi\n"],
  ]) {
    const result = await virtual({ args: ["--files", "-t", name!, "."], files: fixture });
    assert.equal(result.code, 0, name);
    assert.equal(result.stdout.toString(), expected, name);
  }
});

test("rg ships the complete pinned native inventory as immutable literal data", async () => {
  const { defaultFileTypes } = await import("../../src/commands/search/file-types.js");
  const entries = Object.entries(defaultFileTypes);
  const inventory = entries.map(([name, patterns]) => `${name}: ${patterns.join(", ")}\n`).join("");
  assert.equal(entries.length, 224);
  assert.equal(entries.reduce((count, [, patterns]) => count + patterns.length, 0), 609);
  assert.equal(new Set(entries.flatMap(([, patterns]) => patterns)).size, 537);
  assert.equal(Buffer.byteLength(inventory), 6482);
  assert.equal(createHash("sha256").update(inventory).digest("hex"), "43d61f9dcafe9af53d496f1d68ea170f71e74994a906bf1fbc30a7d110af980e");
  assert.equal(Object.isFrozen(defaultFileTypes), true);
  assert.equal(entries.every(([, patterns]) => Object.isFrozen(patterns)), true);
});

test("rg unknown types fail before stdin or filesystem content consumption", async () => {
  for (const name of ["unknown_type", "TS", "ts,js", "constructor", "toString", "__proto__", ""]) {
    for (const flag of ["--type", "--type-not"]) {
      let consumed = false;
      const stdin: ByteSource = { async *[Symbol.asyncIterator]() { consumed = true; yield Buffer.from("hit\n"); } };
      const result = await virtual({ args: [flag, name, "-g", "*", "hit", "-"] }, {}, { stdin });
      assert.equal(result.code, 2);
      assert.equal(result.stdout.length, 0);
      assert.equal(result.stderr.toString(), `rg: unrecognized file type: ${name}\n`);
      assert.equal(consumed, false);
    }
  }
  for (const flag of ["-t", "-T", "--type", "--type-not"]) {
    const result = await virtual({ args: ["--files", flag] });
    assert.equal(result.code, 2);
    assert.equal(result.stderr.toString(), `rg: ${flag} requires a value\n`);
  }
});

test("rg explicit files stdin and files-mode paths bypass type filtering", async () => {
  for (const flags of [["-tjson"], ["-Tts"], ["-Tall"]]) {
    const explicit = await virtual({ args: ["--files", ...flags, "a.ts"], files });
    assert.equal(explicit.code, 0);
    assert.equal(explicit.stdout.toString(), "a.ts\n");
    for (const paths of [[], ["-"]]) {
      const stdin = await virtual({ args: [...flags, "hit", ...paths], stdin: "hit\n", files });
      assert.equal(stdin.code, 0);
      assert.equal(stdin.stdout.toString(), "hit\n");
    }
    const listed = await virtual({ args: ["--files", ...flags, "-"], stdin: "hit\n" });
    assert.equal(listed.code, 0);
    assert.equal(listed.stdout.toString(), "<stdin>\n");
  }
  const implicit = await virtual({ args: ["-tts", "hit"], files });
  assert.equal(implicit.stdout.toString(), "a.ts:hit\nb.tsx:hit\n");
  assert.equal((await virtual({ args: ["-tunknown_type", "hit", "a.ts"], files })).code, 2);
});

test("rg unknown type diagnostics are configuration errors even with no-messages", async () => {
  for (const args of [["--files", "--no-messages", "-tunknown_type", "."], ["--files", "-Tunknown_type", "--no-messages", "."]]) {
    const result = await virtual({ args, files });
    assert.equal(result.code, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.toString(), "rg: unrecognized file type: unknown_type\n");
  }
});

test("rg types respect ignore exclusions and native hidden leaf whitelisting without pruning directories", async () => {
  const fixture = {
    ".ignore": "ignored.ts\n!visible.json\n", ".leaf.ts": "", "ignored.ts": "", "visible.json": "",
    "plain/a.ts": "", "dir.json/b.ts": "", ".secret/c.ts": "", "plain/untyped": "",
  };
  const selected = await virtual({ args: ["--files", "-tts", "."], files: fixture });
  assert.equal(selected.code, 0);
  assert.equal(selected.stdout.toString(), "./.leaf.ts\n./dir.json/b.ts\n./plain/a.ts\n");
  assert.equal((await virtual({ args: ["--files", "--hidden", "-tts", "."], files: fixture })).stdout.toString(),
    "./.leaf.ts\n./.secret/c.ts\n./dir.json/b.ts\n./plain/a.ts\n");
  assert.equal((await virtual({ args: ["--files", "-tts", "-g", "*.ts", "."], files: fixture })).stdout.toString(),
    "./.leaf.ts\n./dir.json/b.ts\n./ignored.ts\n./plain/a.ts\n");
  const baseline = await virtual({ args: ["--files", "."], files: fixture });
  assert.equal(baseline.stdout.toString(), "./dir.json/b.ts\n./plain/a.ts\n./plain/untyped\n./visible.json\n");
});

test("rg type filters preserve recursive symlink policy and classify the link basename", async () => {
  const fixture = { files: { "source.txt": "hit\n", "plain/file.ts": "hit\n" }, links: { "alias.ts": "source.txt", linked: "plain" } };
  assert.equal((await virtual({ ...fixture, args: ["--files", "-tts", "."] })).stdout.toString(), "./plain/file.ts\n");
  const followed = await virtual({ ...fixture, args: ["--files", "-L", "-tts", "."] });
  assert.equal(followed.code, 0);
  assert.equal(followed.stdout.toString(), "./alias.ts\n./linked/file.ts\n./plain/file.ts\n");
});

test("rg retains selection count traversal record and output limits", async () => {
  const oversized = await virtual({ args: ["--files", ...Array<string>(1025).fill("-tts"), "."], files });
  assert.equal(oversized.code, 2);
  assert.equal(oversized.stderr.toString(), "rg: file type selection limit exceeded\n");
  assert.equal((await virtual({ args: ["--files", ...Array<string>(1024).fill("-tts"), "."], files })).stdout.toString(), "./a.ts\n./b.tsx\n");
  for (const [options, message] of [
    [{ maxFiles: 1 }, "filesystem entry limit exceeded"],
    [{ maxOutputBytes: 1 }, "output byte limit exceeded"],
    [{ maxLineBytes: 1 }, "line byte limit exceeded"],
  ] as const) {
    const result = await virtual({ args: ["-tts", "hit", "."], files }, options);
    assert.equal(result.code, 2);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.stderr.toString(), `rg: ${message}\n`);
  }
});

test("rg type preparation and preabort preserve falsey cancellation before input", async () => {
  for (const reason of [false, null, 0, ""]) {
    for (const preabort of [false, true]) {
      const controller = new AbortController();
      let consumed = false;
      const stdin: ByteSource = { async *[Symbol.asyncIterator]() { consumed = true; yield Buffer.from("hit\n"); } };
      if (preabort) controller.abort(reason);
      else registerYieldCheckpoint(controller.signal, () => { scheduleTurn(() => controller.abort(reason)); });
      await assert.rejects(virtual({ args: ["-tall", "hit", "-"] }, {}, { stdin, signal: controller.signal }), error => error === reason);
      assert.equal(consumed, false);
    }
  }
});

test("rg types preserve raw matching bytes and reused source ownership", async () => {
  const stdin: ByteSource = { async *[Symbol.asyncIterator]() {
    const buffer = Buffer.from([255, 120, 0]);
    yield buffer;
    buffer.set([128, 120, 0]);
    yield buffer;
    buffer.fill(65);
  } };
  const result = await virtual({ args: ["-tts", "--null-data", "-F", "x", "-"] }, {}, { stdin, stdinIsDefault: false });
  assert.equal(result.code, 0);
  assert.deepEqual(result.stdout, Buffer.from([255, 120, 0, 128, 120, 0]));
  const file = await virtual({ args: ["-tts", "--no-filename", "x", "."], files: { "a.ts": Buffer.from([255, 120, 10]), "b.js": "x\n" } });
  assert.equal(file.code, 0);
  assert.deepEqual(file.stdout, Buffer.from([255, 120, 10]));
});

test("rg file-type filtering does not enable customization or type-list flags", async () => {
  for (const flag of ["--type-add=custom:*.custom", "--type-clear=ts", "--type-list"]) {
    const result = await virtual({ args: ["--files", flag, "."], files });
    assert.equal(result.code, 2);
    assert.equal(result.stdout.length, 0);
  }
});
