import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAC0lEQVR4nGNgwAQAABQAAX3+Hu4AAAAASUVORK5CYII=", "base64"));
const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] });

for (const writer of ["default=nw=1:nk=1", "csv=p=0"]) {
  it.each([
    { target: "frame.png", filename: "frame.png", extra: [], bytes: png, format: "png_pipe" },
    { target: "frame.bin", filename: "frame.bin", extra: [], bytes: png, format: "png_pipe" },
    { target: "frame.png", filename: "frame.png", extra: ["-f", "image2"], bytes: png, format: "image2" },
    { target: "frame%02d.png", filename: "frame01.png", extra: [], bytes: png, format: "image2" },
    { target: "frame%02d.png", filename: "frame01.png", extra: ["-f", "image2"], bytes: png, format: "image2" },
    { target: "sound.wav", filename: "sound.wav", extra: [], bytes: wav, format: "wav" }
  ])(`reports $format for $target with $extra using ${writer}`, async ({ target, filename, extra, bytes, format }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(`/${filename}`, bytes);
    const args = ["-v", "error", ...extra, "-show_entries", "format=format_name", "-of", writer, target];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode).toBe(0);
    expect(diagnostic).toBe("");
    expect(output).toBe(`${format}\n`);
    if (target === filename) expect(evalSyncFfprobe(undefined, args, () => bytes)).toBe(`${format}\n`);
  });
}

it("preserves PNG dimensions and absent audio selection", () => {
  const args = ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", "frame.png"];
  expect(JSON.parse(evalSyncFfprobe(undefined, args, () => png)!).streams).toEqual([{ width: 3, height: 2 }]);
  expect(JSON.parse(evalSyncFfprobe(undefined, ["-select_streams", "a", ...args], () => png)!).streams).toEqual([]);
});
