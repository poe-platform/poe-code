import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const ppm = new Uint8Array([...new TextEncoder().encode("P6\n2 1\n255\n"), 10, 20, 30, 90, 110, 130]);
// Native ImageMagick 7.1.2-35 Q16-HDRI; only timing values are normalized.
const red = "xc:red XC 1x1 1x1+0+0 16-bit sRGB";
const file = "in.ppm PPM 2x1 2x1+0+0 8-bit sRGB 17B";

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  it.each([
    { args: ["xc:red", "info:"], summary: red },
    { args: ["in.ppm", "info:"], summary: file },
    { args: ["ppm:in.ppm", "info:"], summary: "ppm:in.ppm PPM 2x1 2x1+0+0 8-bit sRGB 17B" },
    { args: ["in.ppm[1x1+0+0]", "info:"], summary: "in.ppm[1x1+0+0] PPM 1x1 2x1+0+0 8-bit sRGB 17B" },
    { args: ["xc:red", "-scene", "5", "info:"], summary: "xc:red[5] XC 1x1 1x1+0+0 16-bit sRGB" },
    { args: ["xc:red", "-page", "5x4-1+2", "info:"], summary: "xc:red XC 1x1 5x4-1+2 16-bit sRGB" },
    { args: ["xc:red", "-format", "ignored", "+format", "info:-"], summary: red },
    { args: ["gradient:red-blue", "info:"], summary: "gradient:red-blue GRADIENT 1x1 1x1+0+0 16-bit sRGB" },
    { args: ["in.ppm", "-resize", "50%", "info:"], summary: "in.ppm PPM 1x1 1x1+0+0 8-bit sRGB 17B" },
    { args: ["xc:red", "xc:blue", "info:"], summary: "xc:red[0] XC 1x1 1x1+0+0 16-bit sRGB\nxc:blue[1] XC 1x1 1x1+0+0 16-bit sRGB" },
    { args: ["xc:red", "-write", "info:", "null:"], summary: red },
    { args: ["in.ppm", "+write", "info:report.txt", "null:"], summary: file, target: "report.txt" },
    { args: ["xc:red", "info:report.txt"], summary: red, target: "report.txt" },
    { args: ["xc:red", "-format", "%i|%m|%wx%h|%g|%z", "info:"], formatted: "|XC|1x1|1x1+0+0|16" },
    { args: ["in.ppm", "-format", "%i|%m|%wx%h|%g|%z", "info:"], formatted: "|PPM|2x1|2x1+0+0|8" },
    { args: ["xc:red", "-format", "", "info:"], formatted: "" }
  ])(`${mode} info summary: $args`, async ({ args, summary, formatted, target }) => {
    const files = new Map([["in.ppm", ppm]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", ppm);
    const retained = mode === "retained" || mode === "command";
    let result;
    if (mode === "command") {
      const argumentValues = createCommandArguments(args);
      let stdout = "", stderr = "";
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const output = target ? new TextDecoder().decode(retained ? await fs.readFile(`/${target}`) : files.get(target)) : result.stdout;
    if (target) expect(result.stdout).toBe("");
    if (formatted !== undefined) expect(output).toBe(formatted);
    else expect(output.replace(/ \d+\.\d+u \d+:\d+\.\d+\n/g, "\n")).toBe(`${summary}\n`);
  });
}
