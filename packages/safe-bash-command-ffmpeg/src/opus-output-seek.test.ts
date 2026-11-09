import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2 references: mono 48 kHz Opus, 0.75 s and 2.75 s (multiple Ogg pages).
// Packet hashes cover every payload in order, independently of container serialization.
const cases = [
  {
    name: "plain",
    fixture: "tone-opus.ogg",
    args: [],
    packets: 38,
    packetHash: "f8803184c977009a2233458510405efdf7356e8753234963117fb352ca09c352",
  },
  {
    name: "duration",
    fixture: "tone-opus.ogg",
    args: ["-t", "0.2"],
    packets: 11,
    packetHash: "7ee7fc2c2d0de3bbdea81c6841623c89de2514694c0e1737f19fc4ce95c655d7",
  },
  {
    name: "seekAfter",
    fixture: "tone-opus.ogg",
    args: ["-ss", "0.2"],
    packets: 27,
    packetHash: "76ffa12f1b90fd85ad1d33af1b24fc5de50d108fa9641a1534e894a0b308bde9",
  },
  {
    name: "window",
    fixture: "tone-opus.ogg",
    args: ["-ss", "0.2", "-t", "0.2"],
    packets: 10,
    packetHash: "7981b6e81f29ee4aa76e90afed4fd69cf6e7204aae2593843444d83d366fd660",
  },
  {
    name: "pagePlain",
    fixture: "opus-seek-pages.ogg",
    args: [],
    packets: 138,
    packetHash: "a4158e40af7662e2f3ef26f4010ee12c4c56a06f70f7a157404271f4a8103534",
  },
  {
    name: "pageSeekAfter",
    fixture: "opus-seek-pages.ogg",
    args: ["-ss", "1.20"],
    packets: 77,
    packetHash: "36a40fcc039d7591d3e91de5ce696e65e4b940e12c0c15d28ea96ca392117546",
  },
  {
    name: "pageDuration",
    fixture: "opus-seek-pages.ogg",
    args: ["-t", "1.20"],
    packets: 61,
    packetHash: "2f7aa16aca90e88796ff4fb28de7dcb3e46bc4a75ea6edbb5525779af235d467",
  }
];

for (const testCase of cases) for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} Opus stream copy ${testCase.name}`, async () => {
    const input = readFileSync(new URL(`./fixtures/${testCase.fixture}`, import.meta.url));
    const volume = Volume.fromJSON({ "/in.ogg": input });
    const args = ["-y", "-i", "/in.ogg", ...testCase.args, "-c", "copy", "/out.mkv"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const track = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer)).tracks[0]!;
    assert.equal(track.samples.length, testCase.packets);
    const hashes = track.samples.map(sample => `SHA256:${createHash("sha256").update(sample.data).digest("hex")}`);
    assert.equal(createHash("sha256").update(hashes.join("\n")).digest("hex"), testCase.packetHash);
    assert.equal(track.codecDelayNs, 6_500_000);
    assert.equal(track.samples.at(-1)!.discardPaddingNs, testCase.args.includes("-t") ? undefined : 3_500_000);
  });
}
