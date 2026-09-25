import assert from "node:assert/strict";
import test from "node:test";
import { contents, filesystem, run } from "./helpers.js";

const cases = [
  { name: "replacement", old: "a\nb\nc\n", next: "a\nB\nc\n" },
  { name: "insertion", old: "a\nc\n", next: "a\nb\nc\n" },
  { name: "deletion", old: "a\nb\nc\n", next: "a\nc\n" },
  { name: "empty old", old: "", next: "one\ntwo\n" },
  { name: "empty new", old: "one\ntwo\n", next: "" },
  { name: "unterminated old", old: "one", next: "one\n" },
  { name: "unterminated new", old: "one\n", next: "one" },
  { name: "unterminated both", old: "old", next: "new" },
  { name: "CRLF", old: "one\r\ntwo\r\n", next: "ONE\r\ntwo\r\n" },
  { name: "UTF-8 BOM", old: "\ufeffcafé\n雪\n", next: "\ufeffcafe\n雪☃\n" },
  { name: "separate hunks", old: "0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n", next: "X\n1\n2\n3\n4\n5\n6\n7\n8\nY\n" },
];

for (const fixture of cases) for (const context of [0, 3]) {
  test(`native diff exact output and cross-apply: ${fixture.name}, U${context}`, async () => {
    const args = [`-U${context}`, "--label", "old", "--label", "new", "old", "new"];
    const files = { old: fixture.old, new: fixture.next };
    const actual = await run("diff", args, { files });
    assert.equal(actual.stderr, "");
    const applied = await run("patch", ["old"], { files, input: actual.stdout });
    assert.equal(applied.exitCode, 0, applied.stderr);
    assert.equal(await contents(applied.fs, "old"), fixture.next);
  });
}

test("identical input returns zero without headers", async () => {
  const result = await run("diff", ["old", "new"], { files: { old: "same\n", new: "same\n" } });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "");
});

test("brief comparison, grouped flags, and stdin operands", async () => {
  const result = await run("diff", ["-uq", "-", "new"], { files: { new: "new\n" }, input: "old\n" });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "Files - and new differ\n");
  const same = await run("diff", ["-", "-"], { input: "identical\n" });
  assert.equal(same.exitCode, 0);
});

test("recursive new-file diffs create, delete, and update with strip", async () => {
  const files = { "before/common": "old\n", "before/gone": "gone\n", "after/common": "new\n", "after/fresh": "fresh\n" };
  const diff = await run("diff", ["-urN", "before", "after"], { files });
  assert.equal(diff.exitCode, 1, diff.stderr);
  assert.match(diff.stdout, /--- \/dev\/null\n\+\+\+ after\/fresh/u);
  assert.match(diff.stdout, /--- before\/gone\n\+\+\+ \/dev\/null/u);
  const patched = await run("patch", ["-p1"], { files: { common: "old\n", gone: "gone\n" }, input: diff.stdout });
  assert.equal(patched.exitCode, 0, patched.stderr);
  assert.equal(await contents(patched.fs, "common"), "new\n");
  assert.equal(await contents(patched.fs, "fresh"), "fresh\n");
  await assert.rejects(patched.fs.stat("/work/gone"));
});

test("recursive order is deterministic and nonrecursive subdirectories stay unvisited", async () => {
  const files = { "left/z": "z\n", "left/a": "a\n", "left/sub/item": "old\n", "right/sub/item": "new\n" };
  const result = await run("diff", ["left", "right"], { files });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "Only in left: a\nCommon subdirectories: left/sub and right/sub\nOnly in left: z\n");
});

test("file-directory matching uses the file basename", async () => {
  const result = await run("diff", ["-u", "file", "directory"], { files: { file: "old\n", "directory/file": "new\n" } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /\+\+\+ directory\/file/u);
});

test("literal option-like filenames and labels with spaces", async () => {
  const result = await run("diff", ["-U", "1", "-L", "old name", "--label=new name", "--", "-old", "-new"], { files: { "-old": "old\n", "-new": "new\n" } });
  assert.equal(result.exitCode, 1);
  assert.match(result.stdout, /^--- old name\n\+\+\+ new name\n/u);
});

for (const args of [["-x", "a", "b"], ["--color", "a", "b"], ["-U-1", "a", "b"], ["-U"], ["a"], ["--label=a\nb", "a", "b"]]) {
  test(`diff rejects invalid arguments ${JSON.stringify(args)}`, async () => {
    const result = await run("diff", args, { files: { a: "a", b: "b" } });
    assert.equal(result.exitCode, 2);
    assert.equal(result.stdout, "");
  });
}

test("GNU unified accepts context above the safe integer range with exact incomplete-line output", async () => {
  const files = { a: "a", b: "b" };
  const args = ["-U9007199254740992", "-L", "a", "-L", "b", "a", "b"];
  const expected = { exitCode: 1, stdout: "--- a\n+++ b\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n\\ No newline at end of file\n", stderr: "" };
  for (const actual of [await run("diff", args, { files })]) {
    assert.deepEqual({ exitCode: actual.exitCode, stdout: actual.stdout, stderr: actual.stderr }, expected);
  }
});

test("missing paths require -N; both missing remains an error", async () => {
  assert.equal((await run("diff", ["missing", "present"], { files: { present: "x" } })).exitCode, 2);
  assert.equal((await run("diff", ["-N", "missing", "also-missing"])).exitCode, 2);
});

test("diff dereferences symlinks including ancestors", async () => {
  const fs = await filesystem({ target: "old\n", "dir/item": "new\n" });
  await fs.symlink("target", "/work/link");
  await fs.symlink("dir", "/work/alias");
  for (const [path, expected] of [["link", ""], ["alias/item", "1c1\n< new\n---\n> old\n"]] as const) {
    const result = await run("diff", [path, "target"], { fs });
    assert.equal(result.exitCode, expected ? 1 : 0, result.stderr);
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
  }
});

for (const flags of [[], ["-q"], ["--brief"], ["-u"], ["-y"], ["-D", "FLAG"]]) {
  test(`NUL bytes select binary reporting on either side: ${flags.join(" ")}`, async () => {
    for (const swapped of [false, true]) {
      const result = await run("diff", [...flags, "-L", "café", "a", "b"], {
        files: { a: swapped ? "text\n" : "a\0b", b: swapped ? "a\0b" : "text\n" },
      });
      assert.equal(result.exitCode, 1, result.stderr);
      assert.equal(result.stdout, `${flags.includes("-q") || flags.includes("--brief") ? "Files" : "Binary files"} café and b differ\n`);
      assert.equal(result.stderr, "");
    }
  });
}

for (const flags of [[], ["-a"], ["-U0"], ["-n"], ["-e"]]) {
  test(`non-UTF-8 changes preserve distinct raw bytes: ${flags.join(" ")}`, async () => {
    const output: Uint8Array[] = [];
    const result = await run("diff", [...flags, "a", "b"], {
      files: { a: Buffer.from([0xff, 10, 0x80, 10]), b: Buffer.from([0xfe, 10, 0x80, 10]) },
      stdout: { async write(chunk) { output.push(chunk.slice()); } },
    });
    const body = flags.includes("-U0") ? "--- a\n+++ b\n@@ -1 +1 @@\n-\xff\n+\xfe\n"
      : flags.includes("-n") ? "d1 1\na1 1\n\xfe\n"
      : flags.includes("-e") ? "1c\n\xfe\n.\n" : "1c1\n< \xff\n---\n> \xfe\n";
    assert.equal(result.exitCode, 1, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(Buffer.concat(output), Buffer.from(body, "latin1"));
  });
}

test("byte-text comparison leaves identical invalid lines unchanged and honors stdin and whitespace", async () => {
  const files = { b: Buffer.from([98, 10, 0x80, 10]) };
  const result = await run("diff", ["-", "b"], { files, input: Buffer.from([97, 10, 0x80, 10]) });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stdout, "1c1\n< a\n---\n> b\n");
  const same = await run("diff", ["-ws", "-", "b"], { files, input: Buffer.from([98, 32, 10, 0x80, 10]) });
  assert.equal(same.exitCode, 0, same.stderr);
  assert.equal(same.stdout, "Files - and b are identical\n");
});

test("recursive binary differences continue to byte-text and UTF-8 siblings", async () => {
  const output: Uint8Array[] = [];
  const result = await run("diff", ["-r", "left", "right"], {
    files: { "left/a": "x\0", "right/a": "y\0", "left/b": Buffer.from([0xff, 10]), "right/b": Buffer.from([0xfe, 10]), "left/café": "café\n", "right/café": "雪\n" },
    stdout: { async write(chunk) { output.push(chunk.slice()); } },
  });
  assert.equal(result.exitCode, 1, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(Buffer.concat(output), Buffer.concat([
    Buffer.from("Binary files left/a and right/a differ\ndiff -r left/b right/b\n1c1\n< \xff\n---\n> \xfe\n", "latin1"),
    Buffer.from('diff -r "left/caf\\303\\251" "right/caf\\303\\251"\n1c1\n< café\n---\n> 雪\n'),
  ]));
});

test("--no-dereference compares link targets, including dangling links, and file types", async () => {
  const fs = await filesystem({ file: "same\n" });
  await fs.symlink("missing", "/work/left");
  await fs.symlink("missing", "/work/right");
  const same = await run("diff", ["--no-dereference", "-s", "left", "right"], { fs });
  assert.equal(same.exitCode, 0, same.stderr);
  assert.equal(same.stdout, "Files left and right are identical\n");
  await fs.symlink("file", "/work/other");
  for (const flags of [[], ["-q"], ["-a"]]) {
    const different = await run("diff", ["--no-dereference", ...flags, "left", "other"], { fs });
    assert.equal(different.exitCode, 1, different.stderr);
    assert.equal(different.stdout, "Symbolic links left and other differ\n");
  }
  const mixed = await run("diff", ["--no-dereference", "left", "file"], { fs });
  assert.equal(mixed.exitCode, 1, mixed.stderr);
  assert.equal(mixed.stdout, "File left is a symbolic link while file file is a regular file\n");
});

test("recursive diff follows directory links, and no-dereference still follows parent links", async () => {
  const fs = await filesystem({ "old/item": "old\n", "new/item": "new\n" });
  await fs.symlink("old", "/work/left");
  await fs.symlink("new", "/work/right");
  const recursive = await run("diff", ["-r", "left", "right"], { fs });
  assert.equal(recursive.exitCode, 1, recursive.stderr);
  assert.equal(recursive.stdout, "diff -r left/item right/item\n1c1\n< old\n---\n> new\n");
  const parent = await run("diff", ["--no-dereference", "left/item", "right/item"], { fs });
  assert.equal(parent.exitCode, 1, parent.stderr);
  assert.equal(parent.stdout, "1c1\n< old\n---\n> new\n");
});

test("recursive directory links detect ancestry cycles without suppressing siblings", async () => {
  const fs = await filesystem({ "left/z": "old\n", "right/z": "new\n" });
  await fs.symlink(".", "/work/left/loop");
  await fs.symlink(".", "/work/right/loop");
  const result = await run("diff", ["-r", "left", "right"], { fs });
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /left\/loop: recursive directory loop/u);
  assert.equal(result.stdout, "diff -r left/z right/z\n1c1\n< old\n---\n> new\n");
  const links = await run("diff", ["-rq", "--no-dereference", "left", "right"], { fs });
  assert.equal(links.exitCode, 1, links.stderr);
  assert.equal(links.stdout, "Files left/z and right/z differ\n");
});

test("dangling symlinks respect new-file modes and recursive comparisons continue on errors", async () => {
  const fs = await filesystem({ "left/z": "old\n", "right/z": "new\n", b: "new\n" });
  for (const path of ["a", "left/a", "right/a"]) await fs.symlink("missing", `/work/${path}`);
  for (const flag of ["-N", "-P"]) {
    const empty = await run("diff", [flag, "a", "b"], { fs });
    assert.equal(empty.exitCode, 1, empty.stderr);
    assert.equal(empty.stdout, "0a1\n> new\n");
    const link = await run("diff", ["--no-dereference", flag, "missing", "a"], { fs });
    assert.equal(link.exitCode, 2);
    assert.equal(link.stdout, "");
  }
  const recursive = await run("diff", ["-r", "left", "right"], { fs });
  assert.equal(recursive.exitCode, 2);
  assert.match(recursive.stderr, /left\/a/u);
  assert.match(recursive.stderr, /right\/a/u);
  assert.equal(recursive.stdout, "diff -r left/z right/z\n1c1\n< old\n---\n> new\n");
});

test("no-dereference reports unmatched directory links and uses actual link names", async () => {
  const fs = await filesystem({ "left/z": "same\n", "right/z": "same\n", empty: "" });
  await fs.symlink("missing", "/work/right/link");
  await fs.symlink("other", "/work/other");
  const only = await run("diff", ["-r", "--no-dereference", "left", "right"], { fs });
  assert.equal(only.exitCode, 1, only.stderr);
  assert.equal(only.stdout, "Only in right: link\n");
  const labels = await run("diff", ["--no-dereference", "-L", "old label", "-L", "new label", "right/link", "other"], { fs });
  assert.equal(labels.exitCode, 1, labels.stderr);
  assert.equal(labels.stdout, "Symbolic links right/link and other differ\n");
  const empty = await run("diff", ["--no-dereference", "right/link", "empty"], { fs });
  assert.equal(empty.exitCode, 1, empty.stderr);
  assert.equal(empty.stdout, "File right/link is a symbolic link while file empty is a regular empty file\n");
});

for (const flag of ["-N", "-P"]) test(`recursive ${flag} diagnoses an existing dangling entry`, async () => {
  const fs = await filesystem({ "left/z": "same\n", "right/z": "same\n", "right/a": "new\n" });
  await fs.symlink("missing", "/work/left/a");
  const result = await run("diff", ["-r", flag, "left", "right"], { fs });
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /left\/a/u);
});

test("bounded seeded repeated-line diffs roundtrip in both directions", async () => {
  let seed = 0x124578;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let sample = 0; sample < 100; sample++) {
    const make = () => Array.from({ length: random() % 20 }, () => `${random() % 5}\n`).join("").replace(/\n$/u, random() % 2 ? "\n" : "");
    const old = make();
    const next = make();
    const diff = await run("diff", [`-U${sample % 5}`, "--label=target", "--label=target", "old", "new"], { files: { old, new: next } });
    assert.equal(diff.exitCode, old === next ? 0 : 1, diff.stderr);
    const fs = await filesystem({ target: old });
    const applied = await run("patch", [], { fs, input: diff.stdout });
    assert.equal(applied.exitCode, 0, `sample ${sample}: ${applied.stderr}\n${diff.stdout}`);
    assert.equal(await contents(fs, "target"), next);
    const reversed = await run("patch", ["-R"], { fs, input: diff.stdout });
    assert.equal(reversed.exitCode, 0, reversed.stderr);
    assert.equal(await contents(fs, "target"), old);
  }
});
