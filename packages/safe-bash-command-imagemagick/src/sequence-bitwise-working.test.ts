import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI, RGB8 input, raw big-endian RGB output.
for (const mode of ["map", "sync", "retained", "command"] as const)
for (const width of [2, 1026])
it.each([
  { operation: "Xor", depth: 8, edit: true, expected: "1c103c381809" },
  { operation: "And", depth: 16, edit: true, expected: "00081000040c4208660c8200" },
  { operation: "Or", depth: 16, edit: true, expected: "1bba1fd63fde7a5a7e7e8ab2" },
  { operation: "Xor", depth: 16, edit: true, expected: "1bb20fd63bd23852187208b2" },
  { operation: "Max", depth: 16, edit: true, expected: "11b81bc225cc6208761c8a30" },
  { operation: "Xor", depth: 16, edit: false, expected: "000000000000000000000000" },
])(`${mode}: $operation preserves working samples (depth=$depth, edit=$edit, width=${width})`, async ({ operation, depth, edit, expected }) => {
  const pixels = [10, 20, 30, 90, 110, 130];
  const input = new Uint8Array([...new TextEncoder().encode(`P6\n${width} 1\n255\n`), ...Array.from({ length: width * 3 }, (_, index) => pixels[index % pixels.length]!)]);
  const files = new Map([["/in.ppm", input]]), fs = createMemoryFileSystem();
  await fs.writeFile("/in.ppm", input);
  const args = ["/in.ppm", "(", "+clone", ...(edit ? ["-evaluate", "Add", "3%"] : []), ")", "-evaluate-sequence", operation, "-depth", String(depth), "-endian", "MSB", "rgb:/out.rgb"];
  const result = mode === "command" ? await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write() {} },
  }) : mode === "sync" ? runConvertCliSync(args, files)
    : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0 });
  const output = mode === "map" || mode === "sync" ? files.get("/out.rgb")! : await fs.readFile("/out.rgb");
  expect(Buffer.from(output).toString("hex")).toBe(expected.repeat(width / 2));
});
