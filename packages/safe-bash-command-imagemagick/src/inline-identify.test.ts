import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { name: "current format and image order", args: ["-size", "2x1", "xc:red", "-size", "3x1", "xc:blue", "-format", "%p:%w;", "-identify", "-format", "END", "info:"], stdout: "0:2;1:3;ENDEND" },
    { name: "repeated reports around an image edit", args: ["xc:red", "xc:blue", "-format", "%p:%[pixel:p{0,0}];", "-identify", "-negate", "-identify", "-depth", "8", "rgb:end.raw"], stdout: "0:srgb(255,0,0);1:srgb(0,0,255);0:srgb(0,255,255);1:srgb(255,255,0);", pixels: [0, 255, 255, 255, 255, 0] },
    { name: "current list inside parentheses", args: ["xc:red", "-format", "%p:%w;", "(", "-size", "3x1", "xc:blue", "-identify", ")", "-identify", "null:"], stdout: "0:3;0:1;1:3;" },
    { name: "input names in a custom format", args: ["xc:red", "xc:blue", "-format", "%i:%p;", "-identify", "null:"], stdout: "red:0;blue:1;" },
    { name: "an explicitly empty format", args: ["xc:red", "-format", "", "-identify", "-format", "END", "info:"], stdout: "END" },
    { name: "default identification lines", args: ["xc:red", "xc:blue", "-identify", "-depth", "8", "rgb:end.raw"], pixels: [255, 0, 0, 0, 0, 255] }
  ])(`${mode} inline -identify preserves $name`, async ({ args, stdout: expected, pixels }) => {
    const files = new Map<string, Uint8Array>();
    const fs = new MemoryFileSystem();
    const retained = mode === "retained" || mode === "command";
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      result = { ...status, stdout, stderr };
    } else result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    if (expected !== undefined) expect(result.stdout).toBe(expected);
    else {
      const lines = result.stdout.trimEnd().split("\n");
      expect(lines).toHaveLength(2);
      for (const [index, color] of ["red", "blue"].entries()) {
        expect(lines[index]).toContain(`${color} XC 1x1 1x1+0+0 16-bit sRGB`);
      }
    }
    if (pixels) expect(retained ? await fs.readFile("/end.raw") : files.get("end.raw")).toEqual(new Uint8Array(pixels));
    expect(retained ? (await fs.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(pixels ? ["end.raw"] : []);
  });
}
