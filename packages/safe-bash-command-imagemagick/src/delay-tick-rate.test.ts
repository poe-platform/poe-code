import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick inputs: red at 16cs, blue at 36cs.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");
const inputs = ["/first.gif", "/second.gif"];

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  it.each([
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "6"], delays: [250, 250] },
    { args: ["-delay", "12x24", ...Array.from({ length: 17 }, () => inputs).flat(), "-set", "delay", "6"], delays: Array(34).fill(250) },
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "6x100"], delays: [60, 60] },
    { args: [...inputs, "-set", "delay", "6"], delays: [60, 60] },
    { args: ["-delay", "1x1000", ...inputs, "-set", "delay", "100"], delays: [100, 100] },
    { args: [...inputs, "-set", "delay", "12x24", "-set", "delay", "6"], delays: [250, 250] },
    { args: ["-delay", "12x24", inputs[0]!, "-delay", "1x1000", inputs[1]!, "-set", "delay", "100"], delays: [4160, 100] },
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "6x100", "-set", "delay", "10"], delays: [100, 100] },
    { args: ["-delay", "12x24", inputs[0]!, "-set", "delay", "6x100", inputs[1]!], delays: [60, 500] },
  ])(`${mode} retains each frame's tick rate: $args`, async ({ args, delays }) => {
    const files = new Map<string, Uint8Array>([[inputs[0]!, first], [inputs[1]!, second], ["/out.gif", new TextEncoder().encode("KEEP")]]);
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
    for (const [page] of delays.entries()) {
      const input = page % 2 === 0 ? first : second;
      const original = decodeImage(input, { coalesce: false });
      expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
        width: original.width, height: original.height, disposal: original.disposal,
        properties: original.properties, data: original.data,
      });
    }
  });
}
