import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

const bytes = text => new Uint8Array(Buffer.from(text, "latin1"));
const replacement = "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+new\n";

test("native Wasm patch preserves arbitrary target bytes through files and stdin", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    const tail = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from("\ue080\ue0ff 🦀")]);
    for (const command of ["patch -f -i input.patch target", "cat input.patch | patch -f target"]) {
      await bash.fs.writeFile("/target", Buffer.concat([Buffer.from("old\n"), tail]));
      await bash.fs.writeFile("/input.patch", replacement);
      const result = await bash.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await bash.fs.readFile("/target"), new Uint8Array(Buffer.concat([Buffer.from("new\n"), tail])));
    }
  } finally { await bash.dispose(); }
});

for (const [format, patch] of Object.entries({
  unified: "--- target\n+++ target\n@@ -1 +1 @@\n-old\n+\0\xff\x80\xc0\n",
  normal: "1c1\n< old\n---\n> \0\xff\x80\xc0\n",
  context: "*** target\n--- target\n***************\n*** 1 ****\n! old\n--- 1 ----\n! \0\xff\x80\xc0\n",
})) test(`native Wasm ${format} patch preserves hunk, reverse and reject bytes`, async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    await bash.fs.writeFile("/input.patch", bytes(patch));
    for (const [option, input, expected, status] of [
      ["", "old\n", "\0\xff\x80\xc0\n", 0],
      ["-R", "\0\xff\x80\xc0\n", "old\n", 0],
      ["", "other\n", "other\n", 1],
    ]) {
      await bash.fs.writeFile("/target", bytes(input));
      const result = await bash.exec(`patch -f ${option} -i input.patch target`);
      assert.equal(result.exitCode, status, result.stderr);
      assert.deepEqual(await bash.fs.readFile("/target"), bytes(expected));
      if (status === 1) assert.ok(Buffer.from(await bash.fs.readFile("/target.rej")).includes(Buffer.from([0, 255, 128, 192, 10])));
    }
  } finally { await bash.dispose(); }
});

test("native Wasm patch keeps filename validation separate from body bytes", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const name of ["bad\0name", "bad\xff", '"bad\\377"', '"bad\\000name"']) {
      await bash.fs.writeFile("/target", "old\n");
      await bash.fs.writeFile("/input.patch", bytes(`--- ${name}\n+++ target\n@@ -1 +1 @@\n-old\n+new\n`));
      const result = await bash.exec("patch -f -i input.patch target");
      assert.equal(result.exitCode, 2, result.stderr);
      assert.deepEqual(await bash.fs.readFile("/target"), bytes("old\n"));
    }
    const name = "\ue080🦀";
    await bash.fs.writeFile(`/${name}`, "\ue080\n");
    await bash.fs.writeFile("/input.patch", `--- ${name}\n+++ ${name}\n@@ -1 +1 @@\n-\ue080\n+\ue0ff\n`);
    const result = await bash.exec("patch -f -i input.patch");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(await bash.fs.readFile(`/${name}`), new Uint8Array(Buffer.from("\ue0ff\n")));
  } finally { await bash.dispose(); }
});

test("native Wasm patch preserves stdout, backups and cancelled targets", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    await bash.fs.writeFile("/input.patch", replacement);
    for (const option of ["-b", "--atomic", "-o output", "-o - > output"]) {
      await bash.fs.writeFile("/target", bytes("old\n\0\xff\n"));
      await bash.fs.writeFile("/output", bytes("previous\0\xff"));
      const result = await bash.exec(`patch -f -i input.patch target ${option}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await bash.fs.readFile(option.startsWith("-o") ? "/output" : "/target"), bytes("new\n\0\xff\n"));
      if (option === "-b") assert.deepEqual(await bash.fs.readFile("/target.orig"), bytes("old\n\0\xff\n"));
    }
    await bash.fs.writeFile("/target", bytes("old\n\0\xff\n"));
    const controller = new AbortController(), reason = new Error("stop before patch");
    controller.abort(reason);
    await assert.rejects(bash.exec("patch -f -i input.patch target", { signal: controller.signal }), error => error === reason);
    assert.deepEqual(await bash.fs.readFile("/target"), bytes("old\n\0\xff\n"));
  } finally { await bash.dispose(); }
});

test("native Wasm binary patches preserve line endings and reject malformed input", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    for (const [option, input, patch, expected, status] of [
      ["--binary", "old\r\n", "--- target\r\n+++ target\r\n@@ -1 +1 @@\r\n-old\r\n+\0\xff\r\n", "\0\xff\r\n", 0],
      ["", "old", "--- target\n+++ target\n@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+\0\xff\n\\ No newline at end of file\n", "\0\xff", 0],
      ["", "old\n\0\xff\n", "", "old\n\0\xff\n", 0],
      ["", "old\n\0\xff\n", "\0\xff", "old\n\0\xff\n", 2],
      ["", "old\n\0\xff\n", "1c1\n< old\n---\n", "old\n\0\xff\n", 2],
    ]) {
      await bash.fs.writeFile("/target", bytes(input));
      await bash.fs.writeFile("/input.patch", bytes(patch));
      const result = await bash.exec(`patch -f ${option} -i input.patch target`);
      assert.equal(result.exitCode, status, result.stderr);
      assert.deepEqual(await bash.fs.readFile("/target"), bytes(expected));
    }
  } finally { await bash.dispose(); }
});
