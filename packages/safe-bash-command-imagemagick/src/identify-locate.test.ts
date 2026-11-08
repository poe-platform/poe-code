import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runIdentifyCliSync } from "./index.js";

it.each([false, true])("reports row-major maxima with an independent per-channel limit (16-bit=%s)", async (sixteen) => {
  const width = 7, height = 6;
  const samples = new Uint16Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    samples[i] = x >= 1 && x <= 4 && y >= 2 && y <= 4 ? 65535 : 0;
    samples[i + 1] = sixteen ? (x === 5 ? 32769 : 32768) : samples[i]!;
    samples[i + 2] = sixteen ? (y === 1 ? 12345 : 12344) : samples[i]!;
    samples[i + 3] = !sixteen || x === 6 ? 65535 : 0;
  }
  const bytes = encodeImage({ width, height, data: Uint8Array.from(samples, v => Math.round(v / 257)),
    ...(sixteen ? { data16: samples } : {}), format: "png", space: "srgb", channels: sixteen ? 4 : 3,
    depth: sixteen ? "ushort" : "uchar", density: 72, hasAlpha: sixteen }, { format: "png" }).data;
  const fs = new MemoryFileSystem();
  await fs.writeFile("/shape.png", bytes);
  for (const limit of [undefined, 0, 1, 2]) {
    const args = ["-define", "identify:locate=maximum", ...(limit === undefined ? [] : ["-define", `identify:limit=${limit}`]), "-verbose", "/shape.png"];
    const coordinates = (channel: number) => {
      const maximum = Math.max(...Array.from(samples).filter((_, i) => i % 4 === channel));
      const positions = Array.from({ length: width * height }, (_, i) => i).filter(i => samples[i * 4 + channel] === maximum);
      return positions.slice(0, limit || positions.length).map(i => `${i % width},${Math.floor(i / width)}`).join(" ");
    };
    const expected = "Channel maximum locations:\n" + (sixteen
      ? `  Red: 65535 (1) ${coordinates(0)}\n  Green: 32769 (0.500023) ${coordinates(1)}\n  Blue: 12345 (0.188373) ${coordinates(2)}\n  Alpha: 65535 (1) ${coordinates(3)}\n`
      : ["Red", "Green", "Blue"].map(name => `  ${name}: 65535 (1) ${coordinates(0)}\n`).join(""));
    expect(runIdentifyCliSync(args, new Map([["/shape.png", bytes]]))).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
    const argumentValues = createCommandArguments(["identify", ...args]);
    let stdout = "", stderr = "";
    const result = await createMagickCommand().execute({ command: "magick", args: argumentValues.args, argumentValues,
      fs, cwd: "/", env: {}, signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
    expect({ ...result, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  }
});

it("consumes define operands, supports resets, and preserves custom formats", () => {
  const bytes = encodeImage({ width: 2, height: 1, data: new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]),
    format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
  const files = new Map([["/white.png", bytes]]), locate = ["-define", "identify:locate=maximum"];
  const result = runIdentifyCliSync([...locate, "-define", "identify:limit=1", "+define", "identify:limit", "/white.png"], files);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("65535 (1) 0,0 1,0");
  expect(runIdentifyCliSync([...locate, "-format", "%w", "/white.png"], files)).toEqual({ exitCode: 0, stdout: "2", stderr: "" });
  expect(runIdentifyCliSync([...locate, "+define", "identify:locate", "/white.png"], files))
    .toEqual(runIdentifyCliSync(["/white.png"], files));
  expect(runIdentifyCliSync(["-define"], files)).toEqual({ exitCode: 1, stdout: "", stderr: "identify: missing an argument for option '-define'\n" });
});
