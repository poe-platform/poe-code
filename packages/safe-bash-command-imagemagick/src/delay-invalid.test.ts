import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Original GIFs from the malformed-delay reproduction.
const first = Buffer.from("R0lGODlhBAACAPAAAP8AAAAAACH5BAgQAAAAIf4FRmlyc3QALAAAAAAEAAIAAAIDhG8FADs=", "base64");
const second = Buffer.from("R0lGODlhBAACAPAAAAAA/wAAACH5BAwkAAAAIf4GU2Vjb25kACwAAAAABAACAAACA4RvBQA7", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each(["bogus", "20ms", "12xbogus"])(`rejects -delay %s without overwriting a GIF (${mode})`, async value => {
    const keep = new TextEncoder().encode("KEEP");
    const files = new Map<string, Uint8Array>([["first.gif", first], ["second.gif", second], ["out.gif", keep]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = ["-delay", value, "first.gif", "second.gif", "out.gif"];
    let stderr = "";
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {},
      signal: new AbortController().signal, fs: filesystem,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
      registerCleanup() {},
    } as unknown as CommandContext) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-delay'");
    expect(mode === "retained" || mode === "command" ? await filesystem.readFile("/out.gif") : files.get("out.gif")).toEqual(keep);
  });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
  it(`keeps -set delay bogus permissive (${mode})`, async () => {
    const files = new Map<string, Uint8Array>([["first.gif", first], ["second.gif", second]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
    const args = ["first.gif", "second.gif", "-set", "delay", "bogus", "out.gif"];
    const result = mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" ? await filesystem.readFile("/out.gif") : files.get("out.gif")!;
    expect((await sharp(output, { animated: true }).metadata()).delay).toEqual([0, 0]);
  });
}
