import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI inputs: 16cs/Background and 36cs/Previous.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["map", "sync", "retained", "command"] as const) {
  it.each([
    { setting: "7x20<", expected: [800, 1800] },
    { setting: "7x20>", expected: [350, 350] },
    { setting: "20x20>", expected: [800, 1000] },
    { setting: "20x20<", expected: [1000, 1800] },
    { setting: "20>", expected: [160, 200] },
    { setting: "20<", expected: [200, 360] },
    { setting: "20", expected: [200, 200] },
    { setting: "16>", expected: [160, 160] },
    { setting: "36<", expected: [360, 360] },
  ])(`${mode} applies conditional delay $setting to each incoming frame`, async ({ setting, expected }) => {
    const files = new Map<string, Uint8Array>([["/first.gif", first], ["/second.gif", second]]);
    const fs = createMemoryFileSystem();
    await fs.writeFile("/first.gif", first);
    await fs.writeFile("/second.gif", second);
    const run = async (args: string[]) => mode === "command"
      ? createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
      })
      : mode === "sync" ? runMagickCliSync(args, files)
      : runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    const read = (path: string) => mode === "map" || mode === "sync" ? files.get(path)! : fs.readFile(path);

    // Check separate inputs, then read the same frames from one animated input.
    expect(await run(["/first.gif", "/second.gif", "/pair.gif"])).toMatchObject({ exitCode: 0 });
    for (const inputs of [["/first.gif", "/second.gif"], ["/pair.gif"]]) {
      const sentinel = new TextEncoder().encode("KEEP");
      files.set("/out.gif", sentinel);
      await fs.writeFile("/out.gif", sentinel);
      expect(await run(["-delay", setting, ...inputs, "/out.gif"])).toMatchObject({ exitCode: 0 });
      const output = await read("/out.gif");
      expect(decodeImage(output, { page: 0, coalesce: false }).delay).toEqual(expected);
      for (const [page, original] of [first, second].entries()) {
        const frame = decodeImage(output, { page, coalesce: false });
        const input = decodeImage(original, { page: 0, coalesce: false });
        expect([frame.width, frame.height, frame.disposal]).toEqual([input.width, input.height, input.disposal]);
        expect(frame.data).toEqual(input.data);
      }
    }

    // A later setting must not retroactively modify already loaded frames.
    expect(await run(["/pair.gif", "-delay", setting, "/pair.gif[1,0]", "/ordered.gif"]))
      .toMatchObject({ exitCode: 0 });
    expect(decodeImage(await read("/ordered.gif")).delay).toEqual([160, 360, expected[1], expected[0]]);
  });
}
