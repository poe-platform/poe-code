import assert from "node:assert/strict";
import { it } from "node:test";
import { createHash } from "node:crypto";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import reference from "./signalstats-reference.json" with { type: "json" };
import { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { signalstats } from "./signalstats.js";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, yuv = false) {
  const volume = Volume.fromJSON({});
  for (let t = 0; t < 2; t++) {
    const data = Uint8Array.from(Array.from({ length: 768 }, (_, i) => {
      const x = i % 32, y = Math.floor(i / 32);
      return [(7*x+3*y+87*t)%256, (2*x+9*y+53*t)%256, (4*x+11*y+23*t)%256, 255];
    }).flat());
    volume.writeFileSync(`/f${t}.png`, encodeImage({ width: 32, height: 24, channels: 4, data,
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
  }
  if (yuv) volume.writeFileSync("/in.y4m", Buffer.concat([
    Buffer.from("YUV4MPEG2 W4 H2 F1:1 Ip A1:1 C420jpeg\nFRAME\n"),
    Buffer.from([0,16,235,255,16,16,235,235,128,15,128,128])
  ]));
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "info", "-y", "-framerate", "5", "-i", yuv ? "/in.y4m" : "/f%d.png", "-vf", filter, "/o%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    }, stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, volume, error: Buffer.concat(errors).toString() };
}
for (const highlight of [false, true]) {
  it(`matches native signalstats metadata and RGB output (highlight=${highlight})`, async () => {
    const { result, volume, error } = await run(`signalstats=stat=brng${highlight ? ":out=brng" : ""},metadata=print`);
    assert.equal(result.exitCode, 0, error);
    const records = error.split("frame:").slice(1);
    assert.equal(records.length, 2);
    for (const [i, expected] of reference.entries()) {
      for (const [key, value] of Object.entries(expected)) assert.ok(records[i]!.includes(`lavfi.signalstats.${key}=${value}\n`), `${key}: ${records[i]}`);
      const output = decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer);
      const rgb = output.data.filter((_, j) => j % 4 !== 3);
      assert.equal(createHash("md5").update(rgb).digest("hex"), ["0b19f46a281791bb4aafac7bbbb86c55", "5bc032226f29469507c03e27f8db2c0f"][i]);
    }
  });
}

// FFmpeg 9.0.1 raw yuv422p reference: five of eight pixels violate broadcast limits.
it("highlights out-of-range YUV pixels, including their shared chroma", async () => {
  const data = new Uint8Array(32);
  const pixels = Uint8Array.from([0,16,235,255,16,16,235,235,128,15,240,241,128,128,128,128]);
  const frame = { width: 4, height: 2, data, ptsSeconds: 0, durationSeconds: 1, keyframe: true,
    native: { width: 4, height: 2, rgba: data, pixels, format: 4, colorspace: 5, fullRange: 0 } };
  const [out] = await signalstats([frame], true, [210,16,146], new MediaBudgetTracker());
  assert.equal(out!.filterMetadata!["lavfi.signalstats.BRNG"], "0.625");
  assert.equal(out!.filterMetadata!["lavfi.signalstats.YAVG"], "126");
  assert.equal(out!.filterMetadata!["lavfi.signalstats.VBITDEPTH"], "1");
  assert.deepEqual([...out!.native!.pixels], [210,16,210,210,16,16,210,210,16,16,240,16,146,146,128,146]);
  assert.deepEqual([...pixels], [0,16,235,255,16,16,235,235,128,15,240,241,128,128,128,128]);
});
for (const filter of ["signalstats=stat=tout", "signalstats=out=vrep", "signalstats=unknown=1", "signalstats=brng:brng:yellow:extra"]) {
  it(`rejects unsupported options: ${filter}`, async () => {
    const { result, volume } = await run(filter);
    assert.equal(result.exitCode, 1);
    assert.equal(volume.existsSync("/o1.png"), false);
  });
}
it("null preserves the original input raster", async () => {
  const { result, volume, error } = await run("null");
  assert.equal(result.exitCode, 0, error);
  for (let i = 0; i < 2; i++) assert.deepEqual(
    decodeImage(volume.readFileSync(`/o${i+1}.png`) as Buffer).data,
    decodeImage(volume.readFileSync(`/f${i}.png`) as Buffer).data);
});

it("prints measurements and renders custom-color broadcast highlights through the command", async () => {
  const { result, volume, error } = await run("signalstats=out=brng:color=red,metadata=print:key=lavfi.signalstats.BRNG", true);
  assert.equal(result.exitCode, 0, error);
  assert.ok(error.includes("lavfi.signalstats.BRNG=0.625\n"), error);
  assert.ok(!error.includes("lavfi.signalstats.YAVG"), error);
  const output = decodeImage(volume.readFileSync("/o1.png") as Buffer);
  for (const i of [0, 2, 3, 6, 7]) {
    assert.ok(output.data[4*i]! > 240);
    assert.ok(output.data[4*i+1]! < 10);
    assert.ok(output.data[4*i+2]! < 10);
  }
});
