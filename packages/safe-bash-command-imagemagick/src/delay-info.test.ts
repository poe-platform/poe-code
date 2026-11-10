import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick GIFs: red at 16cs, blue at 36cs.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");
const inputs = ["/first.gif", "/second.gif"];

for (const mode of ["map", "sync", "filesystem", "command"] as const) {
  it.each([
    { args: ["-delay", "12x24", ...inputs], stdout: "12|12|", delays: [500, 500] },
    { args: [...inputs, "-set", "delay", "12x24"], stdout: "12|12|", delays: [500, 500] },
    { args: ["-delay", "1x1000", ...inputs], stdout: "1|1|", delays: [0, 0] },
    { args: [...inputs, "-set", "delay", "1x1000"], stdout: "1|1|", delays: [0, 0] },
    { args: ["-delay", "1x1000000", ...inputs], stdout: "1|1|", delays: [0, 0] },
    { args: [...inputs, "-set", "delay", "1x1000000"], stdout: "1|1|", delays: [0, 0] },
    { args: ["-delay", "16x100", ...inputs], stdout: "16|16|", delays: [160, 160] },
    { args: inputs, stdout: "16|36|", delays: [160, 360] },
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "%T"], stdout: "12|12|", delays: [500, 500] },
    { args: ["-delay", "1x1000", ...inputs, "-set", "delay", "%T"], stdout: "1|1|", delays: [0, 0] },
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "6"], stdout: "6|6|", delays: [250, 250] },
    { args: ["-delay", "12x24", ...inputs, "-set", "delay", "6x100"], stdout: "6|6|", delays: [60, 60] },
    { args: ["-delay", "20>", ...inputs], stdout: "16|20|", delays: [160, 200] },
    { args: ["-delay", "20<", ...inputs], stdout: "20|36|", delays: [200, 360] },
    { args: ["-delay", "12x24", inputs[0]!, "-delay", "1x1000", inputs[1]!, "-reverse"], stdout: "1|12|", delays: [0, 500] },
  ])(`${mode} reports original delay ticks and preserves GIF timing: $args`, async ({ args, stdout, delays }) => {
    const files = new Map<string, Uint8Array>([[inputs[0]!, first], [inputs[1]!, second], ["/out.gif", new TextEncoder().encode("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const argv = [...args, "-write", "/out.gif", "-format", "%T|", "info:"];
    let commandStdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { commandStdout += new TextDecoder().decode(chunk); } }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect("stdout" in result ? result.stdout : commandStdout).toBe(stdout);
    const output = mode === "map" || mode === "sync" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    expect(decodeImage(output, { animated: true }).delay).toEqual(delays);
    const frames = args.includes("-reverse") ? [second, first] : [first, second];
    for (const [page, input] of frames.entries()) {
      const original = decodeImage(input, { coalesce: false });
      expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
        width: original.width, height: original.height, disposal: original.disposal,
        properties: original.properties, data: original.data,
      });
    }
  });
}

for (const mode of ["sync", "filesystem"] as const) {
  it(`${mode} updates reported ticks when duplicate layers combine delays`, async () => {
    const args = ["-size", "1x1", "-delay", "10", "xc:red", "xc:red", "-layers", "RemoveDups", "-format", "%T|", "info:"];
    const result = mode === "sync" ? runConvertCliSync(args, new Map())
      : await runConvertCli(args, { filesystem: new MemoryFileSystem(), cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stdout: "20|" });
  });
}

it("retains original ticks when frame records exceed the retained stack cache", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/first.gif", first);
  await fs.writeFile("/second.gif", second);
  const pairs = Array.from({ length: 20 }, () => ["-delay", "12x24", inputs[0]!, "-delay", "1x1000000", inputs[1]!]).flat();
  const result = await runConvertCli([...pairs, "-reverse", "-format", "%T|", "info:"], { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stdout: "1|12|".repeat(20) });
});
