import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["squish(u)", [135, 163]],
    ["squish(0)", [128, 128]],
    ["squish(1)", [186, 186]],
    ["squish(-1)", [69, 69]],
    ["squish(-1000)", [0, 0]],
    ["squish(1000)", [255, 255]],
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
    expect(Array.from(decodeImage(output).data)).toEqual([red[0], 64, 128, 112, red[1], 160, 176, 192]);
  });
}
