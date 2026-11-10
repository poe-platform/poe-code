import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "magick", "montage"] as const) {
  for (const geometry of ["1x1+0+0", "+0+0"]) {
    it.each([
      { options: [], background: "blue", color: "#ff000080", hex: "80007fff" },
      { options: ["-compose", "Over"], background: "blue", color: "#ff000080", hex: "80007fff" },
      { options: ["-compose", "Copy"], background: "blue", color: "#ff000080", hex: "ff0000ff" },
      { options: ["-compose", "Copy"], background: "none", color: "#ff000080", hex: "ff000080" },
      { options: ["-compose", "Multiply"], background: "blue", color: "red", hex: "000000ff" },
      { options: ["-compose", "mUlTiPlY"], background: "blue", color: "red", hex: "000000ff" },
      { options: ["-compose", "Copy", "+compose"], background: "blue", color: "#ff000080", hex: "80007fff" },
    ])(`${mode} composes ${geometry} tiles: $options over $background`, async ({ options, background, color, hex }) => {
      const fs = new MemoryFileSystem();
      const files = new Map<string, Uint8Array>();
      // File inputs exercise the PNG shortcut when geometry only sets offsets.
      const tile = encodeImage({ width: 1, height: 1, channels: 4, depth: "uchar", space: "srgb", format: "png", density: 72, hasAlpha: true,
        data: Uint8Array.of(255, 0, 0, color === "red" ? 255 : 128) }, { format: "png" }).data;
      files.set("tile.png", tile);
      await fs.writeFile("/tile.png", tile);
      const args = ["-geometry", geometry, "-tile", "x1", "-background", background, ...options,
        geometry === "+0+0" ? "tile.png" : `xc:${color}`, "png:-"];
      let output: Uint8Array;
      if (mode === "magick" || mode === "montage") {
        const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
        const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
          fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(chunk) { stdout.push(chunk); } },
          stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
        expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
        output = Buffer.concat(stdout);
      } else {
        const result = mode === "sync" ? runMontageCliSync(args, files)
          : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        output = result.stdoutBytes!;
      }
      expect(Buffer.from(decodeImage(output).data).toString("hex")).toBe(hex);
    });
  }

  it.each([
    { options: ["-compose"], error: "missing argument for -compose" },
    { options: ["-compose", "banana"], error: "unrecognized compose operator 'banana'" },
  ])(`${mode} rejects invalid composition without overwriting output: $options`, async ({ options, error }) => {
    const keep = Uint8Array.of(1, 2, 3);
    const files = new Map([["out.png", keep]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/out.png", keep);
    const args = ["xc:red", "out.png", ...options];
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      let stderr = "";
      const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
        fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() { throw new Error("Unexpected output"); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } } });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 1, stderr: `montage: ${error}\n` });
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: `montage: ${error}\n` });
    }
    expect(files.get("out.png")).toEqual(keep);
    expect(await fs.readFile("/out.png")).toEqual(keep);
  });
}

for (const mode of ["sync", "buffered", "retained"] as const)
it(`${mode} clips Copy to each tile, preserving neighboring tiles and padding`, async () => {
  const args = ["-geometry", "1x1+1+0", "-tile", "x1", "-background", "none", "-compose", "Copy", "xc:red", "xc:lime", "png:-"];
  const files = new Map<string, Uint8Array>();
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: new MemoryFileSystem(), cwd: "/" });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const image = decodeImage(result.stdoutBytes!);
  expect([image.width, image.height]).toEqual([6, 1]);
  expect([...image.data]).toEqual([0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0]);
});
