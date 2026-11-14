import assert from "node:assert/strict";
import test from "node:test";
import { run, replacement } from "./helpers.test.js";

// latin1 here constructs exact fixture bytes, including invalid UTF-8.
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

test("ASCII hunk preserves untouched non-UTF-8 target bytes", async () => {
  const result = await run("patch", ["-f", "target"], {
    files: { target: bytes("old\n\xff\n") }, input: replacement,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await result.fs.readFile("/work/target"), bytes("new\n\xff\n"));
});

const patches = {
  unified: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+\xff\x80\xc0\n",
  normal: "1c1\n< old\n---\n> \xff\x80\xc0\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! \xff\x80\xc0\n",
};

for (const [option, input, patch, expected] of [
  [["--binary"], "old\r\n", "--- target\r\n+++ target\r\n@@ -1 +1 @@\r\n-old\r\n+\0\xff\r\n", "\0\xff\r\n"],
  [[], "old", "--- target\n+++ target\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+\0\xff\n\\ No newline at end of file\n", "\0\xff"],
] as const) test(`binary hunk line endings: ${JSON.stringify(expected)}`, async () => {
  const result = await run("patch", ["-f", ...option, "target"], { files: { target: bytes(input) }, input: bytes(patch) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await result.fs.readFile("/work/target"), bytes(expected));
});

test("malformed input, output limits and cancellation preserve binary targets", async () => {
  const empty = await run("patch", ["-f", "target"], { files: { target: bytes("old\n\0\xff\n") }, input: "" });
  assert.equal(empty.exitCode, 0, empty.stderr);
  assert.deepEqual(await empty.fs.readFile("/work/target"), bytes("old\n\0\xff\n"));
  for (const input of [bytes("\0\xff"), bytes("1c1\n< old\n---\n")]) {
    const result = await run("patch", ["-f", "target"], { files: { target: bytes("old\n\0\xff\n") }, input });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes("old\n\0\xff\n"));
  }
  const result = await run("patch", ["-f", "target"], { files: { target: bytes("old\n\0\xff\n") }, input: replacement, options: { maxOutputBytes: 1 } });
  assert.equal(result.exitCode, 2);
  assert.deepEqual(await result.fs.readFile("/work/target"), bytes("old\n\0\xff\n"));
  const controller = new AbortController(), reason = new Error("stop before patch");
  controller.abort(reason);
  await assert.rejects(run("patch", ["-f", "target"], { fs: result.fs, input: replacement, signal: controller.signal }), error => error === reason);
  assert.deepEqual(await result.fs.readFile("/work/target"), bytes("old\n\0\xff\n"));
});

test("ASCII hunks preserve every untouched byte and literal private Unicode", async () => {
  const tail = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("\ue080\ue0ff 🦀")]);
  for (const named of [false, true]) {
    const result = await run("patch", ["-f", ...(named ? ["-i", "input.patch"] : []), "target"], {
      files: { target: Buffer.concat([Buffer.from("old\n"), tail]), "input.patch": replacement }, input: replacement,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), new Uint8Array(Buffer.concat([Buffer.from("new\n"), tail])));
  }
});

for (const [format, original] of Object.entries(patches)) {
  const patch = original.replace("\xff\x80\xc0", "\0\xff\x80\xc0");
  for (const [option, input, expected, status] of [
    [[], "old\n", "\0\xff\x80\xc0\n", 0],
    [["-R"], "\0\xff\x80\xc0\n", "old\n", 0],
    [[], "other\n", "other\n", 1],
  ] as const) test(`${format} preserves NUL and invalid UTF-8, ${option.join()} status ${status}`, async () => {
    const result = await run("patch", ["-f", ...option, "target"], { files: { target: bytes(input) }, input: bytes(patch) });
    assert.equal(result.exitCode, status, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes(expected));
    if (status === 1) assert.ok(Buffer.from(await result.fs.readFile("/work/target.rej")).includes(Buffer.from([0, 255, 128, 192, 10])));
  });
}

for (const option of [["-b"], ["--atomic"], ["-o", "output"], ["-o", "-"]]) {
  test(`patch output and backup preserve raw bytes: ${option.join(" ")}`, async () => {
    const stdout: Uint8Array[] = [];
    const result = await run("patch", ["-f", ...option, "target"], {
      files: { target: bytes("old\n\0\xff\n"), output: bytes("previous\0\xff") }, input: replacement,
      stdout: { async write(chunk) { stdout.push(chunk.slice()); } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = option[1] === "-" ? new Uint8Array(Buffer.concat(stdout)) : await result.fs.readFile(`/work/${option[0] === "-o" ? "output" : "target"}`);
    assert.deepEqual(output, bytes("new\n\0\xff\n"));
    if (option[0] === "-b") assert.deepEqual(await result.fs.readFile("/work/target.orig"), bytes("old\n\0\xff\n"));
    if (option[0] === "-o") assert.deepEqual(await result.fs.readFile("/work/target"), bytes("old\n\0\xff\n"));
  });
}

for (const name of ["bad\0name", "bad\xff", '"bad\\377"', '"bad\\000name"']) {
  test(`invalid filename bytes cannot replace the explicit target: ${JSON.stringify(name)}`, async () => {
    const result = await run("patch", ["-f", "target"], {
      files: { target: "old\n" }, input: bytes(`--- ${name}\n+++ target\n@@ -1 +1 @@\n-old\n+new\n`),
    });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes("old\n"));
  });
}

test("literal private Unicode is distinct from raw bytes in filenames and contents", async () => {
  const name = "\ue080🦀";
  const result = await run("patch", ["-f"], {
    files: { [name]: "\ue080\n" }, input: `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-\ue080\n+\ue0ff\n`,
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await result.fs.readFile(`/work/${name}`), new Uint8Array(Buffer.from("\ue0ff\n")));
});

for (const [format, patch] of Object.entries(patches)) {
  for (const reverse of [false, true]) test(`${format} preserves non-UTF-8 hunk bytes${reverse ? " in reverse" : ""}`, async () => {
    const result = await run("patch", ["-f", ...(reverse ? ["-R"] : []), "target"], {
      files: { target: bytes(reverse ? "\xff\x80\xc0\n" : "old\n") },
      input: { async *[Symbol.asyncIterator]() { for (const byte of bytes(patch)) yield Uint8Array.of(byte); } },
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes(reverse ? "old\n" : "\xff\x80\xc0\n"));
  });
  test(`${format} preserves non-UTF-8 bytes in rejects`, async () => {
    const result = await run("patch", ["-f", "target"], { files: { target: "other\n" }, input: bytes(patch) });
    assert.equal(result.exitCode, 1, result.stderr);
    assert.ok(Buffer.from(await result.fs.readFile("/work/target.rej")).includes(Buffer.from([255, 128, 192, 10])));
    assert.deepEqual(await result.fs.readFile("/work/target"), bytes("other\n"));
  });
}
