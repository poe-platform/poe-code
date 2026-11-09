import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const invalidMasks = ["R,unknown", "Banana", "R+B", "0x1", "opacity", "R,garbage", "garbage", "None", "Opacity"];
const validMasks = [["Red,Blue", "rb"], ["R|B", "rb"], ["R,Sync", "r"], ["R,K", "r"], ["K", ""], ["0", "r"], ["1", "g"], ["2", "b"], ["3", ""], ["4", "a"]] as const;

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const operation of ["Polynomial", "negate"] as const) {
    it.each([...invalidMasks.map(mask => [mask, undefined] as const), ...validMasks])(
      `${mode}: ${operation} validates channel mask %s before replacing the destination`, async (mask, selected) => {
        const pixels = [11, 22, 33, 88, 55, 66, 77, 99];
        const source = await sharp(Uint8Array.from(pixels), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
        const keep = new TextEncoder().encode("KEEP");
        const files = new Map([["/in.png", source], ["/out.png", keep]]);
        const fs = createMemoryFileSystem();
        await fs.writeFile("/in.png", source);
        await fs.writeFile("/out.png", keep);
        const args = ["/in.png", "-channel", mask,
          ...(operation === "Polynomial" ? ["-function", "Polynomial", "0.8"] : ["-negate", "+channel"]), "PNG32:/out.png"];
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        const output = mode === "buffered" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png");
        const diagnostic = "stderr" in result ? result.stderr : stderr;
        if (selected === undefined) {
          expect(result.exitCode).toBe(1);
          expect(diagnostic).toContain("unrecognized channel type");
          expect(diagnostic).toContain(mask);
          expect(output).toEqual(keep);
        } else {
          expect(result.exitCode).toBe(0);
          expect(diagnostic).toBe("");
          expect([...decodeImage(output).data]).toEqual(pixels.map((value, index) =>
            selected.includes("rgba"[index % 4]!) ? operation === "Polynomial" ? 204 : 255 - value : value));
        }
      });
  }
}
