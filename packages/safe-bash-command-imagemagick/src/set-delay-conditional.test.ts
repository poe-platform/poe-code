import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI GIFs, retained byte-for-byte.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  for (const inputs of [["/first.gif", "/second.gif"], ["/pair.gif"]]) {
    it.each([
      { args: [...inputs, "-set", "delay", "20>"], delays: [160, 200] },
      { args: [...inputs, "-set", "delay", "20<"], delays: [0, 360] },
      { args: [...inputs, "-set", "delay", "20x20>"], delays: [800, 1000] },
      { args: [...inputs, "-set", "delay", "20x20<"], delays: [1000, 1800] },
      { args: [...inputs, "-set", "delay", "7x20>"], delays: [350, 350] },
      { args: [...inputs, "-set", "delay", "7x20<"], delays: [800, 1800] },
      { args: [...inputs, "-set", "delay", "17"], delays: [170, 170] },
      { args: [...inputs, "-set", "delay", "17x20"], delays: [850, 850] },
      { args: [...inputs, "-set", "delay", "16<"], delays: [160, 360] },
      { args: [...inputs, "-set", "delay", "20>", ...inputs], delays: [160, 200, 160, 360] },
      { args: ["/pair.gif[1,0]", "-set", "delay", "20>"], delays: [200, 160], reverse: true },
      { args: [...inputs, "-set", "delay", "36>"], delays: [160, 360] },
      { args: [...inputs, "-set", "delay", "%[fx:20]>"], delays: [160, 200] },
    ])(`sets conditional GIF delays per loaded frame (${mode}, ${inputs.join(" ")}): $args`, async ({ args, delays, reverse }) => {
      const files = new Map<string, Uint8Array>([["/first.gif", first], ["/second.gif", second]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      expect(runConvertCliSync(["/first.gif", "/second.gif", "/pair.gif"], files).exitCode).toBe(0);
      await fs.writeFile("/pair.gif", files.get("/pair.gif")!);
      const sentinel = new TextEncoder().encode("KEEP");
      files.set("/out.gif", sentinel);
      await fs.writeFile("/out.gif", sentinel);
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
      for (const [page, input] of delays.map((_, index) => (reverse ? [second, first] : [first, second])[index % 2]!).entries()) {
        const original = decodeImage(input, { coalesce: false });
        const frame = decodeImage(output, { page, coalesce: false });
        expect(frame).toMatchObject({
          width: original.width, height: original.height, disposal: original.disposal,
          properties: original.properties, data: original.data,
        });
      }
    });
  }
}
