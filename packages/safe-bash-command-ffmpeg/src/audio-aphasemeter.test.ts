import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(kind: string, filter = "aphasemeter=video=0,ametadata=mode=print:key=lavfi.aphasemeter.phase:file=phase.txt") {
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

for (const [kind, phase] of [["same", "1.000000"], ["inverse", "-1.000000"], ["mix", "0.000000"]]) {
  it(`measures ${kind} phase per frame without changing PCM`, async () => {
    const result = await run(kind!);
    assert.equal(result.exitCode, 0, result.stderr);
    const report = result.volume.readFileSync("/phase.txt", "utf8") as string;
    for (const [n, pts] of [0, 4096, 8192].entries()) {
      assert.ok(report.includes(`frame:${n}    pts:${String(pts).padEnd(7)} pts_time:${Number((pts / 48000).toPrecision(6))}\nlavfi.aphasemeter.phase=${phase}\n`), report.slice(0, 250));
    }
    assert.ok(report.endsWith("lavfi.aphasemeter.phase=0.000000\n"));
    if (kind === "mix") assert.ok(report.includes("lavfi.aphasemeter.phase=-0.800031\n"));
    const audio = parseWav(result.volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(audio.channelData.map(c => Array.from(c)), result.channels.map(c => Array.from(c)));
  });
}

it("prints only metadata already measured in filter order", async () => {
  const result = await run("same", "ametadata=mode=print:file=before.txt,asetnsamples=n=4096:p=0,asetpts=PTS+48000,aphasemeter=video=false,volume=0,ametadata=mode=print:file=after.txt");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/before.txt", "utf8"), "");
  assert.ok((result.volume.readFileSync("/after.txt", "utf8") as string).startsWith("frame:0    pts:48000   pts_time:1\nlavfi.aphasemeter.phase=1.000000\n"));
});

for (const filter of ["aphasemeter", "aphasemeter=video=1", "aphasemeter=video=0:unknown=1", "ametadata=mode=invalid"]) {
  it(`rejects unsupported ${filter}`, async () => {
    const result = await run("same", filter);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.volume.existsSync("/out.wav"), false);
  });
}

for (const destination of ["", ":file=-", ":file=phase.txt"]) {
  it(`reports total silence as +1 via ${destination || "stderr"}`, async () => {
    const result = await run("same", `volume=0,aphasemeter=video=0,ametadata=mode=print${destination}`);
    assert.equal(result.exitCode, 0, result.stderr);
    const report = destination === ":file=-" ? result.stdout : destination ? result.volume.readFileSync("/phase.txt", "utf8") : result.stderr;
    assert.ok(String(report).includes("lavfi.aphasemeter.phase=1.000000\n"));
    assert.ok(!String(report).includes("lavfi.aphasemeter.phase=0.000000\n"));
  });
}

it("omits metadata when the requested key does not match", async () => {
  const result = await run("same", "aphasemeter=video=0,ametadata=mode=print:key=other:file=phase.txt");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.volume.readFileSync("/phase.txt", "utf8"), "");
});
