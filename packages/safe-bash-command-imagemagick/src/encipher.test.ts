import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";
import fixtures from "./encipher-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-31 Q16-HDRI: native -encipher output, including partial rows.
for (const retained of [false, true]) {
  for (const fixture of fixtures) {
    it(`matches native cipher pixels: ${fixture.key}, ${fixture.coder}, ${fixture.size}, retained=${retained}`, async () => {
      const files = new Map([["/plain.png", Buffer.from(fixture.source, "base64")], ["/key.txt", Buffer.from(fixture.key)]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const result = await runConvertCli(["/plain.png", "-encipher", "/key.txt", "-define", `png:color-type=${["PNG32", "PNG64"].includes(fixture.coder) ? 6 : 2}`, "/cipher.png"], retained ? { filesystem: fs, cwd: "/" } : files);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      const actual = decodeImage(retained ? await fs.readFile("/cipher.png") : files.get("/cipher.png")!);
      const expected = decodeImage(Buffer.from(fixture.cipher, "base64"));
      expect(actual.data).toEqual(expected.data);
      expect(actual.data16).toEqual(expected.data16);
    });
  }
}

for (const retained of [false, true]) {
  it.each([{ keyArgs: [] }, { keyArgs: ["/missing-key"] }])(`rejects missing key arguments/files, retained=${retained}, %j`, async ({ keyArgs }) => {
    const files = new Map([["/plain.png", Buffer.from(fixtures[0]!.source, "base64")]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/plain.png", files.get("/plain.png")!);
    const result = await runConvertCli(["/plain.png", "-encipher", ...keyArgs, "/cipher.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(keyArgs.length ? "missing-key" : "missing argument '-encipher'");
    if (retained) await expect(fs.stat("/cipher.png")).rejects.toThrow();
    else expect(files.has("/cipher.png")).toBe(false);
  });
}

for (const mogrify of [false, true]) {
  it(`encrypts through the public command and mogrify, mogrify=${mogrify}`, async () => {
    const fs = new MemoryFileSystem(), fixture = fixtures[0]!;
    await fs.mkdir("/work");
    await fs.writeFile("/work/plain.png", Buffer.from(fixture.source, "base64"));
    await fs.writeFile("/work/key.txt", Buffer.from(fixture.key));
    const args = ["-encipher", "key.txt", "-define", "png:color-type=2"];
    const errors: Uint8Array[] = [];
    const result = mogrify
      ? await runMogrifyCli([...args, "plain.png"], { filesystem: fs, cwd: "/work" })
      : await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(["plain.png", ...args, "-write", "cipher.png", "null:"]).args,
          cwd: "/work", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { async write() {} }, stderr: { async write(bytes) { errors.push(bytes); } }
        });
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    const output = await fs.readFile(`/work/${mogrify ? "plain" : "cipher"}.png`);
    expect(decodeImage(output).data).toEqual(decodeImage(Buffer.from(fixture.cipher, "base64")).data);
  });
}
