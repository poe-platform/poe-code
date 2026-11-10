import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

// Complete P6 headers and samples from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  it.each([
    { geometry: "+0+0", input: ["-size", "1x1", "-depth", "16", "rgb:one"], header: "P6\n1 1\n65535\n", samples: "34127856bc9a" },
    { geometry: "1x1+0+0", input: ["-size", "1x1", "-depth", "16", "rgb:one"], header: "P6\n1 1\n65535\n", samples: "34127856bc9a" },
    { geometry: "+0+0", input: ["-depth", "16", "tile.ppm"], header: "P6\n2 2\n65535\n", samples: "101020203030404050506060707080809090a0a0b0b0c0c0" },
    { geometry: "+0+0", input: ["-size", "2x2", "-depth", "8", "rgb:colors"], header: "P6\n2 2\n255\n", samples: "102030405060708090a0b0c0" },
  ])(`${mode}: preserves montage RGB samples with $geometry: $input`, async ({ geometry, input, header, samples }) => {
    const colors = Buffer.from("102030405060708090a0b0c0", "hex");
    const files = new Map<string, Uint8Array>([
      ["one", Buffer.from("123456789abc", "hex")],
      ["colors", colors],
      ["tile.ppm", Buffer.concat([Buffer.from("P6\n2 2\n255\n"), colors])],
    ]);
    const args = ["-geometry", geometry, "-tile", "x1", ...input, "ppm:-"];
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(`/${path}`, bytes);
    let output: Uint8Array;
    if (mode === "magick" || mode === "montage") {
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const stderr: unknown[] = [];
      const context: CommandContext = {
        command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk); } },
        stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
      };
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      expect((await command.execute(context)).exitCode).toBe(0);
      expect(stderr).toEqual([]);
      output = Buffer.concat(chunks);
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      output = result.stdoutBytes!;
    }
    expect(Buffer.from(output)).toEqual(Buffer.concat([Buffer.from(header), Buffer.from(samples, "hex")]));
  });
}

it("preserves raw RGB samples without montage", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/one", Buffer.from("123456789abc", "hex"));
  const argumentValues = createCommandArguments(["-size", "1x1", "-depth", "16", "rgb:one", "ppm:sheet.ppm"]);
  const stderr: Uint8Array[] = [];
  const result = await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write() {} }, stderr: { async write(bytes) { stderr.push(bytes); } }
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toEqual([]);
  expect(Buffer.from(await fs.readFile("/sheet.ppm"))).toEqual(Buffer.concat([
    Buffer.from("P6\n1 1\n65535\n"), Buffer.from("34127856bc9a", "hex")
  ]));
});
