import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 3.5 s of 700 Hz PCM16 tone, then a 20 ms loud tail.
const samples = Float64Array.from({ length: 28160 }, (_, i) =>
  (i < 28000 ? Math.trunc(8192 * Math.sin(2 * Math.PI * 700 * i / 8000)) : 30000) / 32768);

async function run(filter: string, level = "info", input = samples) {
  const volume = Volume.fromJSON({
    "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [input] }))
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-y", "-v", level, "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
    parseWav(volume.readFileSync("/in.wav") as Buffer).tracks[0]!.decodedAudio!.channelData);
  return { volume, stderr };
}

it("attaches native loudness and sample peak tags to each complete 100 ms frame", async () => {
  const { volume } = await run("ebur128=metadata=1:peak=sample,ametadata=mode=print:file=tags.txt");
  const expected = Array.from({ length: 35 }, (_, n) =>
    `frame:${String(n).padEnd(5)}pts:${String(n * 800).padEnd(8)}pts_time:${n / 10}\n` +
    `lavfi.r128.M=${n < 3 ? "-120.691" : n === 3 ? "-15.400" : "-15.399"}\n` +
    `lavfi.r128.S=${n < 29 ? "-120.691" : "-15.399"}\n` +
    `lavfi.r128.I=${n < 3 ? "-70.000" : "-15.400"}\n` +
    `lavfi.r128.LRA=${n >= 29 && n < 33 ? "20.000" : "0.000"}\n` +
    `lavfi.r128.LRA.low=${n < 29 ? "0.000" : n < 33 ? "-35.400" : "-15.400"}\n` +
    `lavfi.r128.LRA.high=${n < 29 ? "0.000" : "-15.400"}\n` +
    "lavfi.r128.sample_peaks_ch0=0.250\nlavfi.r128.sample_peak=0.250\n").join("");
  assert.equal(volume.readFileSync("/tags.txt", "utf8"), expected);
});

it("accepts metadata alone, preserves the summary and uses verbose measurement logs", async () => {
  const baseline = await run("ebur128=peak=sample");
  const enabled = await run("ebur128=metadata=1:peak=sample");
  assert.equal(enabled.stderr, baseline.stderr.slice(baseline.stderr.indexOf("Summary:")));
  assert.match(enabled.stderr, /Peak: +?-0.8 dBFS/);
  const verbose = await run("ebur128=metadata=1:peak=sample", "verbose");
  assert.equal(verbose.stderr, baseline.stderr);
  assert.equal((await run("ebur128=metadata=1", "quiet")).stderr, "");
});

for (const metadata of ["0", "false", "OFF"]) {
  it(`metadata=${metadata} leaves tags and framing unchanged`, async () => {
    const { volume } = await run(`ebur128=metadata=${metadata},ametadata=mode=print:file=tags.txt`);
    assert.equal(volume.readFileSync("/tags.txt", "utf8"), "");
  });
}

it("reframes timestamps and preserves upstream tags, including the incomplete tail", async () => {
  const { volume, stderr } = await run("ametadata=mode=print:file=before.txt,asetnsamples=n=1024:p=0,asetpts=2*PTS,ametadata=mode=add:key=audit:value=kept,ebur128=metadata=TRUE,ametadata=mode=print:file=tags.txt,ashowinfo");
  assert.equal(volume.readFileSync("/before.txt", "utf8"), "");
  const tags = String(volume.readFileSync("/tags.txt", "utf8"));
  const headers = tags.split("\n").filter(line => line.startsWith("frame:"));
  assert.equal(headers.length, 36);
  for (const [n, header] of headers.entries()) {
    const pts = n * 800 + Math.floor(n * 800 / 1024) * 1024;
    assert.equal(header, `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(8)}pts_time:${Number((pts / 8000).toPrecision(6))}`);
  }
  assert.equal(tags.split("audit=kept").length - 1, 36);
  assert.equal(tags.split("lavfi.r128.I=").length - 1, 35);
  assert.equal(tags.includes("lavfi.r128.sample_peak"), false);
  assert.equal(stderr.split("nb_samples:800").length - 1, 35);
  assert.match(stderr, /nb_samples:160 /);
});

it("does not invent a measurement for audio shorter than 100 ms", async () => {
  const { volume } = await run("ebur128=metadata=1,ametadata=mode=print:file=tags.txt", "info", samples.slice(0, 160));
  assert.equal(volume.readFileSync("/tags.txt", "utf8"), "");
});

it("keeps metadata absolute when display scale changes", async () => {
  const absolute = await run("ebur128=metadata=1,ametadata=mode=print:file=tags.txt");
  const relative = await run("ebur128=metadata=1:target=-16:scale=relative,ametadata=mode=print:file=tags.txt");
  assert.equal(relative.volume.readFileSync("/tags.txt", "utf8"), absolute.volume.readFileSync("/tags.txt", "utf8"));
});

it("allows an explicit info frame log level with metadata", async () => {
  const baseline = await run("ebur128");
  assert.equal((await run("ebur128=metadata=1:framelog=info")).stderr, baseline.stderr);
});

it("includes native cumulative true-peak tags only on complete measurement frames", async () => {
  const { volume } = await run("ebur128=metadata=1:peak=true,ametadata=mode=print:file=tags.txt");
  const lines = String(volume.readFileSync("/tags.txt", "utf8")).split("\n");
  assert.deepEqual(lines.filter(line => line.startsWith("lavfi.r128.true_peak=")), Array(35).fill("lavfi.r128.true_peak=0.251"));
  assert.deepEqual(lines.filter(line => line.startsWith("lavfi.r128.true_peaks_ch0=")), Array(35).fill("lavfi.r128.true_peaks_ch0=0.251"));
  assert.equal(lines.some(line => line.startsWith("lavfi.r128.sample_peak")), false);
});
