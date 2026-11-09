import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Two-frame GIFs with complete, short, unterminated, and excess LZW rasters.
const fixtures = {
  "early2.gif": "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c00000000020001000002012c003b",
  "extra.gif": "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90404070000002c00000000020001000002030443140021f90404170000002c00000000020001000002020c51003b",
  "missingpixel.gif": "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90404070000002c00000000020001000002024c010021f90404170000002c00000000020001000002020c51003b",
  "noeoi.gif": "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90404070000002c000000000200010000020204030021f90404170000002c00000000020001000002020c51003b",
  "ok.gif": "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30030102000021f90408070000002c000000000200010000020204530021f90404170000002c00000000020001000002020c51003b",
};

for (const mode of ["buffered", "retained", "command"]) {
  it.each(Object.entries(fixtures))(`validates decoded pixel counts in %s (${mode})`, async (name, hex) => {
    const input = new Uint8Array(Buffer.from(hex, "hex"));
    const invalid = name === "missingpixel.gif" || name === "early2.gif";
    const keep = new TextEncoder().encode("keep");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.gif", input);
    await fs.writeFile("/out.gif", keep);
    const files = new Map([["/in.gif", input], ["/out.gif", keep]]);
    const args = ["/in.gif", "/out.gif"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } }
    }) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    const output = mode === "buffered" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    if (invalid) {
      expect(result.exitCode).toBe(1);
      expect("stderr" in result ? result.stderr : stderr).toContain("Truncated GIF pixels");
      expect(output).toEqual(keep);
    } else {
      expect(result.exitCode).toBe(0);
      expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 230] });
      expect([0, 1].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual(name === "ok.gif" ? [2, 1] : [1, 1]);
      expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(
        Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255)
      );
    }
  });
}
