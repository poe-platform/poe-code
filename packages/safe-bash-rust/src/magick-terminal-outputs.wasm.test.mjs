import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

for (const destination of ["mpr:final", "MPR:Final[0]", "null:"]) {
  test(`terminal ${destination} preserves files and prior explicit writes`, async () => {
    const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
    try {
      const initial = await bash.fs.readdir("/");
      const command = `magick -size 1x1 xc:blue ${destination}`;
      let result = await bash.exec(command);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(await bash.fs.readdir("/"), initial);
      await bash.fs.writeFile("/" + destination, "KEEP");
      result = await bash.exec(`magick -size 1x1 xc:blue -depth 8 -write saved.ppm ${destination}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
      assert.deepEqual(await bash.fs.readFile("/" + destination), new TextEncoder().encode("KEEP"));
      assert.deepEqual(await bash.fs.readFile("/saved.ppm"), new Uint8Array(Buffer.from("P6\n1 1\n255\n\0\0\xff", "latin1")));
      result = await bash.exec(`magick saved.ppm ${destination}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(await bash.fs.readFile("/" + destination), new TextEncoder().encode("KEEP"));
      assert.equal((await bash.fs.readdir("/")).length, initial.length + 2);
    } finally { await bash.dispose(); }
  });
}

test("terminal MPR output validates every input", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    const initial = await bash.fs.readdir("/");
    for (const command of [
      "magick missing.png mpr:final",
      "magick mpr:final",
      "magick mpr:final later.png",
      "magick xc:blue missing.png mpr:final",
    ]) {
      assert.notEqual((await bash.exec(command)).exitCode, 0, command);
      assert.deepEqual(await bash.fs.readdir("/"), initial, command);
    }
  } finally { await bash.dispose(); }
});

test("terminal output failure preserves prior explicit writes", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    const initial = await bash.fs.readdir("/");
    await bash.fs.writeFile("/broken.bin", "not an image");
    const result = await bash.exec("magick xc:blue -depth 8 -write saved.ppm broken.bin mpr:final");
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(await bash.fs.readFile("/saved.ppm"), new Uint8Array(Buffer.from("P6\n1 1\n255\n\0\0\xff", "latin1")));
    assert.equal((await bash.fs.readdir("/")).length, initial.length + 2);
  } finally { await bash.dispose(); }
});
