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
    { args: [...inputs, "-set", "delay", "bad", "-format", "%T|", "info:"], stdout: "0|0|" },
    { args: [...inputs, "-set", "delay", "bad", "/out.gif"], delays: [0, 0] },
    { args: ["-delay", "bad", ...inputs, "/out.gif"], error: true },
    { args: [...inputs, "-set", "delay", "16", "-format", "%T|", "info:"], stdout: "16|16|" },
    { args: [...inputs, "-set", "delay", "16", "/out.gif"], delays: [160, 160] },
    { args: [...inputs, "-format", "%T|", "info:"], stdout: "16|36|" },
  ])(`${mode} handles delay properties independently of options: $args`, async ({ args, stdout, delays, error }) => {
    const sentinel = new TextEncoder().encode("KEEP");
    const files = new Map<string, Uint8Array>([[inputs[0]!, first], [inputs[1]!, second], ["/out.gif", sentinel]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    let commandStdout = "", commandStderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { commandStdout += new TextDecoder().decode(chunk); } },
      stderr: { write: async chunk => { commandStderr += new TextDecoder().decode(chunk); } },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: error ? 1 : 0 });
    expect("stdout" in result ? result.stdout : commandStdout).toBe(stdout ?? "");
    expect("stderr" in result ? result.stderr : commandStderr).toBe(error ? "magick: invalid argument for option '-delay' 'bad'\n" : "");
    const output = mode === "map" || mode === "sync" ? files.get("/out.gif")! : await fs.readFile("/out.gif");
    if (!delays) {
      expect(output).toEqual(sentinel);
      return;
    }
    expect(decodeImage(output, { animated: true }).delay).toEqual(delays);
    for (const [page, input] of [first, second].entries()) {
      const original = decodeImage(input, { coalesce: false });
      expect(decodeImage(output, { page, coalesce: false })).toMatchObject({
        width: original.width, height: original.height, disposal: original.disposal,
        properties: original.properties, data: original.data,
      });
    }
  });
}
