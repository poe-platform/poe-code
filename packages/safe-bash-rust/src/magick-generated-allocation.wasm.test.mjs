import assert from "node:assert/strict";
import test from "node:test";
import { createRustWasmBash } from "./index.js";

test("generated images reject oversized allocations and preserve outputs", async () => {
  const bash = await createRustWasmBash({ forceNative: true, cwd: "/" });
  try {
    const initial = await bash.fs.readdir("/");
    await bash.fs.writeFile("/out.ppm", "KEEP");
    const options = { limits: { maxInputBytes: 1024 * 1024, maxMemoryBytes: 8 * 1024 * 1024 } };
    assert.equal((await bash.exec("magick -size 1x1 xc:blue null:", options)).exitCode, 0);
    for (const [size, input] of [
      ["100000x100000", "xc:blue"],
      ["30000x20000", "canvas:blue"],
      ["1x500000000", "xc:blue"],
      ["8000x8000", "xc:rgba(0,0,255,0.5)"],
    ]) {
      const result = await bash.exec(`magick -size 1x1 xc:blue -depth 8 -write saved.ppm -size ${size} '${input}' out.ppm`, options);
      assert.equal(result.exitCode, 1, `${size} ${input}`);
      assert.match(result.stderr, /image exceeds memory budget/);
      assert.deepEqual(await bash.fs.readFile("/out.ppm"), new TextEncoder().encode("KEEP"));
      assert.deepEqual(await bash.fs.readFile("/saved.ppm"), new Uint8Array(Buffer.from("P6\n1 1\n255\n\0\0\xff", "latin1")));
      assert.equal((await bash.fs.readdir("/")).length, initial.length + 2);
    }
  } finally { await bash.dispose(); }
});
