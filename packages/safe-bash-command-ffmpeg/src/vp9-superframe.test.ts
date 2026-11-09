import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseMkv, type MediaSample } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";
import { mergeVp9Superframes } from "./vp9-superframe.js";

// The split fixture contains the same VP9 frames as the packed reference,
// with invisible frames separated at 100, 1200 and 1600 milliseconds.
const packed = parseMkv(new Uint8Array(readFileSync(new URL("./fixtures/vp9-packed.webm", import.meta.url))));
const expected = packed.tracks[0]!.samples.map(({ pts, data }) => ({ pts, data }));
assert.equal(expected.length, 20);

for (const sync of [false, true]) {
  for (const input of ["vp9-split.mkv", "vp9-packed.webm"]) {
    for (const extension of ["mkv", "webm"]) {
      it(`${sync ? "sync" : "async"} copies ${input} to ${extension} with native VP9 packet grouping`, async () => {
        const bytes = readFileSync(new URL(`./fixtures/${input}`, import.meta.url));
        const volume = Volume.fromJSON({ "/in.mkv": bytes });
        const args = ["-v", "error", "-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", `/out.${extension}`];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const output = parseMkv(new Uint8Array(volume.readFileSync(`/out.${extension}`) as Buffer));
        assert.equal(output.tracks[0]!.samples.length, 20);
        assert.deepEqual(output.tracks[0]!.samples.map(({ pts, data }) => ({ pts, data })), expected);
      });
    }
  }
}

function sample(header: number, size = 1): MediaSample {
  const data = new Uint8Array(size);
  data[0] = header;
  return { ...packed.tracks[0]!.samples[0]!, pts: 123, dts: 100, cts: 23, duration: 40, data, size };
}

for (const [invisible, displayed] of [[0x84, 0x86], [0x84, 0x88], [0xb2, 0xb3], [0xb2, 0xb4]]) {
  for (const size of [255, 256, 65536]) {
    it(`packs VP9 header ${displayed} with a ${size}-byte invisible frame and displayed-packet timing`, () => {
      const hidden = sample(invisible!, size);
      const shown = { ...sample(displayed!), pts: 200, dts: 180, cts: 20, duration: 60, isKeyframe: false };
      const [track] = mergeVp9Superframes([{ ...packed.tracks[0]!, samples: [hidden, shown] }], new MediaBudgetTracker());
      const magnitude = size === 255 ? 1 : size === 256 ? 2 : 3;
      const marker = 0xc1 | ((magnitude - 1) << 3);
      const index = size === 255 ? [marker, 255, 1, marker]
        : size === 256 ? [marker, 0, 1, 1, 0, marker]
          : [marker, 0, 0, 1, 1, 0, 0, marker];
      assert.equal(track!.samples.length, 1);
      const merged = track!.samples[0]!;
      assert.deepEqual(merged, { ...shown, data: new Uint8Array([...hidden.data, ...shown.data, ...index]), size: size + 1 + index.length });
    });
  }
}

it("passes visible and already-packed packets unchanged and drops a trailing invisible frame", () => {
  const shown = sample(0x86);
  const superframe = packed.tracks[0]!.samples[1]!;
  const [track] = mergeVp9Superframes([{ ...packed.tracks[0]!, samples: [shown, superframe, sample(0x84)] }], new MediaBudgetTracker());
  assert.deepEqual(track!.samples, [shown, superframe]);
  assert.equal(track!.samples[0], shown);
  assert.equal(track!.samples[1], superframe);
});

it("rejects excessive invisible frames and checks output and memory limits before joining", () => {
  const source = packed.tracks[0]!;
  assert.throws(() => mergeVp9Superframes([{ ...source, samples: [...Array.from({ length: 7 }, () => sample(0x84)), sample(0x86)] }], new MediaBudgetTracker()), /too many invisible frames/);
  for (const limits of [{ maxOutputBytes: 4 }, { maxMemoryBytes: 4 }]) {
    assert.throws(() => mergeVp9Superframes([{ ...source, samples: [sample(0x84), sample(0x86)] }], new MediaBudgetTracker(limits)), /limit/i);
  }
});
