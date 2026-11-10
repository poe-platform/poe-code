import { expect, it } from "vitest";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const geometry of ["1x1+0+0", "+0+0"])
it.each([
  { spacer: "null:", border: 1, rows: ["KKKYYYKKK", "KRKYYYKBK", "KKKYYYKKK"] },
  { spacer: "xc:none", border: 1, rows: ["KKKKKKKKK", "KRKKKKKBK", "KKKKKKKKK"] },
  { spacer: "null:", border: 0, rows: ["RYB"] }
])(`reserves empty null montage cells via ${mode}, ${geometry}: $spacer, border $border`, async ({ spacer, border, rows }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const args = ["-background", "white", "-geometry", geometry, "-tile", "3x", "-background", "yellow",
    "-bordercolor", "black", "-border", String(border), "xc:red", spacer, "xc:blue", "/sheet.png"];
  if (mode === "magick" || mode === "montage") {
    const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: mode, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await (mode === "magick" ? createMagickCommand() : createMontageCommand()).execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files)
      : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const actual = mode === "sync" || mode === "buffered" ? files.get("/sheet.png")! : await fs.readFile("/sheet.png");
  const colors: Record<string, number[]> = { K: [0, 0, 0, 255], R: [255, 0, 0, 255], B: [0, 0, 255, 255], Y: [255, 255, 0, 255] };
  // Native ImageMagick 7 leaves null cells empty, including their border area.
  const image = decodeImage(actual);
  expect([image.width, image.height]).toEqual([rows[0]!.length, rows.length]);
  expect(Array.from(image.data)).toEqual([...rows.join("")].flatMap(pixel => colors[pixel]!));
});
