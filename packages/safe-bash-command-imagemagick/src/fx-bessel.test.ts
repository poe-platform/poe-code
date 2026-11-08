import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native: magick 'xc:#20408070' 'xc:#90a0b0c0' +append -strip PNG32:-
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVQI12NUcGgoKEgwCAAAC5ICopdym6wAAAAASUVORK5CYII=", "base64");

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  it.each([
    ["j0(0)/2", [128, 128]],
    ["j1(1)", [112, 112]],
    ["j0(u)", [254, 235]],
    ["j1(u)", [16, 69]],
    ["j1(0)", [0, 0]],
    ["(j0(-5)+1)/2", [105, 105]],
    ["(j1(-5)+1)/2", [169, 169]],
    ["(j0(15.99)+1)/2", [105, 105]],
    ["(j1(15.99)+1)/2", [139, 139]],
    ["(j0(16)+1)/2", [105, 105]],
    ["(j1(16)+1)/2", [139, 139]],
    ["(j0(100)+1)/2", [130, 130]],
    ["(j1(100)+1)/2", [118, 118]],
    ["(j0(1000000)+1)/2", [128, 128]],
    ["(j1(1000000)+1)/2", [127, 127]],
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

it.each(["j0()", "j0(1,2)", "j1()", "j1(1,2)"])("rejects invalid arity: %s", expression => {
  const original = new Uint8Array([1, 2, 3]);
  const files = new Map([["input.png", input], ["out.png", original]]);
  const result = runConvertCliSync(["input.png", "-fx", expression, "out.png"], files);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("expects 1 arguments");
  expect(files.get("out.png")).toEqual(original);
});
