import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: first frame 17cs/Background,
// second frame 53cs/Previous. Appending keeps the first frame's controls.
const input = Buffer.from("R0lGODlhAwACAPAAAPBAEAAAACH/C05FVFNDQVBFMi4wAwEDAAAh+QQIEQAAACwAAAAAAwACAAACAoRfACH5BAw1AAAALAAAAAACAAUAgBBgwAAAAAIDhI8FADs=", "base64");

for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const operation of ["+append", "-append"]) {
    it.each([
      { name: "original order", source: "/pair.gif", options: [], delay: 170, disposal: 2 },
      { name: "reversed order", source: "/pair.gif", options: ["-reverse"], delay: 530, disposal: 3 },
      { name: "single frame", source: "/pair.gif[0]", options: [], delay: 170, disposal: 2 },
    ])(`${mode} ${operation} preserves animation controls in $name`, async ({ source, options, delay, disposal }) => {
      const files = new Map<string, Uint8Array>([["/pair.gif", input]]);
      const fs = createMemoryFileSystem();
      await fs.writeFile("/pair.gif", input);
      const args = [source, ...options, operation, "/out.gif"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const bytes = mode === "map" || mode === "sync" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
      const output = decodeImage(bytes, { page: 0, coalesce: false });
      expect(output.delay).toEqual([delay]);
      expect(output.disposal).toBe(disposal);
      expect([output.width, output.height]).toEqual(source.endsWith("[0]") ? [3, 2] : operation === "+append" ? [5, 5] : [3, 7]);
    });
  }
}
