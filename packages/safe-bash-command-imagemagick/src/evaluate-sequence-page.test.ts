import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["map", "sync", "retained", "command"] as const) {
  it.each([false, true])(`${mode}: sequence evaluation scales the first page (reverse=%s)`, async reverse => {
    const files = new Map<string, Uint8Array>(), fs = createMemoryFileSystem();
    const run = async (args: string[]) => mode === "command"
      ? createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : mode === "sync" ? runMagickCliSync(args, files)
      : runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(await runMagickCli(["-size", "1x1", "xc:#2468ac", "-repage", "4x2+2+1", "PNG24:/small.png"], files)).toMatchObject({ exitCode: 0 });
    expect(await runMagickCli(["-size", "3x1", "xc:#b04c28", "-repage", "12x8+5+3", "PNG24:/wide.png"], files)).toMatchObject({ exitCode: 0 });
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const inputs = reverse ? ["/wide.png", "/small.png"] : ["/small.png", "/wide.png"];
    const result = await run([...inputs, "-evaluate-sequence", "Mean", "/out.png"]);
    expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "map" || mode === "sync" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    // Native ImageMagick 7: pixels stay fixed while CloneImage scales the first page.
    expect(output).toMatchObject({ width: 3, height: 1, virtualCanvas: reverse
      ? { width: 12, height: 8, x: 5, y: 3 }
      : { width: 12, height: 2, x: 6, y: 1 } });
    expect([...output.data]).toEqual([106, 90, 106, 255, 106, 90, 106, 255, 106, 90, 106, 255]);
  });
}
