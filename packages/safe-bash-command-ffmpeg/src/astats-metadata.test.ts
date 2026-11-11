import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import reference from "./astats-metadata-reference.json" with { type: "json" };

// FFmpeg 7.0.2, 8 kHz PCM16 stereo: astats=metadata=1,ametadata=print.
const channels = [
  Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? [8192, -4096, 0, 4096][i % 4]! : 1024) / 32768),
  Float64Array.from({ length: 2048 }, (_, i) => (i < 1536 ? -16384 : 512) / 32768)
];

async function run(filter: string) {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels })) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
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
  const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
  assert.deepEqual(audio.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
  return { volume, stderr };
}

for (const value of ["1", "yes", "y", "Y"]) {
  it(`metadata=${value} emits all native channel and overall astats tags on each frame`, async () => {
    const { volume } = await run(`astats=metadata=${value},ametadata=mode=print:file=tags.txt`);
    const expected = reference.map(frame => frame.header + "\n" + Object.entries(frame.tags).map(([key, value]) => `${key}=${value}\n`).join("")).join("");
    assert.equal(volume.readFileSync("/tags.txt", "utf8"), expected);
  });
}

it("metadata injection preserves the statistics report and works without a consumer", async () => {
  const expected = (await run("astats=metadata=0")).stderr;
  for (const value of ["1", "yes", "y", "Y", "no", "n", "N"]) {
    assert.equal((await run(`astats=metadata=${value}`)).stderr, expected);
  }
});

for (const filter of ["astats", "astats=metadata=0", "astats=metadata=false", "astats=metadata=no", "astats=metadata=n", "astats=metadata=N"]) {
  it(`${filter} produces no frame tags`, async () => {
    const { volume } = await run(`${filter},ametadata=mode=print:file=tags.txt`);
    assert.equal(volume.readFileSync("/tags.txt", "utf8"), "");
  });
}

for (const [reset, rms] of [
  [1, ["-8.641454", "-8.641454", "-8.641454", "-32.143934"]],
  [2, ["-8.641454", "-8.641454", "-8.641454", "-11.632409"]]
] as const) {
  it(`metadata honors reset=${reset} and preserves existing tags`, async () => {
    const { volume } = await run(`ametadata=mode=add:key=audit:value=kept,astats=metadata=true:reset=${reset},ametadata=mode=print:file=tags.txt`);
    const lines = String(volume.readFileSync("/tags.txt", "utf8")).split("\n");
    assert.deepEqual(lines.filter(line => line.startsWith("lavfi.astats.Overall.RMS_level=")), rms.map(value => `lavfi.astats.Overall.RMS_level=${value}`));
    assert.equal(lines.filter(line => line === "audit=kept").length, 4);
  });
}

it("uses reframed audio timestamps and leaves earlier metadata consumers empty", async () => {
  const { volume } = await run("ametadata=mode=print:file=before.txt,asetnsamples=n=1024:p=0,asetpts=PTS+8000,astats=metadata=1,ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=tags.txt");
  assert.equal(volume.readFileSync("/before.txt", "utf8"), "");
  assert.equal(volume.readFileSync("/tags.txt", "utf8"), "frame:0    pts:8000    pts_time:1\nlavfi.astats.Overall.RMS_level=-8.641454\nframe:1    pts:9024    pts_time:1.128\nlavfi.astats.Overall.RMS_level=-9.884384\n");
});

it("honors independent measurement masks for frame tags and the report", async () => {
  const { volume, stderr } = await run("astats=metadata=1:measure_perchannel=none:measure_overall=RMS_level,ametadata=mode=print:file=tags.txt");
  assert.equal(stderr, "Overall\nRMS level dB: -9.884384\n");
  assert.equal(volume.readFileSync("/tags.txt", "utf8"), reference.map(frame => `${frame.header}\nlavfi.astats.Overall.RMS_level=${frame.tags["lavfi.astats.Overall.RMS_level"]}\n`).join(""));
});
