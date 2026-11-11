import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// libwebp lossless 8x6 animation: red then blue, with 75/195 ms durations
// and loop 3. Native ImageMagick reads 8/20 ticks.
const encoded = "UklGRowAAABXRUJQVlA4WAoAAAACAAAABwAABQAAQU5JTQYAAAD/////AwBBTk1GLAAAAAAAAAAAAAcAAAUAAEsAAAJWUDhMFAAAAC8HQAEABxD9j/4HAILwv20iov8hQU5NRiwAAAAAAAAAAAAHAAAFAADDAAAAVlA4TBQAAAAvB0ABAAcQ0f/+BwCC8L9tIqL/IQ==";

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
  it.each([
    { before: [], after: [], delays: [80, 200], ticks: "8;20;" },
    { before: ["-delay", "19x1000"], after: [], delays: [19, 19], ticks: "19;19;" },
    { before: [], after: ["-set", "delay", "75x1000"], delays: [75, 75], ticks: "75;75;" },
  ])(`${mode}: rewrites WebP with native input timing and explicit overrides: $before $after`, async ({ before, after, delays, ticks }) => {
    const input = Buffer.from(encoded, "base64");
    expect(decodeImage(input, { animated: true }).delay).toEqual([75, 195]);
    const files = new Map<string, Uint8Array>([["/in.webp", input]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.webp", input);
    const argv = [...before, "/in.webp", ...after, "-define", "webp:lossless=true", "-write", "/out.webp", "-format", "%T;", "info:"];
    let stdout = "";
    const result = mode === "command" ? await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(argv).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { stdout += new TextDecoder().decode(chunk); } },
      stderr: { write: async () => {} },
    }) : mode === "sync" ? runConvertCliSync(argv, files)
      : await runConvertCli(argv, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    expect("stdout" in result ? result.stdout : stdout).toBe(ticks);
    const output = mode === "sync" || mode === "map" ? files.get("/out.webp")! : await fs.readFile("/out.webp");
    expect(readImageMetadata(output)).toMatchObject({ delay: delays, loop: 3, pages: 2 });
    for (const page of [0, 1]) {
      const original = decodeImage(input, { page });
      expect(decodeImage(output, { page })).toMatchObject({ width: original.width, height: original.height, data: original.data });
    }
  });
}
