import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand } from "./media.js";
import { resolveInputPath } from "./input-path.js";

// Native FFmpeg: a 300-byte WAV behind a 13-byte prefix. The short range
// truncates the declared data chunk to 32 stereo frames, before demuxing.
const clip = Buffer.alloc(300);
clip.write("RIFF"); clip.writeUInt32LE(292, 4); clip.write("WAVEfmt ", 8);
clip.writeUInt32LE(16, 16); clip.writeUInt16LE(1, 20); clip.writeUInt16LE(2, 22);
clip.writeUInt32LE(8000, 24); clip.writeUInt32LE(32000, 28);
clip.writeUInt16LE(4, 32); clip.writeUInt16LE(16, 34); clip.write("data", 36);
clip.writeUInt32LE(256, 40);
for (let frame = 0; frame < 64; frame++) {
  clip.writeInt16LE(frame + 1, 44 + frame * 4);
  clip.writeInt16LE(-frame - 1, 46 + frame * 4);
}

for (const route of ["retained", "stream", "bytes"]) {
  for (const [input, size, frames] of [
    ["clip.wav", 300, 64],
    ["subfile,,start,13,end,313,,:bundle.bin", 300, 64],
    ["subfile,,start,13,end,185,,:bundle.bin", 172, 32],
    ["subfile,,start,13,end,185,,:file:bundle.bin", 172, 32],
    ["subfile:clip.wav", 300, 64],
    ["subfile,,start,13,,:bundle.bin", 347, 64],
    ["subfile,|start|13|end|185||:bundle.bin", 172, 32],
  ] as const) {
    for (const mode of ["probe", "packets", "decode", "seek"]) {
      it(`${mode} respects ${input} via ${route}`, async () => {
        const base = new MemoryFileSystem();
        await base.writeFile("/clip.wav", clip);
        await base.writeFile("/bundle.bin", Buffer.concat([Buffer.alloc(13, 0xaa), clip, Buffer.alloc(47, 0xbb)]));
        const capabilities = { ...base.capabilities, retainedRead: route === "retained", streamingRead: route === "stream" };
        const fs = new Proxy(base, { get(target, key) {
          if (key === "capabilities") return capabilities;
          if (key === "capabilitiesFor") return async () => capabilities;
          if (key === "readFile" && route !== "bytes" && input.startsWith("subfile")) return () => { throw new Error("Whole backing file read forbidden"); };
          if (key === "openReadFile" && input.startsWith("subfile")) return async (...args: Parameters<typeof base.openReadFile>) => {
            const handle = await base.openReadFile(...args);
            const start = input.includes("bundle.bin") ? 13 : 0;
            return { stat: handle.stat.bind(handle), close: handle.close.bind(handle),
              async read(offset: number, length: number) {
                expect(offset).toBeGreaterThanOrEqual(start);
                if (input.includes("end")) expect(offset + length).toBeLessThanOrEqual(start + size);
                return handle.read(offset, length);
              }
            };
          };
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } });
        const probe = mode === "probe" || mode === "packets";
        const args = probe
          ? ["-v", "error", ...(mode === "packets" ? ["-show_packets", "-show_data_hash", "md5"] : []),
            "-show_entries", "stream=codec_name,sample_rate,channels,duration_ts:format=size", "-of", "json", input]
          : ["-v", "error", "-y", ...(mode === "seek" ? ["-ss", "0.003"] : []), "-i", input,
            ...(mode === "seek" ? ["-t", "0.002"] : []), "-f", "s16le", "/out.pcm"];
        let stdout = "", stderr = "";
        const result = await (probe ? createFfprobeCommand() : createFfmpegCommand()).execute({
          command: probe ? "ffprobe" : "ffmpeg", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect(result.exitCode, stderr).toBe(0);
        if (probe) {
          const actual = JSON.parse(stdout);
          expect(actual).toMatchObject({
            streams: [{ codec_name: "pcm_s16le", sample_rate: "8000", channels: 2, duration_ts: frames }],
            format: { size: String(size) }
          });
          if (mode === "packets") expect(actual.packets).toMatchObject([{
            pos: "44", size: String(frames * 4),
            data_hash: `MD5:${createHash("md5").update(clip.subarray(44, 44 + frames * 4)).digest("hex")}`
          }]);
        }
        else expect(Buffer.from(await base.readFile("/out.pcm"))).toEqual(
          clip.subarray(44 + (mode === "seek" ? 24 : 0) * 4, 44 + Math.min(frames, mode === "seek" ? 40 : frames) * 4));
      });
    }
  }
}

it("resolves only input protocols, preserving file-prefixed literal names", () => {
  expect(resolveInputPath("/media", "subfile,,start,13,end,185,,:../bundle.bin")).toEqual({ path: "/bundle.bin", start: 13, endExclusive: 185 });
  expect(resolveInputPath("/media", "subfile,,start,13,end,0,,:bundle.bin")).toEqual({ path: "/media/bundle.bin", start: 13 });
  expect(resolveInputPath("/media", "file:subfile:clip.wav")).toEqual({ path: "/media/subfile:clip.wav" });
});

for (const input of [
  "subfile,,start,-1,,:clip.wav", "subfile,,start,1.5,,:clip.wav", "subfile,,start,NaN,,:clip.wav",
  "subfile,,start,9007199254740992,,:clip.wav", "subfile,,start,,,:clip.wav",
  "subfile,,start,13,end,12,,:clip.wav", "subfile,,start,13,end,13,,:clip.wav",
  "subfile,,unknown,1,,:clip.wav", "subfile,,start,13", "subfile:", "subfile:http://example.test/clip.wav"
]) it(`rejects invalid local subfile input ${input}`, () => {
  expect(() => resolveInputPath("/", input)).toThrow();
});
