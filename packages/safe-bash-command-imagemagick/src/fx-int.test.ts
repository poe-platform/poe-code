import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["(int(-1.25)+2)/2", 0],
    ["(int(-1.75)+2)/2", 0],
    ["(trunc(-1.25)+2)/2", 128],
    ["(trunc(-1.75)+2)/2", 128],
    ["(int(-1)+2)/2", 128],
    ["int(1.75)/2", 128],
    ["(floor(-1.25)+2)/2", 0],
    ["(ceil(-1.25)+2)/2", 128],
    ["(round(-1.25)+2)/2", 128],
  ] as const)(`${mode}: matches native FX integer rounding for %s`, async (expression, red) => {
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-channel", "R", "-fx", expression, "/out.png"];
    const argumentValues = createCommandArguments(args);
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
      signal: new AbortController().signal, registerCleanup() {},
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
    expect(Array.from(decodeImage(output).data)).toEqual([red, 64, 128, 112, red, 160, 176, 192]);
  });
}
