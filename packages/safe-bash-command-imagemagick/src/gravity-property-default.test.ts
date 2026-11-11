import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "retained", "sync"] as const) {
  it.each([
    ["-set", "gravity", "Static"],
    ["-gravity", "SouthEast", "-set", "option:gravity", "Static"],
    ["-gravity", "SouthEast", "-set", "option:gravity", "none"],
    [],
  ].map(setting => ({ setting })))(`${mode}: defaults to upper-left placement for $setting`, async ({ setting }) => {
    const args = ["xc:red", "xc:blue", "+append", "-background", "black", ...setting,
      "-extent", "4x2", "-depth", "8", "rgb:/out"];
    const files = new Map<string, Uint8Array>();
    const filesystem = new MemoryFileSystem();
    let exitCode: number, stderr = "";
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      ({ exitCode } = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }));
    } else {
      const result = mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      ({ exitCode, stderr } = result);
    }
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe("ff00000000ff000000000000000000000000000000000000");
  });
}
