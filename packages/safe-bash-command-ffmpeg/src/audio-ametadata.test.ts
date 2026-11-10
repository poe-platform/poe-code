import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(kind: string, filter: string) {
  const channels = [0, 1].map(channel => Float64Array.from({ length: 144000 }, (_, i) => {
    const s = (i % 48 < 24 ? 4096 : -4096) / 32768;
    return channel === 0 ? (i < 96000 ? s : 0)
      : kind === "same" ? s : kind === "inverse" ? -s : i < 48000 ? 0 : -2 * s;
  }));
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 48000, channels }));
  let stderr = "";
  let stdout = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.wav", "-af", filter, "-ar", "48000", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, stdout, volume, channels };
}

it("adds and prints arbitrary frame metadata without changing PCM", async () => {
  const result = await run("mix", "ametadata=mode=add:key=audit:value=left,ametadata=mode=print:key=audit:file=tag.txt");
  assert.equal(result.exitCode, 0, result.stderr);
  const report = String(result.volume.readFileSync("/tag.txt", "utf8"));
  const expected = Array.from({ length: Math.ceil(144000 / 4096) }, (_, n) => {
    const pts = n * 4096;
    return `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${Number((pts / 48000).toPrecision(6))}\naudit=left\n`;
  }).join("");
  assert.equal(report, expected);
  const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(audio.channelData.map(c => Array.from(c)), result.channels.map(c => Array.from(c)));
});

it("adds only absent keys and prints all tags in filter order", async () => {
  const result = await run("mix", "ametadata=mode=print:file=before.txt,ametadata=mode=add:key=audit:value=left,ametadata=mode=add:key=audit:value=right,ametadata=mode=add:key=other:value=second,ametadata=mode=print:file=all.txt,ametadata=mode=print:key=missing:file=missing.txt");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/before.txt", "utf8"), "");
  assert.equal(result.volume.readFileSync("/missing.txt", "utf8"), "");
  assert.ok(String(result.volume.readFileSync("/all.txt", "utf8")).startsWith("frame:0    pts:0       pts_time:0\naudit=left\nother=second\n"));
});

for (const filter of ["ametadata=mode=add:value=left", "ametadata=mode=add:key=audit",
  "ametadata=mode=modify:value=left", "ametadata=mode=modify:key=audit"]) {
  it(`rejects incomplete metadata update: ${filter}`, async () => {
    const result = await run("mix", filter);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("requires key and value"), result.stderr);
    assert.equal(result.volume.existsSync("/out.wav"), false);
  });
}

for (const destination of ["", ":file=-"]) {
  it(`prints added metadata to ${destination ? "stdout" : "stderr"}`, async () => {
    const result = await run("mix", `asetnsamples=n=4096:p=0,asetpts=PTS+48000,ametadata=mode=add:key=audit:value=left,ametadata=mode=print:key=audit${destination}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok((destination ? result.stdout : result.stderr).startsWith("frame:0    pts:48000   pts_time:1\naudit=left\n"));
  });
}

it("preserves added tags through phase measurement", async () => {
  const result = await run("same", "ametadata=mode=add:key=audit:value=left,aphasemeter=video=0,ametadata=mode=print:file=tag.txt");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(String(result.volume.readFileSync("/tag.txt", "utf8")).startsWith("frame:0    pts:0       pts_time:0\naudit=left\nlavfi.aphasemeter.phase=1.000000\n"));
});

for (const graph of [false, true]) {
  for (const key of ["label", "absent", undefined]) {
    it(`modifies only existing frame tags without changing PCM (key=${key}, graph=${graph})`, async () => {
      // Native FFmpeg 7.0.2: ten mono PCM16 samples split into 3, 3, 3, 1.
      const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
      const filter = "asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample,"
        + (key === undefined ? "" : `ametadata=mode=modify:key=${key}:value=new,`)
        + "ametadata=mode=print:file=tags";
      const output: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(output), input);
      const value = key === "label" ? "new" : "sample";
      assert.equal(volume.readFileSync("/tags", "utf8"),
        `frame:0    pts:0       pts_time:0\nlabel=${value}\n`
        + `frame:1    pts:3       pts_time:0.000375\nlabel=${value}\n`
        + `frame:2    pts:6       pts_time:0.00075\nlabel=${value}\n`
        + `frame:3    pts:9       pts_time:0.001125\nlabel=${value}\n`);
    });
  }
}
