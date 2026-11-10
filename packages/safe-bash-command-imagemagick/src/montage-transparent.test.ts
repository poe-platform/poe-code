import { expect, it } from "vitest";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
for (const geometry of ["1x1+0+0", "+0+0"])
it.each([
  { inputs: ["xc:red", "xc:lime", "-transparent", "red"], hex: "0000ffff00ff00ff" },
  { inputs: ["-transparent", "red", "xc:red"], hex: "0000ffff" },
  { inputs: ["-transparent", "red", "xc:lime"], hex: "00ff00ff" },
  { inputs: ["xc:red", "xc:lime"], hex: "ff0000ff00ff00ff" },
])(`makes matching montage tile colors transparent via ${mode}, ${geometry}: $inputs`, async ({ inputs, hex }) => {
  const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
  const args = ["-geometry", geometry, "-tile", "x1", "-background", "blue", ...inputs, "/sheet.png"];
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
  const bytes = mode === "sync" || mode === "buffered" ? files.get("/sheet.png")! : await fs.readFile("/sheet.png");
  const image = decodeImage(bytes);
  expect([image.width, image.height]).toEqual([hex.length / 8, 1]);
  // Native ImageMagick 7.1.2 RGBA8 output, including the unchanged control.
  expect(Buffer.from(image.data).toString("hex")).toBe(hex);
});

it("rejects a missing montage transparency color without writing output", () => {
  const files = new Map<string, Uint8Array>();
  expect(runMontageCliSync(["xc:red", "-transparent"], files)).toMatchObject({
    exitCode: 1, stderr: "montage: missing argument for -transparent\n"
  });
  expect(files.size).toBe(0);
});
