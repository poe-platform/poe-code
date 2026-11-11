import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function mix(command: string, mixer = "amix", channels = 1) {
  const volume = Volume.fromJSON({ "/out.pcm": "KEEP" });
  for (const [path, length, level] of [["/a.wav", 2048, 12000], ["/b.wav", 733, -4000]] as const) {
    volume.writeFileSync(path, encodeWav({ sampleRate: 8000,
      channels: Array.from({ length: channels }, (_, channel) => new Float64Array(length).fill((level + channel * 100) / 32768)) }));
  }
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a]asendcmd=c='${command}'[x];[x][1:a]${mixer}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  const output = volume.readFileSync("/out.pcm") as Buffer;
  assert.equal(output.length, 4096 * channels);
  return createHash("sha256").update(output).digest("hex").slice(0, 16);
}

// Native FFmpeg 7.0.2 consumes these upstream commands before mixing the buffered input.
for (const [command, expected] of [
  ["0.15 amix normalize 0", "fdc6a160022d680b"],
  ["0.15 amix weights 0|1", "3c191f8c55abd046"],
  ["0.15 amix weights x1", "3c191f8c55abd046"],
  ["1 amix normalize 0", "e2cef1367f969d5b"],
  ["0.15 amix normalize nope", "e2cef1367f969d5b"],
  ["0.15 amix inputs 3", "e2cef1367f969d5b"],
  ["0.15 amix weights 2", "e2cef1367f969d5b"],
  ["0.05 amix normalize 0;0.15 amix normalize 1", "e2cef1367f969d5b"]
] as const) {
  it(`matches native amix runtime command: ${command}`, async () => {
    assert.equal(await mix(command), expected);
  });
}

for (const [target, expected] of [
  ["amix@mix", "fdc6a160022d680b"],
  ["amix", "fdc6a160022d680b"],
  ["amix@other", "e2cef1367f969d5b"]
] as const) {
  it(`routes runtime commands to ${target}`, async () => {
    assert.equal(await mix(`0.15 ${target} normalize 0`, "amix@mix"), expected);
  });
}

for (const [channels, normalizeHash, weightsHash] of [
  [2, "2f4f554b93b27c54", "1bcafbe6187d09ef"],
  [6, "f613c2698f12eb78", "2afbad5309e5046a"]
] as const) {
  it(`applies runtime options to every channel of a ${channels}-channel mix`, async () => {
    assert.equal(await mix("0.15 amix normalize 0", "amix", channels), normalizeHash);
    assert.equal(await mix("0.15 amix weights 0|1", "amix", channels), weightsHash);
  });
}
