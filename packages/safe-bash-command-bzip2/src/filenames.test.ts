import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { chunks, run } from "./helpers.js";

for (const command of ["bzip2", "bunzip2"]) {
  for (const name of ["nosuffix", "note.BZ2", "note.bz2"]) {
    test(`${command} decodes ${name} with the native output name`, async () => {
      const input = Buffer.from("bzip2 filename fallback\n");
      const encoded = await run("bzip2", ["-c"], chunks(input));
      assert.equal(encoded.exitCode, 0, encoded.stderr);
      const fs = createMemoryFileSystem();
      await fs.writeFile(`/${name}`, encoded.stdout);
      const result = await run(command, ["-dk", name], undefined, { fs });
      assert.equal(result.exitCode, 0, result.stderr);
      const destination = name === "note.bz2" ? "/note" : `/${name}.out`;
      assert.deepEqual(Buffer.from(await fs.readFile(destination)), input);
      assert.deepEqual(Buffer.from(await fs.readFile(`/${name}`)), encoded.stdout);
      assert.equal(result.stderr.includes("Can't guess original name"), name !== "note.bz2");
      assert.equal(result.stdout.length, 0);
    });
  }
}

for (const force of [false, true]) {
  test(`bzip2 fallback ${force ? "replaces with force" : "protects"} an existing output`, async () => {
    const input = Buffer.from("decoded data\n");
    const encoded = await run("bzip2", ["-c"], chunks(input));
    assert.equal(encoded.exitCode, 0, encoded.stderr);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/nosuffix", encoded.stdout);
    const original = Buffer.from("existing output\n");
    await fs.writeFile("/nosuffix.out", original);
    const result = await run("bzip2", [force ? "-dkf" : "-dk", "nosuffix"], undefined, { fs });
    assert.equal(result.exitCode, force ? 0 : 1, result.stderr);
    assert.deepEqual(Buffer.from(await fs.readFile("/nosuffix.out")), force ? input : original);
    assert.deepEqual(Buffer.from(await fs.readFile("/nosuffix")), encoded.stdout);
  });
}
