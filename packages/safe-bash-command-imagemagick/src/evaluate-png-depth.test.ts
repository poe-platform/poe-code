import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// ImageMagick 7 Q16-HDRI: fractional samples are rounded at the output depth.
for (const mode of ["map", "public"] as const) {
  for (const coder of ["PNG64", "PNG48", "PNG32"] as const) {
    it.each([
      ["white", "Divide", "2", 32768],
      ["black", "Set", "50%", 32768],
      ["white", "Set", "50%", 32768],
      ["black", "Divide", "2", 0],
      ["white", "Add", "1", 65535],
    ] as const)(`${mode}: ${coder} encodes xc:%s -evaluate %s %s`, async (color, operator, operand, expected) => {
      const fs = new MemoryFileSystem();
      const files = new Map([["/out", new TextEncoder().encode("KEEP")]]);
      await fs.writeFile("/out", files.get("/out")!);
      const args = [`xc:${color}`, "-evaluate", operator, operand, `${coder}:/out`];
      const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
      const result = mode === "map" ? await runMagickCli(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout.push(bytes); } },
        stderr: { async write(bytes) { stderr.push(bytes); } },
      });
      expect(result.exitCode).toBe(0);
      expect("stdout" in result ? result.stdout : Buffer.concat(stdout).toString()).toBe("");
      expect("stderr" in result ? result.stderr : Buffer.concat(stderr).toString()).toBe("");
      const image = decodeImage(mode === "map" ? files.get("/out")! : await fs.readFile("/out"));
      expect([image.width, image.height]).toEqual([1, 1]);
      expect(image.depth).toBe(coder === "PNG32" ? "uchar" : "ushort");
      const value = coder === "PNG32" ? Math.round(expected / 257) : expected;
      expect(Array.from(image.data16 ?? image.data)).toEqual([value, value, value, coder === "PNG32" ? 255 : 65535]);
    });
  }
}

it.each([false, true])("writes fractional color and alpha across chunks without changing later evaluation, retained=%s", async retained => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const result = await runMagickCli([
    "-size", "513x2", "xc:white", "-alpha", "set", "-evaluate", "Divide", "2",
    "-write", "PNG64:/half.png", "-evaluate", "Multiply", "2", "PNG64:/full.png",
  ], retained ? { filesystem: fs, cwd: "/" } : files);
  expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  for (const [path, value] of [["/half.png", 32768], ["/full.png", 65535]] as const) {
    const image = decodeImage(retained ? await fs.readFile(path) : files.get(path)!);
    expect([image.width, image.height]).toEqual([513, 2]);
    expect(image.data16).toEqual(new Uint16Array(513 * 2 * 4).fill(value));
  }
});
