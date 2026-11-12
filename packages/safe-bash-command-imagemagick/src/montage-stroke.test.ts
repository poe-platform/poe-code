import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "magick", "montage"] as const) {
  const render = async (options: string[]) => {
    const args = ["-size", "3x3", "-pointsize", "8", "-fill", "white", ...options,
      "-label", "I", "xc:black", "xc:blue", "-tile", "2x1", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const fs = new MemoryFileSystem();
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { stdout.push(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      return decodeImage(Buffer.concat(stdout));
    }
    const files = new Map<string, Uint8Array>();
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    return decodeImage(result.stdoutBytes!);
  };

  it(`paints lime label outlines independently of white fill via ${mode}`, async () => {
    const plain = await render([]);
    const stroked = await render(["-stroke", "lime"]);
    expect([stroked.width, stroked.height]).toEqual([plain.width, plain.height]);
    expect(stroked.data.slice(0, 3 * 6 * 4)).toEqual(plain.data.slice(0, 3 * 6 * 4));
    for (const left of [0, 3]) {
      let lime = 0, blended = 0;
      for (let y = 3; y < stroked.height; y++) for (let x = left; x < left + 3; x++) {
        const offset = (y * stroked.width + x) * 4;
        const [r, g, b] = stroked.data.slice(offset, offset + 3);
        if (r === 0 && g === 255 && b === 0) lime++;
        if (r! > 0 && r! < 255 && g === 255 && b === r) blended++;
      }
      expect(lime).toBeGreaterThan(0);
      expect(blended).toBeGreaterThan(0);
    }
  });

  it(`outlines titles and supports transparent label fill via ${mode}`, async () => {
    const titled = await render(["-title", "I", "-stroke", "lime"]);
    expect(titled.data.slice(0, 16 * titled.width * 4).some((value, index, data) =>
      index % 4 === 0 && value < 255 && data[index + 1] === 255 && data[index + 2] === value)).toBe(true);
    const outline = await render(["-fill", "none", "-stroke", "lime"]);
    expect(outline.data.some((value, index, data) =>
      index % 4 === 0 && value === 0 && data[index + 1] === 255 && data[index + 2] === 0)).toBe(true);
    const translucent = await render(["-stroke", "rgba(0,255,0,0.5)"]);
    const label = translucent.data.slice(3 * translucent.width * 4);
    expect(label.some((value, index) => index % 4 === 0 && value >= 127 && value < 255)).toBe(true);
    expect(label.every((value, index) => index % 4 !== 0 || value >= 127)).toBe(true);
  });

  it(`clears label strokes with none and +stroke via ${mode}`, async () => {
    const plain = await render([]);
    for (const options of [["-stroke", "none"], ["-stroke", "lime", "-stroke", "none"], ["-stroke", "lime", "+stroke"]]) {
      expect((await render(options)).data).toEqual(plain.data);
    }
  });
}

it("rejects a missing stroke color before writing output", async () => {
  const result = await runMontageCli(["-stroke"], new Map());
  expect(result).toMatchObject({ exitCode: 1, stdout: "", stderr: "montage: missing argument for -stroke\n" });
});
