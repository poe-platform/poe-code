import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync, runMagickCli } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["2^3^2/512", 32],
    ["(2^3)^2/512", 32],
    ["2^(3^2)/512", 255],
    ["-2^2/8+0.5", 0],
    ["(-2)^2/8+0.5", 255],
    ["2^-2", 64],
    ["2^-2^2", 16],
    ["-2^2^2/32+0.5", 0],
  ])(`${mode}: matches native FX %s and preserves unselected channels`, async (expression, red) => {
    const files = new Map([["input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["input.png", "-channel", "R", "-fx", expression, "out.png"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
      signal: new AbortController().signal, registerCleanup() {},
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual([red, 64, 128, 112, red, 160, 176, 192]);
  });
}

it.each([false, true])("uses native power precedence in FX properties, retained=%s", async (retained) => {
  const filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", input);
  const files = retained ? { filesystem, cwd: "/" } : new Map([["/input.png", input]]);
  const format = "%[fx:2^3^2]|%[fx:2^(3^2)]|%[fx:-2^2]|%[fx:(-2)^2]|%[fx:2^-2^2]";
  for (const identify of [false, true]) {
    const args = identify ? ["identify", "-format", format, "/input.png"] : ["/input.png", "-format", format, "info:"];
    expect(await runMagickCli(args, files)).toEqual({ exitCode: 0, stderr: "", stdout: "64|512|-4|4|0.0625" });
  }
});
