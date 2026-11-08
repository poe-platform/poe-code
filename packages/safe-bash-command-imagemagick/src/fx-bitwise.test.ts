import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["(1<<2)/8", 128],
    ["(4>>1)/4", 128],
    ["(5&3)/4", 64],
    ["(1|2)/4", 191],
    ["(5.9&3.9)/8", 128],
    ["(1.9<<1.9)/16", 128],
    ["(0.5|0)/2", 128],
    ["(-3)|0", 0],
    ["(1<<32)/8589934592", 128],
    ["((4294967296|1)&1)/2", 128],
    ["((2^63)>>63)/2", 128],
    ["((2^63)<<1)", 0],
    ["(1|2&4)/2", 128],
    ["(1<<1+1)/8", 128],
    ["4&2==2", 0],
    ["1|2&&0", 0],
    ["0.5||0", 255],
    ["0.5&&1", 255],
  ] as const)(`${mode}: matches native FX bitwise operations for %s`, async (expression, red) => {
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
