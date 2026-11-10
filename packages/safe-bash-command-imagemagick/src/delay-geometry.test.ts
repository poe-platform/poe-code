import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI GIFs, retained byte-for-byte.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  it.each([
    ...["17X25", "17/25", "17,25", "17x25!", "17x25^", "17x25+0+0", "17x25"].flatMap(value => [
      { args: ["-delay", value, "/first.gif", "/second.gif"], delays: [680, 680] },
      { args: ["/first.gif", "/second.gif", "-set", "delay", value], delays: [680, 680] },
    ]),
  ])(`matches native GIF delay geometry (${mode}): $args`, async ({ args, delays }) => {
    const files = new Map<string, Uint8Array>([["/first.gif", first], ["/second.gif", second], ["/out.gif", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = [...args, "/out.gif"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
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
