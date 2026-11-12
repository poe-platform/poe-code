import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const route of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { options: ["-bordercolor", "NoSuchColor"], exitCode: 0, warning: true },
    { options: ["-regard-warnings", "-bordercolor", "NoSuchColor"], exitCode: 1, warning: true },
    { options: ["+regard-warnings", "-bordercolor", "NoSuchColor"], exitCode: 0, warning: true },
    { options: ["-regard-warnings"], exitCode: 0, warning: false },
    { options: [], exitCode: 0, warning: false },
    { options: ["-regard-warnings", "+regard-warnings", "-bordercolor", "NoSuchColor"], exitCode: 1, warning: true },
    { options: ["-bordercolor", "NoSuchColor", "-regard-warnings"], exitCode: 1, warning: true },
  ])(`${route} preserves formatted montage output for $options`, async ({ options, exitCode, warning }) => {
    const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", ...options, "-format", "%w", "info:"];
    const filesystem = new MemoryFileSystem();
    let result;
    if (route === "magick" || route === "montage") {
      const command = route === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(route === "magick" ? ["montage", ...args] : args);
      let stdout = "", stderr = "";
      const status = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs: filesystem,
        cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      });
      result = { ...status, stdout, stderr };
    } else {
      const files = new Map<string, Uint8Array>();
      result = route === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, route === "buffered" ? files : { filesystem, cwd: "/" });
    }
    expect(result).toEqual({ exitCode, stdout: "2", stderr: warning ? "montage: unrecognized color `NoSuchColor'\n" : "" });
  });

  for (const output of ["ppm:-", "sheet.ppm", "info:width.txt"]) {
    it(`${route} publishes ${output} before reporting a warning failure`, async () => {
      const args = ["xc:red", "xc:blue", "-tile", "2x1", "-geometry", "+0+0",
        "-regard-warnings", "-bordercolor", "NoSuchColor", "-format", "%w", output];
      const filesystem = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      let result;
      if (route === "magick" || route === "montage") {
        const command = route === "magick" ? createMagickCommand() : createMontageCommand();
        const argumentValues = createCommandArguments(route === "magick" ? ["montage", ...args] : args);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const status = await command.execute({
          command: command.name, args: argumentValues.args, argumentValues, fs: filesystem,
          cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout.push(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        });
        result = { ...status, stderr, stdoutBytes: Buffer.concat(stdout) };
      } else {
        result = route === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, route === "buffered" ? files : { filesystem, cwd: "/" });
      }
      expect(result).toMatchObject({ exitCode: 1, stderr: "montage: unrecognized color `NoSuchColor'\n" });
      const path = output === "sheet.ppm" ? "sheet.ppm" : "width.txt";
      const bytes = output === "ppm:-" ? result.stdoutBytes!
        : route === "sync" || route === "buffered" ? files.get(path)! : await filesystem.readFile(`/${path}`);
      if (output === "info:width.txt") expect(new TextDecoder().decode(bytes)).toBe("2");
      else {
        const image = decodeImage(bytes);
        expect([image.width, image.height]).toEqual([2, 1]);
        expect(image.data).toEqual(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]));
      }
    });
  }
}
