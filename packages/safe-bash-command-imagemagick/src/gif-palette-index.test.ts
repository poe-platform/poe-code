import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli } from "./index.js";

// Original two-frame attachment: red/green, then green/red; delays 7/23 cs.
const globalControl = Buffer.from(
  "47494638396102000100800000ff000000ff0021ff0b4e45545343415045322e30" +
  "030102000021f90408070000002c0000000002000100000202045300" +
  "21f90404170000002c00000000020001000002020c51003b", "hex"
);

const localControl = Buffer.concat([
  globalControl.subarray(0, 78),
  Buffer.from("80ff000000ff00", "hex"),
  globalControl.subarray(79)
]);

for (const mode of ["buffered", "retained", "command"]) {
  it.each([
    ["global valid", globalControl, undefined],
    ["global invalid", globalControl, 58],
    ["local valid", localControl, undefined],
    ["local invalid", localControl, 87]
  ] as const)(`validates %s palette indices before replacing GIF output (${mode})`, async (_name, control, offset) => {
    const input = new Uint8Array(control);
    // LZW clear=4, literal=3, literal=0, end=5: valid codes, invalid color 3.
    if (offset !== undefined) { input[offset] = 0x1c; input[offset + 1] = 0x51; }
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
    if (offset !== undefined) {
      expect(result.exitCode).toBe(1);
      expect("stderr" in result ? result.stderr : stderr).toContain("invalid colormap index");
      expect(output).toEqual(keep);
    } else {
      expect(result.exitCode).toBe(0);
      expect(await sharp(output, { animated: true }).metadata()).toMatchObject({ pages: 2, delay: [70, 230] });
      expect([0, 1].map(page => decodeImage(output, { page, coalesce: false }).disposal)).toEqual([2, 1]);
      expect(await sharp(output, { animated: true }).raw().toBuffer()).toEqual(
        Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255)
      );
    }
  });
}
