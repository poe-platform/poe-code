import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const prefix = "1\n00:00:01,000 --> 00:00:02,000\n";
const vtt = (text: string) => `WEBVTT\n\n00:01.000 --> 00:02.000\n${text}\n`;

async function run(input: Uint8Array, options: string[], sync: boolean, extraInput?: Uint8Array) {
  const volume = Volume.fromJSON({ "/in.srt": Buffer.from(input), "/out.vtt": "KEEP",
    ...(extraInput ? { "/second.srt": Buffer.from(extraInput) } : {}) });
  const args = ["-v", "error", "-y", ...options, "/out.vtt"];
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
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
  return { result, stderr, output: volume.readFileSync("/out.vtt") as Buffer };
}

for (const sync of [false, true]) {
  for (const [charset, text, encoding] of [
    ["UTF-8", "Café €", "utf8"], ["ASCII", "Hello", "ascii"],
    ["ISO-8859-1", "Café", "latin1"]
  ] as const) {
    it(`${sync ? "sync" : "async"} recodes SubRip ${charset} input`, async () => {
      const { result, stderr, output } = await run(Buffer.from(prefix + text + "\n\n", encoding),
        ["-sub_charenc", charset, "-i", "/in.srt"], sync);
      assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
      assert.equal(output.toString(), vtt(text));
    });
  }
  it(`${sync ? "sync" : "async"} bypasses charset validation and recoding for stream copy`, async () => {
    const text = Buffer.from([0x43, 0x61, 0x66, 0xe9]);
    const { result, stderr, output } = await run(Buffer.concat([Buffer.from(prefix), text, Buffer.from("\n\n")]),
      ["-sub_charenc", "not-a-charset", "-i", "/in.srt", "-c:s", "copy", "-f", "srt"], sync);
    assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
    assert.deepEqual(output, Buffer.concat([Buffer.from("1\n00:00:01,000 --> 00:00:02,000\n"), text, Buffer.from("\n\n")]));
  });
  if (!sync) it("resets charset after each input", async () => {
    const { result, stderr, output } = await run(Buffer.from(prefix + "Hello\n\n"),
      ["-sub_charenc", "ASCII", "-i", "/in.srt", "-i", "/second.srt", "-map", "1:s"], sync,
      Buffer.from(prefix + "Café €\n\n"));
    assert.deepEqual(result, sync ? "" : { exitCode: 0 }, stderr);
    assert.equal(output.toString(), vtt("Café €"));
  });
}

it("reports ASCII recoding errors with exit 69 after writing only the WebVTT header", async () => {
  const { result, stderr, output } = await run(Buffer.from(prefix + "Café €\n\n"),
    ["-sub_charenc", "ASCII", "-i", "/in.srt"], false);
  assert.deepEqual(result, { exitCode: 69 });
  assert.ok(stderr.includes("Unable to recode subtitle event"), stderr);
  assert.ok(stderr.includes("from ASCII to UTF-8"), stderr);
  assert.equal(output.toString(), "WEBVTT\n");
});

it("declines sync recoding failures without changing the destination", async () => {
  const { result, output } = await run(Buffer.from(prefix + "Café €\n\n"),
    ["-sub_charenc", "ASCII", "-i", "/in.srt"], true);
  assert.equal(result, undefined);
  assert.equal(output.toString(), "KEEP");
});

it("rejects an unusable decoder charset before replacing output", async () => {
  const { result, stderr, output } = await run(Buffer.from(prefix + "Hello\n\n"),
    ["-sub_charenc", "not-a-charset", "-i", "/in.srt"], false);
  assert.deepEqual(result, { exitCode: 1 });
  assert.ok(stderr.includes("not-a-charset"), stderr);
  assert.equal(output.toString(), "KEEP");
});

it("rejects missing charset", async () => {
  const { result, stderr, output } = await run(Buffer.from(prefix + "Hello\n\n"), ["-sub_charenc"], false);
  assert.deepEqual(result, { exitCode: 1 });
  assert.ok(stderr.includes("requires a charset before an input"), stderr);
  assert.equal(output.toString(), "KEEP");
});

it("keeps valid events when another event cannot be recoded", async () => {
  const input = prefix + "Café €\n\n2\n00:00:03,000 --> 00:00:04,000\nHello\n\n";
  const { result, stderr, output } = await run(Buffer.from(input),
    ["-sub_charenc", "ASCII", "-i", "/in.srt"], false);
  assert.deepEqual(result, { exitCode: 0 });
  assert.ok(stderr.includes("Unable to recode subtitle event"), stderr);
  assert.equal(output.toString(), "WEBVTT\n\n00:03.000 --> 00:04.000\nHello\n");
});
