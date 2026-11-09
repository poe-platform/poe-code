import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./media.js";

// Native FFmpeg: 8 kHz stereo PCM, split inside the header and an audio sample.
const wav = new Uint8Array(readFileSync(new URL("./fixtures/concatf.wav", import.meta.url)));

async function run(probe: boolean, list = "a.part\nb.part\nc.part\n", limits = {}, seek = false) {
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work/lists", { recursive: true });
  for (const [name, bytes] of [["a.part", wav.slice(0, 19)], ["b.part", wav.slice(19, 8013)], ["c.part", wav.slice(8013)]] as const)
    await fs.writeFile(`/work/${name}`, bytes);
  await fs.writeFile("/work/lists/parts.txt", new TextEncoder().encode(list));
  let output = "", diagnostic = "";
  const command = probe ? createFfprobeCommand({ limits }) : createFfmpegCommand({ limits });
  const result = await command.execute({
    command: probe ? "ffprobe" : "ffmpeg",
    ...createCommandArguments(probe
      ? ["-v", "error", "-show_entries", "stream=codec_name,channels,sample_rate", "-of", "json", "concatf:lists/parts.txt"]
      : ["-v", "error", "-y", ...(seek ? ["-ss", "0.248"] : []), "-i", "concatf:lists/parts.txt",
        ...(seek ? ["-t", "0.005"] : []), "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"]),
    cwd: "/work", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, fs, output, diagnostic };
}

for (const probe of [false, true]) {
  for (const list of ["a.part\nb.part\nc.part\n", " \t'a.part'\r\n\r\nb\\.part\r\nfile:/work/c.part"]) {
    it(`${probe ? "probes" : "decodes"} concatf bytes in list order with cwd-relative paths: ${JSON.stringify(list)}`, async () => {
      const result = await run(probe, list);
      expect(result.exitCode, result.diagnostic).toBe(0);
      if (probe) expect(JSON.parse(result.output).streams).toEqual([{ codec_name: "pcm_s16le", sample_rate: "8000", channels: 2 }]);
      else expect(await result.fs.readFile("/out.pcm")).toEqual(wav.slice(44));
    });
  }
  for (const [list, limits, message] of [
    ["a.part\nmissing.part\nc.part", {}, "ENOENT"],
    [" \r\n", {}, "no files"],
    ["a.part\nb.part\nc.part", { maxConcatInputs: 2 }, "maxConcatInputs"],
    ["a.part\nb.part\nc.part", { maxInputBytes: wav.length }, "EFBIG"]
  ] as const) it(`rejects concatf ${message} (probe=${probe})`, async () => {
    const result = await run(probe, list, limits);
    expect(result.exitCode).not.toBe(0);
    expect(result.diagnostic).toContain(message);
  });
}

it("seeks across a concatf part boundary with native PCM bytes", async () => {
  const result = await run(false, undefined, {}, true);
  expect(result.exitCode, result.diagnostic).toBe(0);
  const pcm = await result.fs.readFile("/out.pcm");
  expect(pcm.length).toBe(160);
  expect(createHash("sha256").update(pcm).digest("hex")).toBe("6ff95119406ace1eb5be96e7425721ea9f8fa01ffe9e2cf67e5e96f9ba9b483b");
});
