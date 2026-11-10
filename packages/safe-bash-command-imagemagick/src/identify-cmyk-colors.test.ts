import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync", "retained"] as const) {
  it.each([
    { input: "ink.pam", operations: ["-format", "%k %w"], output: "info:out", expected: "3 4" },
    { input: "ink.pam", operations: ["-format", "%k"], output: "info:out", expected: "3" },
    { input: "ink.pam", operations: ["-format", "%[colors]"], output: "info:out", expected: "3" },
    { input: "ink.pam", operations: ["-colorspace", "sRGB", "-format", "%k %w"], output: "info:out", expected: "1 4" },
    { input: "ink.pam", operations: ["-channel", "K", "-separate"], output: "PNG64:out", expected: "0a0a0a0a0a0affff323232323232ffff0a0a0a0a0a0affffc8c8c8c8c8c8ffff" },
    { input: "in.ppm", operations: ["-format", "%k %w"], output: "info:out", expected: "4 4" }
  ])(`${mode} counts CMYK inks before conversion: $input $operations`, async ({ input, operations, output, expected }) => {
    const colors = [[248, 29, 162], [11, 75, 254], [92, 240, 126], [140, 38, 93]];
    const files = new Map([
      ["ink.pam", Buffer.concat([Buffer.from("P7\nWIDTH 4\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n"), Buffer.from([255, 255, 255, 10, 255, 255, 255, 50, 255, 255, 255, 10, 255, 255, 255, 200])])],
      ["in.ppm", Buffer.concat([Buffer.from("P6\n4 2\n255\n"), Buffer.from([1, 2, 3, 0, 3, 1, 0, 2].flatMap(index => colors[index]!))])],
      ["out", Buffer.from("KEEP")]
    ]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    const args = [input, ...operations, output];
    let result;
    if (mode === "command") {
      let stdout = "", stderr = "";
      const argumentValues = createCommandArguments(args);
      const status = await createMagickCommand().execute({
        command: "magick", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
      });
      result = { ...status, stdout, stderr };
    } else result = mode === "sync" ? runMagickCliSync(args, files)
      : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const bytes = mode === "buffered" || mode === "sync" ? files.get("out")! : await fs.readFile("/out");
    if (output === "info:out") expect(new TextDecoder().decode(bytes)).toBe(expected);
    else {
      const image = decodeImage(bytes);
      expect([image.width, image.height]).toEqual([4, 1]);
      expect(Array.from(image.data16!, value => value.toString(16).padStart(4, "0")).join("")).toBe(expected);
    }
  });
}
