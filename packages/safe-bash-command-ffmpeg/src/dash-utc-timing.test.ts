import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[], output = true) {
  const volume = Volume.fromJSON({ "/out.mpd": "existing manifest" });
  volume.writeFileSync("/in.mp4", createSyntheticMp4({ fps: 1, frameCount: 4, includeAudio: false }));
  const manifests: string[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, ...(output ? ["out.mpd"] : [])],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) {
        volume.writeFileSync(path, bytes);
        if (path === "/out.mpd") manifests.push(new TextDecoder().decode(bytes));
      },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, manifests, volume };
}

for (const [url, attribute] of [
  [undefined, undefined],
  ["", ""],
  ["https://example.invalid/time", "https://example.invalid/time"],
  ['https://example.invalid/time?a=1&b="<utc>"', "https://example.invalid/time?a=1&amp;b=&quot;&lt;utc&gt;&quot;"]
] as const) {
  it(`writes DASH UTC timing ${JSON.stringify(url)} without fetching the URL`, async () => {
    const { result, stderr, manifests } = await run(url === undefined ? [] : ["-utc_timing_url", url]);
    assert.equal(result.exitCode, 0, stderr);
    assert.ok(manifests.length > 0);
    for (const manifest of manifests) {
      assert.equal(manifest.split("<UTCTiming").length - 1, url ? 1 : 0);
      if (url) assert.ok(manifest.includes(`<UTCTiming schemeIdUri="urn:mpeg:dash:utc:http-xsdate:2014" value="${attribute}"/>`), manifest);
    }
  });
}

it("rejects a missing UTC timing value before replacing output", async () => {
  const { result, stderr, volume, manifests } = await run(["-utc_timing_url"], false);
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("missing utc_timing_url"), stderr);
  assert.deepEqual(manifests, []);
  assert.equal(volume.readFileSync("/out.mpd", "utf8"), "existing manifest");
  assert.deepEqual(volume.readdirSync("/"), ["in.mp4", "out.mpd"]);
});
