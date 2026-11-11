import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMkv, srtAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const utf8 = Buffer.from("1\n00:00:01,000 --> 00:00:03,000\nCafé €\n");
const utf8Vtt = Buffer.from("WEBVTT\n\n00:01.000 --> 00:03.000\nCafé €\n");
const mixed = Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nfine\n\n2\n00:00:03,000 --> 00:00:04,000\ncaf\xe9\n", "latin1");
const validVtt = Buffer.from("WEBVTT\n\n00:01.000 --> 00:02.000\nfine\n");
const mixedVtt = Buffer.concat([validVtt, Buffer.from("\n00:03.000 --> 00:04.000\ncaf\xe9\n", "latin1")]);

async function run(input: Buffer, options: readonly string[], sync: boolean, pipe = false, format = "webvtt") {
  const volume = Volume.fromJSON({ "/in.srt": input, "/second.srt": input, "/out.vtt": "KEEP" });
  const args = ["-v", "error", "-y", ...options, "-f", format, pipe ? "pipe:1" : "/out.vtt"];
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; })
    : await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
  assert.deepEqual(volume.readFileSync("/in.srt"), input);
  return { result, stderr, output: pipe ? Buffer.concat(stdout) : volume.readFileSync("/out.vtt") };
}

for (const sync of [false, true]) {
  for (const [specifier, matches] of [["", true], [":s", true], [":s:0", true], [":0", true],
    [":s:1", false], [":1", false], [":v", false], [":a:0", false]] as const) {
    it(`selects subtitle charset ${specifier || "default"} (sync=${sync})`, async () => {
      const { result, output, stderr } = await run(utf8,
        [`-sub_charenc${specifier}`, "ASCII", "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? matches ? undefined : "" : { exitCode: matches ? 69 : 0 }, stderr);
      assert.deepEqual(output, matches ? Buffer.from(sync ? "KEEP" : "WEBVTT\n") : utf8Vtt);
    });
    it(`selects subtitle decoder mode ${specifier || "default"} (sync=${sync})`, async () => {
      const { result, output, stderr } = await run(mixed,
        [`-sub_charenc_mode${specifier}`, "ignore", "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? matches ? "" : undefined : { exitCode: 0 }, stderr);
      assert.deepEqual(output, matches ? mixedVtt : sync ? Buffer.from("KEEP") : validVtt);
    });
  }
  for (const specifier of [":s", ":s:0"]) {
    it(`accepts matching UTF-8 charset ${specifier} (sync=${sync})`, async () => {
      const { result, output, stderr } = await run(utf8,
        [`-sub_charenc${specifier}`, "UTF-8", "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
      assert.deepEqual(output, utf8Vtt);
    });
  }
  for (const options of [
    ["-sub_charenc:s:0", "ASCII", "-sub_charenc", "UTF-8"],
    ["-sub_charenc", "ASCII", "-sub_charenc:s:0", "UTF-8", "-sub_charenc:s:1", "ASCII"],
    ["-sub_charenc:s:1", "not-a-charset"]
  ]) {
    it(`uses the last matching charset: ${options.join(" ")} (sync=${sync})`, async () => {
      const { result, output, stderr } = await run(utf8, [...options, "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
      assert.deepEqual(output, utf8Vtt);
    });
  }
  for (const options of [
    ["-sub_charenc_mode:s:0", "do_nothing", "-sub_charenc_mode", "ignore"],
    ["-sub_charenc_mode", "do_nothing", "-sub_charenc_mode:s:0", "ignore", "-sub_charenc_mode:s:1", "auto"],
    ["-sub_charenc:s:0", "ASCII", "-sub_charenc_mode:s:0", "ignore"]
  ]) {
    it(`uses the last matching decoder mode: ${options.join(" ")} (sync=${sync})`, async () => {
      const { result, output, stderr } = await run(mixed, [...options, "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
      assert.deepEqual(output, mixedVtt);
    });
  }
}

for (const [input, options, expected] of [
  [utf8, ["-sub_charenc:s:0", "ASCII"], utf8Vtt],
  [mixed, ["-sub_charenc_mode:s:0", "ignore"], validVtt]
] as const) {
  it(`resets scoped options after each input: ${options[0]}`, async () => {
    const { result, output, stderr } = await run(input,
      [...options, "-i", "/in.srt", "-i", "/second.srt", "-map", "1:s"], false);
    assert.deepEqual(result, { exitCode: 0 }, stderr);
    assert.deepEqual(output, expected);
  });
}

it("preserves non-UTF-8 subtitle bytes on stdout for a matching ignore mode", async () => {
  const { result, output, stderr } = await run(mixed,
    ["-sub_charenc_mode:s:0", "ignore", "-i", "/in.srt"], false, true);
  assert.deepEqual(result, { exitCode: 0 }, stderr);
  assert.deepEqual(output, mixedVtt);
});

for (const specifier of ["s:1", "2"]) {
  for (const selected of [0, 1]) {
    it(`matches ${specifier} against input subtitle streams before mapping stream ${selected}`, async () => {
      const source = srtAst().parse(utf8);
      const video = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 })).tracks[0]!;
      const input = Buffer.from(serializeMkv({ ...source, tracks: [video,
        { ...source.tracks[0]!, id: 2 }, { ...source.tracks[0]!, id: 3 }
      ] }));
      const { result, output, stderr } = await run(input,
        [`-sub_charenc:${specifier}`, "ISO-8859-1", "-i", "/in.srt", "-map", `0:s:${selected}`], false);
      assert.deepEqual(result, { exitCode: 0 }, stderr);
      assert.deepEqual(output, selected === 1 ? Buffer.from(utf8Vtt.toString("latin1")) : utf8Vtt);
    });
    it(`matches decoder mode ${specifier} before mapping stream ${selected}`, async () => {
      const source = srtAst().parse(mixed);
      const video = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 })).tracks[0]!;
      const input = Buffer.from(serializeMkv({ ...source, tracks: [video,
        { ...source.tracks[0]!, id: 2 }, { ...source.tracks[0]!, id: 3 }
      ] }));
      const { result, output, stderr } = await run(input,
        [`-sub_charenc_mode:${specifier}`, "ignore", "-i", "/in.srt", "-map", `0:s:${selected}`], false);
      assert.deepEqual(result, { exitCode: 0 }, stderr);
      assert.deepEqual(output, selected === 1 ? mixedVtt : validVtt);
    });
  }
}

for (const sync of [false, true]) {
  it(`preserves copied subtitle bytes with matching decoder options (sync=${sync})`, async () => {
    const { result, output, stderr } = await run(mixed,
      ["-sub_charenc:s:0", "not-a-charset", "-sub_charenc_mode:s:0", "do_nothing", "-i", "/in.srt", "-c:s", "copy"], sync, false, "srt");
    assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
    assert.deepEqual(output, Buffer.concat([mixed, Buffer.from("\n")]));
  });
  for (const option of ["-sub_charenc:s:bad", "-sub_charenc_mode:s:bad"]) {
    it(`rejects invalid stream selectors without replacing output: ${option} (sync=${sync})`, async () => {
      const { result, output } = await run(utf8, [option, option.startsWith("-sub_charenc_mode") ? "ignore" : "UTF-8", "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? undefined : { exitCode: 1 });
      assert.deepEqual(output, Buffer.from("KEEP"));
    });
  }
}
