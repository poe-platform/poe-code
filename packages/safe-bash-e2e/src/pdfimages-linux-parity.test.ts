import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RustWasmBash } from "@poe-code/safe-bash-rust";
import { SafeBashE2EHarness } from "./harness.js";

test("pdfimages lists and extracts inline LZW images like Poppler", async t => {
  const env = { ...process.env, LC_ALL: "C" };
  const probe = spawnSync("pdfimages", ["-v"], { env });
  if ((probe.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return t.skip("Poppler pdfimages is not installed");
  assert.equal(probe.status, 0, probe.stderr?.toString() ?? probe.error?.message);

  // Both placements contain the bytes " EI (" inside a valid LZW stream.
  const fixture = fileURLToPath(new URL("../fixtures/inline-lzw.pdf", import.meta.url));
  const out = fileURLToPath(new URL("../../../out/", import.meta.url));
  await mkdir(out, { recursive: true });
  const cwd = await mkdtemp(out + "pdfimages-");
  const ts = await SafeBashE2EHarness.create({ backend: "typescript" });
  const rust = new RustWasmBash({ cwd: "/workspace", forceNative: true });
  try {
    const pdf = await readFile(fixture);
    for (const fs of [ts.fs, rust.fs]) await fs.writeFile("/workspace/inline.pdf", pdf);
    for (const [args, script] of [
      [["-list", fixture], "pdfimages -list inline.pdf"],
      [[fixture, "image"], "pdfimages inline.pdf image"],
    ] as const) {
      const native = spawnSync("pdfimages", args, { cwd, env });
      assert.equal(native.status, 0, native.stderr.toString());
      for (const shell of [ts.shell, rust]) {
        const actual = await shell.exec(script);
        assert.deepEqual([actual.exitCode, Buffer.from(actual.stdoutBytes), Buffer.from(actual.stderrBytes)],
          [native.status, native.stdout, native.stderr], shell.constructor.name + ": " + script);
      }
    }
    const files = (await readdir(cwd)).sort();
    assert.deepEqual(files, ["image-000.ppm", "image-001.ppm"]);
    for (const fs of [ts.fs, rust.fs]) {
      const names = (await fs.readdir("/workspace")).map(entry => entry.name).filter(name => name.startsWith("image-"));
      assert.deepEqual(names.sort(), files);
    }
    for (const name of files) {
      const native = await readFile(cwd + "/" + name);
      for (const fs of [ts.fs, rust.fs]) assert.deepEqual(Buffer.from(await fs.readFile("/workspace/" + name)), native, name);
    }
  } finally {
    rust.dispose();
    await ts.dispose();
    await rm(cwd, { recursive: true, force: true });
  }
});
