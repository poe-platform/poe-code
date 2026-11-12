import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string) {
  const input = Buffer.alloc(2400);
  for (let i = 0; i < 1200; i++) input.writeInt16LE(i * 7919 % 22001 - 11000, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      "-filter_complex", `[0:a]asplit[a][b];[a]anull[x];[b]adelay=3S[y];[x][y]${filter}[out]`,
      "-map", "[out]", "-f", "s16le", "pipe:1"],
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
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  const pcm = Buffer.concat(chunks);
  assert.equal(pcm.length, 2400);
  return pcm;
}

// SHA-256 of native FFmpeg 7.0.2 PCM16 output for this exact input and graph.
const hashes = {
  anlms: ["affa015fec77af36f37c3db370b904853c80fe2bea9a8b47ee18bf2dce741120",
    "dd3951557c3cb7309a5e7cc79183661ceb68dc7b5da64952979c630173370af5",
    "145168c15c521122cbcdb2f3a630427ad74eb90eeac92c75e3f80c768fb0a8cf"],
  anlmf: ["668dd0788cb0226fd71b9db76d843206fadb42386b208e3203d6af146624b907",
    "91f79a4404a9f6b9897426d3acabd7713961ee85c50ed0f3162c427aa8b094a6",
    "06bf45ecb28432e81a75b8ac1ff27431df8ad255df9e42b0889cabe3c3ebdefc"]
};
for (const name of ["anlms", "anlmf"] as const) {
  for (const [index, options] of [
    ["order=1", "order=min"],
    ["order=4:mu=0.75", "order=4:mu=default", "order=2+2",
      "order=4:mu=0:mu=default", "order=4:eps=max:leakage=min"],
    ["order=4:out_mode=n", "order=4:out_mode=o+1", "order=4:out_mode=3"]
  ].entries()) {
    it(`${name} resolves option constants and matches native PCM: ${options[1]}`, async () => {
      const control = await run(`${name}=${options[0]}`);
      assert.equal(createHash("sha256").update(control).digest("hex"), hashes[name][index]);
      for (const option of options.slice(1)) {
        assert.deepEqual(await run(`${name}=${option}`), control, option);
      }
    });
  }
}
