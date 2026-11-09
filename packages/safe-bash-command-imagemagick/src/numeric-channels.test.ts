import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const pixels = [11, 22, 33, 88, 55, 66, 77, 99];
const input = encodeImage({ width: 2, height: 1, data: Uint8Array.from(pixels),
  format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;

for (const mode of ["buffered", "retained", "sync", "command"] as const)
it.each([
  ["0", [0]], ["1", [1]], ["2", [2]], ["3", []], ["4", [3]],
  ["0,2", [0, 2]], ["0,4", [0, 3]], ["0,1,2,4", [0, 1, 2, 3]],
  ["R", [0]], ["G", [1]], ["Blue", [2]], ["Alpha", [3]],
] as const)(`${mode}: selects channel IDs with %s`, async (channels, selected) => {
  const files = new Map([["input.png", input]]), filesystem = new MemoryFileSystem();
  await filesystem.writeFile("/input.png", input);
  const args = ["input.png", "-channel", channels, "-function", "Polynomial", "0.8", "+channel", "out.png"];
  const argumentValues = createCommandArguments(args);
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
    signal: new AbortController().signal, registerCleanup() {},
  }) : mode === "sync" ? runConvertCliSync(args, files)
    : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
  expect(result.exitCode).toBe(0);
  const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
  expect([...decodeImage(output).data]).toEqual(pixels.map((value, index) => selected.some(channel => channel === index % 4) ? 204 : value));
});
