import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

const inputs = {
  "illegal6": Buffer.from("47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c00000000020001000002027401003b", "hex"),
  "illegalAfterLiteral": Buffer.from("47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c0000000002000100000202c40b003b", "hex"),
  "illegal7": Buffer.from("47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c00000000020001000002027c01003b", "hex"),
  "validcode": Buffer.from("47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90404070000002c0000000002000100000202840b0021f90404170000002c00000000020001000002020c51003b", "hex"),
  "validred": Buffer.from("47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c00000000020001000002020451003b", "hex"),
};

for (const mode of ["buffered", "retained", "command"]) {
  it.each(Object.entries(inputs))(`validates GIF dictionary references (%s, ${mode})`, async (name, input) => {
    const valid = name.startsWith("valid");
    const keep = new TextEncoder().encode("keep");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    await fs.writeFile("/out.gif", keep);
    const files = new Map([["/in.gif", new Uint8Array(input)], ["/out.gif", keep]]);
    const args = ["/in.gif", "/out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    if (!valid) {
      expect(result.exitCode).not.toBe(0);
      expect(output).toEqual(keep);
      expect(() => decodeImage(input, { animated: true })).toThrow();
      return;
    }
    expect(result.exitCode).toBe(0);
    const red = [255, 0, 0, 255], green = [0, 255, 0, 255];
    const pixels = new Uint8Array(name === "validcode" ? [...red, ...red, ...green, ...red] : [...red, ...green, ...red, ...red]);
    expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(pixels);
    expect(decodeImage(input, { animated: true }).data).toEqual(pixels);
    expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 230] });
    expect([0, 1].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual(name === "validcode" ? [1, 1] : [2, 1]);
  });
}
