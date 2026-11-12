import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const source of ["generated", "files"] as const)
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const)
it.each([
  { options: ["-monitor"], monitored: true },
  { options: ["-monitor", "+monitor"], monitored: false },
  { options: ["+monitor", "-monitor"], monitored: true },
  { options: ["+monitor"], monitored: false },
  { options: [], monitored: false },
  { options: ["-monitor", "-quiet", "-regard-warnings"], monitored: true },
])(`keeps montage progress on stderr via ${mode}, ${source}: $options`, async ({ options, monitored }) => {
  const paths = source === "files" ? ["/red.ppm", "/blue.ppm"] : ["xc:red", "xc:blue"];
  const files = new Map<string, Uint8Array>([
    ["/red.ppm", new TextEncoder().encode("P3\n1 1\n255\n255 0 0\n")],
    ["/blue.ppm", new TextEncoder().encode("P3\n1 1\n255\n0 0 255\n")]
  ]);
  const args = [...options, ...paths, "-tile", "2x1", "-geometry", "+0+0", "-format", "%w,%h:%[fx:1/3]\\n", "info:"];
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile(path, bytes);
  const expected = { exitCode: 0, stdout: "2,1:0.333333\n", stderr: monitored
    ? "mogrify image[red]: 0 of 2, 00% complete\rmogrify image[blue]: 1 of 2, 100% complete\r\n"
      + "tile image[red]: 0 of 2, 00% complete\rtile image[blue]: 1 of 2, 100% complete\r\n"
    : "" };
  if (source === "files") expected.stderr = expected.stderr.replaceAll("[red]", "[/red.ppm]").replaceAll("[blue]", "[/blue.ppm]");
  if (mode === "magick" || mode === "montage") {
    const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await command.execute({
      command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout.push(chunk); } },
      stderr: { async write(chunk) { stderr.push(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }).toEqual(expected);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject(expected);
  }
});
