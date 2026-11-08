import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
for (const geometry of ["+0+0", "2x1+1+1"])
it.each([
  { count: 3, columns: 2, output: "/sheet.png", names: ["/sheet-0.png", "/sheet-1.png"] },
  { count: 3, columns: 1, output: "/sheet.png", names: ["/sheet-0.png", "/sheet-1.png", "/sheet-2.png"] },
  { count: 2, columns: 2, output: "/sheet.png", names: ["/sheet.png"] },
  { count: 3, columns: 2, output: "/sheet-%02d.png", names: ["/sheet-00.png", "/sheet-01.png"] },
])(`preserves montage pages via ${mode}, ${geometry}: $count tiles, $columns columns, $output`, async ({ count, columns, output, names }) => {
  const fs = new MemoryFileSystem();
  const files = new Map<string, Uint8Array>();
  const colors = ["red", "blue", "lime"];
  const pixels = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]];
  for (let i = 0; i < count; i++) {
    const bytes = await sharp({ create: { width: 2, height: 1, channels: 3, background: colors[i]! } }).png().toBuffer();
    files.set(`/in${i}.png`, bytes);
    await fs.writeFile(`/in${i}.png`, bytes);
  }
  const args = ["-geometry", geometry, "-tile", `${columns}x1`, ...files.keys(), output];
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    };
    expect((await createMagickCommand().execute(context)).exitCode).toBe(0);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const retained = mode === "command" || mode === "retained";
  const actualNames = retained ? (await fs.readdir("/")).map(entry => `/${entry.name}`) : [...files.keys()];
  expect(actualNames.filter(name => name.startsWith("/sheet")).sort()).toEqual(names);
  const padding = geometry === "+0+0" ? 0 : 1;
  const width = columns * (2 + padding * 2), height = 1 + padding * 2;
  for (let page = 0; page < names.length; page++) {
    const image = decodeImage(retained ? await fs.readFile(names[page]!) : files.get(names[page]!)!);
    expect([image.width, image.height]).toEqual([width, height]);
    const expected = new Uint8Array(width * height * 4).fill(255);
    for (let col = 0; col < columns; col++) {
      const pixel = pixels[page * columns + col];
      if (page * columns + col >= count || !pixel) continue;
      for (let x = 0; x < 2; x++) expected.set(pixel, (padding * width + col * (2 + padding * 2) + padding + x) * 4);
    }
    expect(Array.from(image.data)).toEqual(Array.from(expected));
  }
});

for (const mode of ["retained", "buffered", "sync"] as const)
it(`lays out unequal tiles across rows and pads the final page via ${mode}`, async () => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  for (const [index, [width, height, background]] of ([
    [2, 1, "red"], [4, 3, "blue"], [1, 2, "lime"], [3, 1, "yellow"], [2, 2, "black"]
  ] as const).entries()) {
    const bytes = await sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();
    files.set(`/in${index}.png`, bytes);
    await fs.writeFile(`/in${index}.png`, bytes);
  }
  const args = ["-geometry", "+0+0", "-tile", "2x2", ...files.keys(), "/sheet.png"];
  const result = mode === "sync" ? runMontageCliSync(args, files)
    : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
  expect(result.exitCode).toBe(0);
  // Native ImageMagick 7: variable row sizes, with the last tile's width padding its row.
  for (const [page, [width, height]] of ([[6, 5], [4, 2]] as const).entries()) {
    const name = `/sheet-${page}.png`;
    const image = decodeImage(mode === "retained" ? await fs.readFile(name) : files.get(name)!);
    expect([image.width, image.height]).toEqual([width, height]);
    if (page === 1) expect(Array.from(image.data)).toEqual([
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255
    ]);
  }
});
