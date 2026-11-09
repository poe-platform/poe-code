import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string[], includeAudio = false) {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(createSyntheticMp4({ width: 32, height: 24, frameCount: 4, includeAudio })) });
  const manifests: string[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", ...options, "/out.mpd"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) {
        if (path === "/out.mpd") manifests.push(new TextDecoder().decode(bytes));
        volume.writeFileSync(path, bytes);
      },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, manifests };
}

for (const latency of ["1.5", "1500ms", "1500000us", "00:00:01.500999"]) {
  it(`writes ${latency} as milliseconds only in the live DASH service description`, async () => {
    const result = await run(["-target_latency", latency, "-ldash", "1", "-streaming", "1", "-write_prft", "1", "-utc_timing_url", "https://example.invalid/time"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.manifests[0]?.includes('type="dynamic"'));
    assert.ok(result.manifests[0]?.includes('<ServiceDescription id="0"><Latency target="1500"/></ServiceDescription>'));
    assert.ok(result.manifests.at(-1)?.includes('type="static"'));
    assert.ok(!result.manifests.at(-1)?.includes("<Latency"));
  });
}
it("enables streaming and producer reference time with ldash and identifies a multi-stream reference", async () => {
  const result = await run(["-target_latency", "1.5", "-ldash", "1", "-utc_timing_url", "https://example.invalid/time"], true);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.manifests[0]?.includes('target="1500" referenceId="0"'));
  assert.ok(result.manifests[0]?.includes('<ProducerReferenceTime id="0"'));
});
for (const options of [[], ["-target_latency", "1.5"], ["-ldash", "1", "-utc_timing_url", "https://example.invalid/time"], ["-target_latency", "0", "-ldash", "1"], ["-target_latency", "1.5", "-ldash", "1"], ["-target_latency", "1.5", "-ldash", "1", "-write_prft", "0", "-utc_timing_url", "https://example.invalid/time"]]) {
  it(`omits latency without its prerequisites: ${options.join(" ")}`, async () => {
    const result = await run(options);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.manifests.every(manifest => !manifest.includes("<Latency")));
  });
}
for (const latency of ["", "bad", "-1", "Infinity"]) {
  it(`rejects invalid target latency ${JSON.stringify(latency)} before writing`, async () => {
    const result = await run(["-target_latency", latency]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("target_latency"));
    assert.deepEqual(result.manifests, []);
  });
}
