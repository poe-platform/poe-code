import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

const font = existsSync("/System/Library/Fonts/Supplemental/Arial.ttf")
  ? "/System/Library/Fonts/Supplemental/Arial.ttf" : "DejaVu-Sans";

const tile = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAF0lEQVR4nAXBAQEAAACCIJ433UAkQ5UOQsoIeL+oczoAAAAASUVORK5CYII=", "base64"));

for (const mode of ["sync", "buffered", "retained", "command"] as const)
for (const geometry of ["2x2+2+2", "+2+2"])
it.each([true, false])(`renders montage texture and foreground via ${mode}, ${geometry}, texture %s`, async enabled => {
  const files = new Map([["tile.png", tile]]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.png", tile);
  await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
  const args = ["tile.png", "-geometry", geometry, "-tile", "1x1",
    ...(enabled ? ["-texture", "tile.png"] : []), "out.png"];
  let output: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
    output = await fs.readFile("/out.png");
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    output = mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")!;
  }
  const inline = `inline:data:image/png;base64,${Buffer.from(tile).toString("base64")}`;
  const native = spawnSync("magick", ["montage", "-font", font, ...args.map(arg => arg === "tile.png" ? inline : arg === "out.png" ? "png:-" : arg)]);
  if (!native.error) {
    expect(native.status, native.stderr.toString()).toBe(0);
    expect(decodeImage(output).data).toEqual(decodeImage(native.stdout).data);
  }
  const actual = decodeImage(output);
  expect([actual.width, actual.height]).toEqual([6, 6]);
  const source = decodeImage(tile);
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const foreground = x >= 2 && x < 4 && y >= 2 && y < 4;
    const pixel = Array.from(source.data.slice(((y % 2) * 2 + x % 2) * 4, ((y % 2) * 2 + x % 2 + 1) * 4));
    const expected = enabled ? pixel.slice(0, 3).map(c => Math.round(c * pixel[3]! / 255 + 255 - pixel[3]!)) : [255, 255, 255];
    if (foreground) for (let c = 0; c < 3; c++) expected[c] = Math.round(pixel[c]! * pixel[3]! / 255 + expected[c]! * (1 - pixel[3]! / 255));
    expect(Array.from(actual.data.slice((y * 6 + x) * 4, (y * 6 + x + 1) * 4))).toEqual([...expected, 255]);
  }
});

it("rejects a missing texture argument", () => {
  expect(runMontageCliSync(["-texture"], new Map())).toMatchObject({ exitCode: 1, stderr: "montage: missing argument for -texture\n" });
});


for (const mode of ["sync", "buffered", "retained"] as const)
it.each(["missing.png", "bad.png"])(`preserves output on texture failure via ${mode}: %s`, async texture => {
  const keep = new TextEncoder().encode("keep");
  const files = new Map([["tile.png", tile], ["bad.png", keep], ["out.png", keep]]);
  const fs = new MemoryFileSystem();
  for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
  const args = ["tile.png", "-texture", texture, "out.png"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(texture);
  expect(mode === "retained" ? await fs.readFile("/out.png") : files.get("out.png")).toEqual(keep);
});
