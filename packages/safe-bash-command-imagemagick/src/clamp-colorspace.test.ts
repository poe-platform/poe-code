import { expect, it } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  // Native ImageMagick 7.1.2-35 Q16-HDRI RGBA8 output after returning to sRGB.
  it.each([
    { space: "Lab", channel: "R", clamp: true, expected: "3b3858c0" },
    { space: "HSL", channel: "R", clamp: true, expected: "536342c0" },
    { space: "Lab", channel: "RGB", clamp: true, expected: "0091c2c0" },
    { space: "Lab", channel: "A", clamp: true, expected: "46426340" },
    { space: "HSL", channel: "A", clamp: true, expected: "46426340" },
    { space: "Lab", channel: "R", clamp: false, expected: "464263c0" },
    { space: "HSL", channel: "R", clamp: false, expected: "464263c0" },
    { space: "sRGB", channel: "A", clamp: true, expected: "46426340" },
  ])(`${mode}: $space $channel clamp=$clamp`, async ({ space, channel, clamp, expected }) => {
    const files = new Map<string, Uint8Array>();
    const filesystem = createMemoryFileSystem();
    const args = ["xc:#464263c0", "-colorspace", space, "-channel", channel,
      "-evaluate", "multiply", "4", ...(clamp ? ["-clamp"] : []), "-evaluate", "divide", "4",
      "+channel", "-colorspace", "sRGB", "-depth", "8", "rgba:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(args, files)
      : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out") : files.get("/out")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
  });
}
