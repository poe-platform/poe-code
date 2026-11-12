import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(4096);
for (let i = 0; i < 2048; i++) input.writeInt16LE(i * 131 % 8191 - 4095, i * 2);

for (const graph of [false, true]) {
  // Native FFmpeg 7.0.2: leading silence, truncated tail, unchanged sample count.
  for (const [seconds, delay, hash] of [
    ["0", 0, "28004e2b0ae3b996dbed30c5bb9a790753450c666a64f380a85f3201da37f745"],
    ["0.001", 8, "a9066ee5a4f4ed9c74ab2251ac612488e6727f9fcc0f4942a415779cb8fb9030"],
    ["0.01", 80, "41b84db06db9801036171b1b0335a0fe5e58df79f13765017ee8127d52a7d15c"],
    ["0.0001875", 1, "8a9e934703aff13a0adb61c5f10f2201f787ff0a9c45e5241154480e03df21c2"],
    ["0.00001", 0, "28004e2b0ae3b996dbed30c5bb9a790753450c666a64f380a85f3201da37f745"],
    ["0.256", 2048, "ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7"],
    ["0.5", 4000, "ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7"],
    ["30", 240000, "ad7facb2586fc6e966c004d7d1d16b024f5805ff7cb47c7a85dabd8b48892ca7"]
  ] as const) {
    it(`mcompand delay ${seconds} preserves native PCM through EOF (graph=${graph})`, async () => {
      const actual = await run(`0,0 6 -40/-40,0/0 0 ${seconds}`, graph);
      const expected = Buffer.alloc(input.length);
      if (delay < 2048) input.copy(expected, delay * 2, 0, input.length - delay * 2);
      assert.deepEqual(actual, expected);
      assert.equal(createHash("sha256").update(actual).digest("hex"), hash);
    });
  }

  for (const [bands, hash] of [
    ["0,0 6 -40/-40,0/0 100 0.001 | 0,0 6 -40/-40,0/0 0 0.01", "d93e72b7964719b5408d41ca5569c86a38839f00b9cff28e0dacfeac1e545553"],
    ["0,0 6 -40/-40,0/0 100 0.01 | 0,0 6 -40/-40,0/0 0 0.001", "d93e72b7964719b5408d41ca5569c86a38839f00b9cff28e0dacfeac1e545553"],
    ["0,0 6 -40/-40,0/0 100 0 | 0,0 6 -40/-40,0/0 0 0.01", "d93e72b7964719b5408d41ca5569c86a38839f00b9cff28e0dacfeac1e545553"],
    ["0.005,0.1 6 -40/-20,0/0 0 0.001", "8d416f769af651886410288c2b0623c4714b4f3f4470ab898d219661600714ba"],
    ["0.005,0.1 6 -40/-20,0/0 100 0.01 | 0,0.025 6 -38/-31,-28/-28,0/-25 0 0.001", "703c156f217f9d6c99b5c0460dbb82d3f1af3d343437bf61c26610ebbda1e1bb"]
  ] as const) {
    it(`mcompand delayed band envelopes match native bytes: ${bands} (graph=${graph})`, async () => {
      const actual = await run(bands, graph);
      assert.equal(createHash("sha256").update(actual).digest("hex"), hash);
    });
  }
}

async function run(bands: string, graph: boolean) {
  const fs = Volume.fromJSON({ "/in.raw": input });
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const filter = `mcompand=args='${bands}'`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  const error = Buffer.concat(errors).toString();
  assert.equal(result.exitCode, 0, error);
  assert.equal(error, "");
  const actual = Buffer.concat(output);
  assert.equal(actual.length, input.length);
  return actual;
}
