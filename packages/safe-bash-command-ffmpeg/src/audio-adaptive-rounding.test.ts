import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(2400);
for (let i = 0; i < 1200; i++) input.writeInt16LE(i * 7919 % 22001 - 11000, i * 2);

async function run(name: string, options: string) {
  const volume = Volume.fromJSON({ "/in.raw": input, "/out.pcm": "keep" });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      "-filter_complex", `[0:a]asplit[a][b];[a]anull[x];[b]adelay=3S[y];[x][y]${name}=${options}[out]`,
      "-map", "[out]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, stdout: Buffer.concat(chunks), pcm: volume.readFileSync("/out.pcm") as Buffer };
}

// FFmpeg 7.0.2-static PCM16 references for the 8 kHz mono input and three-sample delay.
for (const [name, expected, doubleExpected] of [
  ["anlms", "dd3951557c3cb7309a5e7cc79183661ceb68dc7b5da64952979c630173370af5",
    "dd3951557c3cb7309a5e7cc79183661ceb68dc7b5da64952979c630173370af5"],
  ["anlmf", "91f79a4404a9f6b9897426d3acabd7713961ee85c50ed0f3162c427aa8b094a6",
    "33621aa3d45e4d3273b4e489e54470fb22d48b520d97b2d8193149d59c3b4972"]
] as const) {
  for (const options of ["order=4", "order=3.5", "order=4.5", "order=7/2", "order=3.6", "order=4.4",
    "order=4:out_mode=2", "order=4:out_mode=1.5", "order=4:out_mode=2.5", "order=4:precision=0.5"]) {
    it(`${name} matches native integer controls and PCM for ${options}`, async () => {
      const actual = await run(name, options);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.pcm.length, input.length);
      assert.equal(createHash("sha256").update(actual.pcm).digest("hex"), expected);
    });
  }
  for (const precision of ["1.5", "2"]) {
    it(`${name} matches native PCM with precision=${precision}`, async () => {
      const actual = await run(name, `order=4:precision=${precision}`);
      assert.equal(actual.result.exitCode, 0, actual.stderr);
      assert.equal(actual.stderr, "");
      assert.equal(actual.pcm.length, input.length);
      assert.equal(createHash("sha256").update(actual.pcm).digest("hex"), doubleExpected);
    });
  }
  for (const options of ["order=0.9", "order=32767.1", "order=4:out_mode=-0.1", "order=4:out_mode=4.1",
    "order=4:precision=-0.1", "order=4:precision=2.1"]) {
    it(`${name} validates ${options} before rounding and preserves existing output`, async () => {
      const actual = await run(name, options);
      assert.notEqual(actual.result.exitCode, 0);
      assert.ok(actual.stderr.includes(`${name}: invalid`), actual.stderr);
      assert.equal(actual.stdout.length, 0);
      assert.equal(actual.pcm.toString(), "keep");
    });
  }
}
