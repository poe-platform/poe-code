import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI GIFs, retained byte-for-byte.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  it.each([
    { args: ["-delay", "17x", "/first.gif", "/second.gif"], delays: [170, 170] },
    { args: ["/first.gif", "/second.gif", "-set", "delay", "17x"], delays: [170, 170] },
    { args: ["-delay", "17x0", "/first.gif", "/second.gif"], delays: [17000, 17000] },
    { args: ["/first.gif", "/second.gif", "-set", "delay", "17x0"], delays: [17000, 17000] },
    { args: ["-delay", "17", "/first.gif", "/second.gif"], delays: [170, 170] },
    { args: ["/first.gif", "/second.gif", "-set", "delay", "17"], delays: [170, 170] },
  ])(`distinguishes omitted and zero tick rates (${mode}): $args`, async ({ args, delays }) => {
    const files = new Map<string, Uint8Array>([
      ["/first.gif", first], ["/second.gif", second], ["/out.gif", new TextEncoder().encode("KEEP")],
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = [...args, "/out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(argv, files)
      : await runMagickCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    expect(decodeImage(output, { animated: true }).delay).toEqual(delays);
    for (const [page, input] of [first, second].entries()) {
      const original = decodeImage(input, { coalesce: false });
      const frame = decodeImage(output, { page, coalesce: false });
      expect(frame).toMatchObject({
        width: original.width, height: original.height, disposal: original.disposal,
        properties: original.properties, data: original.data,
      });
    }
  });
}
