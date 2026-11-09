import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { createMagickCommand, runConvertCli, runIdentifyCli } from "./index.js";

// Native ImageMagick: two 2x1 red/blue frames, delays 7/13, loop 4.
const base = Uint8Array.from(Buffer.from("R0lGODlhAgABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQABwAAACwAAAAAAgABAAACAgQKACH5BAANAAAALAAAAAACAAEAgAAA/wAAAAICBAoAOw==", "base64"));
for (const repeats of [1, 17]) {
for (const mode of ["buffered", "retained", "command"]) {
  for (const name of ["EXAMPLE0001", "MG8BIM00000"]) {
    for (const strip of [false, true]) {
      it(`retains opaque GIF ${name} (${mode}, strip=${strip}, frames=${repeats * 2})`, async () => {
        const payload = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
        const extension = Uint8Array.of(33, 255, 11, ...new TextEncoder().encode(name), 255, ...payload.subarray(0, 255), 45, ...payload.subarray(255), 0);
        const animation = Uint8Array.of(...base.subarray(0, 19), ...Array.from({ length: repeats }, () => Array.from(base.subarray(19, -1))).flat(), 59);
        const bytes = Uint8Array.of(...animation.subarray(0, 19), ...extension, ...animation.subarray(19));
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.gif", bytes);
        const files = new Map([["in.gif", bytes]]);
        const args = ["in.gif", ...(strip ? ["-strip"] : []), "out.gif"];
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        const output = mode === "buffered" ? files.get("out.gif")! : await fs.readFile("/out.gif");
        expect(readImageMetadata(output, { page: 1 }).gifApplications).toBeUndefined();
        const identified = await runIdentifyCli(["-format", "%[profiles]|", "out.gif[0]"], mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(identified.stdout).toBe((strip ? "" : `gif:${name.toLowerCase()}`) + "|");
        expect(Buffer.from(output).includes(Buffer.from(extension))).toBe(!strip);
        expect(readImageMetadata(output)).toMatchObject({ pages: repeats * 2, delay: Array.from({ length: repeats }, () => [70, 130]).flat(), loop: 4 });
        expect(decodeImage(output, { animated: true }).data).toEqual(decodeImage(animation, { animated: true }).data);
      });
    }
  }
}
}
