import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  for (const direction of ["+append", "-append"]) {
    it.each([false, true])(`${mode} ${direction} preserves the first page (explicit=%s)`, async explicit => {
      const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
      expect(await runMagickCli(["-size", "5x3", "xc:red", ...(explicit ? ["-repage", "20x12-2+4"] : []), "PNG24:/first.png"], files)).toMatchObject({ exitCode: 0 });
      expect(await runMagickCli(["-size", "5x3", "xc:blue", "-repage", "40x30+7-1", "PNG24:/second.png"], files)).toMatchObject({ exitCode: 0 });
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["/first.png", "/second.png", direction, "/out.png"];
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} },
        })
        : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0 });
      const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
      expect([output.width, output.height]).toEqual(direction === "+append" ? [10, 3] : [5, 6]);
      expect(output.virtualCanvas).toEqual(explicit
        ? { width: 20, height: 12, x: -2, y: 4 }
        : { width: 5, height: 3, x: 0, y: 0 });
      const expected = Array.from({ length: 30 }, (_, i) =>
        (direction === "+append" ? i % 10 < 5 : i < 15) ? [255, 0, 0, 255] : [0, 0, 255, 255]).flat();
      expect([...output.data]).toEqual(expected);
    });
  }
}
