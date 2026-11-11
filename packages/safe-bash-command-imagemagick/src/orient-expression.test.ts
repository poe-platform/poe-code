import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runConvertCliSync, runIdentifyCli } from "./index.js";

const data16 = Uint16Array.from({ length: 24 }, (_, index) => 1234 + index * 2571);
const inputs = [1, 6].map(orientation => encodeImage({ width: 3, height: 2,
  data: Uint8Array.from(data16, value => Math.round(value / 257)), data16,
  format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72,
  hasAlpha: true, orientation }, { format: "png" }).data);

for (const mode of ["buffered", "sync", "retained", "command"]) {
  it.each([
    { options: ["-set", "option:direction", "RightTop", "-set", "option:orient", "%[option:direction]"], orientation: 6 },
    { options: ["-set", "option:direction", "RightTop", "-orient", "%[direction]"], orientation: 6 },
    { options: ["-set", "option:direction", "RightTop", "-orient", "%[option:direction]"], orientation: 6 },
    { options: ["-orient", "%[orientation]"], orientation: 6 },
    { options: ["-set", "direction", "TopLeft", "-orient", "%[direction]"], orientation: 1 },
    { options: ["-set", "option:direction", "bogus", "-orient", "%[direction]"], orientation: undefined }
  ])(`expands orientation without changing pixels or invalid destinations (${mode}): $options`, async ({ options, orientation }) => {
    const input = inputs[options[0] === "-orient" ? 1 : 0]!;
    const sentinel = Uint8Array.of(1, 2, 3);
    const files = new Map([["/input.png", input], ["/output.png", sentinel]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/input.png", ...options, "PNG64:/output.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    const output = mode === "buffered" || mode === "sync" ? files.get("/output.png")! : await fs.readFile("/output.png");
    expect(result.exitCode).toBe(orientation === undefined ? 1 : 0);
    if (orientation === undefined) {
      expect(output).toEqual(sentinel);
      return;
    }
    expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, orientation, data16 });
    expect(await runIdentifyCli(["-format", "%[orientation]", "/output.png"], new Map([["/output.png", output]])))
      .toEqual({ exitCode: 0, stdout: orientation === 6 ? "RightTop" : "TopLeft", stderr: "" });
  });

  it(`uses the first image and retains the expanded setting for later inputs (${mode})`, async () => {
    const files = new Map([["/left.png", inputs[0]!], ["/right.png", inputs[1]!]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/right.png", "/left.png", "-orient", "%[orientation]", "/left.png", "PNG64:/out-%d.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} }
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    for (let index = 0; index < 3; index++) {
      const path = `/out-${index}.png`;
      const output = mode === "buffered" || mode === "sync" ? files.get(path)! : await fs.readFile(path);
      expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, orientation: 6, data16 });
    }
  });
}

it.each([
  [0, ["-set", "option:direction", "RightTop", "-orient", "%[direction]"]],
  [1, ["-orient", "%[orientation]"]]
] as const)("matches native orientation expansion for input %s", async (index, options) => {
  const input = inputs[index]!;
  const native = spawnSync("magick", ["-", ...options, "PNG64:-"], { input });
  expect(native.status, native.stderr.toString()).toBe(0);
  const files = new Map([["/input.png", input]]);
  expect(await runConvertCli(["/input.png", ...options, "PNG64:/output.png"], files)).toMatchObject({ exitCode: 0 });
  const output = files.get("/output.png")!;
  expect(decodeImage(output)).toMatchObject({ width: 3, height: 2, orientation: 6, data16: decodeImage(native.stdout).data16 });
  const tag = spawnSync("magick", ["identify", "-format", "%[orientation]", "-"], { input: output, encoding: "utf8" });
  expect(tag.status, tag.stderr).toBe(0);
  expect(tag.stdout).toBe("RightTop");
});
