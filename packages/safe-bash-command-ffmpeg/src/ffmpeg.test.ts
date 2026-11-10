import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { serializeMkv } from "@poe-code/mp4-ast";
import { createSyntheticMp4, decodeH264Samples, mp4Ast, parseMp4, parseMp4Boxes, concatBytes, parseMkv, serializeMp4, parseMpegTs, parseWav } from "@poe-code/mp4-ast";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  createFfmpegCommand,
  evalSyncFfmpeg,
  createFfmpegCommands,
  createFfprobeCommand,
  type FfmpegCommandsOptions
} from "./index.js";

describe("aformat u8 quantization", () => {
  const samples = [-30000, -12345, -401, -1, 0, 1, 401, 12345, 30000];
  const cases: [string, number[]][] = [
    ["volume=1:precision=float,aformat=f=u8", [-29952, -12288, -512, 0, 0, 0, 512, 12288, 29952]],
    ["volume=0.5:precision=float,aformat=f=u8", [-15104, -6144, -256, 0, 0, 0, 256, 6144, 15104]],
    ["acontrast,aformat=f=u8", [-32256, -19200, -768, 0, 0, 0, 768, 19200, 32256]],
    ["volume=0.5:precision=fixed,aformat=f=u8", [-15104, -6400, -256, 0, 0, 0, 0, 6144, 14848]],
    ["aformat=f=u8", [-30208, -12544, -512, -256, 0, 0, 256, 12288, 29952]]
  ];
  for (const [filter, expected] of cases) {
    for (const complex of [false, true]) {
      it(`quantizes the current sample format: ${filter} (complex=${complex})`, async () => {
        const input = new Uint8Array(samples.length * 2);
        const expectedBytes = new Uint8Array(expected.length * 2);
        samples.forEach((sample, index) => new DataView(input.buffer).setInt16(index * 2, sample, true));
        expected.forEach((sample, index) => new DataView(expectedBytes.buffer).setInt16(index * 2, sample, true));
        const vfs = createTestVfs({ "/in.raw": input, "/out.raw": "KEEP" });
        const result = await runCmd(createFfmpegCommand(), [
          "-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(vfs.store.get("/out.raw"), expectedBytes);
      });
    }
  }
});

describe("audio channel stream specifiers", () => {
  const left = [100, 300, 500, 700];
  const right = [-200, -400, -600, -800];
  for (const option of ["-ac", "-ac:a", "-ac:a:0", "-ac:0", "-ac:a:1", "-ac:1", "-ac:v:0"]) {
    const matches = !["-ac:a:1", "-ac:1", "-ac:v:0"].includes(option);
    it(`selects output channels with ${option}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, n => n / 32768)) }) });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", option, "1", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.deepEqual(audio.channelData.map(samples => Array.from(samples, n => n * 32768)),
        matches ? [[-50, -50, -50, -50]] : [left, right]);
    });
    for (const sync of [false, true]) it(`selects raw input channels with ${option} (sync=${sync})`, async () => {
      const raw = new Uint8Array(16);
      const view = new DataView(raw.buffer);
      for (let i = 0; i < left.length; i++) {
        view.setInt16(i * 4, left[i]!, true);
        view.setInt16(i * 4 + 2, right[i]!, true);
      }
      const vfs = createTestVfs({ "/in.raw": raw });
      const args = ["-y", "-f", "s16le", option, "2", "-i", "/in.raw", "/out.wav"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 44100);
      assert.deepEqual(audio.channelData.map(samples => Array.from(samples, n => n * 32768)),
        matches ? [left, right] : [left.flatMap((n, i) => [n, right[i]!])]);
    });
  }
  for (const options of [["-ac", "2", "-ac:a:0", "1"], ["-ac:a:0", "2", "-ac", "1"], ["-ac:a", "1", "-ac:a:1", "2"]]) {
    it(`uses the last matching channel option: ${options.join(" ")}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, n => n / 32768)) }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", ...options, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channels, 1);
    });
  }
  it("applies channel counts independently to mapped streams and outputs", async () => {
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, n => n / 32768)) }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-map", "0:a", "-map", "0:a",
      "-ac:a:1", "1", "-f", "streamhash", "-hash", "md5", "/hash.txt", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const stereo = new Uint8Array(16);
    const mono = new Uint8Array(8);
    for (let i = 0; i < left.length; i++) {
      new DataView(stereo.buffer).setInt16(i * 4, left[i]!, true);
      new DataView(stereo.buffer).setInt16(i * 4 + 2, right[i]!, true);
      new DataView(mono.buffer).setInt16(i * 2, -50, true);
    }
    assert.equal(new TextDecoder().decode(vfs.store.get("/hash.txt")),
      `0,a,MD5=${createHash("md5").update(stereo).digest("hex")}\n1,a,MD5=${createHash("md5").update(mono).digest("hex")}\n`);
    assert.equal(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channels, 2);
  });

});

describe("channel count remix routing", () => {
  for (const channels of [8, 9, 10, 16]) {
    it(`handles stereo to ${channels} channels according to default speaker routing`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 24 }, (_, i) => (i + 1) / 32768),
        Float64Array.from({ length: 24 }, (_, i) => -(i + 1) / 32768)
      ] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/in.wav", "-ac", String(channels), "/out.wav"
      ], vfs);
      if (channels === 9) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(!vfs.store.get("/out.wav")?.byteLength);
      } else {
        assert.equal(result.exitCode, 0, result.stderr);
        const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, channels);
        assert.equal(audio.channelData[0]!.length, 24);
      }
      assert.deepEqual(vfs.store.get("/in.wav"), input);
    });
  }
});

describe("acopy", () => {
  for (const graph of [false, true]) {
    for (const filter of ["acopy", "acopy,areverse", "areverse,acopy"]) {
      it(`preserves exact PCM samples through ${filter} (graph=${graph})`, async () => {
        const samples = [100, -200, 300, -400, 500, -600, 700, -800];
        const vfs = createTestVfs({ "/in.wav": encodeWav({
          sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)]
        }) });
        const result = await runCmd(createFfmpegCommand(), [
          "-v", "error", "-y", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channelData.length, 1);
        assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768),
          filter.includes("areverse") ? [...samples].reverse() : samples);
      });
    }
  }
});

describe("output initialization before media writing", () => {
  for (const earlierExists of [false, true]) {
    for (const later of [["in.wav"], ["./in.wav"], ["-f", "not_a_muxer", "last.zz"]]) {
      it(`leaves earlier output empty on ${later.join(" ")} (existing=${earlierExists})`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8], n => n / 32768)] });
        const vfs = createTestVfs({ "/in.wav": input.slice(), ...(earlierExists ? { "/first.wav": "old" } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-y", "-i", "in.wav", "first.wav", ...later], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, later.length === 1 ? /in-place/ : /output format/);
        assert.deepEqual(vfs.store.get("/in.wav"), input);
        assert.equal(vfs.store.has("/last.zz"), false);
        assert.equal(vfs.store.get("/first.wav")?.byteLength, 0);
      });
    }
  }

  for (const destinations of [["first.wav"], ["first.wav", "last.wav"]]) {
    it(`writes media after successful setup of ${destinations.join(" ")}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8).fill(1 / 32768)] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "in.wav", ...destinations], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (const destination of destinations) assert.ok(vfs.store.get(`/${destination}`)!.byteLength > 44);
    });
  }
});

describe("crop dimension aliases", () => {
  for (const dimensions of ["out_w=4:out_h=2", "w=4:h=2", "out_w=4:h=2", "w=4:out_h=2"]) {
    it(`matches native pixels for ${dimensions} across three frames`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 7, height: 5, channels: 4,
        data: new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "2", "-i", "/in%d.png", "-vf", `crop=${dimensions}:x=0:y=0`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = new Uint8Array([1, 2, 3, 4, 8, 9, 10, 11].flatMap(gray => [gray, gray, gray, 255]));
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
        assert.equal(output.width, 4);
        assert.equal(output.height, 2);
        assert.deepEqual(output.data, expected);
      }
    });
  }
});

describe("default centered crop rounding", () => {
  for (const width of [2, 4]) {
    for (const position of ["", ":(iw-ow)/2:(ih-oh)/2"]) {
      it(`rounds crop=${width}:2${position} to the native centered window`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 7, height: 5, channels: 4,
          data: new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
        const result = await runCmd(createFfmpegCommand(), [
          "-framerate", "2", "-i", "/in%d.png", "-vf", `crop=${width}:2${position}`,
          "-frames:v", "3", "/out%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const expected = new Uint8Array(Array.from({ length: width * 2 }, (_, i) => {
          const gray = 17 + Math.floor(i / width) * 7 + i % width;
          return [gray, gray, gray, 255];
        }).flat());
        for (let frame = 1; frame <= 3; frame++) {
          const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
          assert.equal(output.width, width);
          assert.equal(output.height, 2);
          assert.deepEqual(output.data, expected);
        }
      });
    }
  }
});

describe("crop coordinate references", () => {
  const width = 4;
  for (const position of [":y:1", ":1:x", ":1:1", ":y:n", ":n:x"]) {
    it(`rounds crop=${width}:2${position} to the native dependent window`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 7, height: 5, channels: 4,
        data: new Uint8Array(Array.from({ length: 35 }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "2", "-i", "/in%d.png", "-vf", `crop=${width}:2${position}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (let frame = 1; frame <= 3; frame++) {
        const coordinate = position.includes("n") ? frame - 1 : 1;
        const expected = new Uint8Array(Array.from({ length: width * 2 }, (_, i) => {
          const gray = 1 + coordinate * 8 + Math.floor(i / width) * 7 + i % width;
          return [gray, gray, gray, 255];
        }).flat());
        const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
        assert.equal(output.width, width);
        assert.equal(output.height, 2);
        assert.deepEqual(output.data, expected);
      }
    });
  }
});

describe("trim PTS validation", () => {
  for (const option of ["start_pts", "end_pts"]) {
    for (const value of ["", "bogus", "1.5", "Infinity", "9007199254740992"]) {
      it(`rejects ${option}=${value} without replacing output`, async () => {
        const previous = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/out.png": previous });
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=red:s=2x2:r=4:d=1",
          "-vf", `trim=${option}=${value}`, "/out.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes(`trim: ${option} must be an integer`), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), previous);
      });
    }
  }
});

describe("trim frame validation", () => {
  for (const options of ["start_frame=-2", "end_frame=-1", "start_frame=bogus", "start_frame=Infinity", "start_frame="]) {
    it(`rejects ${options} without replacing output`, async () => {
      const previous = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/out.png": previous });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=red:s=2x2:r=4:d=1",
        "-vf", `trim=${options}`, "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("trim:"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.png"), previous);
    });
  }
});

describe("trim positional validation", () => {
  for (const options of ["start=0.5:1", "0:1:0:4:1:0:6:7", "0:1:bogus", "0:1:"]) {
    it(`rejects ${options} without replacing output`, async () => {
      const previous = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/out.png": previous });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=red:s=2x2:r=4:d=1",
        "-vf", `trim=${options}`, "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("trim:"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.png"), previous);
    });
  }
});

it("trim keeps a positive duration that rounds to zero as an empty interval", async () => {
  const { encodeImage } = await import("@poe-code/image-ast/portable");
  const vfs = createTestVfs();
  vfs.store.set("/in1.png", encodeImage({ width: 1, height: 1,
    data: Uint8Array.from([20, 20, 20, 255]),
    format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
  }, { format: "png" }).data);
  await runCmd(createFfmpegCommand(), [
    "-framerate", "4", "-i", "/in%d.png",
    "-vf", "fps=4,trim=duration=0.01", "/out%d.png"
  ], vfs);
  assert.equal([...vfs.store.keys()].some(path => path.startsWith("/out")), false);
});

describe("trim preserves timestamps", () => {
  for (const [filter, expected] of [
    ["trim=start_frame=-1", [20, 40, 60, 80, 100, 120]],
    ["trim=start_frame=-1:start=0.5", [60, 80, 100, 120]],
    ["trim=start_frame=-1:start_pts=2", [60, 80, 100, 120]],
    ["trim=start_frame=-1:end_frame=3", [20, 40, 60]],
    ["trim=0.5:1:2:4:0:-1", [60, 80]],
    ["trim=end_frame=0", []],
    ["trim=start=10", []],
    ["trim=start_frame=5:end_frame=2", []],
    ["trim=0.5:1", [60, 80]],
    ["trim=0.5:1:0.25", [20, 40, 60, 80]],
    ["trim=0.5:1:0.5", [20, 40, 60, 80]],
    ["trim=0.5:1:1.5", [60, 80]],
    ["trim=0.5:1:3:5", [60, 80, 100]],
    ["trim=0.5:1:3:5:0.25", [60, 80, 100]],
    ["trim=0:1:0:4:0.25:3", [20, 40, 60, 80]],
    ["trim=0:0.25:0:1:0.25:0:5", [20, 40, 60, 80, 100]],
    ["trim=0.5:1:start=0", [20, 40, 60, 80]],
    ["trim=starti=0.5:endi=1", [60, 80]],
    ["trim=durationi=0.5", [20, 40]],
    ["trim=starti=500ms:durationi=500000us", [60, 80]],
    ["trim=start=0:starti=0.5:endi=1", [60, 80]],
    ["trim=starti=0.5:start=0:endi=1", [20, 40, 60, 80]],
    ["trim=end=1:endi=0.5", [20, 40]],
    ["trim=endi=0.5:end=1", [20, 40, 60, 80]],
    ["trim=duration=1:durationi=0.5", [20, 40]],
    ["trim=durationi=0.5:duration=1", [20, 40, 60, 80]],
    ["trim=start_pts=2:end_pts=4", [60, 80]],
    ["trim=start_pts=2", [60, 80, 100, 120]],
    ["trim=end_pts=4", [20, 40, 60, 80]],
    ["trim=start_pts=-2:end_pts=2", [20, 40]],
    ["trim=start_frame=1,trim=start_pts=2:end_pts=4", [60, 80]],
    ["trim=start_pts=3:start_frame=1:end_pts=4", [40, 60, 80]],
    ["trim=start_pts=3:start=0.25:end_pts=4", [40, 60, 80]],
    ["trim=end_pts=2:end_frame=4", [20, 40, 60, 80]],
    ["trim=end_pts=2:end=1", [20, 40, 60, 80]],
    ["trim=start_pts=2:duration=0.5", [60, 80]],
    ["fps=2,trim=start_pts=1:end_pts=2", [60]],
    ["trim=start=0.2", [40, 60, 80, 100, 120]],
    ["trim=start=0.1", [20, 40, 60, 80, 100, 120]],
    ["trim=start=0.125", [40, 60, 80, 100, 120]],
    ["trim=end=0.3", [20]],
    ["trim=end=0.375", [20, 40]],
    ["trim=duration=0.3", [20]],
    ["trim=duration=0", [20, 40, 60, 80, 100, 120]],
    ["trim=duration=0:start_frame=2", [60, 80, 100, 120]],
    ["trim=durationi=0:start=0.5", [60, 80, 100, 120]],
    ["trim=duration=0:end_frame=3", [20, 40, 60]],
    ["trim=duration=0:end=0.5", [20, 40]],
    ["trim=start=0.2:duration=0.3", [40]],
    ["trim=start_frame=3:start=0.2", [40, 60, 80, 100, 120]],
    ["fps=2,trim=start=0.3", [60, 100]],
    ["fps=2,trim=end=0.6", [20]],
    ["trim=start=0.5:end=1.25:duration=0.25", [60, 80, 100]],
    ["trim=start=0.5:end=0.75:duration=0.75", [60, 80, 100]],
    ["trim=start=0.5:end=1.25:duration=0.25:end_frame=3", [60, 80, 100]],
    ["trim=start=0.5:end=0.75:duration=0.25:end_frame=5", [60, 80, 100]],
    ["trim=start_frame=2:duration=0.5", [60, 80]],
    ["trim=start=0.5:duration=0.5", [60, 80]],
    ["trim=start_frame=2,trim=duration=0.5", [60, 80]],
    ["trim=start=0.5,trim=end=1", [60, 80]],
    ["trim=start=0.5:end=1", [60, 80]],
    ["trim=start_frame=2,trim=end=1", [60, 80]],
    ["trim=start=0.5,setpts=PTS-STARTPTS,trim=end=0.5", [60, 80]]
  ] as const) {
    it(filter, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 1; i <= 6; i++) {
        vfs.store.set(`/in${i}.png`, encodeImage({ width: 1, height: 1,
          data: Uint8Array.from([i * 20, i * 20, i * 20, 255]),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "4", "-i", "/in%d.png", "-vf", filter, "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = [...vfs.store.keys()].filter(path => path.startsWith("/out")).sort();
      assert.deepEqual(output.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
    });
  }
});

describe("negate available components", () => {
  for (const [source, filter, valid] of [
    ["rgba", "negate=components=y", false],
    ["rgba", "negate=components=u+v", false],
    ["rgba", "negate=components=y+r", false],
    ["rgba", "negate=63", false],
    ["rgba", "negate=components=r+a", true],
    ["yuv", "negate=components=r", false],
    ["yuv", "negate=components=a", false],
    ["yuv", "negate=components=y+r", false],
    ["yuv", "negate=127", false],
    ["yuv", "negate=components=y", true],
    ["yuv", "negate=components=u+v", true],
    ["yuv", "negate", true],
    ["yuv", "negate=0", true],
    ["yuv", "format=rgba,negate=components=y", false],
    ["yuv", "format=rgba,negate=components=r+a", true],
    ["rgba", "format=rgb24,negate=components=a", false]
  ] as const) {
    it(`${valid ? "accepts" : "rejects"} ${filter} on ${source}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const png = encodeImage({ width: 2, height: 1,
        data: new Uint8Array([10, 40, 90, 64, 20, 50, 100, 192]),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const input = source === "rgba" ? png : readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
      const path = source === "rgba" ? "/in.png" : "/in.mp4";
      const vfs = createTestVfs({ [path]: input, "/out.png": png });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-i", path, "-vf", filter, "-frames:v", "1", "/out.png"
      ], vfs);
      if (valid) {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.ok(decodeImage(vfs.store.get("/out.png")!).width > 0);
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Requested components not available"), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), png);
      }
      assert.deepEqual(vfs.store.get(path), input);
    });
  }
});

describe("negate option validation", () => {
  for (const options of ["components=bogus", "negate_alpha=bogus", "unknown=1", "components=", "components=r+", "negate_alpha=2", "r:0:extra"]) {
    it(`rejects ${options} without overwriting output`, async () => {
      const { encodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({ width: 2, height: 1,
        data: new Uint8Array([10, 40, 90, 64, 20, 50, 100, 192]),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const previous = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/in.png": input, "/out.png": previous });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-i", "/in.png", "-vf", `negate=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("negate:"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.png"), previous);
      assert.deepEqual(vfs.store.get("/in.png"), input);
    });
  }
});

describe("negate timeline", () => {
  for (const [filter, enabled] of [
    ["negate", [true, true, true]],
    ["negate=enable=0", [false, false, false]],
    ["negate=enable=0.25", [false, false, false]],
    ["negate=enable=-1", [true, true, true]],
    ["negate=components=r+g+b:negate_alpha=0:enable=gte(n\\,1)", [false, true, true]],
    ["negate=enable=gte(n\\,1)", [false, true, true]],
    ["negate=enable=between(t\\,1\\,1)", [false, true, false]]
  ] as const) {
    it(`honors ${filter} on each frame and preserves alpha`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const pixels = [10, 40, 90, 64, 20, 50, 100, 192];
      const input = encodeImage({ width: 2, height: 1,
        data: new Uint8Array(pixels), format: "png", space: "srgb", channels: 4,
        depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", filter, "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (const [index, active] of enabled.entries()) {
        const output = decodeImage(vfs.store.get(`/out${index + 1}.png`)!);
        assert.deepEqual([...output.data], pixels.map((value, channel) =>
          active && channel % 4 !== 3 ? 255 - value : value));
      }
    });
  }
});

describe("negate alpha boolean aliases", () => {
  for (const alias of ["y", "n", "enabled", "disabled", "Y", "N", "ENABLED", "DISABLED", "enable", "disable", "1", "0"]) {
    for (const components of [undefined, "r", "r+g+b+a"]) {
      it(`accepts ${alias} with components=${components ?? "default"} and matches native RGBA`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({ width: 2, height: 1,
          data: new Uint8Array([17, 58, 99, 140, 41, 187, 111, 127]),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/in.png": input });
        const filter = components === undefined ? `negate=negate_alpha=${alias}` : `negate=${components}:${alias}`;
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.png", "-vf", filter, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual([...decodeImage(vfs.store.get("/out.png")!).data],
          components === "r" ? [238, 58, 99, 140, 214, 187, 111, 127] :
          components === "r+g+b+a" ? [238, 197, 156, 115, 214, 68, 144, 128] :
          [238, 197, 156, 140, 214, 68, 144, 127]);
        assert.deepEqual(vfs.store.get("/in.png"), input);
      });
    }
  }
});

describe("negate RGBA components", () => {
  for (const [filter, expected] of [
    ["negate", [245, 215, 165, 64, 235, 205, 155, 192]],
    ["negate=negate_alpha=true", [245, 215, 165, 64, 235, 205, 155, 192]],
    ["negate=r:yes", [245, 40, 90, 64, 235, 50, 100, 192]],
    ["negate=components=r:negate_alpha=1", [245, 40, 90, 64, 235, 50, 100, 192]],
    ["negate=components=r:negate_alpha=0", [245, 40, 90, 64, 235, 50, 100, 192]],
    ["negate=components=r+a:negate_alpha=1", [245, 40, 90, 191, 235, 50, 100, 63]],
    ["negate=negate_alpha=off", [245, 215, 165, 64, 235, 205, 155, 192]],
    ["negate=components=r+a", [245, 40, 90, 191, 235, 50, 100, 63]],
    ["negate=components=a", [10, 40, 90, 191, 20, 50, 100, 63]],
    ["negate=components=8", [10, 40, 90, 191, 20, 50, 100, 63]],
    ["negate=components=9", [245, 40, 90, 191, 235, 50, 100, 63]],
    ["negate=components=g+b", [10, 215, 165, 64, 20, 205, 155, 192]],
    ["negate=r", [245, 40, 90, 64, 235, 50, 100, 192]],
    ["negate=0", [10, 40, 90, 64, 20, 50, 100, 192]]
  ] as const) {
    it(`honors ${filter}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({ width: 2, height: 1,
        data: new Uint8Array([10, 40, 90, 64, 20, 50, 100, 192]),
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.png", "-vf", filter, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...decodeImage(vfs.store.get("/out.png")!).data], expected);
      assert.deepEqual(vfs.store.get("/in.png"), input);
    });
  }
});

describe("xfade duration", () => {
  for (const [labels, expected] of [
    ["[0:v][1:v]", [254, 254, 254, 254, 254, 190, 127, 63, 0, 0, 0, 0]],
    ["[1:v][0:v]", [0, 0, 0, 0, 0, 63, 127, 190, 254, 254, 254, 254]]
  ] as const) {
    it(`binds xfade inputs in label order ${labels}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `${labels}xfade=duration=1:offset=1`, "/%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, expected.length);
      // Native FFmpeg's lavfi color conversion differs by at most one.
      for (const [index, red] of expected.entries()) {
        const frame = decodeImage(vfs.store.get(`/${index + 1}.png`)!);
        assert.ok(Math.abs(frame.data[0]! - red) <= 1,
          `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
      }
    });
  }
  for (const [offset, expected] of [
    [-0.5, [127, 63, 0, 0, 0, 0, 0, 0]],
    [-1, [0, 0, 0, 0, 0, 0, 0, 0]],
    [-2, [0, 0, 0, 0, 0, 0, 0, 0]]
  ] as const) {
    it(`preserves elapsed xfade progress at offset=${offset}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=duration=1:offset=${offset}`, "/%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, expected.length);
      for (const [index, red] of expected.entries()) {
        const frame = decodeImage(vfs.store.get(`/${index + 1}.png`)!);
        assert.ok(Math.abs(frame.data[0]! - red) <= 1,
          `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
      }
    });
  }
  for (const options of ["duration=-1:offset=0", "duration=bad:offset=0", "duration=1:offset=0:typo=1", "duration=61:offset=0", "fade:-1:0", "fade:1:0:extra"]) {
    it(`rejects invalid xfade options ${options} before writing frames`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=${options}`, "/%d.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(vfs.store.size, 0);
    });
  }
  for (const options of ["duration=0:offset=1", "fade:0:1", "transition=wipeleft:duration=0:offset=1"]) {
    it(`cuts immediately with ${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=${options}`, "/%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, 12);
      // Native FFmpeg emits four red frames followed by eight blue frames.
      for (let index = 0; index < 12; index++) {
        const frame = decodeImage(vfs.store.get(`/${index + 1}.png`)!);
        const red = index < 4 ? 254 : 0;
        assert.ok(Math.abs(frame.data[0]! - red) <= 1,
          `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
      }
    });
  }
  for (const [duration, offset] of [[1, 0], [0.5, 0], [0.5, 0.5]] as const) {
    it(`matches named options for positional fade:${duration}:${offset}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const outputs = [];
      for (const options of [`fade:${duration}:${offset}`, `transition=fade:duration=${duration}:offset=${offset}`]) {
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error",
          "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
          "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
          "-filter_complex", `[0:v][1:v]xfade=${options}`, "/%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        outputs.push(Array.from({ length: vfs.store.size }, (_, index) =>
          decodeImage(vfs.store.get(`/${index + 1}.png`)!).data));
      }
      assert.deepEqual(outputs[0], outputs[1]);
      assert.equal(outputs[0]!.length, 8 + offset * 4);
      if (duration === 1 && offset === 0) {
        for (const [index, red] of [254, 190, 127, 63, 0, 0, 0, 0].entries()) {
          assert.ok(Math.abs(outputs[0]![index]![0]! - red) <= 1);
        }
      }
    });
  }
  for (const duration of [undefined, "1", "0.5"]) {
    it(`matches native fade timing with duration=${duration ?? "default"}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=4:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=4:d=2",
        "-filter_complex", `[0:v][1:v]xfade=${duration === undefined ? "" : `duration=${duration}:`}offset=0`,
        "/%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, 8);
      // Native FFmpeg PNG red channels; lavfi color conversion differs by at most one.
      const expected = duration === "0.5"
        ? [254, 127, 0, 0, 0, 0, 0, 0]
        : [254, 190, 127, 63, 0, 0, 0, 0];
      for (const [index, red] of expected.entries()) {
        const frame = decodeImage(vfs.store.get(`/${index + 1}.png`)!);
        assert.ok(Math.abs(frame.data[0]! - red) <= 1,
          `frame ${index + 1}: expected red ${red}, got ${frame.data[0]}`);
      }
    });
  }
});

describe("stack input counts", () => {
  for (const axis of ["hstack", "vstack"]) {
    for (const count of [1, 0, -1, 2147483648]) {
      it(`${axis} rejects inputs=${count} before publishing frames`, async () => {
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error",
          "-f", "lavfi", "-i", "color=c=red:s=8x8:r=1:d=4",
          "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=1:d=2",
          "-filter_complex", `[0:v][1:v]${axis}=inputs=${count}`, "/out_%d.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes(`${axis}: inputs`), result.stderr);
        assert.equal(vfs.store.size, 0);
      });
    }
  }
});

describe("stack input labels", () => {
  for (const axis of ["hstack", "vstack"]) {
    for (const labels of ["[1:v][0:v]", "[1:v:0][0:v:0]", "[0:v][1:v]", ""]) {
      it(`${axis} respects ${labels || "implicit input order"}`, async () => {
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-f", "lavfi", "-i", "color=c=red:s=8x8:r=1:d=4",
          "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=1:d=2",
          "-filter_complex", `${labels}${axis}=inputs=2`, "/out_%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(vfs.store.size, 4);
        const colors = labels.startsWith("[1:")
          ? [[0, 0, 255], [255, 0, 0]] : [[255, 0, 0], [0, 0, 255]];
        for (let i = 1; i <= 4; i++) {
          const frame = decodeImage(vfs.store.get(`/out_${i}.png`)!);
          assert.equal(frame.width, axis === "hstack" ? 16 : 8);
          assert.equal(frame.height, axis === "vstack" ? 16 : 8);
          for (const [block, color] of colors.entries()) {
            const offset = block * 8 * (axis === "vstack" ? frame.width : 1) * 4;
            for (const [channel, expected] of color.entries()) {
              assert.ok(Math.abs(frame.data[offset + channel]! - expected) <= 3,
                `frame ${i}, block ${block}, channel ${channel}: expected ${expected}, got ${frame.data[offset + channel]}`);
            }
          }
        }
      });
    }
  }
  for (const labels of ["[2:v][0:v]", "[0:v:1][1:v]", "[a][0:v]", "[0:v][1:v][0:v]"]) {
    it(`rejects unavailable or invalid stack pads ${labels}`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=c=red:s=8x8:r=1:d=1",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=1:d=1",
        "-filter_complex", `${labels}hstack=inputs=2`, "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("hstack:"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
});

describe("multi-input stacks", () => {
  for (const axis of ["hstack", "vstack"]) {
    for (const shortest of [false, true]) {
      it(`${axis} renders all three inputs with shortest=${shortest}`, async () => {
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-f", "lavfi", "-i", "color=c=red:s=8x8:r=1:d=4",
          "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=1:d=2",
          "-f", "lavfi", "-i", "color=c=green:s=8x8:r=1:d=4",
          "-filter_complex", `[0:v][1:v][2:v]${axis}=inputs=3${shortest ? ":shortest=1" : ""}`,
          "/out_%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const count = shortest ? 2 : 4;
        assert.equal([...vfs.store.keys()].filter(path => path.startsWith("/out_")).length, count);
        for (let i = 1; i <= count; i++) {
          const frame = decodeImage(vfs.store.get(`/out_${i}.png`)!);
          assert.equal(frame.width, axis === "hstack" ? 24 : 8);
          assert.equal(frame.height, axis === "vstack" ? 24 : 8);
          for (const [block, expected] of [[255, 0, 0, 255], [0, 0, 255, 255], [0, 128, 0, 255]].entries()) {
            const offset = block * 8 * (axis === "vstack" ? frame.width : 1) * 4;
            // Allow YUV-to-RGB rounding in the lavfi color source.
            for (const [channel, value] of expected.entries()) {
              assert.ok(Math.abs(frame.data[offset + channel]! - value) <= 3);
            }
          }
        }
      });
    }
  }
});

describe("asendcmd", () => {
  for (const command of ["", "invalid volume@v volume 0.5", "0 volume@v unsupported 1", "0 [leave] volume@v volume 1"]) {
    it(`rejects unsupported schedule ${command} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af",
        `asendcmd=c='${command}',volume@v=1`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("asendcmd:"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
  for (const [prefix, transition] of [["", 2048], ["asetnsamples=300:p=0,", 2100]] as const) {
    it(`applies named volume commands on the first eligible frame with ${prefix || "input frames"}`, async () => {
      const samples = [ [0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000] ]
        .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => (i % 2 ? -amplitude! : amplitude!) / 32768));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }) });
      for (const [filter, path, gain] of [
        ["anull", "/control.wav", 1],
        [`${prefix}asendcmd=c='0.25 volume@v volume 0.25',volume@v=1,volume@other=0.5`, "/out.wav", 0.5]
      ] as const) {
        const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", path], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const actual = parseWav(vfs.store.get(path)!).tracks[0]!.decodedAudio!.channelData[0]!;
        assert.deepEqual(Array.from(actual, value => Math.round(value * 32768)),
          samples.map((value, i) => Math.round(value * 32768 * gain * (path === "/out.wav" && i >= transition ? 0.25 : 1)) || 0));
      }
    });
  }
  it("applies successive commands and respects sender timestamps", async () => {
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8).fill(400 / 32768)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af",
      "asetnsamples=2:p=0,asetpts=PTS+8000,asendcmd=commands='1.00025 volume@v volume 0.25;1.0005 volume@v volume 0.5',volume@v=1",
      "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768),
      [400, 400, 100, 100, 200, 200, 200, 200]);
  });
});

describe("bitplanenoise", () => {
  for (const [filter, limits, error] of [
    ["bitplanenoise=unknown=1", {}, "bitplanenoise: options"],
    ["bitplanenoise=bitplane=0", {}, "bitplanenoise:"]
  ] as const) {
    it(`preserves existing output when rejected: ${error}`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-f", "lavfi", "-i",
        "color=red:s=16x16:d=0.04", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(error), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  for (const plane of [1, 2, 0]) it(`renders native bit plane ${plane} pixels and measurements`, async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    for (let t = 0; t < 2; t++) {
      const data = new Uint8Array(32 * 24 * 4);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 32; x++) {
          data.set([(7 * x + 3 * y + 87 * t) % 256, (2 * x + 9 * y + 53 * t) % 256,
            (4 * x + 11 * y + 23 * t) % 256, 255], (y * 32 + x) * 4);
        }
      }
      vfs.store.set(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const result = await runCmd(createFfmpegCommand(), ["-framerate", "5", "-i", "/f%d.png", "-vf", plane === 0 ? "bitplanenoise,metadata=print" : `bitplanenoise=bitplane=${plane}:filter=1,metadata=print`, "/o%d.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const hashes = plane === 1 ? ["788f5791f53e331c9f2d694b7c0eb90e", "788f5791f53e331c9f2d694b7c0eb90e"] : ["e5ffafe004196cd5deeac81af41ffe88", "60526e63386aa83706157b648c95e27a"];
    if (plane !== 2) for (const [channel, value] of ["0.125000", "0.125000", "0.000000"].entries()) {
      assert.equal(result.stderr.split(`lavfi.bitplanenoise.${channel}.1=${value}`).length - 1, 2);
    }
    for (let i = 0; i < 2; i++) {
      const output = decodeImage(vfs.store.get(`/o${i + 1}.png`)!);
      assert.equal(output.width, 32);
      assert.equal(output.height, 24);
      const rgb = output.data.filter((_, index) => index % 4 !== 3);
      if (plane === 0) {
        for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
          assert.deepEqual([...output.data.subarray((y * 32 + x) * 4, (y * 32 + x + 1) * 4)],
            [(7 * x + 3 * y + 87 * i) % 256, (2 * x + 9 * y + 53 * i) % 256,
              (4 * x + 11 * y + 23 * i) % 256, 255]);
        }
      }
      else assert.equal(createHash("md5").update(rgb).digest("hex"), hashes[i]);
    }
    assert.equal(vfs.store.has("/o3.png"), false);
  });
});

describe("vectorscope", () => {
  for (const [filter, limits, error] of [
    ["vectorscope=unknown=1", {}, "vectorscope: options"],
    ["vectorscope", { maxPixelsPerFrame: 1024 }, "maxPixelsPerFrame"]
  ] as const) {
    it(`preserves existing output when rejected: ${error}`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-f", "lavfi", "-i",
        "color=red:s=16x16:d=0.04", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(error), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  it("accumulates repeated samples and saturates", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    for (const size of [2, 20]) {
      const data = new Uint8Array(size * size * 4);
      for (let pixel = 0; pixel < size * size; pixel++) data.set([20, 40, 60, 255], pixel * 4);
      const input = encodeImage({ width: size, height: size, data, format: "png", space: "srgb",
      channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in.png": input });
      const args = ["-i", "/in.png", "-vf", "vectorscope", "/out.png"];
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      const intensity = Math.min(255, size * size);
      assert.deepEqual([...output.data.slice((235 * 256 + 60) * 4, (235 * 256 + 60) * 4 + 4)],
        [intensity, intensity, intensity, 255]);
      assert.equal(output.data.filter((value, index) => index % 4 !== 3 && value !== 0).length, 3);
    }
  });
  it("renders each RGB frame with native FFmpeg vectorscope pixels", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    for (let t = 0; t < 2; t++) {
      const data = new Uint8Array(32 * 24 * 4);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 32; x++) {
          data.set([(7 * x + 3 * y + 87 * t) % 256, (2 * x + 9 * y + 53 * t) % 256,
            (4 * x + 11 * y + 23 * t) % 256, 255], (y * 32 + x) * 4);
        }
      }
      vfs.store.set(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const result = await runCmd(createFfmpegCommand(), ["-framerate", "5", "-i", "/f%d.png", "-vf", "vectorscope", "/o%d.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const hashes = ["3875098ffd42e8ea10052bba8c475b6c", "53198e29b5a6cf40768016bdb6354718"];
    for (let i = 0; i < 2; i++) {
      const output = decodeImage(vfs.store.get(`/o${i + 1}.png`)!);
      assert.equal(output.width, 256);
      assert.equal(output.height, 256);
      const rgb = output.data.filter((_, index) => index % 4 !== 3);
      assert.equal(createHash("md5").update(rgb).digest("hex"), hashes[i]);
    }
    assert.equal(vfs.store.has("/o3.png"), false);
  });
});

describe("histogram", () => {
  for (const [filter, limits, error] of [
    ["histogram=unknown=1", {}, "histogram: options"],
    ["histogram", { maxPixelsPerFrame: 1024 }, "maxPixelsPerFrame"]
  ] as const) {
    it(`preserves existing output when rejected: ${error}`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-f", "lavfi", "-i",
        "color=red:s=16x16:d=0.04", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(error), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  it("renders each RGB frame with native FFmpeg histogram pixels", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    for (let t = 0; t < 2; t++) {
      const data = new Uint8Array(32 * 24 * 4);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 32; x++) {
          data.set([(7 * x + 3 * y + 87 * t) % 256, (2 * x + 9 * y + 53 * t) % 256,
            (4 * x + 11 * y + 23 * t) % 256, 255], (y * 32 + x) * 4);
        }
      }
      vfs.store.set(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const result = await runCmd(createFfmpegCommand(), ["-framerate", "5", "-i", "/f%d.png", "-vf", "histogram", "/o%d.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const hashes = ["c52473e231355c29c81089f790dd4a6b", "d001c9e93e5a7b9969a4cd830a50dcec"];
    for (let i = 0; i < 2; i++) {
      const output = decodeImage(vfs.store.get(`/o${i + 1}.png`)!);
      assert.equal(output.width, 256);
      assert.equal(output.height, 636);
      const rgb = output.data.filter((_, index) => index % 4 !== 3);
      assert.equal(createHash("md5").update(rgb).digest("hex"), hashes[i]);
    }
    assert.equal(vfs.store.has("/o3.png"), false);
  });
});

describe("Targa output", () => {
  for (const sync of [false, true]) {
    for (const codec of [[], ["-c:v", "targa"]]) {
      for (const rle of [[], ["-rle", "0"], ["-rle", "1"]]) {
        for (const target of ["/out.tga", "/out%02d.tga"]) {
          it(`${sync ? "sync" : "async"} ${codec.join(" ")} ${rle.join(" ")} ${target}`, async () => {
            const { encodeImage } = await import("@poe-code/image-ast/portable");
            const colors = [[230, 10, 40, 255], [20, 190, 60, 127], [40, 70, 210, 0]];
            const rgba = Uint8Array.from(Array.from({ length: 36 }, (_, i) => colors[(Math.floor(i / 12) + Number(i % 12 > 8)) % 3]!).flat());
            const input = encodeImage({ width: 12, height: 3, data: rgba, format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
            const vfs = createTestVfs({ "/in.png": input });
            const args = ["-i", "/in.png", ...codec, ...rle, target];
            if (sync) {
              assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
                (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
            } else {
              const result = await runCmd(createFfmpegCommand(), args, vfs);
              assert.equal(result.exitCode, 0, result.stderr);
            }
            const bytes = vfs.store.get(target.includes("%") ? "/out01.tga" : target)!;
            assert.equal(bytes[2], rle[1] === "0" ? 2 : 10);
            assert.equal(bytes[16], 32);
            assert.equal(bytes[17], 40); // Top-left origin, eight alpha bits.
            assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(12, true), 12);
            assert.equal(new DataView(bytes.buffer, bytes.byteOffset).getUint16(14, true), 3);
            // Independently unpack B G R A packets, without the production decoder.
            const pixels: number[] = [];
            let offset = 18;
            while (pixels.length < rgba.length) {
              const packet = bytes[2] === 10 ? bytes[offset++]! : 0;
              const count = (packet & 127) + 1;
              for (let i = 0; i < count; i++) {
                pixels.push(bytes[offset + 2]!, bytes[offset + 1]!, bytes[offset]!, bytes[offset + 3]!);
                if (!(packet & 128)) offset += 4;
              }
              if (packet & 128) offset += 4;
            }
            assert.deepEqual(Uint8Array.from(pixels), rgba);
          });
        }
      }
    }
  }
});

describe("dcshift", () => {
  it("preserves the source PCM for a second output", async () => {
    const channels = [Float64Array.from([-0.25, 0, 0.25])];
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", "dcshift=0.125", "/shifted.wav", "-af", "anull", "/original.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from(parseWav(vfs.store.get("/original.wav")!).tracks[0]!.decodedAudio!.channelData[0]!), Array.from(channels[0]!));
  });
  for (const filter of ["dcshift=0.125", "dcshift=shift=0.125"]) {
    it(`matches native stereo PCM for ${filter}`, async () => {
      const channels = [
        Float64Array.from({ length: 2048 }, (_, i) => ((i * 67) % 14000 - 7000) / 32768),
        Float64Array.from({ length: 2048 }, (_, i) => (6000 - (i * 53) % 12000) / 32768)
      ];
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.sampleRate, 8000);
      // Native FFmpeg adds 4096 to every signed PCM16 sample in this fixture.
      assert.deepEqual(output.channelData.map(channel => Array.from(channel, value => value * 32768)),
        channels.map(channel => Array.from(channel, value => value * 32768 + 4096)));
    });
  }
  for (const shift of [-1, 0, 1]) {
    it(`clips shifted samples for shift=${shift}`, async () => {
      const samples = [-0.75, 0, 0.75];
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", `dcshift=${shift}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(output.channelData[0]!), samples.map(value => Math.max(-1, Math.min(32767 / 32768, value + shift))));
    });
  }
  for (const filter of ["dcshift=2", "dcshift=NaN", "dcshift=shift=", "dcshift=0.1:1.5", "dcshift=unknown=0.1"]) {
    it(`rejects ${filter} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /dcshift:/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("bounded infinite aloop", () => {
  for (const complex of [false, true]) {
    for (const [filter, options, left] of [
      ["aloop=-1:3:0", ["-t", "0.00125"], [101, 102, 103, 101, 102, 103, 101, 102, 103, 101]],
      ["aloop=-1:3:0", ["-frames:a", "2"], [101, 102, 103, 101, 102, 103]],
      ["aloop=-1:3:0,atrim=end_sample=10", [], [101, 102, 103, 101, 102, 103, 101, 102, 103, 101]],
      ["aloop=2:3:0", ["-t", "0.00125"], [101, 102, 103, 101, 102, 103, 101, 102, 103, 104]],
    ] as const) {
      it(`matches oracle PCM for ${filter} ${options.join(" ")}, complex=${complex}`, async () => {
        const raw = new Uint8Array(32);
        const view = new DataView(raw.buffer);
        for (let i = 0; i < 8; i++) {
          view.setInt16(i * 4, 101 + i, true);
          view.setInt16(i * 4 + 2, -901 - i, true);
        }
        const vfs = createTestVfs({ "/in.raw": raw, "/out.raw": "KEEP" });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          ...options, "-f", "s16le", "/out.raw"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const expected = new Uint8Array(left.length * 4);
        const expectedView = new DataView(expected.buffer);
        left.forEach((sample, i) => {
          expectedView.setInt16(i * 4, sample, true);
          expectedView.setInt16(i * 4 + 2, -800 - sample, true);
        });
        assert.deepEqual(vfs.store.get("/out.raw"), expected);
      });
    }
    for (const filter of ["aloop=-2:3:0", "aloop=-1:-3:0", "aloop=-1:3:0"]) {
      it(`preserves existing output for ${filter}, complex=${complex}`, async () => {
        const vfs = createTestVfs({ "/in.raw": new Uint8Array(32), "/out.raw": "KEEP" });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /aloop:/);
        assert.equal(new TextDecoder().decode(vfs.store.get("/out.raw")), "KEEP");
      });
    }
  }
});

describe("aloop", () => {
  for (const complex of [false, true]) {
    for (const [filter, expected] of [
      ["aloop=loop=2:size=3:start=-1:time=375us", [101, 102, 103, 104, 105, 106, 104, 105, 106, 104, 105, 106, 107, 108]],
      ["aloop=2:3:-1:375us", [101, 102, 103, 104, 105, 106, 104, 105, 106, 104, 105, 106, 107, 108]],
      ["aloop=2:3:-1:64ms", [101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=loop=2:size=3:start=-1", [101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=loop=2:size=3:start=0:time=0", [101, 102, 103, 101, 102, 103, 101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=2:3:0", [101, 102, 103, 101, 102, 103, 101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=2:3:-2", null],
      ["aloop=2:3:-1:invalid", null],
      ["aloop=2:3:0:-1us", null],
      ["aloop=2:3:-1:", null],
    ] as const) {
      it(`matches native PCM for ${filter} (complex=${complex})`, async () => {
        const input = new Uint8Array(8 * 4);
        const view = new DataView(input.buffer);
        for (let i = 0; i < 8; i++) {
          view.setInt16(i * 4, 101 + i, true);
          view.setInt16(i * 4 + 2, -901 - i, true);
        }
        const vfs = createTestVfs({ "/in.raw": input, "/out.raw": "KEEP" });
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw",
        ], vfs);
        if (expected === null) {
          assert.notEqual(result.exitCode, 0);
          assert.match(result.stderr, /aloop:/);
          assert.equal(new TextDecoder().decode(vfs.store.get("/out.raw")), "KEEP");
        } else {
          assert.equal(result.exitCode, 0, result.stderr);
          const bytes = new Uint8Array(expected.length * 4);
          const output = new DataView(bytes.buffer);
          expected.forEach((left, i) => {
            output.setInt16(i * 4, left, true);
            output.setInt16(i * 4 + 2, -800 - left, true);
          });
          assert.deepEqual(vfs.store.get("/out.raw"), bytes);
        }
      });
    }
  }
  it("groups input and replay into 1024 samples before resuming incoming frames", async () => {
    const channels = [1, -1].map(sign => Float64Array.from({ length: 2300 }, (_, i) => sign * (i + 1) / 32768));
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af",
      "asetnsamples=512:0,aloop=2:1100:0,volume='if(eq(n,4),0,1)':eval=frame", "-frames:a", "8", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData;
    // Native FFmpeg 7.0.2 frames: 1024, 76, 1024, 76, 1024, 76, 436, 512, 252.
    for (let c = 0; c < channels.length; c++) {
      const input = Array.from(channels[c]!);
      const expected = [...input.slice(0, 1100), ...input.slice(0, 1100), ...input].slice(0, 4248);
      expected.fill(0, 2200, 3224);
      assert.deepEqual(Array.from(output[c]!), expected);
    }
  });
  for (const complex of [false, true]) {
    for (const [filter, frames, left] of [
      ["aloop=2:3:0,volume='if(eq(n,1),0,1)':eval=frame", undefined, [101, 102, 103, 0, 0, 0, 101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=2:3:0,volume='if(eq(t,0.000375),0,1)':eval=frame", undefined, [101, 102, 103, 0, 0, 0, 101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=2:3:0", 1, [101, 102, 103]],
      ["aloop=2:3:0", 2, [101, 102, 103, 101, 102, 103]],
      ["aloop=0:3:0", 1, [101, 102, 103]],
      ["anull", 1, [101, 102, 103, 104, 105, 106, 107, 108]],
      ["aloop=2:3:0", undefined, [101, 102, 103, 101, 102, 103, 101, 102, 103, 104, 105, 106, 107, 108]],
    ] as const) {
      it(`matches FFmpeg 7 loop frames for ${filter}, frames=${frames}, complex=${complex}`, async () => {
        const raw = new Uint8Array(32);
        const view = new DataView(raw.buffer);
        for (let i = 0; i < 8; i++) {
          view.setInt16(i * 4, 101 + i, true);
          view.setInt16(i * 4 + 2, -901 - i, true);
        }
        const vfs = createTestVfs({ "/in.raw": raw, "/out.raw": "KEEP" });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          ...(frames === undefined ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "/out.raw"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const expected = new Uint8Array(left.length * 4);
        const expectedView = new DataView(expected.buffer);
        left.forEach((sample, i) => {
          expectedView.setInt16(i * 4, sample, true);
          expectedView.setInt16(i * 4 + 2, sample === 0 ? 0 : -800 - sample, true);
        });
        assert.deepEqual(vfs.store.get("/out.raw"), expected);
      });
    }
    it(`preserves the destination on invalid loop input, complex=${complex}`, async () => {
      const vfs = createTestVfs({ "/in.raw": new Uint8Array(32), "/out.raw": "KEEP" });
      const filter = "aloop=2:-3:0";
      const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /aloop:/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.raw")), "KEEP");
    });
  }
  for (const [filter, repeats, size] of [
    ["aloop=loop=2:size=8:start=0", 2, 8],
    ["aloop=2:8:0", 2, 8],
    ["aloop=1.5:8", 2, 8],
    ["aloop=loop=0:size=8:start=10", 0, 8],
    ["aloop", 0, 0],
    ["aloop=2:0", 0, 0],
    ["aloop=2:3000", 2, 2300],
  ] as const) {
    it(`preserves stereo sample order and length for ${filter}`, async () => {
      const channels = [1, -1].map(sign => Float64Array.from({ length: 2300 }, (_, i) => sign * i / 32768));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData;
      for (let c = 0; c < channels.length; c++) {
        const input = Array.from(channels[c]!, value => value || 0);
        const expected = [...Array.from({ length: repeats }, () => input.slice(0, size)).flat(), ...input];
        assert.deepEqual(Array.from(output[c]!), expected);
      }
    });
  }
  for (const filter of ["aloop=-1:8", "aloop=2:-8", "aloop=2:8:-2", "aloop=loop=", "aloop=wat=1"]) {
    it(`rejects unsupported or invalid ${filter} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /aloop:/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
  for (const limits of [{ maxDurationSeconds: 1 }, { maxMemoryBytes: 65536 }]) for (const start of [0, 3]) {
    it(`bounds repeated output with ${JSON.stringify(limits)} and start=${start}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-i", "/in.wav", "-af", `aloop=100000:8:${start}`, "/out.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.doesNotMatch(result.stderr, /Unsupported audio filter/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("aselect", () => {
  for (const [filter, ranges] of [
    ["aselect='not(mod(n,2))'", [[0, 512], [1024, 1536], [2048, 2300]]],
    ["aselect='eq(n,1)'", [[512, 1024]]],
    ["aselect=expr='eq(n,4)'", [[2048, 2300]]],
    ["aselect", [[0, 2300]]],
    ["aselect=0", []],
    ["aselect='not(mod(n,2))',aselect='eq(n,1)'", [[1024, 1536]]],
  ] as const) {
    it(`selects decoded stereo frames with ${filter}`, async () => {
      const channels = [1, -1].map(sign => Float64Array.from({ length: 2300 }, (_, i) => (sign * i / 32768) || 0));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(output.map(channel => Array.from(channel)),
        channels.map(channel => ranges.flatMap(([start, end]) => Array.from(channel.slice(start, end)))));
    });
  }
  it("rejects invalid expressions without replacing output", async () => {
    const vfs = createTestVfs({
      "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(600)] }),
      "/out.wav": "keep"
    });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", "aselect=unknown(n)", "/out.wav"], vfs);
    assert.equal(result.exitCode, 1);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
  });
});

describe("asetnsamples", () => {
  for (const [filter, count, size] of [
    ["asetnsamples=n=300:p=1", 2400, 300],
    ["asetnsamples=n=512:p=1", 2560, 512],
    ["asetnsamples=n=512:p=0", 2300, 512],
    ["asetnsamples=nb_out_samples=300:pad=false", 2300, 300],
    ["asetnsamples", 3072, 1024],
    ["asetnsamples=300:0", 2300, 300]
  ] as const) {
    it(`preserves PCM and reports frame boundaries for ${filter}`, async () => {
      const channels = [1, -1].map(sign => Float64Array.from({ length: 2300 }, (_, i) => (sign * i / 32768) || 0));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", `${filter},ashowinfo`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(output.map(channel => Array.from(channel)), channels.map(channel => [...channel, ...new Array<number>(count - 2300).fill(0)]));
      const lines = result.stderr.trim().split("\n");
      assert.equal(lines.length, Math.ceil(count / size));
      for (const [n, line] of lines.entries()) {
        assert.ok(line.includes(`n:${n} pts:${n * size} `), line);
        assert.ok(line.includes(`nb_samples:${Math.min(size, count - n * size)} `), line);
      }
    });
  }
  for (const [filter, args, expected] of [
    ["asetnsamples=n=32:p=0", ["-frames:a", "1"], Array.from({ length: 32 }, (_, i) => i)],
    ["asetnsamples=n=1:p=0,aselect='mod(n,2)'", [], Array.from({ length: 1150 }, (_, i) => i * 2 + 1)],
    ["asetnsamples=n=1:p=0,aselect='not(mod(n,2))'", [], Array.from({ length: 1150 }, (_, i) => i * 2)]
  ] as const) {
    it(`exposes new frame boundaries to ${filter} ${args.join(" ")}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 2300 }, (_, i) => i / 32768)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, ...args, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(Array.from(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!, value => Math.round(value * 32768)), expected);
    });
  }
  for (const [filter, frames] of [
    ["asetpts=PTS+8000,asetnsamples=300:0,ashowinfo", [[8000, 300], [8300, 300], [8600, 100]]],
    ["asetnsamples=300:0,asetpts=PTS+8000,ashowinfo", [[8000, 300], [8300, 300], [8600, 100]]],
    ["asetnsamples=300:0,asetnsamples=512:1,ashowinfo", [[0, 512], [512, 512]]]
  ] as const) {
    it(`preserves timestamps through ${filter}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(700)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const lines = result.stderr.trim().split("\n");
      assert.equal(lines.length, frames.length);
      for (const [n, [pts, size]] of frames.entries()) {
        assert.ok(lines[n]!.includes(`n:${n} pts:${pts} `), lines[n]);
        assert.ok(lines[n]!.includes(`nb_samples:${size} `), lines[n]);
      }
    });
  }
  it("uses resized frames in volume expressions", async () => {
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(6).fill(1 / 32768)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", "asetnsamples=2:0,volume=n:eval=frame", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(Array.from(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!, value => value * 32768), [0, 0, 1, 1, 2, 2]);
  });
  for (const [option, exitCode] of [
    ["n=0", 222], ["n=-1", 222], ["n=0.9", 222], ["n=2147483647.1", 222], ["n=2147483648", 222],
    ["n=1/0", 234], ["n=0/0", 234], ["n=2*", 234], ["n=", 234], ["p=maybe", 234], ["unknown=1", 1]
  ] as const) {
    it(`rejects ${option} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(4)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `asetnsamples=${option}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, exitCode);
      assert.ok(result.stderr.includes("asetnsamples"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("ashowinfo", () => {
  it("reports timestamps produced by an earlier asetpts filter", async () => {
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(600)] }) });
    const result = await runCmd(createFfmpegCommand(),
      ["-i", "/in.wav", "-af", "asetpts=PTS+8000,ashowinfo", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stderr.includes("n:0 pts:8000 pts_time:1 pos:"), result.stderr);
    assert.ok(result.stderr.includes("n:1 pts:8512 pts_time:1.064 pos:"), result.stderr);
    assert.ok(result.stderr.includes("fmt:s16 channels:1 chlayout:mono rate:8000 nb_samples:512 checksum:00000000"), result.stderr);
  });
  for (const level of ["info", "warning", "quiet", "32"]) {
    it(`reports PCM frames at ${level} without changing samples`, async () => {
      const channels = [1, -1].map(sign => Float64Array.from({ length: 2300 }, (_, i) => (sign * i / 32768) || 0));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const result = await runCmd(createFfmpegCommand(),
        ["-hide_banner", "-loglevel", level, "-y", "-i", "/in.wav", "-af", "ashowinfo", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(output.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
      const lines = result.stderr.trim().split("\n");
      if (level === "warning" || level === "quiet") {
        assert.equal(result.stderr, "");
      } else {
        assert.equal(lines.length, 5);
        const checksums = ["0365FB2F", "08DDFC2F", "10DDFC2F", "18DDFC2F", "AB63F614"];
        for (const [n, checksum] of checksums.entries()) {
          assert.ok(lines[n]!.includes(`n:${n} pts:${n * 512} pts_time:${n * 512 / 8000} pos:`), lines[n]);
          assert.ok(lines[n]!.includes(`fmt:s16 channels:2 chlayout:stereo rate:8000 nb_samples:${n === 4 ? 252 : 512} checksum:${checksum} plane_checksums: [ ${checksum} ]`), lines[n]);
        }
      }
    });
  }
});

describe("input -sseof", () => {
  for (const sync of [false, true]) {
    for (const [seek, start, count] of [
      [[], 0, 16000], [["-sseof", "-0.125"], 15000, 1000],
      [["-sseof", "-00:00:00.125"], 15000, 1000], [["-sseof", "-3"], 0, 16000],
      [["-ss", "1", "-sseof", "-0.125"], 8000, 8000],
      [["-sseof", "-0.125", "-ss", "1"], 8000, 8000],
      [["-sseof", "-0.125", "-t", "0.05"], 15000, 400]
    ] as const) {
      it(`${sync ? "sync" : "async"} preserves every PCM sample for ${seek.join(" ")}`, async () => {
        const input = encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 16000 }, (_, index) => index / 32768)] });
        const vfs = createTestVfs({ "/in.wav": input });
        const args = [...seek, "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const samples = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
        assert.deepEqual(Array.from(samples, value => Math.round(value * 32768)),
          Array.from({ length: count }, (_, index) => start + index));
      });
    }
    for (const [offset, start] of [["-2.6", 5], ["-5", 0]] as const) {
      it(`${sync ? "sync" : "async"} copies video packets for ${offset}`, async () => {
        // FFmpeg: testsrc2=s=16x16:r=5:d=4, libx264 -g 5 -bf 0 -sc_threshold 0.
        const input = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACA1tZGF0AAACbAYF//9o3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MiBrZXlpbnQ9NSBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTUgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAyWWIhF/UX7NAlB6DzE0vP473I5OWavVQJvghQBgZ5GQBPXCGU/hKqWHympT9ZWALAM5b4KxSlKfX65IhFMBQQ7lWuN96+EM1H6YkXoV7oeiKVS6AH2lUneeLmCOrfvKoY5jVLqrW1WpO/J6F40qD+xZfPy7t3p6fLaUxXF9T0/ZMzuxSlcGOTNUca8ilLcxQZRHXicfJznhcNFpIeM9CsVAGK4AH22hUqjYEpXDK4p43dh+72sjUhdb1hzCeC2RN9PAq+NLVuiQIbwAAAAdBmjsV/5eAAAAACkGaTwhkymFfl4EAAABRQZpyeEPJlMCvrFpdA1jz5vCzKJJIIS9qaRmGwfwemsranzsSggCpShYgMW9G0HaaFT7Jjfoq3J3oZvBn+HdV1HuqTq3TaMQ9pbZ4CL9J8YHwAAAASUGaknhDyZTAr+mRo/Hz3xfgLAPOnZWR0Q/nGkRlTDulj/koQdJsO8AGFclidh4S8IC2K5o7Jz7WADqVTYsuJrXfsFZtxZ/OpucAAADvZYiCC/9jXPLvXrsC6FvLpDsYI8od9Si+q3/5ZGSYi8AbsYNtZ8npdY5rJB1fv1W+UARS2c+sZ/UNElLtH4u+VyNlhsyjfBjVSuq/XwLd+yA5fhMCAYZAX7aibLBvhSOD9CkNpVamuqq3oGbvoZ88m8NwdXVEK7wgiGyMPFui6u5+Xy6qsWG7RXb4HvwTu6pqfdj4LBcy04DR7ThC9ECbXNi8eFLCai+vgCOHfa6nCzB0xrc6cGNwTlKHy1ATULJbkO2NS0AfomqV9+kGl5aqkoLJc8pnPXtHR/XyMAwfaAxORNRlt8yyoYUa+a6S0H0AAAAvQZo7Ff+1AkjMJLr1F1LWIKVE8RAuocTKFImqvb8qVUg1+7llMWcNV4js6y2MJHcAAAAKQZpPCGTKYV+XgQAAAAtBmnJ4Q8mUwK+XgAAAADhBmpJ4Q8mUwK+sXLMAOBcTuxTAA/POpsDoybLT9m2vmaOijwsiWl4/wMHfzx1//0q+DtRlLQ5XwAAAAO1liIQvY1zy7167Auhby6Q7GCPKHajuTvC9s8zOovgN1o0rMtBzbMPmfUEKqEiB+xPHkjMZGZ7hHeJPXXCzOeQQbF8b285gCjEfJmmFJC/2SggSh0c2nCVDxcaboG/hZ6T66xxFMN38aRKN7+NEBdGLAq3yHRQODl8Fyfd9kMvW07jMO19C1l872AnJzCCDyPZ27HsdEPisNIjTQyklEeFN2ATsvSdQYKEj9dBIP9leZpV6U146avQYEuKPtDo8EWxwa5vheeLxJu4cJWqd94EKEoyj8G4Vozk76mgEKR1JiUcXjdbF/o4EzoYzR50AAAAHQZo7Ff+XgAAAAApBmk8IZMphX5eAAAAAKkGacnhDyZTAr6seX4xk7MW8O0pv3sJcaIsy6VzSQpWfD5WhluZnCnSzYQAAAAxBmpJ4Q8mUwK+/GXkAAADuZYiCC/9jNKEgJgmqSWzjZYdjBHlDtR3J3he2eZnT4PaC1UpjiaRRmb59bkuiKIH/v3whE6kCmw4wxXLTi2Ky46ocjP6d1T8PGXnBJEQYWnN4lBXJFA9aglK80nG303Ox1LKqBczIIRLTTUF638fEFY6S+793hERWGa4ZvUSWZdoyvlCaqVhetF871FtcLaCDyOHy3x3dhCdLmCMuS4xxIwzyQUh29RchKb6CcIZy3p82uUyigqCWh+epXwB+wCTDtWQp44ZOGZ70CT3bJxsc3lp+O3pZhjDmnJ6dgBV9S9DG0bN264h4D/bvQN/WZwAAAAdBmjsSf5yAAAAACkGaTwhkymE3poAAAAAnQZpyeEPJlMCb/7mvQ7ayJk2ZyzApSRQfVqtqiMPtpNKPrc6ypZpPAAAADEGaknhDyZTAiv+zgAAAA4Rtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAPoAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACr3RyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAPoAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAEAAAABAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAD6AAAAAAAAEAAAAAAidtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAACgAAACgAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAHSbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABknN0YmwAAAC+c3RzZAAAAAAAAAABAAAArmF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAEAAQAEgAAABIAAAAAAAAAAEUTGF2YzYzLjEuMTAxIGxpYngyNjQAAAAAAAAAAAAAAAAY//8AAAA0YXZjQwFkAAr/4QAXZ2QACqyyPYCIAAADAAgAAAMAUHiRMkABAAZo68PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAEAoAAAAAAAAAGHN0dHMAAAAAAAAAAQAAABQAAAgAAAAAIHN0c3MAAAAAAAAABAAAAAEAAAAGAAAACwAAABAAAAAcc3RzYwAAAAAAAAABAAAAAQAAABQAAAABAAAAZHN0c3oAAAAAAAAAAAAAABQAAAM9AAAACwAAAA4AAABVAAAATQAAAPMAAAAzAAAADgAAAA8AAAA8AAAA8QAAAAsAAAAOAAAALgAAABAAAADyAAAACwAAAA4AAAArAAAAEAAAABRzdGNvAAAAAAAAAAEAAAAwAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMQ==", "base64");
        const vfs = createTestVfs({ "/in.mp4": input });
        const args = ["-sseof", offset, "-i", "/in.mp4", "-c:v", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!.samples.map(sample => sample.data),
          parseMp4(input).tracks[0]!.samples.slice(start).map(sample => new Uint8Array(sample.data)));
      });
    }
  }
  it("resets end-relative seeking for the next input", async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16000)] });
    const vfs = createTestVfs({ "/in.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-sseof", "-0.125", "-i", "/in.wav",
      "-i", "/in.wav", "-map", "1:a", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!.length, 16000);
  });
  for (const args of [["-sseof"], ["-i", "/in.wav", "-sseof", "-1", "/out.wav"]]) {
    it(`rejects missing value or output placement: ${args.join(" ")}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, args.length === 1 ? 1 : 234);
      assert.ok(result.stderr.includes("-sseof"), result.stderr);
      assert.equal(vfs.store.size, 0);
    });
  }
  for (const value of ["0", "1", "nope", "-1junk", "-Infinity", ""]) {
    it(`rejects ${value} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.wav": "keep" });
      const args = ["-y", "-sseof", value, "-i", "/in.wav", "/out.wav"];
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 234);
      assert.ok(result.stderr.includes("-sseof"), result.stderr);
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => { assert.fail("unexpected write"); }), undefined);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("adelay", () => {
  const left = [1000, 2000, 3000, 4000];
  const right = [-4000, -3000, -2000, -1000];
  for (const [argument, delays] of [
    ["0S|1S", [0, 1]], ["1S:all=1", [1, 1]],
    ["1S", [1, 0]], ["delays=2S|1S:all=0", [2, 1]],
    ["0.125|0.25", [1, 2]], ["0.000125s|0S", [0, 0]], ["1s|0S", [8000, 0]],
    ["0S|0S|100S", [0, 0]], ["0S|1S,volume=0.5", [0, 1]]
  ] as const) {
    it(`preserves samples and pads each channel for ${argument}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
        channels: [left, right].map(channel => Float64Array.from(channel, value => value / 32768)) }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", `adelay=${argument}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      for (const [channel, samples] of [left, right].entries()) {
        const expected = new Array<number>(4 + Math.max(...delays)).fill(0);
        samples.forEach((value, index) => { expected[index + delays[channel]!] = value * (argument.includes("volume") ? 0.5 : 1); });
        assert.deepEqual(Array.from(audio.channelData[channel]!, value => Math.round(value * 32768)), expected);
      }
    });
  }
  for (const argument of ["-1S", "NaNS", "Infinity", "1S:all=bogus", "1S:unknown=1"]) {
    it(`rejects ${argument} without replacing output`, async () => {
      const original = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(4)] }), "/out.wav": original });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `adelay=${argument}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(vfs.store.get("/out.wav"), original);
    });
  }
  for (const limits of [{ maxDurationSeconds: 1 }, { maxMemoryBytes: 65536 }]) {
    it(`bounds delay allocation with ${JSON.stringify(limits)}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(4)] }) });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-i", "/in.wav", "-af", "adelay=80000S", "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("exceeds") || result.stderr.includes("limit"), result.stderr);
      assert.equal(vfs.store.has("/out.wav"), false);
    });
  }
});

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} stream copy preserves VP9 alpha and default duration`, async () => {
    // Native FFmpeg: color=red@0.25:s=16x16:r=2:d=1,format=yuva420p,
    // -c:v libvpx-vp9 -threads 1. Decoded alpha: 63 (approximately 25% opacity).
    const input = new Uint8Array(readFileSync(new URL("../../mp4-ast/src/fixtures/vp9-alpha.webm", import.meta.url)));
    const vfs = createTestVfs({ "/in.webm": input });
    const args = ["-i", "/in.webm", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.webm"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
    } else {
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const source = parseMkv(input).tracks[0]!;
    const copied = parseMkv(vfs.store.get("/out.webm")!).tracks[0]!;
    assert.equal(copied.defaultDurationNs, 500_000_000);
    assert.deepEqual(copied.samples.map(sample => sample.pts), [0, 500]);
    assert.deepEqual(copied.samples.map(sample => sample.duration), [500, 500]);
    assert.equal(copied.codecDescriptions[0]!.alphaMode, 1);
    assert.equal(source.samples.length, 2);
    for (const [index, sample] of source.samples.entries()) {
      assert.ok(sample.blockAdditions?.byteLength);
      assert.deepEqual(copied.samples[index]!.blockAdditions, sample.blockAdditions);
      assert.deepEqual(copied.samples[index]!.data, sample.data);
    }
  });

  for (const layout of ["mono", "surround"]) {
    it(`${sync ? "sync" : "async"} stream copy preserves ${layout} Opus discard padding`, async () => {
      const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/opus-padding-${layout}.webm`, import.meta.url));
      const vfs = createTestVfs({ "/in.webm": input });
      const args = ["-i", "/in.webm", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.webm"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const audio = parseMkv(vfs.store.get("/out.webm")!).tracks.find(track => track.type === "audio")!;
      assert.equal(audio.samples.at(-1)!.discardPaddingNs, 13_500_000);
      assert.deepEqual(audio.samples.map(sample => Buffer.from(sample.data)),
        parseMkv(input).tracks.find(track => track.type === "audio")!.samples.map(sample => Buffer.from(sample.data)));
    });
  }

  it(`${sync ? "sync" : "async"} stream copy preserves H.264 B-frame decode order`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mkv", import.meta.url));
    const vfs = createTestVfs({ "/meeting.mkv": input });
    const args = ["-i", "/meeting.mkv", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.mkv"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
    } else {
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const packets = (bytes: Uint8Array) => parseMkv(bytes).tracks[0]!.samples.map(sample => ({
      pts: sample.pts, data: Buffer.from(sample.data)
    }));
    assert.deepEqual(packets(vfs.store.get("/out.mkv")!), packets(input));
  });

  it(`${sync ? "sync" : "async"} copies the Matroska title without an overriding uppercase tag`, async () => {
    const input = serializeMkv(parseMp4(createSyntheticMp4({
      frameCount: 1,
      metadata: { title: "Meeting", comment: "recorder" }
    })));
    const vfs = createTestVfs({ "/meeting.mkv": input });
    const args = ["-i", "/meeting.mkv", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "/out.mkv"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
    } else {
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    const output = vfs.store.get("/out.mkv")!;
    assert.equal(parseMkv(output).metadata.title, "Meeting");
    assert.equal(parseMkv(output).metadata.comment, "recorder");
    // A TITLE SimpleTag replaces the segment's lowercase title key in native ffprobe.
    assert.equal(Buffer.from(output).includes(Buffer.from([0x45, 0xa3, 0x85, ...Buffer.from("TITLE")])), false);
  });
}

for (const sync of [false, true]) {
  for (const map of sync ? [undefined] : [undefined, "0:a:0", "0:a:1", "0:a"]) {
    it(`${sync ? "sync" : "async"} selects the default Matroska speaker with map=${map}`, async () => {
      const fixture = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
      const input = serializeMkv({ ...fixture, tracks: fixture.tracks.map((track, index) => ({
        ...track, language: index === 0 ? "eng" : "fra"
      })) });
      const source = parseMkv(input).tracks;
      const audio = source.filter(track => track.type === "audio");
      assert.deepEqual(audio.map(track => track.disposition?.default), [0, 1]);
      const vfs = createTestVfs({ "/meeting.mkv": input });
      const args = ["-i", "/meeting.mkv", ...(map ? ["-map", map] : []), "-c", "copy", "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const expected = map === "0:a" ? audio : map === "0:a:0" ? [audio[0]!] : [audio[1]!];
      if (!map) expected.push(...source.filter(track => track.type === "subtitle"));
      const actual = parseMkv(vfs.store.get("/out.mkv")!).tracks;
      assert.deepEqual(actual.map(track => [track.type, track.language]),
        expected.map(track => [track.type, track.language]));
      assert.deepEqual(actual.map(track => track.samples.map(sample => Buffer.from(sample.data))),
        expected.map(track => track.samples.map(sample => Buffer.from(sample.data))));
    });
  }
}

for (const sync of [false, true]) {
  for (const disabled of [false, true]) {
    for (const override of [false, true]) {
      it(`${sync ? "sync" : "async"} copies Matroska languages with metadata disabled=${disabled}, override=${override}`, async () => {
        const fixture = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
        const input = serializeMkv({ ...fixture, tracks: fixture.tracks.filter(track => track.type === "audio").map((track, index) => ({
          ...track, language: index === 0 ? "eng" : "fra"
        })) });
        const vfs = createTestVfs({ "/meeting.mkv": input });
        const args = ["-i", "/meeting.mkv", ...(sync ? [] : ["-map", "0:a"]),
          ...(disabled ? ["-map_metadata", "-1"] : []), "-map_chapters", "-1", "-c", "copy",
          ...(override ? ["-metadata:s:a:0", "language=deu"] : []), "/out.mkv"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const source = parseMkv(input).tracks;
        const selected = sync ? source.filter(track => track.disposition?.default) : source;
        const output = parseMkv(vfs.store.get("/out.mkv")!).tracks;
        assert.deepEqual(output.map(track => track.language), selected.map((track, index) =>
          override && index === 0 ? "deu" : disabled ? "und" : track.language));
        assert.deepEqual(output.map(track => track.samples.map(sample => Buffer.from(sample.data))),
          selected.map(track => track.samples.map(sample => Buffer.from(sample.data))));
      });
    }
  }
}

it("keeps speaker titles with their audio tracks when stream-copy maps reorder them", async () => {
  const source = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
  const tracks = source.tracks.filter(track => track.type === "audio").map((track, index) => ({
    ...track, language: index === 0 ? "eng" : "fra", metadata: { title: index === 0 ? "Alice" : "Bob" }
  }));
  const input = serializeMkv({ ...source, tracks });
  for (const order of [[0, 1], [1, 0]]) {
    const vfs = createTestVfs({ "/meeting.mkv": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/meeting.mkv",
      ...order.flatMap(index => ["-map", `0:a:${index}`]), "-c", "copy", "/out.mkv"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseMkv(vfs.store.get("/out.mkv")!).tracks.map(track =>
      [track.metadata?.title, track.language]), order.map(index =>
      [tracks[index]!.metadata.title, tracks[index]!.language]));
  }
});

it("copies Matroska PCM audio without changing its codec or packets", async () => {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url));
  const original = parseMkv(input).tracks.filter(track => track.type === "audio");
  for (const map of ["0:a", "0"]) {
    const vfs = createTestVfs({ "/input.mkv": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mkv", "-map", map, "-c", "copy", "/out.mkv"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const copied = parseMkv(vfs.store.get("/out.mkv")!).tracks.filter(track => track.type === "audio");
    assert.equal(copied.length, 2);
    for (const [index, track] of copied.entries()) {
      assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s16le");
      for (const key of ["sampleRate", "channels", "bitsPerSample"] as const) {
        assert.equal(track.codecDescriptions[0]![key], original[index]!.codecDescriptions[0]![key]);
      }
      assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)),
        original[index]!.samples.map(sample => Buffer.from(sample.data)));
    }
  }
});

describe("-abort_on flag combinations and masks", () => {
  for (const [flag, mask] of [["0", 0], ["1", 1], ["2", 2], ["3", 3],
    ["empty_output", 1], ["empty_output+empty_output_stream", 3],
    ["empty_output_stream+empty_output", 3]] as const) {
    for (const maps of [[0], [1], [0, 1]]) {
      it(`${flag} with mapped inputs ${maps}`, async () => {
        const vfs = createTestVfs({
          "/full.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] }),
          "/empty.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(0)] })
        });
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-abort_on", flag,
          "-i", "/full.wav", "-i", "/empty.wav",
          ...maps.flatMap(index => ["-map", `${index}:a`]), "-f", "null", "-"
        ], vfs);
        const emptyStream = (mask & 2) !== 0 && maps.includes(1);
        const emptyOutput = (mask & 1) !== 0 && !maps.includes(0);
        assert.equal(result.exitCode, emptyStream || emptyOutput ? 234 : 0, result.stderr);
        if (emptyStream) assert.ok(result.stderr.includes(`output stream 0:${maps.indexOf(1)}`), result.stderr);
        if (!emptyStream && !emptyOutput) assert.equal(result.stderr, "");
      });
    }
  }
});

describe("-abort_on empty_output_stream", () => {
  for (const maps of [[0], [0, 1], [1, 0], [0, 0]]) {
    it(`checks mapped streams: ${maps}`, async () => {
      const vfs = createTestVfs({
        "/full.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] }),
        "/empty.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(0)] })
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-abort_on", "empty_output_stream",
        "-i", "/full.wav", "-i", "/empty.wav",
        ...maps.flatMap(index => ["-map", `${index}:a`]), "-f", "null", "-"
      ], vfs);
      assert.equal(result.exitCode, maps.includes(1) ? 234 : 0, result.stderr);
      if (maps.includes(1)) {
        assert.ok(result.stderr.includes(`output stream 0:${maps.indexOf(1)}`), result.stderr);
        assert.ok(result.stderr.includes("Empty output stream"), result.stderr);
      } else assert.equal(result.stderr, "");
    });
  }
  it("checks processed streams in later outputs with the flag last", async () => {
    const vfs = createTestVfs({
      "/full.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] })
    });
    const args = ["-i", "/full.wav", "/full-out.wav", "-t", "0", "/empty-out.wav",
      "-abort_on", "empty_output_stream"];
    assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
      (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
    const result = await runCmd(createFfmpegCommand(), args, vfs);
    assert.equal(result.exitCode, 234, result.stderr);
    assert.ok(result.stderr.includes("output stream 1:0"), result.stderr);
    assert.ok(result.stderr.includes("Empty output stream"), result.stderr);
    assert.ok(vfs.store.has("/full-out.wav"));
    assert.ok(vfs.store.has("/empty-out.wav"));
  });
});

describe("-abort_on empty_output", () => {
  for (const maps of [[0, 1], [1, 0], [0, 0]]) {
    for (const separateOutputs of [false, true]) {
      it(`checks each output, not each stream: maps=${maps}, separate=${separateOutputs}`, async () => {
        const vfs = createTestVfs({
          "/full.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] }),
          "/empty.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(0)] })
        });
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-abort_on", "empty_output", "-i", "/full.wav", "-i", "/empty.wav",
          ...maps.flatMap(index => ["-map", `${index}:a`, ...(separateOutputs ? ["-f", "null", "-"] : [])]),
          ...(separateOutputs ? [] : ["-f", "null", "-"])
        ], vfs);
        const emptyOutput = separateOutputs && maps.includes(1);
        assert.equal(result.exitCode, emptyOutput ? 234 : 0, result.stderr);
        if (emptyOutput) assert.match(result.stderr, /[Nn]othing was (written|encoded)/);
        else assert.equal(result.stderr, "");
      });
    }
  }
  for (const output of [["-f", "null", "-"], ["/out.wav"]]) {
    for (const frames of [0, 4096]) {
      for (const abort of [false, true]) {
        it(`${frames} frames to ${output.at(-1)}, abort=${abort}`, async () => {
          const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000,
            channels: [new Float64Array(frames)] }) });
          const result = await runCmd(createFfmpegCommand(),
            ["-y", "-v", "error", ...(abort ? ["-abort_on", "empty_output"] : []), "-i", "/i.wav", ...output], vfs);
          assert.equal(result.exitCode, abort && frames === 0 ? 234 : 0, result.stderr);
          if (abort && frames === 0) assert.match(result.stderr, /[Nn]othing was (written|encoded)/);
          else assert.equal(result.stderr, "");
          if (output.at(-1) === "/out.wav") assert.ok(vfs.store.has("/out.wav"));
        });
      }
    }
  }
  it("checks processed audio and all outputs, even when the flag appears last", async () => {
    for (const secondOutput of [false, true]) {
      const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(4096)] }) });
      const args = ["-i", "/i.wav", "-t", "0", "/empty.wav",
        ...(secondOutput ? ["-af", "volume=0", "/silent.wav"] : []), "-abort_on", "empty_output"];
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.ok(vfs.store.has("/empty.wav"));
    }
  });
});

describe("per-frame audio checksums", () => {
  it("selects framehash format versions while retaining native PCM rows", async () => {
    const input = encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 1200 }, (_, i) => i / 32768)] });
    const digests = [
      "407715b8ded48be4426df98401cecd0e7ad61b9ad742649eb844de452d1c5f91",
      "559634035f5df002db2c2a92319018124bdcf693acc7008f32a269e1705e0381",
      "2697af264dc1db05044267745e5bd6a3676ce9274d6b18d40c6860b606b11d90"
    ];
    for (const version of [undefined, "1", "2"]) {
      for (const target of ["-", "/frames.txt"]) {
        const vfs = createTestVfs({ "/i.wav": input });
        const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/i.wav",
          "-f", "framehash", ...(version ? ["-format_version", version] : []), target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = target === "-" ? result.stdout : new TextDecoder().decode(vfs.store.get(target));
        assert.ok(output.includes(`#version: ${version ?? "2"}\n#hash: SHA256\n`));
        const rows = output.split("\n").filter(line => line && !line.startsWith("#"));
        assert.deepEqual(rows.map(row => row.split(",").map(field => field.trim())),
          digests.map((digest, i) => ["0", String(i * 512), String(i * 512),
            String(i === 2 ? 176 : 512), String(i === 2 ? 352 : 1024), digest]));
      }
    }
  });
  it("rejects invalid framehash format versions without replacing output", async () => {
    for (const version of ["0", "3", "invalid", "", "1.5"]) {
      const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(1200)] }), "/frames.txt": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav",
        "-f", "framehash", "-format_version", version, "/frames.txt"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("format_version"));
      assert.equal(new TextDecoder().decode(vfs.store.get("/frames.txt")), "keep");
    }
  });
  it("honors framemd5 hash overrides for every PCM packet", async () => {
    const pcm = new Uint8Array(2400);
    for (let i = 0; i < 1200; i++) new DataView(pcm.buffer).setInt16(i * 2, i, true);
    const input = encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 1200 }, (_, i) => i / 32768)] });
    for (const algorithm of [undefined, "sha256", "sha512"]) {
      for (const target of ["-", "/frames.txt"]) {
        const vfs = createTestVfs({ "/i.wav": input });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/i.wav",
          "-f", "framemd5", ...(algorithm ? ["-hash", algorithm] : []), target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = target === "-" ? result.stdout : new TextDecoder().decode(vfs.store.get(target));
        assert.ok(output.includes(`#hash: ${(algorithm ?? "md5").toUpperCase()}\n`));
        const rows = output.split("\n").filter(line => line && !line.startsWith("#"));
        assert.equal(rows.length, 3);
        for (const [i, row] of rows.entries()) {
          const payload = pcm.subarray(i * 1024, (i + 1) * 1024);
          assert.deepEqual(row.split(",").map(field => field.trim()), ["0", String(i * 512), String(i * 512),
            String(payload.length / 2), String(payload.length), createHash(algorithm ?? "md5").update(payload).digest("hex")]);
        }
      }
    }
  });
  it("rejects invalid framemd5 hashes without replacing output", async () => {
    const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(1200)] }), "/frames.txt": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav",
      "-f", "framemd5", "-hash", "invalid", "/frames.txt"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(vfs.store.get("/frames.txt")), "keep");
  });
  it("supports explicit hashes, stereo PCM encoding, stream copy, and empty streams", async () => {
    for (const frames of [0, 515]) {
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: frames }, (_, i) => i / 32768), new Float64Array(frames)] });
      const packets = parseWav(input).tracks[0]!.samples;
      for (const codec of ["pcm_s16le", "copy"]) {
        const vfs = createTestVfs({ "/i.wav": input });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/i.wav", "-c:a", codec, "-f", "framehash", "-hash", "sha512", "-"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.ok(result.stdout.includes("#hash: SHA512\n"));
        const rows = result.stdout.split("\n").filter(line => line && !line.startsWith("#"));
        assert.equal(rows.length, packets.length);
        for (const [i, row] of rows.entries()) {
          const packet = packets[i]!;
          assert.deepEqual(row.split(",").map(field => field.trim()), ["0", String(packet.dts), String(packet.pts),
            String(packet.duration), String(packet.data.length), createHash("sha512").update(packet.data).digest("hex")]);
        }
      }
    }
  });
  it("rejects an unknown frame hash without replacing output", async () => {
    const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(512)] }), "/frames.txt": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav", "-f", "framehash", "-hash", "invalid", "/frames.txt"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(vfs.store.get("/frames.txt")), "keep");
  });
  for (const format of ["framemd5", "framehash", "framecrc"]) {
    for (const target of ["-", "/frames.txt"]) {
      it(`${format} to ${target} preserves PCM packet boundaries and the final short packet`, async () => {
        const frames = 4101;
        const pcm = new Uint8Array(frames * 2);
        for (let i = 0; i < frames; i++) new DataView(pcm.buffer).setInt16(i * 2, i - 2048, true);
        const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: frames }, (_, i) => (i - 2048) / 32768)] }) });
        const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/i.wav", "-f", format, target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = target === "-" ? result.stdout : new TextDecoder().decode(vfs.store.get(target));
        assert.ok(output.includes("#tb 0: 1/8000\n"));
        const rows = output.split("\n").filter(line => line && !line.startsWith("#"));
        assert.equal(rows.length, 9);
        for (const [i, row] of rows.entries()) {
          const payload = pcm.subarray(i * 1024, (i + 1) * 1024);
          let checksum: string;
          if (format === "framecrc") {
            // Native framecrc uses Adler-32 with a zero initial state.
            let a = 0, b = 0;
            for (const byte of payload) { a = (a + byte) % 65521; b = (b + a) % 65521; }
            checksum = `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
          } else checksum = createHash(format === "framemd5" ? "md5" : "sha256").update(payload).digest("hex");
          assert.deepEqual(row.split(",").map(field => field.trim()),
            ["0", String(i * 512), String(i * 512), String(payload.length / 2), String(payload.length), checksum]);
        }
        if (format === "framemd5") {
          assert.ok(rows[0]!.endsWith("9b29af00d6f8da690f22b3868c730e5a"));
          assert.ok(rows[7]!.endsWith("15e17ee991df91c85b4e37406dec941b"));
        }
      });
    }
  }
});

describe("per-stream audio checksums", () => {
  const pcm = new Uint8Array(8192);
  for (let i = 0; i < 4096; i++) new DataView(pcm.buffer).setInt16(i * 2, i - 2048, true);
  const wav = encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 4096 }, (_, i) => (i - 2048) / 32768)] });
  for (const target of ["-", "/digest.txt"]) {
    for (const maps of [["0:a"], ["0:a", "1:a"], ["2:a", "0:a", "1:a"]]) {
      it(`hashes mapped streams independently in output order: ${maps} to ${target}`, async () => {
        const vfs = createTestVfs({ "/i.wav": wav,
          "/silent.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096)] }) });
        const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/i.wav", "-i", "/i.wav",
          "-i", "/silent.wav", ...maps.flatMap(map => ["-map", map]), "-f", "streamhash", target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        const expected = maps.map((map, i) => `${i},a,SHA256=${map === "2:a"
          ? createHash("sha256").update(new Uint8Array(8192)).digest("hex")
          : "4d03c1071bbb0168f05cfdcf859053a7bfe695a3204039925404b9037f51395c"}\n`).join("");
        assert.equal(target === "-" ? result.stdout : new TextDecoder().decode(vfs.store.get(target)), expected);
        if (target !== "-") assert.equal(result.stdout, "");
      });
    }
  }
  it("applies per-stream filters and resets hash options for subsequent outputs", async () => {
    const vfs = createTestVfs({ "/i.wav": wav });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/i.wav", "-map", "0:a", "-map", "0:a",
      "-filter:a:0", "volume=0", "-f", "streamhash", "-hash", "md5", "/digest.txt", "-f", "streamhash", "-"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/digest.txt")),
      `0,a,MD5=${createHash("md5").update(new Uint8Array(8192)).digest("hex")}\n1,a,MD5=${createHash("md5").update(pcm).digest("hex")}\n`);
    assert.equal(result.stdout, `0,a,SHA256=${createHash("sha256").update(pcm).digest("hex")}\n`);
  });
  for (const codec of ["pcm_s16be", "copy"]) {
    it(`hashes empty streams and uses the ${codec} output payload`, async () => {
      const vfs = createTestVfs({ "/i.wav": wav,
        "/empty.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array()] }) });
      const payload = pcm.slice();
      if (codec === "pcm_s16be") {
        for (let i = 0; i < payload.length; i += 2) [payload[i], payload[i + 1]] = [payload[i + 1]!, payload[i]!];
      }
      const result = await runCmd(createFfmpegCommand(), ["-i", "/i.wav", "-i", "/empty.wav",
        "-map", "0:a", "-map", "1:a", "-c:a", codec, "-f", "streamhash", "-hash", "sha512", "-"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, [payload, new Uint8Array()].map((bytes, i) =>
        `${i},a,SHA512=${createHash("sha512").update(bytes).digest("hex")}\n`).join(""));
    });
  }
  it("rejects unknown algorithms without replacing output", async () => {
    const vfs = createTestVfs({ "/i.wav": wav, "/digest.txt": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav", "-f", "streamhash", "-hash", "invalid", "/digest.txt"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(vfs.store.get("/digest.txt")), "keep");
  });
});

describe("whole-output audio checksums", () => {
  const channels = [Float64Array.from({ length: 4096 }, (_, i) => (i - 2048) / 32768)];
  const pcm = new Uint8Array(8192);
  for (let i = 0; i < 4096; i++) new DataView(pcm.buffer).setInt16(i * 2, i - 2048, true);
  for (const [format, extra, expected] of [
    ["hash", [], "SHA256=4d03c1071bbb0168f05cfdcf859053a7bfe695a3204039925404b9037f51395c\n"],
    ["md5", [], "MD5=a258820e1cb3e7b24776b047836fcfb4\n"],
    ["md5", ["-hash", "sha256"], `SHA256=${createHash("sha256").update(pcm).digest("hex")}\n`],
    ["md5", ["-hash", "sha512"], `SHA512=${createHash("sha512").update(pcm).digest("hex")}\n`],
    ["crc", [], "CRC=0xd2a9f0e2\n"],
    ["hash", ["-hash", "sha160"], `SHA160=${createHash("sha1").update(pcm).digest("hex")}\n`],
    ["hash", ["-hash", "sha224"], `SHA224=${createHash("sha224").update(pcm).digest("hex")}\n`],
    ["hash", ["-hash", "sha384"], `SHA384=${createHash("sha384").update(pcm).digest("hex")}\n`],
    ["hash", ["-hash", "sha512"], `SHA512=${createHash("sha512").update(pcm).digest("hex")}\n`]
  ] as const) {
    for (const target of ["-", "/digest.txt"]) {
      it(`${format} ${extra.join(" ")} to ${target} hashes decoded PCM without headers`, async () => {
        // Floating-point input must be converted to the muxer's default PCM16.
        const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels }, { float: true, bitsPerSample: 32 }) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/i.wav", "-f", format, ...extra, target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        assert.equal(target === "-" ? result.stdout : new TextDecoder().decode(vfs.store.get(target)), expected);
        if (target !== "-") assert.equal(result.stdout, "");
      });
    }
  }
  for (const codec of [undefined, "pcm_s16be", "copy"]) {
    it(`hashes integer WAV with encoder ${codec ?? "default"}`, async () => {
      const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels }) });
      const payload = pcm.slice();
      if (codec === "pcm_s16be") {
        for (let i = 0; i < payload.length; i += 2) [payload[i], payload[i + 1]] = [payload[i + 1]!, payload[i]!];
      }
      const result = await runCmd(createFfmpegCommand(), ["-i", "/i.wav", ...(codec ? ["-c", codec] : []), "-f", "hash", "-"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, `SHA256=${createHash("sha256").update(payload).digest("hex")}\n`);
    });
  }
  it("hashes filtered audio and keeps digest options local to each output", async () => {
    const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/i.wav", "-af", "volume=0", "-f", "hash", "-hash", "md5", "/silent.txt", "-f", "hash", "-"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/silent.txt")), `MD5=${createHash("md5").update(new Uint8Array(8192)).digest("hex")}\n`);
    assert.equal(result.stdout, `SHA256=${createHash("sha256").update(pcm).digest("hex")}\n`);
  });
  for (const format of ["hash", "md5"]) it(`rejects unknown ${format} algorithms without replacing a file`, async () => {
    const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels }), "/digest.txt": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav", "-f", format, "-hash", "invalid", "/digest.txt"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.equal(new TextDecoder().decode(vfs.store.get("/digest.txt")), "keep");
  });
});

describe("strict input validation", () => {
  it("fails on decoder errors even without a truncated container", async () => {
    const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096)] }).slice(0, -1);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    view.setUint32(4, wav.length - 8, true);
    view.setUint32(40, wav.length - 44, true);
    const result = await runCmd(createFfmpegCommand(),
      ["-xerror", "-i", "/i.wav", "-f", "null", "-"], createTestVfs({ "/i.wav": wav }));
    assert.equal(result.exitCode, 183, result.stderr);
    assert.match(result.stderr, /Invalid PCM packet/);
  });
  for (const remove of [0, 511, 512, 8191]) {
    for (const output of [["-f", "null", "-"], ["/strict.wav"], ["-c:a", "copy", "/strict.wav"]]) {
      it(`-xerror with ${remove} bytes missing to ${output.at(-1)}`, async () => {
        const wav = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 4096 }, (_, i) => (i - 2048) / 32768)
        ] });
        const vfs = createTestVfs({ "/i.wav": wav.slice(0, wav.length - remove) });
        const result = await runCmd(createFfmpegCommand(),
          ["-y", "-v", "error", "-xerror", "-i", "/i.wav", ...output], vfs);
        assert.equal(result.exitCode, remove ? 183 : 0, result.stderr);
        assert.equal(result.stdout, "");
        if (remove) assert.match(result.stderr, /corrupt input packet/);
        else assert.equal(result.stderr, "");
        if (output.at(-1) === "/strict.wav") {
          const samples = parseWav(vfs.store.get("/strict.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
          const count = remove ? Math.floor((8192 - remove) / 1024) * 512 : 4096;
          assert.deepEqual(Array.from(samples), Array.from({ length: count }, (_, i) => (i - 2048) / 32768));
        }
      });
    }
  }
});

describe("-max_error_rate (FFmpeg 7.0.2)", () => {
  for (const [remove, rate, code] of [
    [0, "0", 0], [511, "0", 0], [8191, "0", 69],
    [8191, "NaN", 0], [8191, "inf", 0], [8191, "0.99", 69], [8191, "1", 0], [8191, "2", 0], [0, "-1", 69]
  ] as const) {
    for (const output of [["-f", "null", "-"], ["/out.wav"]]) {
      it(`${remove} missing bytes, threshold ${rate}, output ${output.at(-1)}`, async () => {
        const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096)] });
        const vfs = createTestVfs({ "/i.wav": wav.slice(0, wav.length - remove) });
        const args = ["-y", "-v", "error", "-i", "/i.wav", ...output, "-max_error_rate", rate];
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
        assert.equal(vfs.store.has("/out.wav"), false);
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, code, result.stderr);
        assert.equal(result.stdout, "");
        if (code === 69) assert.match(result.stderr, /Decode error rate .* exceeds maximum/);
        if (remove) assert.match(result.stderr, /Invalid PCM packet/);
        if (!remove && code === 0) assert.equal(result.stderr, "");
        if (output.at(-1) === "/out.wav") {
          const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
          assert.equal(audio.channelData[0]!.length, Math.floor((8192 - remove) / 2));
        }
      });
    }
  }
  it("does not apply decoder thresholds to stream copy or override -xerror", async () => {
    const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(4096)] }).slice(0, 45);
    for (const [extra, code] of [[["-c:a", "copy"], 0], [["-xerror"], 183]] as const) {
      const result = await runCmd(createFfmpegCommand(),
        ["-max_error_rate", "1", "-i", "/i.wav", ...extra, "-f", "null", "-"], createTestVfs({ "/i.wav": wav }));
      assert.equal(result.exitCode, code, result.stderr);
    }
  });
  for (const value of ["bad", "0.5junk", ""]) {
    it(`rejects invalid threshold '${value}' before writing output`, async () => {
      const vfs = createTestVfs({ "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(),
        ["-y", "-i", "/missing.wav", "/out.wav", "-max_error_rate", value], vfs);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.match(result.stderr, /max_error_rate/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("truncated PCM decoding", () => {
  for (const output of [["-f", "null", "-"], ["/out.wav"]]) {
    for (const [name, frames, remove, expectedFrames, exitCode] of [
      ["no complete sample", 4096, 8191, 0, 69],
      ["recoverable partial sample", 4096, 511, 3840, 0],
      ["complete samples after truncation", 4096, 512, 3840, 0],
      ["valid empty input", 0, 0, 0, 0]
    ] as const) {
      it(`${name} to ${output.at(-1)}`, async () => {
        const wav = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: frames }, (_, i) => (i - 2048) / 32768)
        ] });
        const bytes = wav.slice(0, wav.length - remove);
        const vfs = createTestVfs({ "/input.wav": bytes });
        const args = ["-y", "-v", "error", "-i", "/input.wav", ...output];
        if (remove % 2) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, data) => { vfs.store.set(path, data); return true; }), undefined);
          assert.equal(vfs.store.has("/out.wav"), false);
        }
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, exitCode, result.stderr);
        assert.equal(result.stdout, "");
        if (remove % 2) assert.match(result.stderr, /Invalid PCM packet/);
        else assert.equal(result.stderr, "");
        if (output.at(-1) === "/out.wav") {
          const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
          assert.equal(audio.channelData[0]!.length, expectedFrames);
          assert.deepEqual(Array.from(audio.channelData[0]!),
            Array.from({ length: expectedFrames }, (_, i) => (i - 2048) / 32768));
        }
      });
    }
  }
});

it("detects incomplete multichannel and floating-point PCM frames", async () => {
  for (const bitsPerSample of [16, 24, 32] as const) {
    for (const channels of [1, 2]) {
      const wav = encodeWav({ sampleRate: 8000, channels:
        Array.from({ length: channels }, () => new Float64Array(4))
      }, { bitsPerSample, float: bitsPerSample === 32 });
      const bytes = wav.slice(0, -1);
      assert.equal(parseWav(bytes, { decodeAudio: false }).tracks[0]!.decodeErrors, undefined);
      const vfs = createTestVfs({ "/input.wav": bytes });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-f", "null", "-"], vfs);
      assert.equal(result.exitCode, 0);
      assert.match(result.stderr, /Invalid PCM packet/);
      assert.equal(parseWav(bytes).tracks[0]!.decodedAudio!.channelData[0]!.length, 3);
      const copied = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", "copy", "-f", "null", "-"], vfs);
      assert.equal(copied.exitCode, 0);
      assert.equal(copied.stderr, "");
    }
  }
});

describe("SRT input validation", () => {
  for (const [name, input] of [
    ["junk", "bad text only\n"],
    ["empty", ""],
    ["missing first cue index", "00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:05,000 --> 00:00:06,000\nthere\n"]
  ]) {
    it(`rejects ${name} without writing output`, async () => {
      const vfs = createTestVfs({ "/i.srt": input! });
      const args = ["-y", "-v", "error", "-i", "/i.srt", "/out.vtt"];
      const sync = evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; });
      assert.notEqual(sync, "");
      assert.equal(vfs.store.has("/out.vtt"), false);
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(vfs.store.has("/out.vtt"), false);
    });
  }

  it("converts UTF-8 BOM and CRLF SRT input", async () => {
    const vfs = createTestVfs({ "/i.srt": "\uFEFF1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n" });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/i.srt", "/out.vtt"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
      "WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n");
  });
});

it("converts short SRT millisecond fields to exact WebVTT cue timestamps", async () => {
  const vfs = createTestVfs({ "/i.srt": "1\n00:00:01,2 --> 00:00:02,25\nHello\n\n2\n00:00:05,000 --> 00:00:06,750\nthere\n" });
  const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/i.srt", "/out.vtt"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
    "WEBVTT\n\n00:01.002 --> 00:02.025\nHello\n\n00:05.000 --> 00:06.750\nthere\n");
});

for (const [start, end, expectedEnd] of [
  ["01,000", "01,000", "01.000"],
  ["03,500", "01,250", "05.000"]] as const) {
  it(`converts SRT interval ${start}–${end} with native cue timing`, async () => {
    const vfs = createTestVfs({ "/i.srt": `1\n00:00:${start} --> 00:00:${end}\nHello\n\n2\n00:00:05,000 --> 00:00:06,750\nthere\n` });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/i.srt", "/out.vtt"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
      `WEBVTT\n\n00:${start.replace(",", ".")} --> 00:${expectedEnd}\nHello\n\n00:05.000 --> 00:06.750\nthere\n`);
  });
}

describe("volume timeline enable", () => {
  for (const [expression, start, end] of [
    ["0", 8000, 8000],
    ["0.2", 8000, 8000],
    ["-0.4", 8000, 8000],
    ["0.499999", 8000, 8000],
    ["-0.499999", 8000, 8000],
    ["0.5", 0, 8000],
    ["-0.5", 0, 8000],
    ["1", 0, 8000],
    ["gte(t\\,0.5)", 4096, 8000],
    ["gte(t\\,0.07)", 1024, 8000],
    ["'between(t,0.2,0.4)'", 2048, 3584],
    ["eq(n\\,1)", 512, 1024]
  ] as const) {
    it(`evaluates ${expression} at native audio frame boundaries`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 8000 }, (_, i) => (12000 + i % 50) / 32768),
        Float64Array.from({ length: 8000 }, (_, i) => -(12000 + i % 50) / 32768)
      ] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.wav", "-af", `volume=0:enable=${expression}`, "-c:a", "pcm_s16le", "/output.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = parseWav(input).tracks[0]!.decodedAudio!.channelData;
      for (const channel of expected) channel.fill(0, start, end);
      const actual = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(actual, expected);
    });
  }
});

describe("frame-evaluated volume", () => {
  // Native FFmpeg 7.0.2 and 9.0.1 restore this 8 kHz signal at sample 4096.
  for (const [expression, transition] of [
    ["if(lt(t\\,0.5)\\,0\\,1)", 4096],
    ["'if(lt(t,0.5),0,1)'", 4096],
    ["if(lt(n\\,8)\\,0\\,1)", 4096],
    ["if(lt(t\\,0.07)\\,0\\,1)", 1024]
  ] as const) {
    it(`matches native frame transitions and every PCM sample: ${expression}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 8000 }, (_, i) => (12000 + i % 50) / 32768)
      ] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.wav", "-af", `volume=${expression}:eval=frame,volume=1`, "-c:a", "pcm_s16le", "/out.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!.slice();
      expected.fill(0, 0, transition);
      assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0], expected);
    });
  }

  for (const evaluation of ["once", "frame"]) {
    it(`accepts scalar volume with eval=${evaluation}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000).fill(0.5)] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.wav", "-af", `volume=0.5:eval=${evaluation}`, "-c:a", "pcm_s16le", "/out.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0], new Float32Array(8000).fill(0.25));
    });
  }
});

describe("stream-scoped audio filters", () => {
  for (const options of [
    ["-af", "volume=0", "-af", "volume=1"],
    ["-af", "areverse", "-af", "areverse"],
    ["-af", "volume=0", "-filter:a:0", "volume=1"],
    ["-af:0", "volume=0", "-filter:a", "volume=1"],
    ["-af", "volume=0", "-af", "volume=1", "-af:1", "volume=0"],
    ["-af", "unsupported", "-af", "volume=1"],
    ["-af", "volume=0,volume=1"],
    ["-af", "areverse,areverse"]
  ]) {
    it(`uses the last matching audio filter option: ${options.join(" ")}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 80 }, (_, i) => i / 256)
      ] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.wav", ...options, "-c:a", "pcm_s16le", "/out.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!.slice();
      if (options.includes("volume=0,volume=1")) expected.fill(0);
      if (options.includes("areverse")) expected.reverse();
      const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(actual, expected);
    });
  }

  it("counts output audio ordinals after mapping", async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800).fill(0.375)] });
    const vfs = createTestVfs({ "/in.wav": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.wav", "-i", "/in.wav", "-map", "1:a:0", "-filter:a:0", "volume=0", "/out.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const samples = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(samples.length, 800);
    assert.ok(samples.every(value => value === 0));
  });

  for (const alias of ["-filter:a", "-af"]) {
    for (const ordinal of [0, 1]) {
      for (const codec of ["pcm_s16le", "copy"]) {
        it(`${alias}:${ordinal} applies only to matching output audio with ${codec}`, async () => {
          const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000).fill(0.375)] });
          const vfs = createTestVfs({ "/in.wav": input });
          const args = ["-y", "-v", "error", "-i", "/in.wav", `${alias}:${ordinal}`, "volume=0", "-c:a", codec, "/out.wav"];
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => {
            assert.fail("scoped audio filters must defer without writing");
          }), undefined);
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          if (codec === "copy" && ordinal === 0) {
            assert.notEqual(result.exitCode, 0);
            assert.ok(result.stderr.includes("Filtering and streamcopy"), result.stderr);
            assert.equal(vfs.store.has("/out.wav"), false);
          } else {
            assert.equal(result.exitCode, 0, result.stderr);
            const samples = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
            const source = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
            assert.equal(samples.length, source.length);
            if (ordinal === 0) assert.ok(samples.every(value => value === 0));
            else assert.deepEqual(samples, source);
          }
        });
      }
    }
  }
});

describe("audio channel count", () => {
  for (const channels of [1, 2]) {
    for (const options of [[], ["-ac", "-1"], ["-ac", "-2"], ["-ac", "-3"], ["-ac", "-20"], ["-ac", "0"], ["-ac", "1"]]) {
      for (const filtered of [false, true]) {
        it(`preserves native PCM for ${channels} channels, ${options.join(" ") || "default"}, filter=${filtered}`, async () => {
          const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, () =>
            Float64Array.from({ length: 8000 }, (_, i) => (12000 + i % 50) / 32768)) });
          const vfs = createTestVfs({ "/in.wav": input });
          const result = await runCmd(createFfmpegCommand(), [
            "-y", "-v", "error", "-i", "/in.wav", ...options,
            ...(filtered ? ["-af", "areverse"] : []), "-c:a", "pcm_s16le", "/out.wav"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
          const expected = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!.slice();
          if (filtered) expected.reverse();
          assert.equal(actual.sampleRate, 8000);
          assert.equal(actual.channels, options[1] === "1" ? 1 : channels);
          for (const channel of actual.channelData) assert.deepEqual(channel, expected);
        });
      }
    }
  }
});

describe("audio sample rate validation", () => {
  for (const existing of [false, true]) {
    it(`rejects -ar -1 without ${existing ? "overwriting" : "creating"} output`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000).fill(0.375)] });
      const vfs = createTestVfs({ "/in.wav": input, ...(existing ? { "/out.wav": input } : {}) });
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-ar", "-1", "-c:a", "pcm_s16le", "/out.wav"];
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => {
        assert.fail("invalid rate must not write synchronously");
      }), undefined);
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("sample rate"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.wav"), existing ? input : undefined);
    });
  }

  it("accepts -ar 0 as the input sample rate", async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000).fill(0.375)] });
    const vfs = createTestVfs({ "/in.wav": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.wav", "-ar", "0", "-c:a", "pcm_s16le", "/out.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
    const expected = parseWav(input).tracks[0]!.decodedAudio!;
    assert.equal(actual.sampleRate, expected.sampleRate);
    assert.deepEqual(actual.channelData, expected.channelData);
  });
});

describe("negative duration", () => {
  for (const inputOption of [false, true]) {
    it(`rejects negative ${inputOption ? "input" : "output"} -t without writing a completed WAV`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)
      ] });
      const vfs = createTestVfs({ "/in.wav": input });
      const args = inputOption
        ? ["-t", "-0.025", "-i", "/in.wav", "/out.wav"]
        : ["-i", "/in.wav", "-t", "-0.025", "/out.wav"];
      let syncWrites = 0;
      assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => {
        syncWrites++;
        return true;
      }), undefined);
      assert.equal(syncWrites, 0);
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("duration must be nonnegative"), result.stderr);
      assert.equal(vfs.store.has("/out.wav"), false);
      assert.deepEqual(vfs.store.get("/in.wav"), input);
    });
  }
});

describe("required option arguments", () => {
  for (const option of ["-ar", "-t", "-ac", "-v"]) {
    for (const existing of [false, true]) {
      it(`rejects missing ${option} before ${existing ? "overwriting" : "creating"} outputs`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [
          Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)
        ] });
        const vfs = createTestVfs({ "/in.wav": input, ...(existing ? { "/a.wav": input } : {}) });
        const args = ["-v", "error", "-y", "-i", "/in.wav", "/a.wav", "/b.wav", option];
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => {
          assert.fail("sync fallback must not write output");
        }), undefined);
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 234, result.stderr);
        assert.ok(result.stderr.includes(`Missing argument for option '${option.slice(1)}'`));
        assert.equal(vfs.store.has("/b.wav"), false);
        assert.deepEqual(vfs.store.get("/a.wav"), existing ? input : undefined);
        assert.deepEqual(vfs.store.get("/in.wav"), input);
      });
    }
  }

  it("preserves explicit -t 0 and valid trailing options", async () => {
    for (const args of [["-t", "0", "/out.wav"], ["/out.wav", "-t", "0"], ["/out.wav", "-ar", "16000"]]) {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)
      ] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", ...args], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const samples = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      const expected = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(samples, args[0] === "-t" ? expected.slice(0, 0) : expected);
    }
  });
});

describe("tile invalid options", () => {
  for (const options of [
    "2x2:nb_frames=5", "0x2", "2x0", "-1x2", "2x2x2", "2junkx2", "2.5x2",
    "2x2:padding=-1", "2x2:margin=-1", "2x2:badkey=1",
    "2x2:nb_frames=-1", "2x2:nb_frames=invalid",
    "2x2:margin=invalid", "2x2:padding=2147483648",
    "2x2:margin=2147483648", "2x2:padding=1025", "2x2:margin=1025",
    "2147483648x1", "65536x65536", "2x2:nb_frames=", "2x2:color=invalid",
    "2x2:0:0:0:black:0:0:extra"
  ]) {
    it(`rejects tile=${options} without publishing or replacing sheets`, async () => {
      for (const existing of [false, true]) {
        const vfs = createTestVfs(existing ? { "/out1.png": "keep" } : {});
        const before = new Map(vfs.store);
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=s=4x4:r=5:d=1.4",
          "-vf", `tile=${options}`, "-fps_mode", "passthrough", "/out%d.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0, result.stderr);
        assert.deepEqual(vfs.store, before);
      }
    });
  }
});

describe("untile", () => {
  for (const layout of ["3x1", "2x2", "6x5"]) {
    it(`extracts ordered RGB frames and blank cells from ${layout} sheets`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      for (const filter of [`tile=${layout}`, `tile=${layout},untile=${layout}`, `tile=${layout},${layout === "6x5" ? "untile" : `untile=layout=${layout}`}`]) {
        const vfs = createTestVfs();
        for (let i = 0; i < 7; i++) {
          const value = 20 * (i + 1);
          vfs.store.set(`/f${i}.png`, encodeImage({
            width: 3, height: 2, data: Uint8Array.from(Array(6).fill([value, value, value, 255]).flat()),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
        }
        const [cols, rows] = layout.split("x").map(Number);
        const capacity = cols! * rows!;
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-framerate", "5", "-i", "/f%d.png", "-vf", filter,
          "-fps_mode", "passthrough", "/o%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const split = filter.includes("untile");
        const count = Math.ceil(7 / capacity) * (split ? capacity : 1);
        assert.equal(vfs.store.size - 7, count);
        for (let i = 0; i < count; i++) {
          const frame = decodeImage(vfs.store.get(`/o${i + 1}.png`)!);
          assert.equal(frame.width, split ? 3 : cols! * 3);
          assert.equal(frame.height, split ? 2 : rows! * 2);
          for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
            const n = split ? i : i * capacity + Math.floor(y / 2) * cols! + Math.floor(x / 3);
            const value = n < 7 ? 20 * (n + 1) : 0;
            const offset = (y * frame.width + x) * 4;
            assert.deepEqual([...frame.data.subarray(offset, offset + 4)], [value, value, value, 255]);
          }
          vfs.store.delete(`/o${i + 1}.png`);
        }
      }
    });
  }
  for (const options of ["0x1", "2x0", "bad", "3x1", "2x2:unknown=1"]) {
    it(`rejects invalid layout/options ${options} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "lavfi", "-i",
        "color=s=4x4:r=1:d=1", "-vf", `untile=${options}`, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("untile"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
});

describe("tile overlap", () => {
  for (const overlap of ["-1", "2147483648", "invalid"]) {
    it(`rejects overlap=${overlap} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=s=4x4:r=1:d=1",
        "-vf", `tile=3x1:overlap=${overlap}`, "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("tile: overlap"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  for (const [count, options, expected] of [
    [7, "init_padding=1", [[0, 20, 40], [60, 80, 100], [120, 140, 0]]],
    [7, "overlap=1:init_padding=1", [[0, 20, 40], [40, 60, 80], [80, 100, 120], [120, 140, 0]]],
    [7, "overlap=2:init_padding=2", [[0, 0, 20], [0, 20, 40], [20, 40, 60], [40, 60, 80], [60, 80, 100], [80, 100, 120], [100, 120, 140]]],
    [1, "init_padding=1", [[0, 20, 0]]],
    [2, "init_padding=1", [[0, 20, 40]]],
    [7, "init_padding=0", [[20, 40, 60], [80, 100, 120], [140, 0, 0]]],
    [7, "init_padding=3", [[20, 40, 60], [80, 100, 120], [140, 0, 0]]],
    [7, "init_padding=2147483647", [[20, 40, 60], [80, 100, 120], [140, 0, 0]]],
    [7, "nb_frames=2:init_padding=3", [[20, 40, 0], [60, 80, 0], [100, 120, 0], [140, 0, 0]]],
    [3, "nb_frames=2:init_padding=1", [[0, 20, 0], [40, 60, 0]]],
    [7, "overlap=1", [[20, 40, 60], [60, 80, 100], [100, 120, 140]]],
    [6, "overlap=1", [[20, 40, 60], [60, 80, 100], [100, 120, 0]]],
    [2, "overlap=1", [[20, 40, 0]]],
    [7, "overlap=0", [[20, 40, 60], [80, 100, 120], [140, 0, 0]]],
    [7, "overlap=2", [[20, 40, 60], [40, 60, 80], [60, 80, 100], [80, 100, 120], [100, 120, 140]]],
    [7, "overlap=3", [[20, 40, 60], [40, 60, 80], [60, 80, 100], [80, 100, 120], [100, 120, 140]]],
    [7, "nb_frames=2:overlap=2", [[20, 40, 0], [40, 60, 0], [60, 80, 0], [80, 100, 0], [100, 120, 0], [120, 140, 0]]]
  ] as const) {
    it(`matches native RGB sheets for ${count} frames and ${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 0; i < count; i++) {
        const value = 20 * (i + 1);
        vfs.store.set(`/f${i}.png`, encodeImage({
          width: 3, height: 2, data: Uint8Array.from(Array(6).fill([value, value, value, 255]).flat()),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "5", "-i", "/f%d.png", "-vf", `tile=3x1:${options}`,
        "-fps_mode", "passthrough", "/o%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size - count, expected.length);
      for (const [index, cells] of expected.entries()) {
        const sheet = decodeImage(vfs.store.get(`/o${index + 1}.png`)!);
        assert.equal(sheet.width, 9);
        assert.equal(sheet.height, 2);
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 9; x++) {
            const value = cells[Math.floor(x / 3)]!;
            const offset = (y * 9 + x) * 4;
            assert.deepEqual([...sheet.data.subarray(offset, offset + 4)], [value, value, value, 255]);
          }
        }
      }
    });
  }
});

describe("tile initial padding", () => {
  for (const initPadding of ["-1", "2147483648", "invalid"]) {
    it(`rejects init_padding=${initPadding} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=s=4x4:r=1:d=1",
        "-vf", `tile=3x1:init_padding=${initPadding}`, "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("tile: init_padding"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
});

describe("tile positional options", () => {
  for (const options of [
    "3x1:2:1:2:red",
    "3x1:2:1:padding=2:color=red",
    "layout=3x1:nb_frames=2:margin=1:padding=2:color=red"
  ]) {
    it(`renders four 15x4 sheets with ${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 0; i < 7; i++) {
        const value = 20 * (i + 1);
        vfs.store.set(`/f${i}.png`, encodeImage({
          width: 3, height: 2, data: Uint8Array.from(Array(6).fill([value, value, value, 255]).flat()),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "5", "-i", "/f%d.png", "-vf", `tile=${options}`,
        "-fps_mode", "passthrough", "/o%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size - 7, 4);
      for (let index = 0; index < 4; index++) {
        const sheet = decodeImage(vfs.store.get(`/o${index + 1}.png`)!);
        assert.equal(sheet.width, 15);
        assert.equal(sheet.height, 4);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 15; x++) {
            const cell = Math.floor((x - 1) / 5);
            const frame = index * 2 + cell;
            const occupied = y >= 1 && y < 3 && x >= 1 && (x - 1) % 5 < 3 && cell < 2 && frame < 7;
            const value = 20 * (frame + 1);
            const offset = (y * 15 + x) * 4;
            assert.deepEqual([...sheet.data.subarray(offset, offset + 4)],
              occupied ? [value, value, value, 255] : [255, 0, 0, 255]);
          }
        }
      }
    });
  }
});

describe("tile frame grouping", () => {
  for (const count of [7, 31]) {
    for (const filter of ["tile", "tile=6x5"]) {
      it(`uses 6x5 sheets with row-major pixels for ${filter} and ${count} frames`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs();
        for (let i = 0; i < count; i++) {
          const value = (20 * (i + 1)) % 256;
          vfs.store.set(`/f${i}.png`, encodeImage({
            width: 3, height: 2, data: Uint8Array.from(Array(6).fill([value, value, value, 255]).flat()),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
        }
        const result = await runCmd(createFfmpegCommand(), [
          "-framerate", "5", "-i", "/f%d.png", "-vf", filter, "-fps_mode", "passthrough", "/o%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(vfs.store.size - count, Math.ceil(count / 30));
        for (let index = 0; index < Math.ceil(count / 30); index++) {
          const sheet = decodeImage(vfs.store.get(`/o${index + 1}.png`)!);
          assert.equal(sheet.width, 18);
          assert.equal(sheet.height, 10);
          for (let y = 0; y < 10; y++) {
            for (let x = 0; x < 18; x++) {
              const frame = index * 30 + Math.floor(y / 2) * 6 + Math.floor(x / 3);
              const value = frame < count ? (20 * (frame + 1)) % 256 : 0;
              const offset = (y * 18 + x) * 4;
              assert.deepEqual([...sheet.data.subarray(offset, offset + 4)], [value, value, value, 255]);
            }
          }
        }
      });
    }
  }
  // Native FFmpeg with RGB input: occupied cells are white, unused cells black.
  for (const [options, occupied] of [
    ["", [4]],
    [":nb_frames=0", [4]],
    [":nb_frames=1", [1, 1, 1, 1]],
    [":nb_frames=2", [2, 2]],
    [":nb_frames=3", [3, 1]],
    [":nb_frames=4", [4]]
  ] as const) {
    it(`matches native sheet counts and cells for tile=2x2${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=white:s=16x16:r=1:d=4",
        "-vf", `tile=2x2${options}`, "/out_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, occupied.length);
      for (const [index, count] of occupied.entries()) {
        const sheet = decodeImage(vfs.store.get(`/out_${index + 1}.png`)!);
        assert.equal(sheet.width, 32);
        assert.equal(sheet.height, 32);
        for (let y = 0; y < 32; y++) {
          for (let x = 0; x < 32; x++) {
            const cell = Math.floor(y / 16) * 2 + Math.floor(x / 16);
            const offset = (y * 32 + x) * 4;
            const value = cell < count ? 255 : 0;
            assert.deepEqual([...sheet.data.subarray(offset, offset + 4)], [value, value, value, 255]);
          }
        }
      }
    });
  }
});

describe("tile background", () => {
  for (const [option, background] of [
    ["", [0, 0, 0, 255]],
    [":color=yellow", [255, 255, 0, 255]],
    [":color=0xff0000@0.5", [255, 0, 0, 127]]
  ] as const) {
    it(`fills margins, gaps and unused tiles with ${option || "default black"}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const blue = [0, 0, 255, 255];
      const vfs = createTestVfs({
        "/in.png": encodeImage({
          width: 16, height: 16, channels: 4, format: "png", space: "srgb",
          depth: "uchar", density: 72, hasAlpha: true,
          data: Uint8Array.from(Array(256).fill(blue).flat())
        }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/in.png",
        "-vf", `tile=2x2:padding=4:margin=4${option}`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 44);
      assert.equal(image.height, 44);
      for (let y = 0; y < 44; y++) {
        for (let x = 0; x < 44; x++) {
          const offset = (y * 44 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x >= 4 && x < 20 && y >= 4 && y < 20 ? blue : background,
            `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

describe("overlay end of input", () => {
  for (const options of ["shortest=1", "eof_action=endall", "", "shortest=0"]) {
    for (const [mainDuration, overlayDuration] of [[4, 2], [2, 4]]) {
      it(`matches native frame count for ${options || "defaults"} with durations ${mainDuration}/${overlayDuration}`, async () => {
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-f", "lavfi", "-i", `color=c=red:s=8x8:r=1:d=${mainDuration}`,
          "-f", "lavfi", "-i", `color=c=blue:s=8x8:r=1:d=${overlayDuration}`,
          "-filter_complex", `[0:v][1:v]overlay${options ? `=${options}` : ""}`,
          "/out_%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const count = options === "shortest=1" || options === "eof_action=endall" ? 2 : mainDuration!;
        assert.equal(vfs.store.size, count);
        for (let i = 1; i <= count; i++) {
          const frame = decodeImage(vfs.store.get(`/out_${i}.png`)!);
          assert.equal(frame.width, 8);
          assert.equal(frame.height, 8);
          for (const [channel, expected] of [0, 0, 255, 255].entries()) {
            assert.ok(Math.abs(frame.data[channel]! - expected) <= 3);
          }
        }
      });
    }
  }
});

describe("overlay pass after EOF", () => {
  for (const options of ["eof_action=pass", "repeatlast=0", "", "repeatlast=1"]) {
    it(`preserves main frames with ${options || "defaults"}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=8x8:r=1:d=4",
        "-f", "lavfi", "-i", "color=c=blue:s=8x8:r=1:d=2",
        "-filter_complex", `[0:v][1:v]overlay${options ? `=${options}` : ""}`,
        "/out_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, 4);
      for (let i = 1; i <= 4; i++) {
        const frame = decodeImage(vfs.store.get(`/out_${i}.png`)!);
        assert.equal(frame.width, 8);
        assert.equal(frame.height, 8);
        const pass = options === "eof_action=pass" || options === "repeatlast=0";
        const pixel = pass && i > 2 ? [255, 0, 0, 255] : [0, 0, 255, 255];
        for (const [channel, expected] of pixel.entries()) {
          assert.ok(Math.abs(frame.data[channel]! - expected) <= 3,
            `frame ${i}, channel ${channel}: expected ${expected}, got ${frame.data[channel]}`);
        }
      }
    });
  }
});

describe("overlay alpha", () => {
  // Decoded native FFmpeg PNG pixels for a green overlay on opaque red.
  for (const [alpha, expected] of [
    [0, [255, 0, 0, 255]],
    [128, [127, 128, 0, 255]],
    [255, [0, 255, 0, 255]]
  ] as const) {
    it(`matches native PNG pixels with overlay alpha ${alpha}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const red = [255, 0, 0, 255];
      const vfs = createTestVfs({
        "/base.png": encodeImage({ width: 8, height: 8, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(64).fill(red).flat()) }, { format: "png" }).data,
        "/logo.png": encodeImage({ width: 2, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(4).fill([0, 255, 0, alpha]).flat()) }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/base.png", "-i", "/logo.png",
        "-filter_complex", "[0:v][1:v]overlay=0:0:format=rgb",
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 8);
      assert.equal(image.height, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x < 2 && y < 2 ? expected : red, `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

describe("overlay offsets", () => {
  for (const [options, ox, oy] of [
    ["3:2", 2, 2],
    ["2:3", 2, 2],
    ["3:3", 2, 2],
    ["2:2", 2, 2],
    ["-1:2", -2, 2],
    ["2:-1", 2, -2],
    ["3:3:format=yuv420", 2, 2],
    ["3:3:format=yuv422", 2, 3],
    ["3:3:format=yuv444", 3, 3],
    ["3:3:format=auto", 3, 3],
    ["3:3:format=rgb", 3, 3],
    ["x=2:y=2:format=rgb", 2, 2],
    ["y=3:x=2:format=rgb", 2, 3],
    ["2:3:format=rgb", 2, 3],
    ["2:y=3:format=rgb", 2, 3],
    ["y=2:format=rgb", 0, 2],
    ["x=2:format=rgb", 2, 0],
    ["format=rgb", 0, 0]
  ] as const) {
    it(`positions PNG pixels for ${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const red = [255, 0, 0, 255];
      const green = [0, 255, 0, 255];
      const vfs = createTestVfs({
        "/base.png": encodeImage({ width: 8, height: 8, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(64).fill(red).flat()) }, { format: "png" }).data,
        "/logo.png": encodeImage({ width: 2, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(Array(4).fill(green).flat()) }, { format: "png" }).data
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/base.png", "-i", "/logo.png",
        "-filter_complex", `[0:v][1:v]overlay=${options}`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 8);
      assert.equal(image.height, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...image.data.subarray(offset, offset + 4)],
            x >= ox && x < ox + 2 && y >= oy && y < oy + 2 ? green : red,
            `pixel (${x}, ${y})`);
        }
      }
    });
  }
});

function createTestVfs(initialFiles: Record<string, Uint8Array | string> = {}) {
  const store = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(initialFiles)) {
    const key = k.startsWith("/") ? k : `/${k}`;
    store.set(key, typeof v === "string" ? new TextEncoder().encode(v) : v);
  }

  return {
    store,
    fs: {
      async mkdir() {},
      async readdir(path: string) {
        const prefix = path.endsWith("/") ? path : `${path}/`;
        const entries = new Map<string, { name: string; type: "file" | "directory" }>();
        for (const key of store.keys()) {
          if (!key.startsWith(prefix)) continue;
          const suffix = key.slice(prefix.length);
          const name = suffix.split("/")[0]!;
          entries.set(name, { name, type: suffix.includes("/") ? "directory" : "file" });
        }
        return [...entries.values()];
      },
      async readFile(path: string) {
        const key = path.startsWith("/") ? path : `/${path}`;
        const val = store.get(key);
        if (!val) {
          const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        }
        return val;
      },
      async writeFile(path: string, data: Uint8Array) {
        const key = path.startsWith("/") ? path : `/${path}`;
        store.set(key, data);
      },
      async rm(path: string) {
        store.delete(path);
      },
      async stat(path: string) {
        const key = path.startsWith("/") ? path : `/${path}`;
        const val = store.get(key);
        if (!val) {
          const err = new Error(`ENOENT: ${path}`) as Error & { code?: string };
          err.code = "ENOENT";
          throw err;
        }
        return { type: "file" as const, size: val.byteLength, mode: 0o644, mtimeMs: 0 };
      }
    }
  };
}

async function runCmd(
  cmdDef: ReturnType<typeof createFfmpegCommand>,
  args: string[],
  vfs: ReturnType<typeof createTestVfs>,
  stdinBytes = new Uint8Array(0),
  signal = new AbortController().signal
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes: Uint8Array }> {
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];

  const res = await cmdDef.execute({
    args,
    cwd: "/",
    env: {},
    fs: vfs.fs as never,
    signal,
    stdin: (async function* () {
      if (stdinBytes.byteLength > 0) yield stdinBytes;
    })() as never,
    stdout: {
      async write(chunk: Uint8Array) {
        outChunks.push(chunk);
      }
    } as never,
    stderr: {
      async write(chunk: Uint8Array) {
        errChunks.push(chunk);
      }
    } as never
  } as never);

  const concat = (arr: Uint8Array[]) => {
    const total = arr.reduce((a, b) => a + b.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const c of arr) {
      out.set(c, pos);
      pos += c.byteLength;
    }
    return out;
  };

  const stdoutBytes = concat(outChunks);
  const stderrBytes = concat(errChunks);
  return {
    exitCode: res.exitCode,
    stdout: new TextDecoder().decode(stdoutBytes),
    stderr: new TextDecoder().decode(stderrBytes),
    stdoutBytes
  };
}

describe("aliceblue color source", () => {
  for (const [color, alpha] of [["aliceblue", 255], ["AliceBlue", 255], ["aliceblue@0.5", 127]] as const) {
    it(`renders ${color} with the native RGB values`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", `color=c=${color}:s=16x16:r=1:d=1`,
        "-frames:v", "1", "-update", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let offset = 0; offset < image.data.length; offset += 4) {
        assert.deepEqual([...image.data.subarray(offset, offset + 4)], [239, 247, 254, alpha]);
      }
    });
  }
});

describe("pad omitted named parameters", () => {
  for (const [options, width, height, left, top, border] of [
    ["height=8", 6, 8, 0, 0, [0, 0, 0, 255]],
    ["h=8", 6, 8, 0, 0, [0, 0, 0, 255]],
    ["width=10", 10, 4, 0, 0, [0, 0, 0, 255]],
    ["color=red", 6, 4, 0, 0, [255, 0, 0, 255]],
    ["x=2", 6, 4, 0, 0, [0, 0, 0, 255]],
    ["y=2", 6, 4, 0, 0, [0, 0, 0, 255]],
    ["x=1:y=1:w=10:h=8", 10, 8, 1, 1, [0, 0, 0, 255]],
    ["w=10:h=8:color=red", 10, 8, 0, 0, [255, 0, 0, 255]],
    ["10:8:color=red", 10, 8, 0, 0, [255, 0, 0, 255]],
    ["10:8:1:color=red", 10, 8, 1, 0, [255, 0, 0, 255]],
    ["10:8:1:1:eval=frame", 10, 8, 1, 1, [0, 0, 0, 255]],
    ["10:8:1:1:red:frame", 10, 8, 1, 1, [255, 0, 0, 255]]
  ] as const) {
    it(`preserves default parameters and pixels for pad=${options}`, async () => {
      const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 6, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 24 }, (_, i) => [20 + i, 20 + i, 20 + i, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `pad=${options}`, "-frames:v", "1", "/pad.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/pad.png")!);
      assert.equal(output.width, width);
      assert.equal(output.height, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const source = x >= left && x < left + 6 && y >= top && y < top + 4;
          const gray = 20 + (y - top) * 6 + x - left;
          const offset = (y * width + x) * 4;
          assert.deepEqual([...output.data.subarray(offset, offset + 4)], source ? [gray, gray, gray, 255] : [...border]);
        }
      }
    });
  }
});

describe("pad display aspect ratio", () => {
  for (const [options, sar, width, height, left, top] of [
    ["iw:ih:0:0:black:aspect=1/1", 1, 6, 6, 0, 0],
    ["iw:ih:0:0:black:aspect=2/1", 1, 8, 4, 0, 0],
    ["iw:ih:(ow-iw)/2:(oh-ih)/2:black:aspect=1/1", 1, 6, 6, 0, 1],
    ["iw:ih:-1:-1:black:init:2/1", 1, 8, 4, 1, 0],
    ["iw:ih:0:0:black:aspect=1.1", 1, 6, 5, 0, 0],
    ["iw:ih:0:0:black:aspect=0", 1, 6, 4, 0, 0],
    ["iw:ih:0:0:black:aspect=1/1", 2, 6, 12, 0, 0],
    ["w=iw:h=ih:x=0:y=0:aspect=2/1", 2, 6, 6, 0, 0],
    ["aspect=1/1", 1, 6, 6, 0, 0]
  ] as const) {
    it(`honors ${options} with sample aspect ${sar}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 6, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 24 }, (_, i) => [20 + i, 20 + i, 20 + i, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true,
        resolution: { x: sar, y: 1, unit: "unknown" }
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input1.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", sar === 1 ? "/input1.png" : "/input%d.png", "-vf", `pad=${options}`, "-frames:v", "1", "/pad.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/pad.png")!);
      assert.equal(output.width, width);
      assert.equal(output.height, height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const gray = x >= left && x < left + 6 && y >= top && y < top + 4
            ? 20 + (y - top) * 6 + x - left : 0;
          const offset = (y * width + x) * 4;
          assert.deepEqual([...output.data.subarray(offset, offset + 4)], [gray, gray, gray, 255]);
        }
      }
    });
  }

  for (const aspect of ["-1", "1/0", "garbage"]) {
    it(`rejects invalid aspect ${aspect} without replacing output`, async () => {
      const vfs = createTestVfs({ "/pad.png": "original" });
      const original = vfs.store.get("/pad.png");
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=red:s=6x4:d=1",
        "-vf", `pad=iw:ih:aspect=${aspect}`, "-frames:v", "1", "/pad.png"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("pad:"), result.stderr);
      assert.deepEqual(vfs.store.get("/pad.png"), original);
    });
  }
});

describe("pad background alpha", () => {
  for (const [color, alpha] of [["red@0.5", 127], ["red@0", 0], ["0xff000080", 128], ["red", 255]] as const) {
    for (const filter of [
      `pad=4:4:1:1:color=${color}`,
      `pad=4:4:1:1:${color}`,
      `pad=4:4:x=(ow-iw)/2:y=(oh-ih)/2:color=${color}`,
      `pad=4:4:(out_w-in_w)/2:(out_h-in_h)/2:${color}`
    ]) {
      it(`preserves border and source RGBA pixels for ${filter}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 2, height: 2, channels: 4,
          data: new Uint8Array([255, 128, 64, 0].flatMap((a) => [0, 0, 255, a])),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", filter, "-frames:v", "1", "-update", "1", "/pad.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/pad.png")!);
        assert.equal(output.width, 4);
        assert.equal(output.height, 4);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const offset = (y * 4 + x) * 4;
            const source = x >= 1 && x <= 2 && y >= 1 && y <= 2;
            const expected = source ? [0, 0, 255, [255, 128, 64, 0][(y - 1) * 2 + x - 1]] : [255, 0, 0, alpha];
            assert.deepEqual([...output.data.subarray(offset, offset + 4)], expected);
          }
        }
      });
    }
  }
});

describe("pad position expressions", () => {
  for (const [position, left, top] of [
    ["-1:-1", 1, 1],
    ["-2:0", 1, 0],
    ["0:-3", 0, 1],
    ["x=-1:y=2", 1, 2],
    ["x=2:y=-1", 2, 1],
    ["0:0", 0, 0],
    ["2:2", 2, 2],
    ["(ow-iw)/2:(oh-ih)/2", 1, 1]
  ] as const) {
    for (const size of [5, 6]) {
      it(`places source pixels for pad=${size}:${size}:${position}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 3, height: 3, channels: 4,
          data: new Uint8Array(Array.from({ length: 9 }, () => [0, 0, 255, 255]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", `pad=${size}:${size}:${position}:color=red`,
          "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/pad.png")!);
        assert.equal(output.width, size);
        assert.equal(output.height, size);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const source = x >= left && x < left + 3 && y >= top && y < top + 3;
            assert.deepEqual([...output.data.subarray(offset, offset + 4)],
              source ? [0, 0, 255, 255] : [255, 0, 0, 255], `pixel (${x}, ${y})`);
          }
        }
      });
    }
  }

  for (const expression of ["unknown", "1junk", "1/0", "(ow-iw", "unknown(0)"]) {
    for (const axis of ["x", "y"]) {
      it(`rejects unsupported ${axis}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/pad.png": "original" });
        const original = vfs.store.get("/pad.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=blue:s=2x2:r=1:d=1",
          "-vf", `pad=4:4:${axis}=${expression}`, "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("pad: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/pad.png"), original);
      });
    }
  }
});

describe("pad chroma dimensions", () => {
  for (const source of ["yuv420p", "rgba"]) {
    for (const [size, width, height, position] of [
      ["65:49:0:0", 65, 49, 0],
      ["68:52:1:1", 68, 52, 1],
      ["69:53:(ow-iw)/2:(oh-ih)/2", 69, 53, 2]
    ] as const) {
      it(`aligns pad=${size} dimensions and placement for ${source}`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const input = source === "yuv420p"
          ? readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url))
          : encodeImage({ width: 64, height: 48, channels: 4,
            data: new Uint8Array(64 * 48 * 4).fill(255), format: "png", space: "srgb",
            depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
        const path = source === "yuv420p" ? "/in.mp4" : "/in.png";
        const vfs = createTestVfs({ [path]: input });
        const original = await runCmd(createFfmpegCommand(), [
          "-i", path, "-frames:v", "1", "/original.png"
        ], vfs);
        assert.equal(original.exitCode, 0, original.stderr);
        const result = await runCmd(createFfmpegCommand(), [
          "-i", path, "-vf", `pad=${size}:color=red`, "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/pad.png")!);
        const grid = source === "yuv420p" ? 2 : 1;
        assert.equal(output.width, Math.floor(width / grid) * grid);
        assert.equal(output.height, Math.floor(height / grid) * grid);
        const offset = Math.floor(position / grid) * grid;
        const decoded = decodeImage(vfs.store.get("/original.png")!);
        for (let y = 0; y < output.height; y++) {
          for (let x = 0; x < output.width; x++) {
            const i = (y * output.width + x) * 4;
            const inside = x >= offset && x < offset + 64 && y >= offset && y < offset + 48;
            const j = ((y - offset) * 64 + x - offset) * 4;
            assert.deepEqual(output.data.slice(i, i + 4), inside
              ? decoded.data.slice(j, j + 4) : new Uint8Array([255, 0, 0, 255]));
          }
        }
      });
    }
  }
});

describe("pad dimensions", () => {
  for (const filter of ["pad=8:8", "pad=8:32", "pad=32:8", "pad=w=iw/2:h=ih", "pad=width=iw:height=ih/2"]) {
    for (const existing of [false, true]) {
      it(`rejects ${filter} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const vfs = createTestVfs(existing ? { "/pad.png": "original" } : {});
        const original = vfs.store.get("/pad.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
          "-vf", filter, "-frames:v", "1", "/pad.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Padded dimensions cannot be smaller than input dimensions"), result.stderr);
        assert.equal(result.stdoutBytes.length, 0);
        assert.deepEqual(vfs.store.get("/pad.png"), original);
      });
    }
  }

  for (const [filter, width, height] of [
    ["pad=16:16", 16, 16],
    ["pad=32:24", 32, 24],
    ["pad=0:24", 16, 24],
    ["pad=32:0", 32, 16],
    ["scale=16:24,pad=32:0", 32, 24]
  ] as const) {
    it(`accepts ${filter}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
        "-vf", filter, "-frames:v", "1", "/pad.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/pad.png")!);
      assert.equal(image.width, width);
      assert.equal(image.height, height);
    });
  }
});

describe("video filter separators", () => {
  it("accepts the quoted select expression when extracting a PNG", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i", "testsrc=size=16x16:rate=4:duration=1",
      "-vf", "select='not(mod(n,2))'", "-frames:v", "1", "/safe.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    assert.equal(decodeImage(vfs.store.get("/safe.png")!).width, 16);
  });

  for (const expression of ["'not(mod(n,2))'", "not(mod(n\\,2))", "'not(mod(n,'2'))'"]) {
    it(`preserves expression commas in ${expression} and runs the following filter`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "testsrc=size=16x16:rate=4:duration=1",
        "-vf", `select=${expression},scale=8:8`, "/selected_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()], ["/selected_1.png", "/selected_2.png", "/selected_3.png"]);
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      assert.equal(decodeImage(vfs.store.get("/selected_1.png")!).width, 8);
    });
  }
});

describe("rotate frame expressions", () => {
  for (const [filter, expected] of [
    ["rotate=t*PI/2", [28, 27, 68]],
    ["rotate=angle=n*PI/2", [28, 68, 168]],
    ["setpts=PTS*2,rotate=a=t*PI/2", [28, 68, 168]],
    ["select=n,rotate=n*PI/2", [28, 68]]
  ] as const) {
    it(`evaluates ${filter} using the current frame`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 12, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 48 }, (_, i) => [4 * (i + 1), 4 * (i + 1), 4 * (i + 1), 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "2", "-i", "/in%d.png", "-vf", filter,
        "-fps_mode", "passthrough", "-frames:v", "3", "/out-%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const frames = [...vfs.store.keys()].filter(path => path.startsWith("/out-"));
      assert.equal(frames.length, expected.length);
      assert.deepEqual(frames.map(path => decodeImage(vfs.store.get(path)!).data[6 * 4]), expected);
    });
  }
});

describe("rotate bilinear sampling", () => {
  it("uses nearest sampling on native YUV frames", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
    const vfs = createTestVfs({ "/input.mp4": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.mp4", "-vf", "rotate=0.4:bilinear=0", "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodeImage(vfs.store.get("/out.png")!);
    // Native FFmpeg RGBA probes; allow one level for YUV conversion rounding.
    for (const [x, y, expected] of [
      [0, 0, [0, 0, 0, 255]],
      [4, 38, [255, 0, 0, 255]],
      [32, 12, [68, 64, 0, 255]],
      [20, 20, [0, 63, 1, 255]],
      [40, 30, [0, 0, 63, 255]]
    ] as const) {
      for (const [channel, value] of expected.entries()) {
        assert.ok(Math.abs(output.data[(y * 64 + x) * 4 + channel]! - value) <= 1);
      }
    }
  });

  for (const [option, expected] of [
    [":bilinear=0", [100, 24]],
    [":bilinear=false", [100, 24]],
    [":bilinear=1", [115, 69]],
    ["", [115, 69]]
  ] as const) {
    it(`samples decoded RGBA pixels for rotate=0.4${option}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 12, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 48 }, (_, i) => [4 * (i + 1), 4 * (i + 1), 4 * (i + 1), 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `rotate=0.4${option}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      assert.deepEqual([output.data[0], output.data[6 * 4]], expected);
    });
  }
});

describe("rotate timeline enable", () => {
  it("rejects an invalid enable expression without replacing output", async () => {
    const { encodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({
      width: 1, height: 1, channels: 4, data: new Uint8Array([40, 40, 40, 255]),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/in.png": input, "/out.png": input.slice() });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-i", "/in.png", "-vf", "rotate=PI:enable=unknown", "/out.png"
    ], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("rotate enable"), result.stderr);
    assert.deepEqual(vfs.store.get("/out.png"), input);
  });

  for (const [option, expected] of [
    [":enable=gte(n\\,1)", [28, 168, 168]],
    [":enable=between(t\\,0.5\\,0.5)", [28, 168, 28]],
    [":enable=0", [28, 28, 28]],
    [":enable=-1", [168, 168, 168]],
    [":enable=0.25", [28, 28, 28]],
    ["", [168, 168, 168]]
  ] as const) {
    it(`selects frames and preserves decoded pixels for rotate=PI${option}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 12, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 48 }, (_, i) => [4 * (i + 1), 4 * (i + 1), 4 * (i + 1), 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "2", "-i", "/in%d.png", "-vf", `rotate=PI${option}`, "-frames:v", "3", "/out-%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, 6);
      for (const [index, gray] of expected.entries()) {
        const output = decodeImage(vfs.store.get(`/out-${index + 1}.png`)!);
        assert.equal(output.width, 12);
        assert.equal(output.height, 4);
        assert.deepEqual(Array.from(output.data.slice(6 * 4, 7 * 4)), [gray, gray, gray, 255]);
        if (gray === 28) assert.deepEqual(output.data, decodeImage(input).data);
      }
    });
  }
});

describe("rotate fill color", () => {
  for (const [option, expected] of [
    ["", [0, 0, 0, 255]],
    [":c=red", [255, 0, 0, 255]],
    [":fillcolor=red@0.5", [255, 0, 0, 127]],
    [":c=0xff000080", [255, 0, 0, 128]],
    [":fillcolor=blue@0", [0, 0, 255, 0]]
  ] as const) {
    it(`fills uncovered RGBA pixels for rotate=PI/2${option}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 12, height: 4, channels: 4,
        data: new Uint8Array(Array.from({ length: 48 }, (_, i) => [4 * (i + 1), 4 * (i + 1), 4 * (i + 1), 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `rotate=PI/2${option}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(output.width, 12);
      assert.equal(output.height, 4);
      assert.deepEqual(Array.from(output.data.slice(0, 4)), expected);
      assert.equal(output.data[(1 * 12 + 5) * 4 + 3], 255);
    });
  }
});

describe("rotate option validation", () => {
  for (const options of ["0:unknown=1", "0:c=bogus", "0:ow=bad", "0:bilinear=bogus", "0:oh=bad", "0:fillcolor=bogus", "0:out_w=bad", "0:out_h=bad", "0:extra", "angle=bad", "a=bad"]) {
    it(`preserves decoded output for invalid rotate=${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const png = (width: number, height: number, values: number[]) => encodeImage({
        width, height, channels: 4, data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const input = png(12, 4, Array.from({ length: 48 }, (_, i) => 4 * (i + 1)));
      const original = png(1, 1, [99]);
      const vfs = createTestVfs({ "/in.png": input, "/out.png": original });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/in.png", "-vf", `rotate=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("rotate"), result.stderr);
      assert.deepEqual(decodeImage(vfs.store.get("/out.png")!), decodeImage(original));
      assert.deepEqual(vfs.store.get("/out.png"), original);
    });
  }

  for (const filter of ["rotate", "rotate=0", "rotate=angle=0", "rotate=a=PI-PI"]) {
    it(`preserves input pixels for ${filter}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 2, height: 2, channels: 4, data: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255]),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in.png": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.png", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(decodeImage(vfs.store.get("/out.png")!), decodeImage(input));
    });
  }
});

describe("transpose option validation", () => {
  const png = (width: number, height: number, values: number[]) => import("@poe-code/image-ast/portable").then(({ encodeImage }) => encodeImage({
    width, height, channels: 4, data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data);

  for (const [width, height, expected] of [
    [3, 2, [10, 40, 20, 50, 30, 60]],
    [2, 3, [10, 30, 50, 20, 40, 60]],
    [2, 2, [10, 30, 20, 40]]
  ] as const) {
    for (const filter of ["transpose", "transpose=0", "transpose=dir=cclock_flip"]) {
      it(`uses counterclockwise rotation with vertical flip for ${filter} on ${width}x${height}`, async () => {
        const values = [10, 20, 30, 40, 50, 60].slice(0, width * height);
        const vfs = createTestVfs({ "/in.png": await png(width, height, values) });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/in.png", "-vf", filter, "/out.png"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, height);
        assert.equal(output.height, width);
        assert.deepEqual(Array.from(output.data.filter((_, index) => index % 4 === 0)), expected);
      });
    }
  }

  for (const options of ["8", "-1", "bogus", "1:passthrough=bogus", "1:unknown=1", "1:passthrough=-1", "1:passthrough=2147483648", "1:none:extra"]) {
    it(`preserves existing output for invalid transpose=${options}`, async () => {
      const original = await png(1, 1, [99]);
      const vfs = createTestVfs({ "/in.png": await png(3, 2, [10, 20, 30, 40, 50, 60]), "/out.png": original });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-v", "error", "-i", "/in.png", "-vf", `transpose=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("transpose"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.png"), original);
    });
  }

  for (const [width, height, rotated] of [
    [3, 2, [40, 10, 50, 20, 60, 30]],
    [2, 3, [50, 30, 10, 60, 40, 20]],
    [2, 2, [30, 10, 40, 20]]
  ] as const) {
    for (const [options, preserve] of [
      ["1", false], ["dir=clock", false], ["1:passthrough=none", false],
      ["1:passthrough=landscape", width >= height], ["1:1", width >= height],
      ["1:passthrough=portrait", width <= height], ["1:2", width <= height],
      ["5", width >= height]
    ] as const) {
      it(`transposes ${width}x${height} with ${options}`, async () => {
        const values = [10, 20, 30, 40, 50, 60].slice(0, width * height);
        const vfs = createTestVfs({ "/in.png": await png(width, height, values) });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.png", "-vf", `transpose=${options}`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, preserve ? width : height);
        assert.equal(output.height, preserve ? height : width);
        assert.deepEqual(Array.from(output.data.filter((_, index) => index % 4 === 0)), preserve ? values : rotated);
      });
    }
  }
});

describe("legacy transpose directions", () => {
  for (const [direction, portrait] of [
    [4, [10, 30, 50, 20, 40, 60]],
    [5, [50, 30, 10, 60, 40, 20]],
    [6, [20, 40, 60, 10, 30, 50]],
    [7, [60, 40, 20, 50, 30, 10]]
  ] as const) {
    for (const [width, height] of [[3, 2], [2, 3], [2, 2]] as const) {
      for (const options of [`${direction}`, `dir=${direction}`, `${direction}:passthrough=none`]) {
        it(`matches native pixels for transpose=${options} on ${width}x${height}`, async () => {
          const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
          const values = [10, 20, 30, 40, 50, 60].slice(0, width * height);
          const input = encodeImage({
            width, height, channels: 4,
            data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data;
          const vfs = createTestVfs({ "/in.png": input });
          const result = await runCmd(createFfmpegCommand(), [
            "-i", "/in.png", "-vf", `transpose=${options}`, "-frames:v", "1", "/out.png"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const output = decodeImage(vfs.store.get("/out.png")!);
          const preserve = width >= height;
          assert.equal(output.width, preserve ? width : height);
          assert.equal(output.height, preserve ? height : width);
          assert.deepEqual(Array.from(output.data.filter((_, index) => index % 4 === 0)), preserve ? values : portrait);
        });
      }
    }
  }
});

describe("transpose direction expressions", () => {
  for (const [width, height, counterclockwise, flipped] of [
    [3, 2, [30, 60, 20, 50, 10, 40], [60, 30, 50, 20, 40, 10]],
    [2, 3, [20, 40, 60, 10, 30, 50], [60, 40, 20, 50, 30, 10]],
    [2, 2, [20, 40, 10, 30], [40, 20, 30, 10]]
  ] as const) {
    for (const [direction, expected] of [["1+1", counterclockwise], ["2", counterclockwise], ["1+2", flipped], ["3", flipped]] as const) {
      for (const option of [direction, `dir=${direction}`]) {
        it(`evaluates ${option} on ${width}x${height}`, async () => {
          const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
          const values = [10, 20, 30, 40, 50, 60].slice(0, width * height);
          const input = encodeImage({
            width, height, channels: 4,
            data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data;
          const vfs = createTestVfs({ "/in.png": input });
          const result = await runCmd(createFfmpegCommand(), [
            "-i", "/in.png", "-vf", `transpose=${option}`, "-frames:v", "1", "/out.png"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const output = decodeImage(vfs.store.get("/out.png")!);
          assert.equal(output.width, height);
          assert.equal(output.height, width);
          assert.deepEqual(Array.from(output.data.filter((_, index) => index % 4 === 0)), expected);
        });
      }
    }
  }
});

describe("transpose directions", () => {
  // Native FFmpeg's pixel order for a 3x2 image containing rows 1,2,3 / 4,5,6.
  for (const [dir, order] of [
    [0, [1, 4, 2, 5, 3, 6]],
    [1, [4, 1, 5, 2, 6, 3]],
    [2, [3, 6, 2, 5, 1, 4]],
    [3, [6, 3, 5, 2, 4, 1]]
  ] as const) {
    for (const filter of [`transpose=${dir}`, `transpose=dir=${dir}`]) {
      it(`matches native decoded pixels for ${filter}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const pixel = (n: number) => [n * 30, n * 20, n * 10, 255];
        const input = encodeImage({
          width: 3, height: 2, channels: 4,
          data: new Uint8Array([1, 2, 3, 4, 5, 6].flatMap(pixel)),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-v", "error", "-i", "/input.png", "-vf", filter, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, 2);
        assert.equal(output.height, 3);
        assert.deepEqual(output.data, new Uint8Array(order.flatMap(pixel)));
      });
    }
  }
});

describe("drawbox invert color", () => {
  for (const options of ["0:0:2:2:invert:fill", "x=0:y=0:w=2:h=2:color=invert:t=fill", "x=0:y=0:w=2:h=2:c=invert:t=1"]) {
    for (const varied of [false, true]) {
      it(`inverts source RGB and preserves alpha for ${options}, varied=${varied}`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const pixels = Array.from({ length: 64 }, (_, i) => varied
          ? [i * 4, 255 - i * 3, i * 2, i * 4] : [20, 40, 60, 80]);
        const input = encodeImage({
          width: 8, height: 8, channels: 4, data: new Uint8Array(pixels.flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
        const result = await runCmd(createFfmpegCommand(), [
          "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=${options}`,
          "-frames:v", "3", "/out%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const expected = new Uint8Array(pixels.flatMap((pixel, i) =>
          i % 8 < 2 && Math.floor(i / 8) < 2
            ? pixel.map((value, channel) => channel < 3 ? 255 - value : value) : pixel));
        for (let frame = 1; frame <= 3; frame++) {
          const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
          assert.equal(output.width, 8);
          assert.equal(output.height, 8);
          assert.deepEqual(output.data, expected);
        }
      });
    }
  }
});

describe("drawbox timeline enable", () => {
  for (const [enable, activeFrames] of [
    ["0", [false, false, false]],
    ["gte(n\\,1)", [false, true, true]],
    ["between(t\\,1\\,1)", [false, true, false]],
    ["0.25", [false, false, false]],
    ["-1", [true, true, true]]
  ] as const) {
    it(`draws only enabled pixels for ${enable}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 8, height: 8, channels: 4,
        data: new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=0:0:4:4:red:fill:enable=${enable}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (const [index, active] of activeFrames.entries()) {
        const output = decodeImage(vfs.store.get(`/out${index + 1}.png`)!);
        const expected = new Uint8Array(Array.from({ length: 64 }, (_, pixel) =>
          active && pixel % 8 < 4 && Math.floor(pixel / 8) < 4
            ? [255, 0, 0, 80] : [20, 40, 60, 80]).flat());
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual(output.data, expected, `frame ${index}`);
      }
    });
  }
});

describe("drawbox detection box source", () => {
  for (const source of [":box_source=side_data_detection_bboxes", ":0:side_data_detection_bboxes", ""]) {
    it(`respects the selected source ${source || "explicit geometry"} across three frames`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat());
      const input = encodeImage({
        width: 8, height: 8, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=1:1:6:6:red:1${source}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = data.slice();
      if (!source) {
        for (let y = 1; y <= 6; y++) {
          for (let x = 1; x <= 6; x++) {
            if (x === 1 || x === 6 || y === 1 || y === 6) {
              expected.set([255, 0, 0, 80], (y * 8 + x) * 4);
            }
          }
        }
      }
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual(output.data, expected, `frame ${frame}`);
      }
    });
  }
});

describe("drawbox default color", () => {
  for (const options of ["0:0:8:8", "x=0:y=0:w=8:h=8", "0:0:8:8:black:3", "0:0:8:8:red:3"]) {
    it(`matches native RGBA pixels for ${options} across three frames`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 8, height: 8, channels: 4,
        data: new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=${options}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = new Uint8Array(Array.from({ length: 64 }, (_, i) => {
        const x = i % 8;
        const y = Math.floor(i / 8);
        return x >= 3 && x < 5 && y >= 3 && y < 5
          ? [20, 40, 60, 80] : [options.includes("red") ? 255 : 0, 0, 0, 80];
      }).flat());
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual(output.data, expected);
      }
    });
  }
});

describe("drawbox omitted options", () => {
  for (const [filter, color, thickness] of [
    ["drawbox", [0, 0, 0, 80], 3],
    ["drawbox=color=red", [255, 0, 0, 80], 3],
    ["drawbox=t=1", [0, 0, 0, 80], 1],
    ["drawbox=0:0:8:8:black:3", [0, 0, 0, 80], 3],
    ["drawbox=0:0:color=red:t=1", [255, 0, 0, 80], 1]
  ] as const) {
    it(`matches native RGBA pixels for ${filter} across three frames`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 8, height: 8, channels: 4,
        data: new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", filter, "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      // Native FFmpeg preserves destination alpha and draws 60 pixels at t=3, 28 at t=1.
      const expected = new Uint8Array(Array.from({ length: 64 }, (_, i) => {
        const x = i % 8;
        const y = Math.floor(i / 8);
        return x < thickness || y < thickness || x >= 8 - thickness || y >= 8 - thickness
          ? [...color] : [20, 40, 60, 80];
      }).flat());
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/out${frame}.png`)!);
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual(output.data, expected);
      }
    });
  }
});

describe("drawbox geometry references", () => {
  for (const [options, origin, size] of [
    ["1:1:h:3:red:fill", 1, 3],
    ["1:1:3:w:red:fill", 1, 3],
    ["y:2:3:3:red:fill", 2, 3],
    ["2:x:3:3:red:fill", 2, 3],
    ["x=y:y=w:width=h:height=3:color=red:t=fill", 3, 3],
    ["1:1:h:0:red:fill", 1, 8]
  ] as const) {
    it(`matches native decoded pixels for ${options} across three frames`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(Array.from({ length: 64 }, () => [20, 40, 60, 80]).flat());
      const input = encodeImage({
        width: 8, height: 8, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice() });
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "1", "-i", "/in%d.png", "-vf", `drawbox=${options}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = data.slice();
      for (let y = origin; y < Math.min(8, origin + size); y++) {
        for (let x = origin; x < Math.min(8, origin + size); x++) {
          expected.set([255, 0, 0, 80], (y * 8 + x) * 4);
        }
      }
      for (let frame = 1; frame <= 3; frame++) {
        assert.deepEqual(decodeImage(vfs.store.get(`/out${frame}.png`)!).data, expected);
      }
    });
  }

  for (const options of ["y:x:3:3:red:fill", "1:1:h:w:red:fill"]) {
    it(`rejects unresolved references ${options} without overwriting output`, async () => {
      const vfs = createTestVfs({ "/out.png": "original" });
      const original = vfs.store.get("/out.png");
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=c=white:s=8x8:r=1:d=1",
        "-vf", `drawbox=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("drawbox: invalid"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.png"), original);
    });
  }
});

describe("drawbox position expressions", () => {
  for (const options of [
    "x=iw-2:y=ih-2:w=2:h=2:color=red:t=fill",
    "x=iw-w:y=ih-h:w=2:h=2:color=red:t=fill",
    "x=iw-w:y=ih-h:w=iw/2:h=ih/2:color=red:t=fill",
    "in_w-w:in_h-h:in_w/2:in_h/2:red:fill",
    "in_w-2:in_h-2:2:2:red:fill",
    "x=(iw-2)/2+1:y=ih/2:w=2:h=2:color=red:t=fill",
    "x=2.9:y=2.1:w=2:h=2:color=red:t=fill"
  ]) {
    it(`places the box in the bottom-right corner for ${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=white:s=8x8:r=1:d=1",
        "-vf", `scale=4:4,drawbox=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const offset = (y * 4 + x) * 4;
          assert.deepEqual([...image.data.slice(offset, offset + 4)],
            x >= 2 && y >= 2 ? [255, 0, 0, 255] : [255, 255, 255, 255], `pixel (${x},${y})`);
        }
      }
    });
  }

  for (const expression of ["unknown", "1junk", "1/0", "(iw-2", "unknown(0)"]) {
    for (const axis of ["x", "y"]) {
      it(`rejects ${axis}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/out.png": "original" });
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=white:s=4x4:r=1:d=1",
          "-vf", `drawbox=${axis}=${expression}:w=2:h=2:t=fill`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("drawbox: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), original);
      });
    }
  }
});

describe("drawbox dimension expressions", () => {
  // Native FFmpeg on an opaque black 8x8 RGBA input produces these box sizes.
  for (const [dimensions, size] of [
    ["w=4:h=4", 4],
    ["w=iw/2:h=ih/2", 4],
    ["w=iw-2:h=ih-2", 6],
    ["width=in_w/2:height=in_h/2", 4],
    ["w=iw/3:h=ih/3", 2],
    ["w=0:h=0", 8]
  ] as const) {
    it(`matches native pixels for ${dimensions}`, async () => {
      const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(8 * 8 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const input = encodeImage({
        width: 8, height: 8, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `drawbox=x=1:y=1:${dimensions}:color=red:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const offset = (y * 8 + x) * 4;
          assert.deepEqual([...output.data.slice(offset, offset + 4)],
            x >= 1 && x < 1 + size && y >= 1 && y < 1 + size
              ? [255, 0, 0, 255] : [0, 0, 0, 255], `pixel (${x},${y})`);
        }
      }
    });
  }

  for (const dimension of ["w", "h", "width", "height"]) {
    for (const expression of ["unknown", "1junk", "1/0", "(iw-2"]) {
      it(`rejects ${dimension}=${expression} without overwriting output`, async () => {
        const vfs = createTestVfs({ "/out.png": "original" });
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=black:s=8x8:r=1:d=1",
          "-vf", `drawbox=${dimension}=${expression}:t=fill`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("drawbox: invalid"), result.stderr);
        assert.deepEqual(vfs.store.get("/out.png"), original);
      });
    }
  }
});

describe("drawbox thickness", () => {
  for (const [options, thickness] of [
    ["x=2:y=2:w=12:h=12:color=red:t=1", 1],
    ["x=2:y=2:w=12:h=12:color=red:thickness=2", 2],
    ["2:2:12:12:red:1", 1],
    ["x=2:y=2:w=12:h=12:color=red", 3],
    ["x=2:y=2:w=12:h=12:color=red:t=fill", 12],
    ["x=2:y=2:w=12:h=12:color=red:t=0", 0],
    ["x=2:y=2:w=12:h=12:color=red:t=1.5", 1]
  ] as const) {
    it(`matches native decoded pixels for ${options}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=1:d=1",
        "-vf", `drawbox=${options}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(image.width, 16);
      assert.equal(image.height, 16);
      // Native FFmpeg's RGB output has the same border mask (YUV conversion
      // slightly changes the red channel, so compare foreground membership).
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const border = x >= 2 && x < 14 && y >= 2 && y < 14
            && Math.min(x - 2, y - 2, 13 - x, 13 - y) < thickness;
          assert.equal(image.data[(y * 16 + x) * 4]! > 200, border, `pixel (${x},${y})`);
        }
      }
    });
  }
});

describe("safe-bash-command-ffmpeg (ffmpeg & ffprobe)", () => {
  it("inspects MP4 streams and format with ffprobe in json, default, csv, and flat formats", async () => {
    const mp4 = createSyntheticMp4({
      width: 128,
      height: 72,
      fps: 10,
      frameCount: 8,
      includeAudio: true,
      metadata: { title: "Test Clip" }
    });
    const vfs = createTestVfs({ "/clip.mp4": mp4 });
    const ffprobe = createFfprobeCommand();

    // JSON output
    const jsonRes = await runCmd(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", "/clip.mp4"],
      vfs
    );
    assert.equal(jsonRes.exitCode, 0);
    const parsed = JSON.parse(jsonRes.stdout);
    assert.equal(parsed.streams.length, 2);
    assert.equal(parsed.streams[0].codec_name, "h264");
    assert.equal(parsed.streams[0].width, 128);
    assert.equal(parsed.streams[0].height, 72);
    assert.equal(parsed.format.tags.title, "Test Clip");

    // Single value extraction (-of default=noprint_wrappers=1:nokey=1 -select_streams v:0 -show_entries stream=width)
    const widthRes = await runCmd(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        "/clip.mp4"
      ],
      vfs
    );
    assert.equal(widthRes.exitCode, 0);
    assert.equal(widthRes.stdout.trim(), "128");
  });

  it("merges MP4 clips with the concat demuxer/filter and reads protocol parts as bytes", async () => {
    const clip1 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 5 });
    const clip2 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 7 });
    const listTxt = "ffconcat version 1.0\nfile '/clip1.mp4'\nfile '/clip2.mp4'\n";
    const vfs = createTestVfs({
      "/clip1.mp4": clip1,
      "/clip2.mp4": clip2,
      "/head.part": clip1.subarray(0, 19),
      "/tail.part": clip1.subarray(19),
      "/list.txt": listTxt
    });
    const ffmpeg = createFfmpegCommand();

    // 1. -f concat -safe 0 -i /list.txt -c copy /merged_concat_demuxer.mp4
    const r1 = await runCmd(
      ffmpeg,
      ["-f", "concat", "-safe", "0", "-i", "/list.txt", "-c", "copy", "/merged_concat_demuxer.mp4"],
      vfs
    );
    assert.equal(r1.exitCode, 0);
    const doc1 = parseMp4(vfs.store.get("/merged_concat_demuxer.mp4")!);
    assert.equal(doc1.tracks.find((t) => t.type === "video")?.samples.length, 12);

    // 2. concat joins byte fragments before the MP4 parser sees them.
    const r2 = await runCmd(
      ffmpeg,
      ["-i", "concat:/head.part|/tail.part", "-c", "copy", "/merged_protocol.mp4"],
      vfs
    );
    assert.equal(r2.exitCode, 0);
    const doc2 = parseMp4(vfs.store.get("/merged_protocol.mp4")!);
    assert.equal(doc2.tracks.find((t) => t.type === "video")?.samples.length, 5);

    // 3. -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]"
    const r3 = await runCmd(
      ffmpeg,
      [
        "-i",
        "/clip1.mp4",
        "-i",
        "/clip2.mp4",
        "-filter_complex",
        "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
        "/merged_filter.mp4"
      ],
      vfs
    );
    assert.equal(r3.exitCode, 0);
    const doc3 = parseMp4(vfs.store.get("/merged_filter.mp4")!);
    assert.equal(doc3.tracks.find((t) => t.type === "video")?.samples.length, 12);
  });

  it("decides supported formats strictly from the registered AST plugins", async () => {
    const clip = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 4 });
    const vfs = createTestVfs({ "/clip.mp4": clip });

    // Configure ffmpeg with ONLY mp4Ast()
    const mp4OnlyFfmpeg = createFfmpegCommand({ asts: [mp4Ast()] });

    // MP4 -> MP4 succeeds
    const okRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/copy.mp4"], vfs);
    assert.equal(okRes.exitCode, 0);

    // MP4 -> MKV fails because mkvAst() is not registered
    const failRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/out.mkv"], vfs);
    assert.equal(failRes.exitCode, 1);
    assert.ok((failRes.stderr).includes("format AST not registered"));

    // Registered formats include real AAC-to-WAV extraction.
    const fullFfmpeg = createFfmpegCommand({ asts: allMediaAsts() });
    for (const ext of ["mkv", "webm", "ts", "avi", "flv", "y4m", "gif"]) {
      const res = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", `/out.${ext}`], vfs);
      assert.equal(res.exitCode, 0);
      assert.ok((vfs.store.get(`/out.${ext}`)?.byteLength ?? 0) > 10);
    }
    const wav = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", "/out.wav"], vfs);
    assert.equal(wav.exitCode, 0, wav.stderr);
    assert.ok(parseWav(vfs.store.get("/out.wav")!).durationSeconds > 0);
  });

  it("supports lavfi sources, video filters (scale, crop, pad, hflip, hstack), and image sequence extraction", async () => {
    const vfs = createTestVfs();
    const ffmpeg = createFfmpegCommand();

    // Generate MP4 from lavfi testsrc + scale + pad
    const genRes = await runCmd(
      ffmpeg,
      [
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=64x48:rate=10:duration=0.5",
        "-vf",
        "scale=32:24,pad=48:32:8:4:black,hflip",
        "/filtered.mp4"
      ],
      vfs
    );
    assert.equal(genRes.exitCode, 0);
    const filteredDoc = parseMp4(vfs.store.get("/filtered.mp4")!);
    const vTrack = filteredDoc.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.width, 48);
    assert.equal(vTrack.height, 32);
    assert.equal(vTrack.samples.length, 5);

    // Extract frames to PNG sequence
    const seqRes = await runCmd(
      ffmpeg,
      ["-i", "/filtered.mp4", "/frame_%03d.png"],
      vfs
    );
    assert.equal(seqRes.exitCode, 0);
    assert.equal(vfs.store.has("/frame_001.png"), true);
    assert.equal(vfs.store.has("/frame_005.png"), true);

    // Re-assemble PNG sequence back to MP4
    const assembleRes = await runCmd(
      ffmpeg,
      ["-framerate", "10", "-i", "/frame_%03d.png", "/reassembled.mp4"],
      vfs
    );
    assert.equal(assembleRes.exitCode, 0);
    const reassembledDoc = parseMp4(vfs.store.get("/reassembled.mp4")!);
    assert.equal(reassembledDoc.tracks[0]?.samples.length, 5);
  });

  it("enforces consumer-defined resource limits and opt-in/opt-out feature flags", async () => {
    const clip = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 10 });
    const vfs = createTestVfs({ "/clip.mp4": clip });

    let capturedStats: FfmpegCommandsOptions["onMetrics"] extends ((s: infer S) => void) | undefined ? S | undefined : never;
    const boundedFfmpeg = createFfmpegCommand({
      limits: cloudflareWorkerLimits({ maxFrames: 4 }),
      onMetrics(stats) {
        capturedStats = stats;
      }
    });

    // Stream copy (`-c copy`) does NOT decode frames, so 10-frame clip succeeds even with maxFrames: 4!
    const copyRes = await runCmd(boundedFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/copied.mp4"], vfs);
    assert.equal(copyRes.exitCode, 0);
    assert.equal(capturedStats?.decodedFrames, 0);

    // Pixel filter (`-vf negate`) decodes frames and hits maxFrames: 4 limit
    const filterRes = await runCmd(boundedFfmpeg, ["-i", "/clip.mp4", "-vf", "negate", "/neg.mp4"], vfs);
    assert.equal(filterRes.exitCode, 1);
    assert.ok((filterRes.stderr).includes("maxFrames"));

    // Opt-out of videoTranscode (`features: { videoTranscode: false }`)
    const remuxOnlyFfmpeg = createFfmpegCommand({
      features: { videoTranscode: false }
    });
    const optOutRes = await runCmd(remuxOnlyFfmpeg, ["-i", "/clip.mp4", "-vf", "scale=32:32", "/scaled.mp4"], vfs);
    assert.equal(optOutRes.exitCode, 1);
    assert.ok((optOutRes.stderr).includes("disabled by consumer feature configuration"));
  });

  it("supports vstack and stream-selective concat=n=2:v=1:a=0 in -filter_complex and .ffmpeg/.ffprobe properties", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const clip1 = createSyntheticMp4({ width: 32, height: 16, fps: 5, frameCount: 2, includeAudio: true });
    const clip2 = createSyntheticMp4({ width: 32, height: 16, fps: 5, frameCount: 2, includeAudio: true });
    const vfs = createTestVfs({ "/c1.mp4": clip1, "/c2.mp4": clip2 });

    const concatRes = await runCmd(
      ffmpeg,
      ["-i", "/c1.mp4", "-i", "/c2.mp4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "/video_only.mp4"],
      vfs
    );
    assert.equal(concatRes.exitCode, 0);
    const probeRes = await runCmd(
      ffprobe,
      ["-v", "quiet", "-print_format", "json", "-show_streams", "/video_only.mp4"],
      vfs
    );
    const parsed = JSON.parse(probeRes.stdout);
    assert.equal(parsed.streams.length, 1);
    assert.equal(parsed.streams[0].codec_type, "video");
    assert.equal(parsed.streams[0].nb_frames, "4");

    const vstackRes = await runCmd(
      ffmpeg,
      ["-i", "/c1.mp4", "-i", "/c2.mp4", "-filter_complex", "[0:v][1:v]vstack=inputs=2", "/vstacked.mp4"],
      vfs
    );
    assert.equal(vstackRes.exitCode, 0);
    const vstackDoc = parseMp4(vfs.store.get("/vstacked.mp4")!);
    assert.equal(vstackDoc.tracks[0]!.width, 32);
    assert.equal(vstackDoc.tracks[0]!.height, 32);
  });

  it("converts .srt/.vtt subtitles, muxes mov_text/S_TEXT, burns drawtext/subtitles, builds tile contact sheets, and resamples WAV (-ar 16000 -ac 1)", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const video = createSyntheticMp4({ width: 32, height: 24, fps: 5, frameCount: 4, includeAudio: true });
    const srt = "1\n00:00:00,100 --> 00:00:00,700\nTEST SUB\n";
    const vfs = createTestVfs({ "/v.mp4": video, "/s.srt": srt });

    // 1. .srt -> .vtt
    const r1 = await runCmd(ffmpeg, ["-i", "/s.srt", "/s.vtt"], vfs);
    assert.equal(r1.exitCode, 0);
    assert.ok((new TextDecoder().decode(vfs.store.get("/s.vtt")!)).includes("WEBVTT"));

    // 2. Mux video + srt -> subbed.mp4 & extract back to .srt
    const r2 = await runCmd(ffmpeg, ["-i", "/v.mp4", "-i", "/s.srt", "-c", "copy", "/subbed.mp4"], vfs);
    assert.equal(r2.exitCode, 0);
    const r2b = await runCmd(ffmpeg, ["-i", "/subbed.mp4", "/out.srt"], vfs);
    assert.equal(r2b.exitCode, 0);
    assert.ok((new TextDecoder().decode(vfs.store.get("/out.srt")!)).includes("00:00:00,100 --> 00:00:00,700"));

    // 3. drawtext + subtitles + tile=2x2 contact sheet
    const r3 = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-vf", "drawtext=text='F%{n}':x=2:y=2:fontsize=8:box=1,subtitles=/s.srt,tile=2x2", "-frames:v", "1", "/sheet.png"],
      vfs
    );
    assert.equal(r3.exitCode, 0);
    const sheetProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "/sheet.png"], vfs)).stdout);
    assert.equal(sheetProbe.streams[0].width, 64);
    assert.equal(sheetProbe.streams[0].height, 48);

    // 4. Resample actual PCM audio rather than an undecoded AAC track.
    assert.equal((await runCmd(ffmpeg, ["-f", "lavfi", "-i", "sine=frequency=220:duration=1", "/source.wav"], vfs)).exitCode, 0);
    const r4 = await runCmd(ffmpeg, ["-i", "/source.wav", "-ar", "16000", "-ac", "1", "/audio.wav"], vfs);
    assert.equal(r4.exitCode, 0);
    const wavProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "/audio.wav"], vfs)).stdout);
    assert.equal(wavProbe.streams[0].sample_rate, "16000");
    assert.equal(wavProbe.streams[0].channels, 1);
    assert.ok(parseWav(vfs.store.get("/audio.wav")!).tracks[0]!.decodedAudio!.channelData[0]!.some(sample => Math.abs(sample) > .1));
  });

  it("segments MP4 into HLS (.m3u8 + .ts) and rejoins back to MP4, probes chapters, and applies xfade/setpts/reverse", async () => {
    const { ffmpeg, ffprobe } = createFfmpegCommands();
    const video = createSyntheticMp4({ width: 32, height: 24, fps: 10, durationSeconds: 2, includeAudio: true });
    const ffmeta = ";FFMETADATA1\ntitle=Demo\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Intro\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=2000\ntitle=Outro\n";
    const vfs = createTestVfs({ "/v.mp4": video, "/m.ffmeta": ffmeta });

    // 1. HLS segmenting & re-joining
    const hlsRes = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_filename", "/seg_%03d.ts", "/index.m3u8"],
      vfs
    );
    assert.equal(hlsRes.exitCode, 0);
    assert.equal(vfs.store.has("/seg_000.ts"), true);
    // There is no second IDR inside this two-second GOP.
    assert.equal(vfs.store.has("/seg_001.ts"), false);
    assert.match(new TextDecoder().decode(vfs.store.get("/index.m3u8")!), /#EXTINF:2\.000000,/);

    const rejoinRes = await runCmd(ffmpeg, ["-i", "/index.m3u8", "-c", "copy", "/rejoined.mp4"], vfs);
    assert.equal(rejoinRes.exitCode, 0);
    const rejoinDoc = parseMp4(vfs.store.get("/rejoined.mp4")!);
    assert.equal(rejoinDoc.tracks.find((t) => t.type === "video")!.samples.length, 20);

    // 2. Chapters muxing & ffprobe -show_chapters
    const chMux = await runCmd(ffmpeg, ["-i", "/v.mp4", "-i", "/m.ffmeta", "-c", "copy", "/ch.mp4"], vfs);
    assert.equal(chMux.exitCode, 0);
    const chProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_chapters", "/ch.mp4"], vfs)).stdout);
    assert.equal(chProbe.chapters.length, 2);
    assert.equal(chProbe.chapters[0].tags.title, "Intro");
    assert.equal(chProbe.chapters[1].tags.title, "Outro");

    // 3. xfade + setpts + reverse
    const xfRes = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-i", "/v.mp4", "-filter_complex", "[0:v][1:v]xfade=transition=fade:duration=0.4:offset=1.6", "-vf", "setpts=0.5*PTS,reverse", "/xf.mp4"],
      vfs
    );
    assert.equal(xfRes.exitCode, 0);
    const xfDoc = parseMp4(vfs.store.get("/xf.mp4")!);
    assert.equal(xfDoc.tracks.find((t) => t.type === "video")!.samples.length, 36);
  });
});

it("maps MP4 container stream IDs independently of stream ordinals", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true }));
  const audio = doc.tracks.find(track => track.type === "audio")!;
  const input = serializeMp4({ ...doc, tracks: [
    { ...audio, id: 1, language: "eng" },
    { ...audio, id: 2, language: "fra", samples: audio.samples.slice(0, 2) }
  ] });
  const french = parseMp4(input).tracks[1]!;
  for (const maps of [["0:#0x2"], ["0:#2"], ["0:a:1"], ["0:1"], ["0", "-0:#0x1"], ["0:#99?", "0:#2"]]) {
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, `${maps}: ${result.stderr}`);
    const tracks = parseMp4(vfs.store.get("/out.mp4")!).tracks;
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.language, "fra");
    assert.deepEqual(tracks[0]!.samples.map(sample => sample.data), french.samples.map(sample => sample.data));
  }
  const vfs = createTestVfs({ "/in.mp4": input });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0:#0", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(result.exitCode, 234);
  assert.equal(vfs.store.has("/out.mp4"), false);
});

it("rejects required negative maps before any positive stream selection", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true }));
  const audio = doc.tracks.find(track => track.type === "audio")!;
  const input = serializeMp4({ ...doc, tracks: [
    { ...audio, id: 1, language: "eng" },
    { ...audio, id: 2, language: "fra", samples: audio.samples.slice(0, 2) }
  ] });
  for (const maps of [["-0:a:1"], ["0:a:99?", "-0:a:1"], ["-0:a:1", "0:a"]]) {
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 234, `${maps}: ${result.stderr}`);
    assert.ok(result.stderr.includes("matches no streams"));
    assert.equal(vfs.store.has("/out.mp4"), false);
  }
  for (const maps of [["0:a", "-0:a:1"], ["-0:a:1?"], ["-0:a:1?", "0:a:0"]]) {
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, `${maps}: ${result.stderr}`);
    const tracks = parseMp4(vfs.store.get("/out.mp4")!).tracks;
    assert.deepEqual(tracks.map(track => track.language), ["eng"]);
    assert.deepEqual(tracks[0]!.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
  }
});

it("rejects an empty final stream selection without touching the destination", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true }));
  const audio = doc.tracks.find(track => track.type === "audio")!;
  const input = serializeMp4({ ...doc, tracks: [
    { ...audio, id: 1, language: "eng" },
    { ...audio, id: 2, language: "fra", samples: audio.samples.slice(0, 2) }
  ] });
  for (const existing of [false, true]) {
    const vfs = createTestVfs({ "/in.mp4": input, ...(existing ? { "/out.mp4": input } : {}) });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-v", "error", "-i", "/in.mp4", "-map", "0:a", "-map", "-0:a", "-c", "copy", "/out.mp4"
    ], vfs);
    assert.equal(result.exitCode, 234);
    assert.ok(result.stderr.includes("Output file does not contain any stream"));
    assert.deepEqual(vfs.store.get("/out.mp4"), existing ? input : undefined);
  }
  for (const maps of [["0:a", "-0:a:1"], ["0:a", "-0:a", "0:a:0"]]) {
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.mp4", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = parseMp4(vfs.store.get("/out.mp4")!).tracks;
    assert.deepEqual(tracks.map(track => track.language), ["eng"]);
    assert.deepEqual(tracks[0]!.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
  }
});

it("negative maps match input, subtitle, absolute and typed stream indices in order", async () => {
  const bytes = createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5, includeAudio: true });
  for (const [maps, expected] of [
    [["0", "1", "-1:a"], ["video", "audio", "video"]],
    [["0", "-0:1"], ["video"]],
    [["0", "-0:a:0"], ["video"]],
    [["0", "-0:a", "0:a"], ["video", "audio"]],
    [["0", "1", "-1"], ["video", "audio"]]
  ] as const) {
    const vfs = createTestVfs({ "/a.mp4": bytes, "/b.mp4": bytes });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/a.mp4", "-i", "/b.mp4", ...maps.flatMap(m => ["-map", m]), "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.type), expected);
  }
  const vfs = createTestVfs({ "/a.mp4": bytes, "/s.srt": "1\n00:00:00,000 --> 00:00:01,000\nHello\n" });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/s.srt", "-i", "/a.mp4", "-map", "0", "-map", "1", "-map", "-0:s", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.type), ["video", "audio"]);
});

describe("HLS segment type validation", () => {
  for (const value of ["bogus", "", "MPEGTS", "fmp4junk"]) {
    it(`rejects ${JSON.stringify(value)} before changing files`, async () => {
      const input = createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false });
      for (const existing of [false, true]) {
        const vfs = createTestVfs({ "/in.mp4": input,
          ...(existing ? { "/out.m3u8": "original playlist", "/out0.ts": "original segment", "/init.mp4": "original init" } : {}) });
        const before = new Map(vfs.store);
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
          "-hls_segment_type", value, "/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes("invalid hls_segment_type"), result.stderr);
        assert.deepEqual(vfs.store, before);
      }
    });
  }
  it("rejects a missing value", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-hls_segment_type"], vfs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("invalid hls_segment_type"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
});

describe("HLS duration", () => {
  const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 5, includeAudio: false }));
  const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
    ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 2 === 0 }))
  })) });
  for (const value of ["1", "1s", "1000ms", "1000000us", "00:01", "00:00:01", "1.000s"]) {
    it(`segments ${value} on the available keyframes`, async () => {
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
        "-hls_list_size", "0", "-hls_time", value, "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const playlist = new TextDecoder().decode(vfs.store.get("/out.m3u8"));
      assert.deepEqual(playlist.split("\n").filter(line => line.startsWith("#EXTINF:")),
        ["#EXTINF:2.000000,", "#EXTINF:2.000000,", "#EXTINF:1.000000,"]);
    });
  }
  for (const value of ["banana", "1banana", "1000msjunk", "1xms", "", "NaN", "Infinity", "-1", "1e2", "0x10", "1:99", "1::1", "1.2.3", "1 ", "999999999999999999999"]) {
    it(`rejects ${JSON.stringify(value)} without changing files`, async () => {
      for (const existing of [false, true]) {
        const vfs = createTestVfs({ "/in.mp4": input,
          ...(existing ? { "/out.m3u8": "original playlist", "/out0.ts": "original segment" } : {}) });
        const before = new Map(vfs.store);
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", value, "/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes("invalid hls_time"), result.stderr);
        assert.deepEqual(vfs.store, before);
      }
    });
  }
});

it("rejects a missing HLS duration without writing output", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand(), ["-hls_time"], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("invalid hls_time"), result.stderr);
  assert.equal(vfs.store.size, 0);
});

describe("HLS unrecognized flags", () => {
  for (const flags of ["not_a_flag", "+not_a_flag", "-not_a_flag", "omit_endlist+not_a_flag", "not_a_flag+omit_endlist"]) {
    for (const type of ["mpegts", "fmp4"]) {
      it(`rejects ${flags} for ${type} before changing files`, async () => {
        const input = createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false });
        for (const existing of [false, true]) {
          const vfs = createTestVfs({ "/in.mp4": input,
            ...(existing ? { "/out.m3u8": "original playlist", "/out0.ts": "original segment", "/init.mp4": "original init" } : {}) });
          const before = new Map(vfs.store);
          const result = await runCmd(createFfmpegCommand(), [
            "-y", "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
            "-hls_segment_type", type, "-hls_flags", flags, "/out.m3u8"
          ], vfs);
          assert.equal(result.exitCode, 1);
          assert.ok(result.stderr.includes("unrecognized HLS flag"), result.stderr);
          assert.deepEqual(vfs.store, before);
        }
      });
    }
  }
});

describe("HLS temp_file", () => {
  for (const type of ["mpegts", "fmp4"]) {
    for (const [flags, temporary] of [
      [["temp_file"], true], [["+temp_file"], true],
      [["temp_file", "-temp_file"], false],
      [["temp_file", "round_durations"], false],
      [["temp_file", "+round_durations"], true],
      [["single_file+temp_file"], true]
    ] as const) {
      it(`publishes ${type} files with flags ${flags.join(",")}`, async () => {
        const input = createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false });
        const vfs = createTestVfs({ "/in.mp4": input });
        const operations: string[] = [];
        const write = vfs.fs.writeFile;
        const fs = {
          ...vfs.fs,
          async writeFile(path: string, bytes: Uint8Array) {
            operations.push(`write ${path}`);
            await write(path, bytes);
          },
          async rename(from: string, to: string) {
            operations.push(`rename ${from} ${to}`);
            assert.ok(vfs.store.has(from));
            vfs.store.set(to, vfs.store.get(from)!);
            vfs.store.delete(from);
          }
        };
        const args = ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
          "-master_pl_name", "master.m3u8", "/out/main.m3u8"];
        const result = await runCmd(createFfmpegCommand(), [
          ...flags.flatMap(flag => ["-hls_flags", flag]), ...args
        ], { ...vfs, fs });
        assert.equal(result.exitCode, 0, result.stderr);
        const ordinary = createTestVfs({ "/in.mp4": input });
        const baseline = await runCmd(createFfmpegCommand(), [
          ...flags.flatMap(flag => flag.includes("round_durations") ? ["-hls_flags", "round_durations"]
            : flag.includes("single_file") ? ["-hls_flags", "single_file"] : []), ...args
        ], ordinary);
        assert.equal(baseline.exitCode, 0, baseline.stderr);
        assert.deepEqual(vfs.store, ordinary.store);
        const expected = [...ordinary.store.keys()].filter(path => path !== "/in.mp4").flatMap(path =>
          temporary && path !== "/out/init.mp4" &&
          !(flags.some(flag => flag.includes("single_file")) && !path.endsWith(".m3u8"))
            ? [`write ${path}.tmp`, `rename ${path}.tmp ${path}`] : [`write ${path}`]);
        assert.deepEqual(operations, expected);
      });
    }
  }
});

describe("HLS omit_endlist", () => {
  for (const [flags, omit] of [
    [[], false],
    [["omit_endlist"], true],
    [["+omit_endlist"], true],
    [["delete_segments+omit_endlist"], true],
    [["omit_endlist-omit_endlist"], false],
    [["omit_endlist", "+delete_segments"], true],
    [["omit_endlist", "delete_segments"], false],
    [["omit_endlist", "-omit_endlist"], false]
  ] as const) {
    it(`matches native playlist for flags ${JSON.stringify(flags)}`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 2, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
        ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const vfs = createTestVfs({ "/input.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.mp4", "-c", "copy", "-hls_time", "1",
        ...flags.flatMap(flag => ["-hls_flags", flag]), "-hls_segment_filename", "/out%d.ts", "-f", "hls", "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), [
        "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1", "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXTINF:1.000000,", "out0.ts", "#EXTINF:1.000000,", "out1.ts",
        ...(omit ? [] : ["#EXT-X-ENDLIST"]), ""
      ].join("\n"));
      for (const path of ["/out0.ts", "/out1.ts"]) assert.ok(vfs.store.get(path)?.byteLength);
    });
  }
});

// ffmpeg -f lavfi -i testsrc=size=32x32:rate=2:duration=2 -c:v libx264 -pix_fmt yuv420p -g 2 -keyint_min 2 -sc_threshold 0 input.mp4
const hlsH264 = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAB61tZGF0AAACqQYF//+l3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0xIGJfcHlyYW1pZD0wIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTIga2V5aW50X21pbj0yIHNjZW5lY3V0PTAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD0yIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAfdliIQP5nB/rZ5RUfwPK9eu2E+jpNvAOYuNDO+KAuQB3QlWgiQtDDpW+jrEHgN9gWH5sxySbIqd0Pj3uMUnCl0wS9aMS/UJGTwnnmqk3JmhwgfUfvhr1kfuTnwSWUiU2w/v5Bzu67FpmP2en2tvr610FViGs+1PoNgAmpmTs5N1b+jG43/MGXFPoVw9lW2x9kSX3O5G/CgW18ifxdLY8h/DcYIc4yqY7Eeo1HYo/jDGj/lVHYTreIT2nURajQX2dy8Ud8m0j7H/HTkbylDSybkvtTyLrQosbtKcxQICbyU4PFQRZgBHtwJDn61eNrOy4xq43neINJ2OJCV97/AoCh8vS1ro+0dW8eludu2wq7hrMa3JP9QGEETwQ+S1FL4u6mbWAiJGdTXjDtHb+ITJvFh25Ue+gq5eWew5spv6HWYEq57RBje3i1uzyi5UDNaWbzKWgCCMEFwD/AFb47OYsBX0Vt+aIGRNgxTLol7nplDSCsM+4NTd3WF2waa7BpjJoD5TszS6GjA0npj/TxREivp6Dd/PYOVE57/Z4r8qu6ER1PUlIwn76R5bHNoWGVmYxXefg+VHfGzKUhGDpR1wvgkx5rJZiJIBgS1LbaPCFpSa0ibDI9g7S8BRhBB7JqQl4kQcTIEx1NNgtuL6Kfc/nD+Rv8/MKSaZwQAAAIdBmiWxX0L+chTHAlOXn5VH/AvleMetQOErrTIt/+soe5Rq9mr3Hy/BSwf0OA2CFPajBImLCauOknJu8ZkwMfpm9SuH/3TmLsAAcWGoJo4KXVDI6YjGHCioAd3P0WfGS1FdrsaOvz5un0nyvb/qQLKlOOvdVFDEpdYNt3+kwdSypaLg8QoYGeAAAAH3ZYiCA//mcH+tnlFR/A8r167YT6Ok28A5i40M74oC5AHdCVaCJC0MOlb6OsQeA32BYfmzHJJsip3Q+Pe4xScKXTBL1oxL9QkZPCeeaqTcmaHCB9R++GvWR+5OfBJZSJTbD+/kHO7rsWmY/Z6fa2+vrXQVWIaz7U+g2ACamZOzk3Vv6Mbjf8wZcU+hXD2VbbH2RJfc7kb8KBbXyJ/F0tjyH8NxghzjKpjsR6jUdij+MMaP+VUdhOt4hPadRFqNBfZ3LxR3ybSPsf8dORvKUNLJuS+1PIutCixu0pzFAgJvJTg8VBFmAEe3AkOfrV42s7LjGrjed4g0nY4kJX3v8CgKHy9LWuj7R1bx6W527bCruuqt647kn+oDCCJ4IfJaioKD264qfgLmd4arRdlfqLRAq8PW3WSudLvIM4zS5dYnHrV20g7A8gIyvw6t4V3n1KPGu4ZEIvUU5woagI6DRHdgAEntwUPlC9e9OelutNHhgEJwVQzpeh/Oq+KXkG3jHYX0333MRsM4UmwXHdZegujM4kGimcgvqUi7jQMGHGXCM3GRA3bnBtR/n4G1KaFkzQWiV4TB1d/aLCEUTNsRo8WZsuBpJCR5MU4njSfQAdz+HCozo0APyFtvAT51jnaSAapI35CeleLDD4g8pv4PFnmj8Y7us8JoKsEAAABzQZolsTdQsEv/9N96yIh5jnd1M4FIwuwCn3kpsXs2zqlFogRHwiTTf0FMfO4jI9GNxJIVtIZBMp0JJyLypPPJDez+T2iRZuaj3gAcjU6nLkfpyHIYTSh2v3MFbahgS66YykK+pvXAYvj7q5wso8hi84oFYAAAA1Rtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAH0AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACf3RyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAH0AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAIAAAACAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAB9AAACAAAAEAAAAAAfdtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAEAAAACAAFXEAAAAAAAtaGRscgAAAAAAAAAAdmlkZQAAAAAAAAAAAAAAAFZpZGVvSGFuZGxlcgAAAAGibWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABYnN0YmwAAAC+c3RzZAAAAAAAAAABAAAArmF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAIAAgAEgAAABIAAAAAAAAAAEUTGF2YzYzLjEuMTAxIGxpYngyNjQAAAAAAAAAAAAAAAAY//8AAAA0YXZjQwFkAAr/4QAXZ2QACqzkJbARAAADAAEAAAMABA8SJRIBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAHpQAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAQAACAAAAAAGHN0c3MAAAAAAAAAAgAAAAEAAAADAAAAGGN0dHMAAAAAAAAAAQAAAAQAACAAAAAAHHN0c2MAAAAAAAAAAQAAAAEAAAAEAAAAAQAAACRzdHN6AAAAAAAAAAAAAAAEAAAEqAAAAIsAAAH7AAAAdwAAABRzdGNvAAAAAAAAAAEAAAAwAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMQ==", "base64");

for (const type of ["mpegts", "fmp4"]) {
  it(`preserves H.264 packets and decode timestamps in ${type} HLS with an edit list`, async () => {
    const source = parseMp4(hlsH264).tracks[0]!;
    assert.ok(source.editList?.some(edit => edit.mediaTime > 0));
    const vfs = createTestVfs({ "/in.mp4": hlsH264 });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type, "-hls_segment_filename", `/preserved_%03d.${type === "fmp4" ? "m4s" : "ts"}`, "/out.m3u8"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = [0, 1].map(i => type === "fmp4"
      ? parseMp4(concatBytes([vfs.store.get("/init.mp4")!, vfs.store.get(`/preserved_00${i}.m4s`)!])).tracks[0]!
      : parseMpegTs(vfs.store.get(`/preserved_00${i}.ts`)!).tracks[0]!);
    assert.deepEqual(tracks.map(track => track.samples.length), [2, 2]);
    assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => [...sample.data])), source.samples.map(sample => [...sample.data]));
    if (type === "fmp4") {
      assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.dts / track.timescale)), source.samples.map(sample => sample.dts / source.timescale));
      assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => sample.pts / track.timescale)), source.samples.map(sample => sample.pts / source.timescale));
    }
  });
}

describe("HLS cut schedule", () => {
  for (const type of ["mpegts", "fmp4"]) {
    it(`keeps ${type} cuts on the original timeline after a late keyframe`, async () => {
      const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 36 }));
      const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
        ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 8 === 0 }))
      })) });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-c", "copy", "-hls_time", "3", "-hls_list_size", "0",
        "-hls_segment_type", type, "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const lines = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
      assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")),
        [4, 2, 3].map(duration => `#EXTINF:${duration.toFixed(6)},`));
      assert.ok(lines.includes("#EXT-X-TARGETDURATION:4"));
      const tracks = [0, 1, 2].map(index => type === "fmp4"
        ? parseMp4(concatBytes([vfs.store.get("/init.mp4")!, vfs.store.get(`/out${index}.m4s`)!])).tracks.find(track => track.type === "video")!
        : parseMpegTs(vfs.store.get(`/out${index}.ts`)!).tracks.find(track => track.type === "video")!);
      assert.deepEqual(tracks.map(track => track.samples.length), [16, 8, 12]);
      assert.deepEqual(tracks.flatMap(track => track.samples.map(sample => [...sample.data])),
        source.tracks[0]!.samples.map(sample => [...sample.data]));
    });
  }
});

describe("HLS round_durations", () => {
  for (const [flags, enabled, version] of [
    [[], false, 3],
    [["round_durations"], true, 2],
    [["+round_durations"], true, 2],
    [["round_durations", "+omit_endlist"], true, 2],
    [["round_durations", "omit_endlist"], false, 3],
    [["round_durations-round_durations"], false, 3],
    [["round_durations", "-round_durations"], false, 3],
    [["single_file+round_durations"], true, 4],
    [["independent_segments+round_durations"], true, 6]
  ] as const) {
    for (const type of ["mpegts", "fmp4"]) {
      for (const [fps, frameCount, keyInterval, durations, rounded] of [
        [4, 20, 8, [2, 2, 1], [2, 2, 1]],
        [10, 20, 16, [1.6, 0.4], [2, 0]]
      ] as const) {
        it(`handles ${JSON.stringify(flags)} with ${type} and durations ${durations}`, async () => {
          const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps, frameCount }));
          const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
            ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % keyInterval === 0 }))
          })) });
          const vfs = createTestVfs({ "/in.mp4": input });
          const result = await runCmd(createFfmpegCommand(), [
            "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", "0",
            "-hls_segment_type", type, ...flags.flatMap(flag => ["-hls_flags", flag]), "/out.m3u8"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const lines = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
          assert.equal(lines[1], `#EXT-X-VERSION:${type === "fmp4" ? 7 : version}`);
          assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")),
            (enabled ? rounded : durations.map(duration => duration.toFixed(6))).map(duration => `#EXTINF:${duration},`));
          assert.ok(lines.includes("#EXT-X-TARGETDURATION:2"));
        });
      }
    }
  }
});

describe("HLS discont_start", () => {
  for (const [flags, enabled] of [
    [[], false],
    [["discont_start"], true],
    [["+discont_start"], true],
    [["discont_start", "+omit_endlist"], true],
    [["discont_start", "omit_endlist"], false],
    [["discont_start-discont_start"], false],
    [["discont_start", "-discont_start"], false],
    [["single_file+discont_start"], true]
  ] as const) {
    for (const type of ["mpegts", "fmp4"]) {
      for (const listSize of [0, 1]) {
        it(`handles ${JSON.stringify(flags)} with ${type} and list size ${listSize}`, async () => {
          const vfs = createTestVfs({ "/in.mp4": hlsH264 });
          const result = await runCmd(createFfmpegCommand(), [
            "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
            "-hls_list_size", String(listSize), "-start_number", "5",
            ...flags.flatMap(flag => ["-hls_flags", flag]), "/out.m3u8"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const lines = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
          const marked = enabled && listSize === 0;
          assert.equal(lines.filter(line => line === "#EXT-X-DISCONTINUITY").length, marked ? 1 : 0);
          if (marked) assert.equal(lines[lines.findIndex(line => line.startsWith("#EXTINF:")) - 1], "#EXT-X-DISCONTINUITY");
          assert.equal(lines.filter(line => line === "#EXTINF:1.000000,").length, listSize === 0 ? 2 : 1);
          assert.ok(lines.includes(`#EXT-X-MEDIA-SEQUENCE:${flags.some(flag => flag.includes("single_file")) ? 0 : listSize === 0 ? 5 : 6}`));
        });
      }
    }
  }
});

describe("HLS independent_segments", () => {
  for (const [flags, enabled] of [
    [["independent_segments"], true],
    [["omit_endlist+independent_segments"], true],
    [["independent_segments", "+omit_endlist"], true],
    [["independent_segments", "omit_endlist"], false],
    [["independent_segments-independent_segments"], false],
    [["independent_segments", "-independent_segments"], false],
    [[], false]
  ] as const) {
    for (const type of ["mpegts", "fmp4"]) {
      it(`handles ${JSON.stringify(flags)} with ${type}`, async () => {
        const vfs = createTestVfs({ "/in.mp4": hlsH264 });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
          ...flags.flatMap(flag => ["-hls_flags", flag]), "/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const lines = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
        assert.equal(lines[1], `#EXT-X-VERSION:${type === "fmp4" ? 7 : enabled ? 6 : 3}`);
        assert.equal(lines.includes("#EXT-X-INDEPENDENT-SEGMENTS"), enabled);
        if (enabled) assert.ok(lines.indexOf("#EXT-X-INDEPENDENT-SEGMENTS") < lines.findIndex(line => line.startsWith("#EXTINF:")));
        assert.equal(lines.filter(line => line === "#EXTINF:1.000000,").length, 2);
      });
    }
  }

  it("does not advertise a segment starting with a dependent video sample", async () => {
    const doc = parseMp4(hlsH264);
    const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index === 0 ? false : sample.isKeyframe }))
    })) });
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_flags", "independent_segments", "/out.m3u8"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const playlist = new TextDecoder().decode(vfs.store.get("/out.m3u8"));
    assert.ok(!playlist.includes("#EXT-X-INDEPENDENT-SEGMENTS"));
    assert.ok(playlist.includes("#EXT-X-VERSION:3"));
  });
});

describe("HLS base URL", () => {
  for (const type of ["mpegts", "fmp4"]) {
    for (const singleFile of [false, true]) {
      for (const baseUrl of ["", "media/", "https://cdn.example/video?segment="]) {
        it(`prefixes only media URIs (${type}, single=${singleFile}, base=${baseUrl})`, async () => {
          const input = createSyntheticMp4({ width: 32, height: 32, fps: 2, frameCount: 4 });
          const control = createTestVfs({ "/in.mp4": input });
          const actual = createTestVfs({ "/in.mp4": input });
          const args = ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
            ...(singleFile ? ["-hls_flags", "single_file"] : []), "/hls/out.m3u8"];
          const baseline = await runCmd(createFfmpegCommand(), args, control);
          assert.equal(baseline.exitCode, 0, baseline.stderr);
          const result = await runCmd(createFfmpegCommand(), ["-hls_base_url", baseUrl, ...args], actual);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual([...actual.store.keys()], [...control.store.keys()]);
          for (const [path, bytes] of control.store) {
            if (path === "/hls/out.m3u8") {
              const expected = new TextDecoder().decode(bytes).split("\n")
                .map(line => line && !line.startsWith("#") ? baseUrl + line : line).join("\n");
              assert.equal(new TextDecoder().decode(actual.store.get(path)), expected);
            } else assert.deepEqual(actual.store.get(path), bytes);
          }
        });
      }
    }
  }
  it("rejects a missing base URL before writing output", async () => {
    const vfs = createTestVfs({});
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "color=s=16x16:d=1", "-hls_base_url"], vfs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("hls_base_url"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
});

describe("HLS fMP4 initialization", () => {
  it("preserves AAC priming, tail packets and timestamps across video segments", async () => {
    // FFmpeg: testsrc2=size=32x24:rate=4:duration=5 + sine=frequency=440:sample_rate=8000:duration=5
    // -c:v libx264 -threads 1 -g 8 -keyint_min 8 -sc_threshold 0 -bf 0 -c:a aac
    const input = readFileSync(new URL("./fixtures/hls-aac.mp4", import.meta.url));
    const source = parseMp4(input);
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", "0",
      "-hls_segment_type", "fmp4", "/out.m3u8"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const segments = [0, 1, 2].map(i => parseMp4(concatBytes([
      vfs.store.get("/init.mp4")!, vfs.store.get(`/out${i}.m4s`)!
    ])));
    assert.deepEqual(segments.map(doc => doc.tracks.find(track => track.type === "audio")!.samples.length), [17, 16, 8]);
    for (const track of source.tracks) {
      const samples = segments.flatMap(doc => doc.tracks.find(row => row.id === track.id)!.samples);
      assert.deepEqual(samples.map(sample => [...sample.data]), track.samples.map(sample => [...sample.data]));
      // Native FFmpeg retains priming at zero and shifts video by the same 1024/8000 seconds.
      const shift = track.type === "video" ? Math.round(1024 / 8000 * track.timescale) : 0;
      assert.deepEqual(samples.map(({ dts, pts, duration }) => ({ dts, pts, duration })),
        track.samples.map(({ dts, pts, duration }) => ({ dts: dts + shift, pts: pts + shift, duration })));
      assert.equal(segments[0]!.tracks.find(row => row.id === track.id)!.editList, undefined);
    }
  });
  it("rejects a missing initialization filename before writing output", async () => {
    const vfs = createTestVfs({});
    const result = await runCmd(createFfmpegCommand(), ["-hls_fmp4_init_filename"], vfs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("missing hls_fmp4_init_filename"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
  for (const { includeAudio, initFilename } of [false, true].flatMap(includeAudio =>
    [undefined, "setup.mp4"].map(initFilename => ({ includeAudio, initFilename })))) {
    it(`writes an initialization map and continuous fragments (audio=${includeAudio}, init=${initFilename ?? "default"})`, async () => {
      const source = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 2, frameCount: 4, includeAudio }));
      const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
        ...track, samples: track.samples.map((sample, i) => ({ ...sample, isKeyframe: i % 2 === 0 }))
      })) });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", "fmp4",
        ...(initFilename === undefined ? [] : ["-hls_fmp4_init_filename", initFilename]),
        "-hls_segment_filename", "/hls/part%d.m4s", "-f", "hls", "/hls/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/hls/out.m3u8")), [
        "#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-TARGETDURATION:1", "#EXT-X-MEDIA-SEQUENCE:0",
        `#EXT-X-MAP:URI="${initFilename ?? "init.mp4"}"`, "#EXTINF:1.000000,", "part0.m4s",
        "#EXTINF:1.000000,", "part1.m4s", "#EXT-X-ENDLIST", ""
      ].join("\n"));
      if (initFilename) assert.equal(vfs.store.has("/hls/init.mp4"), false);
      const init = vfs.store.get(`/hls/${initFilename ?? "init.mp4"}`)!;
      assert.deepEqual(parseMp4Boxes(init).map(box => box.type), ["ftyp", "moov"]);
      for (let i = 0; i < 2; i++) {
        const fragment = vfs.store.get(`/hls/part${i}.m4s`)!;
        assert.deepEqual(parseMp4Boxes(fragment).map(box => box.type), ["moof", "mdat"]);
        const track = parseMp4(concatBytes([init, fragment])).tracks[0]!;
        assert.equal(track.samples[0]!.dts / track.timescale, i);
      }
      const remux = await runCmd(createFfmpegCommand(), ["-i", "/hls/out.m3u8", "-c", "copy", "/joined.mp4"], vfs);
      assert.equal(remux.exitCode, 0, remux.stderr);
      const joined = parseMp4(vfs.store.get("/joined.mp4")!);
      assert.equal(joined.tracks.length, source.tracks.length);
      assert.equal(joined.tracks[0]!.samples.length, 4);
      assert.equal(joined.durationSeconds, 2);
      for (const [i, track] of joined.tracks.entries()) {
        assert.deepEqual(track.samples.map(sample => sample.data), source.tracks[i]!.samples.map(sample => sample.data));
      }
      const probe = await runCmd(createFfprobeCommand(), ["-v", "quiet", "-show_streams", "-of", "json", "/hls/out.m3u8"], vfs);
      assert.equal(probe.exitCode, 0, probe.stderr);
      assert.equal(JSON.parse(probe.stdout).streams[0].codec_name, "h264");
    });
  }
});

describe("HLS filename templates", () => {
  for (const type of ["mpegts", "fmp4"]) {
    for (const pattern of ["fixed.ts", "escaped%%d.ts", "bad%q.ts"]) {
      it(`rejects ${pattern} for ${type} before writing any output`, async () => {
        const input = createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false });
        for (const existing of [false, true]) {
          const vfs = createTestVfs({ "/in.mp4": input,
            ...(existing ? { "/fixed.ts": "original segment", "/out.m3u8": "original playlist", "/init.mp4": "original init" } : {}) });
          const before = new Map(vfs.store);
          const result = await runCmd(createFfmpegCommand(), [
            "-y", "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_list_size", "0",
            "-hls_segment_type", type, "-hls_segment_filename", pattern, "/out.m3u8"
          ], vfs);
          assert.equal(result.exitCode, 1);
          assert.ok(result.stderr.includes("Invalid segment filename template"), result.stderr);
          assert.deepEqual(vfs.store, before);
        }
      });
    }
  }
});

describe("HLS single_file", () => {
  for (const overwrite of [[], ["-n"], ["-y"]]) {
    it(`protects an existing media object (${overwrite.join(" ") || "default"})`, async () => {
      const vfs = createTestVfs({
        "/in.mp4": createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false }),
        "/out.ts": "original media"
      });
      const before = new Map(vfs.store);
      const result = await runCmd(createFfmpegCommand(), [
        ...overwrite, "-i", "/in.mp4", "-c", "copy", "-hls_flags", "single_file", "/out.m3u8"
      ], vfs);
      if (overwrite.includes("-y")) {
        assert.equal(result.exitCode, 0, result.stderr);
        assert.ok(vfs.store.has("/out.m3u8"));
        assert.notDeepEqual(vfs.store.get("/out.ts"), before.get("/out.ts"));
      } else {
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes("already exists"), result.stderr);
        assert.deepEqual(vfs.store, before);
      }
    });
  }
  it("enforces the output limit on the complete media object", async () => {
    const source = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: false }));
    const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
      ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
    })) });
    const args = ["-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_flags", "single_file", "/out.m3u8"];
    const vfs = createTestVfs({ "/in.mp4": input });
    assert.equal((await runCmd(createFfmpegCommand(), args, vfs)).exitCode, 0);
    const limited = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand({ limits: { maxOutputBytes: vfs.store.get("/out.ts")!.length - 1 } }), args, limited);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("maxOutputBytes"), result.stderr);
    assert.deepEqual([...limited.store.keys()], ["/in.mp4"]);
  });
  for (const type of ["mpegts", "fmp4"]) {
    for (const windowed of [false, true]) {
      for (const custom of [false, true]) {
        it(`writes valid byte ranges for ${type} (window=${windowed}, custom=${custom})`, async () => {
          const source = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 3, includeAudio: true }));
          const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
            ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
          })) });
          const vfs = createTestVfs({ "/in.mp4": input });
          const name = custom ? "fixed%03d.bin" : `out.${type === "fmp4" ? "m4s" : "ts"}`;
          const result = await runCmd(createFfmpegCommand(), [
            "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-hls_segment_type", type,
            "-hls_flags", "single_file+delete_segments", "-hls_list_size", windowed ? "1" : "0",
            ...(custom ? ["-hls_segment_filename", `/hls/${name}`, "-hls_fmp4_init_filename", "setup.mp4"] : []), "/hls/out.m3u8"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          assert.deepEqual([...vfs.store.keys()].sort(), ["/in.mp4", "/hls/out.m3u8", `/hls/${name}`].sort());
          const media = vfs.store.get(`/hls/${name}`)!;
          const lines = new TextDecoder().decode(vfs.store.get("/hls/out.m3u8")).split("\n");
          assert.ok(lines.includes(`#EXT-X-VERSION:${type === "fmp4" ? 7 : 4}`));
          let init = new Uint8Array();
          if (type === "fmp4") {
            const map = lines.find(line => line.startsWith("#EXT-X-MAP:"))!;
            const length = Number(map.split('BYTERANGE="')[1]!.split("@")[0]);
            assert.equal(map, `#EXT-X-MAP:URI="${name}",BYTERANGE="${length}@0"`);
            init = media.slice(0, length);
            assert.deepEqual(parseMp4Boxes(init).map(box => box.type), ["ftyp", "moov"]);
          }
          const ranges = lines.filter(line => line.startsWith("#EXT-X-BYTERANGE:"));
          assert.equal(ranges.length, windowed ? 1 : 3);
          let end = init.length;
          for (const [i, range] of ranges.entries()) {
            const [length, offset] = range.slice("#EXT-X-BYTERANGE:".length).split("@").map(Number) as [number, number];
            if (!windowed) assert.equal(offset, end);
            else assert.ok(offset > end);
            assert.ok(length > 0);
            assert.equal(lines[lines.indexOf(range) + 1], name);
            const bytes = media.subarray(offset, offset + length);
            const doc = type === "fmp4" ? parseMp4(concatBytes([init, bytes])) : parseMpegTs(bytes);
            const video = doc.tracks.find(track => track.type === "video")!;
            assert.equal(video.samples.length, 1);
            assert.deepEqual(video.samples[0]!.data, source.tracks[0]!.samples[windowed ? 2 : i]!.data);
            end = offset + length;
          }
          assert.equal(end, media.length);
        });
      }
    }
  }
});

describe("HLS segment basenames", () => {
  for (const template of [undefined, "out/sub/p%02d.ts", "/elsewhere/sub/p%02d.ts"]) {
    for (const baseUrl of ["", "cdn/"]) {
      it(`keeps segment locations and lists basenames (${template ?? "default"}, ${baseUrl})`, async () => {
        const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 4, includeAudio: false }));
        const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
          ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
        })) });
        const vfs = createTestVfs({ "/in.mp4": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1",
          ...(template ? ["-hls_segment_filename", template] : []),
          "-hls_base_url", baseUrl, "/out/main.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const names = Array.from({ length: 4 }, (_, i) => template ? `p0${i}.ts` : `main${i}.ts`);
        const directory = template?.startsWith("/") ? "/elsewhere/sub" : template ? "/out/sub" : "/out";
        assert.deepEqual([...vfs.store.keys()].sort(), ["/in.mp4", "/out/main.m3u8", ...names.map(name => `${directory}/${name}`)].sort());
        for (const name of names) assert.ok(vfs.store.get(`${directory}/${name}`)?.byteLength);
        const playlist = new TextDecoder().decode(vfs.store.get("/out/main.m3u8"));
        assert.deepEqual(playlist.split("\n").filter(line => line && !line.startsWith("#")), names.map(name => baseUrl + name));
      });
    }
  }
});

describe("HLS start_number", () => {
  for (const [pattern, names] of [
    [undefined, ["out5.ts", "out6.ts"]],
    ["/hls/part%d.ts", ["part5.ts", "part6.ts"]],
    ["/hls/part%03d.ts", ["part005.ts", "part006.ts"]],
    ["/hls/part%%_%03d.ts", ["part%%_005.ts", "part%%_006.ts"]]
  ] as const) {
    for (const windowed of [false, true]) {
      it(`starts sequences and filenames at five with ${pattern ?? "default names"} (windowed=${windowed})`, async () => {
        const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 2, frameCount: 4, includeAudio: false }));
        const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
          ...track, samples: track.samples.map((sample, i) => ({ ...sample, isKeyframe: i % 2 === 0 }))
        })) });
        const vfs = createTestVfs({ "/in.mp4": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.mp4", "-c", "copy", "-hls_time", "1", "-start_number", "5",
          ...(pattern ? ["-hls_segment_filename", pattern] : []),
          ...(windowed ? ["-hls_list_size", "1", "-hls_flags", "delete_segments"] : []),
          "-f", "hls", "/hls/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(new TextDecoder().decode(vfs.store.get("/hls/out.m3u8")), [
          "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1",
          `#EXT-X-MEDIA-SEQUENCE:${windowed ? 6 : 5}`,
          ...names.slice(windowed ? 1 : 0).flatMap(name => ["#EXTINF:1.000000,", name]),
          "#EXT-X-ENDLIST", ""
        ].join("\n"));
        for (const name of names) assert.ok(vfs.store.get(`/hls/${name}`)?.byteLength);
      });
    }
  }
});

describe("HLS playlist types", () => {
  for (const type of ["vod", "event"]) {
    for (const typeFirst of [false, true]) {
      it(`retains every ${type} entry and segment (type first=${typeFirst})`, async () => {
        const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: 7, includeAudio: false }));
        const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
          ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
        })) });
        const vfs = createTestVfs({ "/in.mp4": input });
        const typeArgs = ["-hls_playlist_type", type];
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.mp4", "-c", "copy", "-hls_time", "1",
          ...(typeFirst ? typeArgs : []),
          "-hls_list_size", "0", "-hls_list_size", "1",
          ...(!typeFirst ? typeArgs : []),
          "-hls_flags", "delete_segments", "-start_number", "5", "/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const playlist = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
        assert.ok(playlist.includes(`#EXT-X-PLAYLIST-TYPE:${type.toUpperCase()}`));
        assert.ok(playlist.includes("#EXT-X-MEDIA-SEQUENCE:5"));
        assert.ok(playlist.includes("#EXT-X-ENDLIST"));
        const names = Array.from({ length: 7 }, (_, i) => `out${i + 5}.ts`);
        assert.deepEqual(playlist.filter(line => line && !line.startsWith("#")), names);
        for (const name of names) assert.ok(vfs.store.get(`/${name}`)?.byteLength);
      });
    }
  }

  for (const value of ["live", "VOD", "", undefined]) {
    it(`rejects invalid playlist type ${JSON.stringify(value)} without writing output`, async () => {
      const vfs = createTestVfs({ "/out.m3u8": "original" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=s=16x16:d=1", "/out.m3u8",
        "-hls_playlist_type", ...(value === undefined ? [] : [value])
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("hls_playlist_type"), result.stderr);
      assert.deepEqual([...vfs.store.keys()], ["/out.m3u8"]);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), "original");
    });
  }
});

describe("HLS playlist windows", () => {
  for (const [seconds, size, first] of [[5, "2", 3], [5, undefined, 0], [7, undefined, 2], [7, "0", 0], [5, "10", 0], [5, "1", 4]] as const) {
    it(`retains the final window for ${seconds} segments and size ${size ?? "default"}`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 1, frameCount: seconds, includeAudio: false }));
      const input = serializeMp4({ ...doc, tracks: doc.tracks.map(track => ({
        ...track, samples: track.samples.map(sample => ({ ...sample, isKeyframe: true }))
      })) });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-c", "copy", "-hls_time", "1",
        ...(size === undefined ? [] : ["-hls_list_size", size]),
        "-hls_segment_filename", "/out%d.ts", "-f", "hls", "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), [
        "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1",
        `#EXT-X-MEDIA-SEQUENCE:${first}`,
        ...Array.from({ length: seconds - first }, (_, i) => ["#EXTINF:1.000000,", `out${first + i}.ts`]).flat(),
        "#EXT-X-ENDLIST", ""
      ].join("\n"));
      for (let i = 0; i < seconds; i++) assert.ok(vfs.store.get(`/out${i}.ts`)?.byteLength);
    });
  }

  for (const size of ["-1", "bad", ""]) {
    it(`rejects invalid list size ${JSON.stringify(size)} without writing output`, async () => {
      const vfs = createTestVfs({ "/out.m3u8": "original" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=s=16x16:d=1", "-hls_list_size", size, "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("hls_list_size"), result.stderr);
      assert.deepEqual([...vfs.store.keys()], ["/out.m3u8"]);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), "original");
    });
  }
});

describe("HLS expired segment deletion", () => {
  for (const value of ["0", "-1", "1.5", "invalid"]) {
    it(`rejects invalid deletion threshold ${value} without changing output`, async () => {
      const vfs = createTestVfs({ "/out.m3u8": "original" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-hls_delete_threshold", value, "/out.m3u8"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("invalid hls_delete_threshold"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), "original");
    });
  }
  // Native FFmpeg: five one-second segments, rolling playlists, and retained files.
  for (const [name, options, sequence, retained] of [
    ["default retention", ["-hls_list_size", "2", "-hls_flags", "delete_segments"], 3, [2, 3, 4]],
    ["without deletion", ["-hls_list_size", "2"], 3, [0, 1, 2, 3, 4]],
    ["unlimited playlist", ["-hls_list_size", "0", "-hls_flags", "delete_segments"], 0, [0, 1, 2, 3, 4]],
    ["two expired segments", ["-hls_list_size", "2", "-hls_flags", "+delete_segments", "-hls_delete_threshold", "2"], 3, [1, 2, 3, 4]],
    ["duration retention limit", ["-hls_list_size", "1", "-hls_flags", "delete_segments", "-hls_delete_threshold", "10"], 4, [2, 3, 4]],
    ["default playlist size", ["-hls_flags", "delete_segments"], 0, [0, 1, 2, 3, 4]],
    ["disabled deletion", ["-hls_list_size", "2", "-hls_flags", "delete_segments-delete_segments"], 3, [0, 1, 2, 3, 4]]
  ] as const) {
    it(name, async () => {
      const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 2, frameCount: 10, includeAudio: false }));
      const input = serializeMp4({ ...source, tracks: source.tracks.map(track => ({
        ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 2 === 0 }))
      })) });
      const vfs = createTestVfs({ "/input.mp4": input, "/segments/unrelated.ts": "keep" });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.mp4", "-c", "copy", "-hls_time", "1", ...options,
        "-hls_segment_filename", "/segments/out%d.ts", "/out.m3u8"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()].filter(path => path.startsWith("/segments/out")), retained.map(i => `/segments/out${i}.ts`));
      assert.equal(new TextDecoder().decode(vfs.store.get("/segments/unrelated.ts")), "keep");
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.m3u8")), [
        "#EXTM3U", "#EXT-X-VERSION:3", "#EXT-X-TARGETDURATION:1", `#EXT-X-MEDIA-SEQUENCE:${sequence}`,
        ...Array.from({ length: 5 - sequence }, (_, i) => [`#EXTINF:1.000000,`, `out${sequence + i}.ts`]).flat(),
        "#EXT-X-ENDLIST", ""
      ].join("\n"));
    });
  }
});

describe("HLS split_by_time", () => {
  for (const type of ["mpegts", "fmp4"]) {
    for (const [flags, durations] of [
      [[], [2, 2, 1]],
      [["split_by_time"], [1, 1, 1, 1, 1]],
      [["independent_segments", "+split_by_time"], [1, 1, 1, 1, 1]],
      [["split_by_time", "-split_by_time"], [2, 2, 1]],
      [["split_by_time", "independent_segments"], [2, 2, 1]]
    ] as const) {
      it(`segments ${type} with flags ${flags.join(",")}`, async () => {
        const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 20, includeAudio: true }));
        const input = serializeMp4({ ...source, tracks: source.tracks.map(track => track.type === "video" ? {
          ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 8 === 0 }))
        } : track) });
        const vfs = createTestVfs({ "/in.mp4": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/in.mp4", "-c", "copy", "-f", "hls", "-hls_time", "1", "-hls_list_size", "0",
          "-hls_segment_type", type, ...flags.flatMap(flag => ["-hls_flags", flag]), "/out.m3u8"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const lines = new TextDecoder().decode(vfs.store.get("/out.m3u8")).split("\n");
        assert.deepEqual(lines.filter(line => line.startsWith("#EXTINF:")), durations.map(duration => `#EXTINF:${duration.toFixed(6)},`));
        if (durations.length === 5) assert.ok(!lines.includes("#EXT-X-INDEPENDENT-SEGMENTS"));
        const segments = lines.filter(line => line && !line.startsWith("#")).map(name => {
          const bytes = vfs.store.get(`/${name}`)!;
          return type === "fmp4" ? parseMp4(concatBytes([vfs.store.get("/init.mp4")!, bytes])) : parseMpegTs(bytes);
        });
        for (const track of parseMp4(input).tracks) {
          const samples = segments.flatMap(segment => segment.tracks.find(item => item.type === track.type)!.samples);
          assert.deepEqual(samples.map(sample => sample.data), track.samples.map(sample => sample.data));
        }
      });
    }
  }
});

it("HLS copies each video sample once and cuts at keyframes", async () => {
  const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 20, includeAudio: true }));
  const bytes = serializeMp4({ ...doc, tracks: doc.tracks.map(t => t.type === "video" ? {
    ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: i === 0 || i === 16 }))
  } : t) });
  const vfs = createTestVfs({ "/a.mp4": bytes });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/a.mp4", "-c", "copy", "-hls_time", "0.5", "/out.m3u8"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const playlist = new TextDecoder().decode(vfs.store.get("/out.m3u8"));
  assert.ok(playlist.includes("#EXT-X-TARGETDURATION:2"), playlist);
  assert.ok(playlist.includes("#EXTINF:1.600000,"), playlist);
  assert.ok(playlist.includes("#EXTINF:0.400000,"), playlist);
  const segments = [...vfs.store.entries()].filter(([path]) => path.endsWith(".ts"));
  assert.equal(segments.length, 2);
  assert.equal(segments.reduce((sum, [, bytes]) => sum + parseMpegTs(bytes).tracks.find(t => t.type === "video")!.samples.length, 0), 20);
});

describe("subtitle force_style", () => {
  for (const style of ["PrimaryColour=&H000000FF", "PrimaryColour=255", "PrimaryColour=&H800000FF", "Alignment=8", "Alignment=3", "Alignment=6", "'PrimaryColour=&H000000FF,Alignment=8'", "PrimaryColour=&H000000FF\\,Alignment=8"]) {
    it(`applies ${style} only during the cue`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const width = 320, height = 180;
      const data = new Uint8Array(width * height * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const input = encodeImage({ width, height, channels: 4, data, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice(),
        "/captions.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n" });
      for (const [name, suffix] of [["default", ""], ["styled", `:force_style=${style}`]]) {
        for (const n of [1, 2, 3]) vfs.store.set(`/in${n}.png`, input.slice());
        const result = await runCmd(createFfmpegCommand(), ["-framerate", "1", "-i", "/in%d.png",
          "-vf", `subtitles=/captions.srt${suffix}`, "-frames:v", "3", `/${name}%d.png`], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      for (const n of [1, 3]) assert.deepEqual(decodeImage(vfs.store.get(`/styled${n}.png`)!).data, data);
      const baseline = decodeImage(vfs.store.get("/default2.png")!).data;
      const styled = decodeImage(vfs.store.get("/styled2.png")!).data;
      const visible = (pixels: Uint8Array) => {
        const points: number[] = [];
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 30) points.push(i / 4);
        return points;
      };
      const before = visible(baseline), after = visible(styled);
      assert.ok(before.length > 0 && after.length > 0);
      if (style.includes("PrimaryColour")) {
        assert.ok(after.every(i => styled[i * 4]! > 2 * styled[i * 4 + 1]! && styled[i * 4]! > 2 * styled[i * 4 + 2]!), "PrimaryColour must produce red glyphs");
      }
      if (style === "PrimaryColour=&H800000FF") {
        assert.equal(Math.max(...after.map(i => styled[i * 4]!)), 127, "ASS alpha is inverted");
      }
      if (style === "Alignment=3") {
        assert.ok(Math.min(...after.map(i => i % width)) > width * .75, "Alignment=3 right-aligns text");
        assert.equal(Math.min(...after.map(i => Math.floor(i / width))), Math.min(...before.map(i => Math.floor(i / width))));
      } else if (style === "Alignment=6") {
        assert.ok(Math.max(...after.map(i => Math.floor(i / width))) < height / 4, "Alignment=6 uses top-center alignment");
        assert.equal(Math.min(...after.map(i => i % width)), Math.min(...before.map(i => i % width)));
      } else if (style.includes("Alignment")) {
        assert.ok(Math.max(...after.map(i => i % width)) < width / 4, "Alignment=8 uses libass's left alignment");
        assert.ok(Math.abs(Math.min(...after.map(i => Math.floor(i / width))) - height / 2) < 12, "Alignment=8 vertically centers text");
      } else assert.deepEqual(after, before);
    });
  }
});

it("applies subtitle original_size aspect scaling without changing timing or height", async () => {
  const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
  const data = new Uint8Array(320 * 180 * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const input = encodeImage({ width: 320, height: 180, channels: 4, data,
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
  const widths: number[] = [];
  let baseline: Uint8Array | undefined;
  for (const option of ["", ":original_size=640x360", ":original_size=180x288", ":180x288", ":original_size=640x180"]) {
    const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice(),
      "/s.srt": "1\n00:00:01,000 --> 00:00:02,000\nTEST\n" });
    const result = await runCmd(createFfmpegCommand(), ["-framerate", "1", "-i", "/in%d.png",
      "-vf", `subtitles=/s.srt${option}`, "-frames:v", "3", "/out%d.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const frame of [1, 3]) assert.deepEqual(decodeImage(vfs.store.get(`/out${frame}.png`)!).data, data);
    const output = decodeImage(vfs.store.get("/out2.png")!).data;
    baseline ??= output;
    if (option === ":original_size=640x360") assert.deepEqual(output, baseline);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < output.length; i += 4) {
      if (output[i]! > 30) { xs.push(i / 4 % 320); ys.push(Math.floor(i / 4 / 320)); }
    }
    widths.push(Math.max(...xs) - Math.min(...xs) + 1);
    assert.equal(Math.max(...ys) - Math.min(...ys) + 1, 7);
    assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 160) < 4);
  }
  assert.ok(widths[2]! > widths[0]! * 2.5, `original_size did not widen text: ${widths}`);
  assert.equal(widths[2], widths[3]);
  assert.ok(widths[4]! < widths[0]! * 0.6, `original_size did not narrow text: ${widths}`);
});

it("rejects invalid subtitle original_size without replacing output", async () => {
  for (const size of ["0x288", "180x0", "-1x288", "180x288x1", "oops", "1.5x288"]) {
    const vfs = createTestVfs({ "/s.srt": "1\n00:00:00,000 --> 00:00:01,000\nTEST\n", "/out.png": "existing" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "lavfi", "-i", "color=black:s=32x32",
      "-vf", `subtitles=/s.srt:original_size=${size}`, "-frames:v", "1", "/out.png"], vfs);
    assert.notEqual(result.exitCode, 0, size);
    assert.ok(result.stderr.includes("original_size"), result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "existing");
  }
});

it("scales default subtitle lettering and bottom spacing with video height", async () => {
  for (const height of [360, 720]) {
    const width = height * 16 / 9;
    const source = parseMp4(createSyntheticMp4({ width, height, frameCount: 1, fps: 1, includeAudio: false }));
    const data = new Uint8Array(width * height * 4);
    for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
    const input = serializeMp4({ ...source, tracks: [{ ...source.tracks[0]!, samples: [], decodedVideoFrames: [{ width, height, data, ptsSeconds: 0, durationSeconds: 1, keyframe: true }] }] });
    const vfs = createTestVfs({ "/input.mp4": input, "/captions.srt": "1\n00:00:00,000 --> 00:00:01,000\nHI\n" });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "subtitles=/captions.srt", "/output.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/output.mp4")!).tracks[0]!;
    const frame = [...decodeH264Samples(output.samples, output.codecDescriptions, width, height, output.timescale)][0]!;
    const visibleRows = [];
    for (let y = 0; y < height; y++) {
      if (frame.data.subarray(y * width * 4, (y + 1) * width * 4).some((value, offset) => offset % 4 === 0 && value > 180)) visibleRows.push(y);
    }
    assert.ok(visibleRows.length >= height * .035, `${visibleRows.length}-pixel letters at ${height}p are too small`);
    assert.ok(visibleRows.length <= height * .08, "Subtitle lettering should not dominate the frame");
    assert.ok(visibleRows[0]! >= height * .75, "Subtitles should remain near the bottom");
    assert.ok(visibleRows.at(-1)! < height * .98, "Subtitles need bottom spacing");
  }
});

it("burns captions at presentation times through media offsets and leading empty edits", async () => {
  for (const delay of [0, .2]) {
    const source = parseMp4(createSyntheticMp4({ width: 64, height: 32, frameCount: 10, fps: 10, includeAudio: false }));
    const track = source.tracks[0]!;
    const decodedVideoFrames = Array.from({ length: 10 }, (_, index) => {
      const data = new Uint8Array(64 * 32 * 4);
      for (let alpha = 3; alpha < data.length; alpha += 4) data[alpha] = 255;
      return { width: 64, height: 32, data, ptsSeconds: .2 + index / 10, durationSeconds: .1, keyframe: true };
    });
    const edits = [
      ...(delay ? [{ segmentDuration: Math.round(delay * source.timescale), mediaTime: -1, mediaRateInteger: 1, mediaRateFraction: 0 }] : []),
      { segmentDuration: source.duration, mediaTime: Math.round(.2 * track.timescale), mediaRateInteger: 1, mediaRateFraction: 0 }
    ];
    const input = serializeMp4({ ...source, tracks: [{ ...track, samples: [], decodedVideoFrames, editList: edits }] });
    const vfs = createTestVfs({ "/input.mp4": input, "/captions.srt": "1\n00:00:00,300 --> 00:00:00,600\nHI\n" });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "subtitles=/captions.srt", "/output.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/output.mp4")!).tracks[0]!;
    const frames = [...decodeH264Samples(output.samples, output.codecDescriptions, 64, 32, output.timescale)];
    assert.equal(frames.length, 10);
    const visible = frames.flatMap((frame, index) => frame.data.some((value, offset) => offset % 4 === 0 && value > 180) ? [index] : []);
    assert.deepEqual(visible, delay ? [1, 2, 3] : [3, 4, 5]);
  }
});

describe("decoded audio editing", () => {
  for (const expression of ["volume='1/2'", "volume=1\\/2", "volume='1/2',volume=1"]) {
    it(`matches unquoted volume gain for filtergraph ${expression}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 80 }, (_, i) => (12000 + 2 * i) / 32768)
      ] });
      const vfs = createTestVfs({ "/input.wav": input });
      for (const [filter, path] of [["volume=1/2", "/plain.wav"], [expression, "/quoted.wav"]]) {
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.wav", "-af", filter!, "-c:a", "pcm_s16le", path!
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const plain = parseWav(vfs.store.get("/plain.wav")!).tracks[0]!.decodedAudio!;
      const quoted = parseWav(vfs.store.get("/quoted.wav")!).tracks[0]!.decodedAudio!;
      assert.deepEqual(quoted.channelData, plain.channelData);
      assert.deepEqual(quoted.channelData[0], Float32Array.from({ length: 80 }, (_, i) => (6000 + i) / 32768));
    });
  }

  for (const [filter, positional] of [
    ["anull,volume=0.5", "volume=0.5"],
    ["volume=0.5,anull", "volume=0.5"],
    ["anull@identity,volume=0.5,anull", "volume=0.5"],
    ["volume", "volume=1"],
    ["volume=volume=0.5", "volume=0.5"],
    ["volume=volume=-6dB", "volume=-6dB"],
    ["atempo", "atempo=1"],
    ["atempo=tempo=1", "atempo=1"],
    ["atempo=tempo=2", "atempo=2"],
    ["atempo=1/2", "atempo=0.5"],
    ["atempo=tempo=1/2", "atempo=0.5"],
    ["atempo='(1+3)/2'", "atempo=2"],
    ["atempo=2*3-4", "atempo=2"],
    ["areverse@flip", "areverse"],
    ["volume@quiet=0.5", "volume=0.5"],
    ["atempo@fast=2", "atempo=2"],
    ["volume@default", "volume"],
    ["atempo@default", "atempo"],
    ["volume@quiet=volume=0.5", "volume=0.5"],
    ["atempo@fast=tempo=2", "atempo=2"],
    ["areverse@flip,volume@quiet=0.5,atempo@fast=2", "areverse,volume=0.5,atempo=2"]
  ]) {
    it(`matches ${positional} PCM samples with ${filter}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 8000 }, (_, i) => (12000 + i % 50) / 32768)
      ] });
      const vfs = createTestVfs({ "/input.wav": input });
      for (const [expression, path] of [[positional!, "/expected.wav"], [filter!, "/actual.wav"]]) {
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.wav", "-af", expression!, "-c:a", "pcm_s16le", path!
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const expected = parseWav(vfs.store.get("/expected.wav")!).tracks[0]!.decodedAudio!;
      const actual = parseWav(vfs.store.get("/actual.wav")!).tracks[0]!.decodedAudio!;
      assert.ok(expected.channelData[0]!.length > 0);
      assert.deepEqual(actual, expected);
    });
  }

  for (const [filter, status] of [
    ["volume=volume=invalid", 1], ["volume=wrong=0.5", 1], ["atempo=tempo=0.25", 222], ["atempo=wrong=1", 8],
    ["volume@quiet=invalid", 1], ["atempo@fast=0.25", 222], ["unsupported@label", 1], ["volume=0.5@quiet", 1],
    ["anull,unsupported", 1], ["unsupported,anull", 1], ["anull=invalid", 1]
  ] as const) {
    it(`rejects ${filter} without replacing output`, async () => {
      const vfs = createTestVfs({
        "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800).fill(0.25)] }),
        "/output.wav": "existing output"
      });
      const before = vfs.store.get("/output.wav")!.slice();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-i", "/input.wav", "-af", filter, "/output.wav"
      ], vfs);
      assert.equal(result.exitCode, status);
      assert.deepEqual(vfs.store.get("/output.wav"), before);
    });
  }

  for (const filter of ["volume=1", "volume=", "areverse", "anull", "anull@identity"]) {
    it(`preserves every PCM sample at unchanged rate with ${filter}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 800 }, (_, i) => 0.125 * Math.sin(2 * Math.PI * 1000 * i / 8000))] });
      const expected = parseWav(input).tracks[0]!.decodedAudio!;
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(actual.sampleRate, 8000);
      assert.equal(actual.channels, 1);
      assert.equal(actual.channelData[0]!.length, 800);
      assert.deepEqual(actual.channelData[0], filter === "areverse" ? expected.channelData[0]!.slice().reverse() : expected.channelData[0]);
    });
  }

  it("matches constant volume gains when evaluating arithmetic on a sine wave", async () => {
    const input = encodeWav({ sampleRate: 16000, channels: [Float64Array.from({ length: 8000 }, (_, i) => 0.125 * Math.sin(2 * Math.PI * 440 * i / 16000))] });
    const vfs = createTestVfs({ "/input.wav": input });
    for (const [expression, gain] of [["0.5+0.25", "0.75"], ["0.5+0.25*2", "1"], ["(0.5+0.25)/2", "0.375"], ["1-0.25-0.25", "0.5"], ["-0.5+1", "0.5"]]) {
      for (const [value, path] of [[expression, "/expression.wav"], [gain, "/constant.wav"]]) {
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", `volume=${value}`, "-c:a", "pcm_s16le", path!], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const actual = parseWav(vfs.store.get("/expression.wav")!).tracks[0]!.decodedAudio!;
      const expected = parseWav(vfs.store.get("/constant.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(actual.sampleRate, 16000);
      assert.equal(actual.channelData[0]!.length, 8000);
      assert.deepEqual(actual.channelData, expected.channelData, expression);
    }
  });

  for (const expression of ["banana", "1junk", "dB", "bananadB", "6junkdB", "NaN", "Infinity", "(1+2", "unknown(0)"]) {
    for (const existing of [false, true]) {
      it(`rejects volume=${expression} with existing output=${existing}`, async () => {
        const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(0.125)] });
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/input.wav": input, ...(existing ? { "/output.wav": original } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("volume"), result.stderr);
        assert.deepEqual(vfs.store.get("/output.wav"), existing ? original : undefined);
      });
    }
  }

  for (const [expression, gain] of [["0", 0], ["0.5", 0.5], ["2", 2], ["1e-1", 0.1], ["(1+2)/2", 1.5], ["6dB", 10 ** (6 / 20)], ["-6dB", 10 ** (-6 / 20)]] as const) {
    it(`applies volume=${expression} to decoded samples`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(0.125)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, 80);
      assert.ok(samples.every(sample => Math.abs(sample - 0.125 * gain) < 0.0001));
    });
  }

  it("runs tempo and reversal filters as distinct ordered operations", async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 8000 }, (_, i) => (12000 + i % 50 + Math.round(1000 * Math.sin(i * i / 8000))) / 32768)
    ] });
    const vfs = createTestVfs({ "/input.wav": input });
    const run = async (source: string, filter: string, destination: string) => {
      const result = await runCmd(createFfmpegCommand(), [
        "-i", source, "-af", filter, "-c:a", "pcm_s16le", destination
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      return parseWav(vfs.store.get(destination)!).tracks[0]!.decodedAudio!.channelData[0]!;
    };
    const original = parseWav(input).tracks[0]!.decodedAudio!.channelData[0]!;
    const reversed = await run("/input.wav", "areverse", "/reversed.wav");
    assert.deepEqual(reversed, original.slice().reverse());
    const reverseFirst = await run("/input.wav", "areverse,atempo=2", "/reverse-first.wav");
    const tempoFirst = await run("/input.wav", "atempo=2,areverse", "/tempo-first.wav");
    assert.ok(reverseFirst.some((sample, i) => sample !== tempoFirst[i]), "Filter order must affect the waveform");
    assert.deepEqual(reverseFirst, await run("/reversed.wav", "atempo=2", "/reversed-tempo.wav"));
    const fast = await run("/input.wav", "atempo=2", "/fast.wav");
    assert.deepEqual(tempoFirst, fast.slice().reverse());
    const reciprocal = await run("/input.wav", "atempo=2,atempo=0.5", "/reciprocal.wav");
    assert.ok(reciprocal.some((sample, i) => sample !== original[i]), "Reciprocal tempo stages must not collapse to identity");
    const separate = await run("/fast.wav", "atempo=0.5", "/separate.wav");
    assert.equal(reciprocal.length, separate.length);
    for (let i = 0; i < reciprocal.length; i++) {
      assert.ok(Math.abs(reciprocal[i]! - separate[i]!) <= 1 / 32768,
        "Chaining must match separate stages within intermediate PCM rounding");
    }
  });

  // Native FFmpeg 7.0.2 and 9.0.1 emit no PCM before the first half-window.
  for (const [rate, length] of [[8000, 80], [8000, 255], [8000, 256], [16000, 511]] as const) {
    for (const tempo of length === 256 ? [1] : [0.5, 1, 2]) {
      for (const tone of [false, true]) {
        it(`matches native atempo fragment boundary: rate=${rate}, length=${length}, tempo=${tempo}, tone=${tone}`, async () => {
          const input = new Uint8Array(length * 2);
          for (let i = 0; i < length; i++) {
            new DataView(input.buffer).setInt16(i * 2, tone ? (i % 32 - 16) * 1000 : 16000, true);
          }
          const vfs = createTestVfs({ "/in.raw": input, "/out.raw": "KEEP" });
          const result = await runCmd(createFfmpegCommand(), [
            "-v", "error", "-y", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", "/in.raw",
            "-af", `atempo=${tempo}`, "-f", "s16le", "/out.raw"
          ], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const output = vfs.store.get("/out.raw")!;
          if (length === 256) {
            assert.equal(output.length, 512);
            assert.equal(createHash("sha256").update(output).digest("hex"), tone
              ? "ec398f2c5809df00914cb9bcfd09857516500b4f56a98856e44610d5fb91dc4b"
              : "c5513c0ecb777c0bf05ea37b7a643f3be73ef13bd375a2203c7969035e789ab0");
          } else {
            assert.deepEqual(output, new Uint8Array(0));
          }
          assert.deepEqual(vfs.store.get("/in.raw"), input);
        });
      }
    }
  }

  // Native FFmpeg 9.0.1 PCM16 reference digests, generated with
  // -f s16le -ar RATE -ac CHANNELS -i pipe:0 -af atempo=1 -f s16le pipe:1.
  for (const [length, channels, silent, expectedLength, hash] of [
    [8000, 1, false, 7983, "30101832ed75ca4c55f051619ecf4c5382f9b591c56ad84e1b161ba94516c3da"],
    [8000, 2, false, 7983, "71543292be1e5bffe6a5aab05065a4960642849beb980268abf6e19b4b8abdc6"],
    [8000, 1, true, 7744, "787857ffbf80480c021e8ff0ca37e20fb89a00439eb18f55baa555404df9649d"],
    [80, 1, false, 0, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
    [256, 1, false, 256, "ce6c7bf02f1ba651bb0b97828aa790d3ea5756660a648bd86ce246aef555e48e"],
    [500, 1, false, 500, "9556cffa76c60fa403500b21963da446220acdcc917041dfdb1897b4193d59ab"]
  ] as const) {
    it(`matches native unity-tempo PCM: length=${length}, channels=${channels}, silence=${silent}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) =>
        Float64Array.from({ length }, (_, i) => silent ? 0 : (12000 + i % 50) * (c ? -1 : 1) / 32768)) });
      for (const filtered of [false, true]) {
        const vfs = createTestVfs({ "/input.wav": input });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav",
          ...(filtered ? ["-af", "atempo=1"] : []), "-c:a", "pcm_s16le", "/output.wav"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData;
        if (!filtered) {
          assert.deepEqual(samples, parseWav(input).tracks[0]!.decodedAudio!.channelData);
          continue;
        }
        assert.equal(samples[0]!.length, expectedLength);
        const pcm = Buffer.alloc(expectedLength * channels * 2);
        for (let i = 0; i < expectedLength; i++) {
          for (let c = 0; c < channels; c++) pcm.writeInt16LE(Math.round(samples[c]![i]! * 32768), (i * channels + c) * 2);
        }
        assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
      }
    });
  }

  // Native FFmpeg sample counts include the aligned terminal fragment.
  for (const [tempo, expectedLength] of [[0.5, 31581], [8, 1775], [100, 0]] as const) {
    it(`honors atempo=${tempo} without clamping`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(16000).fill(0.25)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `atempo=${tempo}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channelData[0]!.length, expectedLength);
    });
  }

  for (const tempo of ["0.25", "0", "-1", "100.1", "Infinity", "NaN", "tempo=", "8junk", "0.25,atempo=4",
    "1/4", "100+1", "1/0", "0/0", "1/", "1/2junk"]) {
    it(`rejects invalid atempo=${tempo} without writing output`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `atempo=${tempo}`, "/output.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("atempo"), result.stderr);
      assert.equal(vfs.store.has("/output.wav"), false);
    });
  }

  for (const [filter, expectedLength, rate] of [["atempo=2", 7929, 16000], ["atempo=0.5", 31589, 16000], ["atempo=2,atempo=2", 1983, 8000]] as const) {
    it(`preserves pitch and stereo alignment with ${filter} at ${rate} Hz`, async () => {
      const tone = Float64Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000));
      const input = encodeWav({ sampleRate: 16000, channels: [tone, tone.map(value => -value)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-ar", String(rate), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      const left = audio.channelData[0]!;
      const right = audio.channelData[1]!;
      assert.equal(left.length, expectedLength);
      const start = Math.floor(left.length * 0.2);
      const end = Math.floor(left.length * 0.8);
      let crossings = 0;
      let energy = 0;
      for (let i = start; i < end; i++) {
        if (left[i - 1]! <= 0 && left[i]! > 0) crossings++;
        energy += left[i]! ** 2;
        assert.ok(Math.abs(left[i]! + right[i]!) < 0.0001, "Stereo channels must remain aligned");
      }
      const pitch = crossings * rate / (end - start);
      assert.ok(Math.abs(pitch - 440) < 10, `Expected 440 Hz, got ${pitch} Hz`);
      assert.ok(energy / (end - start) > 0.08, "Stretching must retain the tone's amplitude");
    });
  }

  for (const [length, stereo, expectedLength] of [[5760, false, 2688], [5760, true, 2688], [6240, true, 2784], [1440, true, 864]] as const) {
    it(`preserves a trailing tone when doubling a ${length}-sample ${stereo ? "stereo" : "mono"} clip`, async () => {
      const toneStart = length - 960;
      const tone = Float64Array.from({ length }, (_, i) => i < toneStart ? 0 : 0.5 * Math.sin(2 * Math.PI * 500 * (i - toneStart) / 48000));
      const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 48000, channels: stereo ? [tone, tone.map(value => -value)] : [tone] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=2", "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const [left, right] = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.equal(left!.length, expectedLength);
      assert.ok(left!.some(sample => Math.abs(sample) > 0.49), "The trailing tone must remain audible");
      for (let i = left!.length - 240; i < left!.length; i++) {
        // Native Hann feathering changes the final samples by up to 13 PCM16 steps.
        assert.ok(Math.abs(left![i]! - tone[length - left!.length + i]!) < 0.0005, "Retain the final tone samples without changing pitch");
        if (stereo) assert.ok(Math.abs(left![i]! + right![i]!) < 0.0001, "Stereo channels must remain aligned");
      }
    });
  }

  it("preserves mono pitch when doubling tempo", async () => {
    const tone = Float64Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 16000, channels: [tone] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=2", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(output.channels, 1);
    const samples = output.channelData[0]!;
    assert.equal(samples.length, 7929);
    let crossings = 0;
    for (let i = 1600; i < 6400; i++) if (samples[i - 1]! <= 0 && samples[i]! > 0) crossings++;
    assert.ok(Math.abs(crossings / 0.3 - 440) < 10);
  });

  it("keeps silence and very short constant audio finite when slowing down", async () => {
    for (const [length, amplitude] of [[1, 0.5], [160, 0.5], [16000, 0]] as const) {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(length).fill(amplitude)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=0.5", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, length < 512 ? 0 : 30592);
      assert.ok(samples.every(sample => Math.abs(sample - amplitude) < 0.0001));
    }
  });

  it("defers audio filters to the async command without writing output", () => {
    const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
    for (const filter of ["no_such_filter", "volume=0.5"]) {
      let writes = 0;
      const result = evalSyncFfmpeg(["-y", "-i", "/input.wav", "-af", filter, "/output.wav"], undefined,
        () => input, () => { writes++; return true; });
      assert.equal(writes, 0);
      assert.equal(result, undefined);
    }
  });

  for (const filter of ["no_such_filter", "volume=0.5,no_such_filter,areverse"]) {
    for (const existing of [false, true]) {
      it(`rejects unsupported audio filter ${filter} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/input.wav": input, ...(existing ? { "/output.wav": original } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
        assert.equal(result.exitCode, 1, result.stderr);
        assert.ok(result.stderr.includes("Unsupported audio filter:"), result.stderr);
        assert.ok(result.stderr.includes("no_such_filter"), result.stderr);
        assert.deepEqual(vfs.store.get("/output.wav"), existing ? original : undefined);
        assert.deepEqual(vfs.store.get("/input.wav"), input);
      });
    }
  }

  for (const [options, sampleRate, channels, samples] of [
    [["-ar", "8000"], 8000, 1, 80],
    [["-ac", "2"], 16000, 2, 160],
    [["-af", "volume=0.5"], 16000, 1, 160],
    [["-af", "atempo=2"], 16000, 1, 0]
  ] as const) {
    it(`preserves short PCM duration when converting with ${options.join(" ")}`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", ...options, "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.sampleRate, sampleRate);
      assert.equal(output.channels, channels);
      for (const channel of output.channelData) assert.equal(channel.length, samples);
    });
  }

  for (const [left, right, expected] of [[0.5, -0.5, 0], [0, 0.5, 0.25], [0.5, 0.5, 0.5]] as const) {
    it(`mixes stereo ${left}, ${right} to mono ${expected}`, async () => {
      const input = encodeWav({
        sampleRate: 8000,
        channels: [new Float64Array(800).fill(left), new Float64Array(800).fill(right)]
      });
      const vfs = createTestVfs({ "/stereo.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/stereo.wav", "-ac", "1", "/mono.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/mono.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.sampleRate, 8000);
      assert.equal(output.channels, 1);
      assert.equal(output.channelData[0]!.length, 800);
      assert.ok(output.channelData[0]!.every(sample => sample === expected));
    });
  }

  for (const channels of [1, 2]) {
    for (const reversals of [1, 2, 3, 4]) {
      it(`applies ${reversals} areverse filters to ${channels} PCM channels`, async () => {
        const input = encodeWav({
          sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) =>
            Float64Array.from({ length: 80 }, (_, i) => (channel === 0 ? i : -i) / 256))
        });
        const source = parseWav(input).tracks[0]!.decodedAudio!;
        const vfs = createTestVfs({ "/input.wav": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.wav", "-af", Array(reversals).fill("areverse").join(","),
          "-c:a", "pcm_s16le", "/output.wav"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(output.sampleRate, source.sampleRate);
        assert.equal(output.channels, channels);
        for (const [channel, samples] of output.channelData.entries()) {
          const expected = source.channelData[channel]!.slice();
          if (reversals % 2 === 1) expected.reverse();
          assert.deepEqual(samples, expected);
        }
      });
    }
  }

  it("mutes audible PCM samples with volume=0 without changing their count", async () => {
    const vfs = createTestVfs();
    const command = createFfmpegCommand();
    const generated = await runCmd(command, ["-f", "lavfi", "-i", "sine=frequency=440:duration=0.1:sample_rate=8000", "/input.wav"], vfs);
    assert.equal(generated.exitCode, 0, generated.stderr);
    const input = parseWav(vfs.store.get("/input.wav")!).tracks[0]!.decodedAudio!;
    assert.ok(input.channelData[0]!.some(value => value !== 0));

    const result = await runCmd(command, ["-v", "error", "-i", "/input.wav", "-af", "volume=0", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(output.sampleRate, input.sampleRate);
    assert.equal(output.channels, input.channels);
    for (const [channel, samples] of output.channelData.entries()) {
      assert.equal(samples.length, input.channelData[channel]!.length);
      assert.ok(samples.every(value => value === 0));
    }
  });

  it("rejects corrupt audio instead of replacing it with silence or a tone", async () => {
    for (const options of [[], ["-ar", "16000"], ["-af", "volume=0.5"]]) {
      const original = new Uint8Array([1, 2, 3]);
      const source = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 2, includeAudio: true }));
      const broken = { ...source, tracks: source.tracks.map(track => track.type !== "audio" ? track : {
        ...track, samples: track.samples.map(sample => ({ ...sample, data: Uint8Array.of(255) }))
      }) };
      const vfs = createTestVfs({ "/input.mp4": serializeMp4(broken), "/output.wav": original });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.mp4", "-vn", ...options, "/output.wav"], vfs);
      assert.equal(result.exitCode, 1, JSON.stringify(options));
      assert.match(result.stderr, /requires decoded PCM audio|AAC/);
      assert.deepEqual(vfs.store.get("/output.wav"), original);
    }
  });

  it("trims and repeats WAV waveforms through ffmpeg options", async () => {
    const vfs = createTestVfs();
    const command = createFfmpegCommand();
    const generated = await runCmd(command, ["-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-y", "/four.wav"], vfs);
    assert.equal(generated.exitCode, 0, generated.stderr);
    for (const [args, duration] of [
      [["-i", "/four.wav", "-ss", "1", "-t", "1"], 1],
      [["-ss", "1", "-i", "/four.wav", "-to", "2"], 2],
      [["-stream_loop", "2", "-i", "/four.wav"], 12],
      [["-i", "concat:/four.wav|/four.wav"], 4],
      [["-i", "/four.wav", "-af", "volume=0.5", "-t", "1"], 1],
      // Native FFmpeg emits 88304 samples after aligning the final fragment.
      [["-i", "/four.wav", "-af", "atempo=2.0,areverse"], 88304 / 44100]
    ] as const) {
      const result = await runCmd(command, [...args, "-y", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!);
      assert.equal(output.durationSeconds, duration, args.join(" "));
      assert.ok(output.tracks[0]!.decodedAudio!.channelData[0]!.some((value) => value !== 0));
    }
  });
});


describe("native ffmpeg parity", () => {
  for (const position of ["x=n*4:y=0", "0:n*4"]) {
    it(`evaluates crop position ${position} per frame`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=black:s=16x16:r=3:d=1",
        "-vf", `drawbox=x=0:y=0:w=4:h=4:c=red:t=fill,crop=8:8:${position}`,
        "-frames:v", "3", "/frame-%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (let frame = 1; frame <= 3; frame++) {
        const output = decodeImage(vfs.store.get(`/frame-${frame}.png`)!);
        assert.equal(output.width, 8);
        assert.equal(output.height, 8);
        assert.deepEqual([...output.data.slice(0, 4)], frame === 1 ? [255, 0, 0, 255] : [0, 0, 0, 255]);
      }
    });
  }

  for (const position of ["x=iw-ow:y=ih-oh", "in_w-out_w:in_h-out_h", "(iw-ow)/2+1:(ih-oh)*1", "2:2"]) {
    it(`evaluates crop position ${position}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(4 * 4 * 4);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) data.set(x >= 2 && y >= 2 ? [0, 0, 255, 255] : [255, 0, 0, 255], (y * 4 + x) * 4);
      }
      const input = encodeImage({
        width: 4, height: 4, channels: 4, data,
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `crop=2:2:${position}`, "-frames:v", "1", "/crop.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/crop.png")!);
      assert.equal(output.width, 2);
      assert.equal(output.height, 2);
      assert.deepEqual(output.data, new Uint8Array(Array.from({ length: 4 }, () => [0, 0, 255, 255]).flat()));
    });
  }

  for (const position of ["x=unknown:y=0", "x=0:y=2garbage", "x=iw/:y=0", "x=1/0:y=0", "x=unknown(1):y=0"]) {
    for (const existing of [false, true]) {
      it(`rejects crop position ${position} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const vfs = createTestVfs(existing ? { "/crop.png": "original" } : {});
        const original = vfs.store.get("/crop.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", "color=c=red:s=4x4:r=1:d=1",
          "-vf", `crop=2:2:${position}`, "-frames:v", "1", "/crop.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("crop:"), result.stderr);
        assert.deepEqual(vfs.store.get("/crop.png"), original);
      });
    }
  }

  for (const options of ["exact=bogus", "keep_aspect=bogus", "typo=1", "bogus", "0:bogus", "0:0:1"]) {
    it(`rejects invalid crop options ${options} before writing frames`, async () => {
      const { encodeImage } = await import("@poe-code/image-ast/portable");
      const image = (width: number, height: number) => encodeImage({
        width, height, channels: 4,
        data: Uint8Array.from(Array.from({ length: width * height }, (_, i) => [i + 1, i + 1, i + 1, 255]).flat()),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
      }, { format: "png" }).data;
      const input = image(7, 5);
      const original = image(1, 1);
      const vfs = createTestVfs({ "/in1.png": input.slice(), "/in2.png": input.slice(), "/in3.png": input.slice(), "/out1.png": original });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-framerate", "2", "-i", "/in%d.png", "-vf", `crop=4:2:0:0:${options}`,
        "-frames:v", "3", "/out%d.png"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("crop:"), result.stderr);
      assert.deepEqual(vfs.store.get("/out1.png"), original);
      assert.equal(vfs.store.has("/out2.png"), false);
      assert.equal(vfs.store.has("/out3.png"), false);
    });
  }

  for (const crop of ["100:100", "100:8", "8:100", "-1:8", "8:-1", "w=iw*2:h=ih"]) {
    for (const existing of [false, true]) {
      it(`rejects invalid crop ${crop} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs(existing ? { "/crop.png": original } : {});
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
          "-vf", `crop=${crop}`, "-frames:v", "1", "/crop.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Invalid too big or non positive size"), result.stderr);
        assert.equal(result.stdoutBytes.length, 0);
        assert.deepEqual(vfs.store.get("/crop.png"), existing ? original : undefined);
      });
    }
  }

  for (const [crop, width, height] of [["16:16", 16, 16], ["8:4", 8, 4], ["w=iw/2:h=ih/2", 8, 8], ["4:2:0:0:0:1", 4, 2], ["4:2:exact=TRUE:keep_aspect=no", 4, 2], ["out_w=4:out_h=2", 4, 2]] as const) {
    it(`preserves valid crop dimensions for ${crop}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1",
        "-vf", `crop=${crop}`, "-frames:v", "1", "/crop.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = decodeImage(vfs.store.get("/crop.png")!);
      assert.equal(actual.width, width);
      assert.equal(actual.height, height);
    });
  }

  for (const [inputWidth, inputHeight, dimension, expected] of [
    [4, 3, "-2", 2],
    [5, 3, "-2", 4],
    [3, 2, "-2", 4],
    [4, 3, "-1", 3]
  ] as const) {
    for (const transpose of [false, true]) {
      const width = transpose ? inputHeight : inputWidth;
      const height = transpose ? inputWidth : inputHeight;
      const scale = transpose ? `2:${dimension}` : `${dimension}:2`;
      it(`rounds aspect scale ${scale} for ${width}x${height} to the nearest multiple`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width, height, channels: 4,
          data: new Uint8Array(width * height * 4).fill(255),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(output.width, transpose ? 2 : expected);
        assert.equal(output.height, transpose ? expected : 2);
      });
    }
  }

  for (const [scale, width, height] of [
    ["1:1", 1, 1],
    ["1:3", 1, 3],
    ["3:1", 3, 1],
    ["iw/16:ih/10", 1, 1],
    ["iw*0.0625:ih*0.1", 1, 1],
    ["-1:1", 2, 1],
    ["1:-1", 1, 1],
    ["-2:1", 2, 1],
    ["1:-2", 1, 2]
  ] as const) {
    it(`preserves small scale dimensions for ${scale}`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      // Native FFmpeg: -f lavfi -i color=c=red:s=16x10:r=1:d=1
      // -vf scale=1:1 -frames:v 1 -f image2pipe -c:v png pipe:1
      const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC", "base64"));
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=16x10:r=1:d=1",
        "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = decodeImage(vfs.store.get("/out.png")!);
      assert.equal(actual.width, width);
      assert.equal(actual.height, height);
      if (scale === "1:1") {
        assert.equal(actual.width, native.width);
        assert.equal(actual.height, native.height);
      }
      for (let offset = 0; offset < actual.data.length; offset++) {
        // Allow native lavfi's YUV-to-RGB conversion rounding.
        assert.ok(Math.abs(actual.data[offset]! - native.data[offset % 4]!) <= 2);
      }
    });
  }

  for (const color of ["notacolor", "#xyzxyz", "0x12345", "1234567", "notacolor@0.5"]) {
    it(`rejects invalid lavfi color ${color} without writing output`, async () => {
      for (const initialFiles of [{}, { "/out.png": "existing image" }]) {
        const vfs = createTestVfs(initialFiles);
        const original = vfs.store.get("/out.png");
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-f", "lavfi", "-i", `color=c=${color}:s=16x16:r=1:d=1`,
          "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(`Invalid color: ${color}`), result.stderr);
        assert.equal(vfs.store.get("/out.png"), original);
      }
    });
  }

  for (const [color, expected] of [
    ["red@0.5", [127, 0, 127, 255]],
    ["red@0x80", [128, 0, 126, 255]],
    ["red", [255, 0, 0, 255]],
    ["red@0", [0, 0, 255, 255]]
  ] as const) {
    it(`matches native drawbox ${color} on a one-pixel RGB PNG`, async () => {
      const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
      const input = encodeImage({
        width: 1, height: 1, channels: 3, data: new Uint8Array([0, 0, 255]),
        format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png" }).data;
      const vfs = createTestVfs({ "/input.png": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.png", "-vf", `drawbox=x=0:y=0:w=1:h=1:color=${color}:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...decodeImage(vfs.store.get("/out.png")!).data], [...expected]);
    });
  }

  for (const replace of ["1", "0", undefined]) {
    for (const alpha of [0, 127, 255]) {
      it(`drawbox replace=${replace} on destination alpha ${alpha}`, async () => {
        const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
        const input = encodeImage({
          width: 4, height: 4, channels: 4,
          data: new Uint8Array(Array.from({ length: 16 }, () => [0, 0, 255, alpha]).flat()),
          format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
        }, { format: "png" }).data;
        const vfs = createTestVfs({ "/input.png": input });
        const result = await runCmd(createFfmpegCommand(), [
          "-i", "/input.png", "-vf",
          `drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill${replace === undefined ? "" : `:replace=${replace}`}`,
          "-frames:v", "1", "/out.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const image = decodeImage(vfs.store.get("/out.png")!);
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const inside = x >= 1 && x <= 2 && y >= 1 && y <= 2;
            const expected = inside
              ? replace === "1" ? [255, 0, 0, 127] : [127, 0, 127, alpha]
              : [0, 0, 255, alpha];
            const offset = (y * 4 + x) * 4;
            assert.deepEqual([...image.data.subarray(offset, offset + 4)], expected);
          }
        }
      });
    }
  }

  it("preserves destination alpha when blending drawbox", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=blue@0.5:s=4x4:r=1:d=1",
      "-vf", "drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill",
      "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const image = decodeImage(vfs.store.get("/out.png")!);
    assert.deepEqual(Array.from(image.data.slice(20, 24)), [127, 0, 127, 127]);
  });

  for (const alpha of ["", "-0.1", "1.1", "0x100", "nope"]) {
    it(`rejects invalid drawbox alpha ${JSON.stringify(alpha)}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=black:s=4x4:r=1:d=1",
        "-vf", `drawbox=color=red@${alpha}:t=fill`, "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("Invalid color alpha"), result.stderr);
      assert.equal(vfs.store.has("/out.png"), false);
    });
  }

  it("blends drawbox alpha colors over the short lavfi clip like native FFmpeg", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    // FFmpeg: -f lavfi -i color=c=black:s=4x4:r=1:d=1
    // -vf drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill -frames:v 1 out.png
    const native = decodeImage(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAABAAAAAQBPJcTWAAAAGUlEQVR4nGMMY0AAFiBWBbNuQzgoMrdhHAA4UwI/yaxwoAAAAABJRU5ErkJggg==", "base64"));
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=4x4:r=1:d=1",
      "-vf", "drawbox=x=1:y=1:w=2:h=2:color=red@0.5:t=fill",
      "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, native.width);
    assert.equal(actual.height, native.height);
    for (let channel = 0; channel < 4; channel++) {
      // Native lavfi uses YUV; allow its conversion rounding at pixel (1, 1).
      assert.ok(Math.abs(actual.data[20 + channel]! - native.data[20 + channel]!) <= 6,
        `channel ${channel}: ${actual.data[20 + channel]} vs ${native.data[20 + channel]}`);
    }
  });

  for (const [color, expected] of [
    ["red@0", [0, 0, 254, 255]],
    ["red@1", [255, 0, 0, 255]],
    ["red", [255, 0, 0, 255]],
    ["red@0.5", [127, 0, 127, 255]],
    ["#ff0000@0.5", [127, 0, 127, 255]],
    ["0xff0000@0x80", [128, 0, 126, 255]],
    ["0xff000080", [128, 0, 126, 255]],
    ["ff000080@0", [0, 0, 254, 255]]
  ] as const) {
    it(`drawbox blends ${color} over blue and leaves pixels outside the box unchanged`, async () => {
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=blue:s=4x4:r=1:d=1",
        "-vf", `drawbox=x=1:y=1:w=2:h=2:color=${color}:t=fill`,
        "-frames:v", "1", "/out.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const image = decodeImage(vfs.store.get("/out.png")!);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const offset = (y * 4 + x) * 4;
          assert.deepEqual(Array.from(image.data.slice(offset, offset + 4)),
            x >= 1 && x < 3 && y >= 1 && y < 3 ? [...expected] : [0, 0, 254, 255]);
        }
      }
    });
  }

  for (const [format, expected] of [
    ["csv=p=0", "HelloWorld\n"],
    ["compact=p=0", "tag:title=HelloWorld\n"],
    ["flat", 'format.tags.title="HelloWorld"\n']
  ]) {
    it(`retains format tags in ${format}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=32x32:d=0.2",
        "-metadata", "title=HelloWorld", "/tagged.mp4"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const probe = await runCmd(createFfprobeCommand(), [
        "-show_entries", "format_tags=title", "-of", format!, "/tagged.mp4"
      ], vfs);
      assert.equal(probe.exitCode, 0, probe.stderr);
      assert.equal(probe.stdout, expected);
    });
  }
  for (const flags of [[], ["-nostdin"], ["-n"]]) {
    it(`preserves existing output with ${flags.join(" ") || "no overwrite flag"}`, async () => {
      const original = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/out.mp4": original });
      const result = await runCmd(createFfmpegCommand(), [
        ...flags, "-f", "lavfi", "-i", "color=c=red:s=16x16:d=0.1", "/out.mp4"
      ], vfs);
      assert.equal(result.exitCode, flags.includes("-n") ? 0 : 1);
      assert.match(result.stderr, /already exists/);
      assert.deepEqual(vfs.store.get("/out.mp4"), original);
    });
  }
  it("replaces existing output with -y", async () => {
    const vfs = createTestVfs({ "/out.mp4": new Uint8Array([1, 2, 3]) });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-f", "lavfi", "-i", "color=c=red:s=16x16:d=0.1", "/out.mp4"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(vfs.store.get("/out.mp4")!.length > 3);
  });
});

for (const [format, expected] of [
  ["csv=p=0", "eng\n"],
  ["compact=p=0", "tag:language=eng\n"],
  ["flat", 'streams.stream.0.tags.language="eng"\n']
]) {
  it(`retains selected stream tags in ${format}`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: false }));
    const bytes = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, language: "eng" })) });
    const result = await runCmd(createFfprobeCommand(), [
      "-show_entries", "stream_tags=language", "-of", format!, "/tagged.mp4"
    ], createTestVfs({ "/tagged.mp4": bytes }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}


it("preserves solid lavfi pixels across multiple H.264 frames", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand(), [
    "-f", "lavfi", "-i", "color=c=red:s=64x48:r=10:d=1", "-c:v", "libx264", "/red.mp4"
  ], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const doc = parseMp4(vfs.store.get("/red.mp4")!, { decodeFrames: true });
  const frames = doc.tracks[0]!.decodedVideoFrames!;
  assert.equal(frames.length, 10);
  for (const frame of frames) {
    for (let i = 0; i < frame.data.length; i += 4) {
      assert.ok(frame.data[i]! >= 250, `red at ${i / 4}: ${frame.data.slice(i, i + 4)}`);
      assert.ok(frame.data[i + 1]! <= 3);
      assert.ok(frame.data[i + 2]! <= 3);
      assert.equal(frame.data[i + 3], 255);
    }
  }
});

it("extracts gapped MKV subtitles with their explicit end timestamps", async () => {
  const srt = "1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,500\nSecond\n";
  const vfs = createTestVfs({ "/in.srt": srt });
  const ffmpeg = createFfmpegCommand();
  assert.equal((await runCmd(ffmpeg, ["-i", "/in.srt", "-c", "copy", "/sub.mkv"], vfs)).exitCode, 0);
  const result = await runCmd(ffmpeg, ["-i", "/sub.mkv", "/out.srt"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const text = new TextDecoder().decode(vfs.store.get("/out.srt"));
  assert.ok(text.includes("00:00:00,000 --> 00:00:01,000"), text);
  assert.ok(text.includes("00:00:03,000 --> 00:00:04,500"), text);
});

describe("DASH program title", () => {
  for (const [flags, expected] of [
    [[], "Trial & test"],
    [["-metadata", "title=Cut < test & crop"], "Cut < test & crop"],
    [["-metadata", "title="], undefined],
    [["-map_metadata", "-1"], undefined]
  ] as const) {
    it(`preserves or clears the program title with ${JSON.stringify(flags)}`, async () => {
      const { parseXml } = await import("@poe-code/xml-ast");
      const doc = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 4, includeAudio: false }));
      const input = serializeMp4({ ...doc, metadata: { title: "Trial & test" } });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-v", "error", "-y", "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash",
        "-seg_duration", "1", ...flags, "/out.mpd"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const root = parseXml(new TextDecoder().decode(vfs.store.get("/out.mpd")!));
      const title = root.children.find(child => child.localName === "ProgramInformation")
        ?.children.find(child => child.localName === "Title");
      assert.equal(title?.text, expected);
      assert.deepEqual(vfs.store.get("/in.mp4"), input);
    });
  }
});

describe("DASH segment duration", () => {
  const input = createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true });
  for (const value of ["oops", "1oops", "", "NaN", "Infinity", "-1", "1e2", "999999999999999999999"]) {
    it(`rejects ${JSON.stringify(value)} without changing files`, async () => {
      for (const existing of [false, true]) {
        const vfs = createTestVfs({ "/in.mp4": input,
          ...(existing ? { "/play.mpd": "original manifest", "/init-stream0.m4s": "original init", "/chunk-stream0-00001.m4s": "original segment" } : {}) });
        const before = new Map(vfs.store);
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", value, "/play.mpd"
        ], vfs);
        assert.equal(result.exitCode, 234);
        assert.ok(result.stderr.includes("invalid seg_duration"), result.stderr);
        assert.deepEqual(vfs.store, before);
      }
    });
  }
  it("rejects a missing value without writing output", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-seg_duration"], vfs);
    assert.equal(result.exitCode, 234);
    assert.ok(result.stderr.includes("invalid seg_duration"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
  for (const value of ["1", "1s", "1000ms", "1000000us", "00:00:01"]) {
    it(`accepts ${value}`, async () => {
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-c", "copy", "-f", "dash", "-seg_duration", value, "/play.mpd"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.ok(vfs.store.has("/play.mpd"));
      assert.ok(vfs.store.has("/init-stream0.m4s"));
      assert.ok(vfs.store.has("/chunk-stream0-00001.m4s"));
    });
  }
});

for (const format of ["hls", "dash"]) {
  it(`probes and remuxes actual ${format} segments without inventing streams`, async () => {
    const source = createSyntheticMp4({ width: 128, height: 96, fps: 25, frameCount: 50, includeAudio: false });
    const vfs = createTestVfs({ "/in.mp4": source });
    const filename = format === "hls" ? "/stream/out.m3u8" : "/stream/out.mpd";
    const ffmpeg = createFfmpegCommand();
    const mux = await runCmd(ffmpeg, ["-i", "/in.mp4", "-c", "copy", "-f", format, filename], vfs);
    assert.equal(mux.exitCode, 0, mux.stderr);
    if (format === "dash") {
      assert.ok(vfs.store.has("/stream/init-stream0.m4s"));
      assert.ok(vfs.store.has("/stream/chunk-stream0-00001.m4s"));
    }
    const probe = await runCmd(createFfprobeCommand(), ["-of", "json", "-show_streams", "-show_format", filename], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.equal(result.streams.length, 1);
    assert.equal(result.streams[0].width, 128);
    assert.equal(result.streams[0].height, 96);
    assert.equal(result.streams[0].r_frame_rate, "25/1");
    assert.equal(Number(result.format.duration), 2);
    const remux = await runCmd(ffmpeg, ["-i", filename, "-c", "copy", "/joined.mp4"], vfs);
    assert.equal(remux.exitCode, 0, remux.stderr);
    const actual = parseMp4(vfs.store.get("/joined.mp4")!);
    const original = parseMp4(source);
    assert.equal(actual.tracks[0]!.samples.length, 50);
    assert.deepEqual(actual.tracks[0]!.samples.map(s => s.data), original.tracks[0]!.samples.map(s => s.data));
  });
}

it("reads multiple HLS fMP4 segments through both commands and preserves their packets", async () => {
  const segment = createSyntheticMp4({ width: 32, height: 24, fps: 25, frameCount: 25, includeAudio: true, fragmented: true });
  const playlist = "#EXTM3U\n#EXTINF:1,\nparts/one.m4s\n#EXTINF:1,\nparts/two.m4s\n#EXT-X-ENDLIST\n";
  const vfs = createTestVfs({ "/hls/media.playlist": playlist, "/hls/parts/one.m4s": segment, "/hls/parts/two.m4s": segment });
  const probe = await runCmd(createFfprobeCommand(), ["-of", "json", "-show_streams", "/hls/media.playlist"], vfs);
  assert.equal(probe.exitCode, 0, probe.stderr);
  const streams = JSON.parse(probe.stdout).streams;
  assert.equal(streams.length, 2);
  assert.equal(streams[0].r_frame_rate, "25/1");
  const result = await runCmd(createFfmpegCommand(), ["-i", "/hls/media.playlist", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const track = parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!;
  const original = parseMp4(segment).tracks[0]!;
  assert.equal(track.samples.length, 50);
  assert.ok(track.samples.every((s, i) => Buffer.from(s.data).equals(original.samples[i % 25]!.data)));
});

for (const command of [createFfmpegCommand, createFfprobeCommand]) {
  it(`${command.name} fails on missing HLS segments instead of returning synthetic media`, async () => {
    const vfs = createTestVfs({ "/hls/index.m3u8": "#EXTM3U\n#EXTINF:1,\nmissing.ts\n" });
    const args = command === createFfmpegCommand ? ["-i", "/hls/index.m3u8", "/out.mp4"] : ["/hls/index.m3u8"];
    const result = await runCmd(command(), args, vfs);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("/hls/missing.ts"), result.stderr);
    assert.equal(vfs.store.has("/out.mp4"), false);
  });
}

it("extracts real pixels from native CABAC H.264", async () => {
  const { decodeImage } = await import("@poe-code/image-ast/portable");
  const native = Buffer.from("AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAAC7W1vb3YAAABsbXZoZAAAAAAAAAAAAAAAAAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAHwdHJhawAAAFx0a2hkAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAABAAAAAMAAAAAABjG1kaWEAAAAgbWRoZAAAAAAAAAAAAAAAAAAAKAAAAAAAVcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAATdtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAD3c3RibAAAAKtzdHNkAAAAAAAAAAEAAACbYXZjMQAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAABAADAASAAAAEgAAAAAAAAAARRMYXZjNjMuMS4xMDEgbGlieDI2NAAAAAAAAAAAAAAAABj//wAAADVhdmNDAWQACv/hABhnZAAKrNlEewEQAAADABAAAAMBQPEiWWABAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAAKG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAADAbW9vZgAAABBtZmhkAAAAAAAAAAEAAACodHJhZgAAACR0ZmhkAAAAOQAAAAEAAAAAAAADEQAABAAAAALaAQEAAAAAABR0ZmR0AQAAAAAAAAAAAAAAAAAAaHRydW4AAAoFAAAACgAAAMgCAAAAAAAC2gAACAAAAAAOAAAUAAAAAAwAAAgAAAAADAAAAAAAAAAMAAAEAAAAABQAABQAAAAADgAACAAAAAAMAAAAAAAAAAwAAAQAAAAAFAAACAAAAANibWRhdAAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAACRliIQAEf/+5+P8CmsrEcS/TVAozem13Ki6Nce2KM2pLx924T8AAAAKQZokbEEP/qpysAAAAAhBnkJ4h38K+QAAAAgBnmF0Q38N6AAAAAgBnmNqQ38N6QAAABBBmmhJqEFomUwId//+qdOhAAAACkGehkURLDv/CvkAAAAIAZ6ldEN/DekAAAAIAZ6nakN/DegAAAAQQZqpSahBbJlMCG///qfuQAAAAENtZnJhAAAAK3RmcmEBAAAAAAAAAQAAAAAAAAABAAAAAAAACAAAAAAAAAADEQEBAQAAABBtZnJvAAAAAAAAAEM=", "base64");
  const vfs = createTestVfs({ "/native.mp4": native });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/native.mp4", "-frames:v", "1", "/frame.png"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const image = decodeImage(vfs.store.get("/frame.png")!);
  assert.equal(image.width, 64);
  assert.equal(image.height, 48);
  assert.deepEqual(Array.from(image.data.slice(0, 4)), [254, 0, 0, 255]);
});

for (const [extension, flags, codec, sampleRate] of [
  ["ogg", [], "vorbis", 44100],
  ["ogg", ["-c:a", "libopus"], "opus", 48000],
  ["opus", [], "opus", 48000]
] as const) {
  it(`encodes ${extension} with ${flags.join(" ") || "default codec"}`, async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "sine=f=440:r=44100:d=0.1", ...flags, "/audio." + extension], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const probe = await runCmd(createFfprobeCommand(), ["-show_streams", "-of", "json", "/audio." + extension], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const stream = JSON.parse(probe.stdout).streams[0];
    assert.equal(stream.codec_name, codec);
    assert.equal(Number(stream.sample_rate), sampleRate);
    // Native ffprobe includes the Opus pre-skip in the reported Ogg duration.
    assert.equal(Number(stream.duration), codec === "opus" ? 0.1065 : 0.1);
  });
}


it("escapes tag separators, quotes and newlines like native ffprobe", async () => {
  const vfs = createTestVfs();
  const title = "Hello, \"World\"|line\nnext\\tab\tend";
  const encoded = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "color=s=16x16:r=1:d=1", "-metadata", "title=" + title, "/tagged.mp4"], vfs);
  assert.equal(encoded.exitCode, 0, encoded.stderr);
  const expected = {
  "csv=p=0": "\"Hello, \"\"World\"\"|line\nnext\\tab\tend\"\n",
  "compact=p=0": "tag:title=Hello, \"World\"\\|line\\nnext\\\\tab\tend\n",
  "flat": "format.tags.title=\"Hello, \\\"World\\\"|line\\nnext\\\\tab\tend\"\n"
};
  for (const [format, output] of Object.entries(expected)) {
    const result = await runCmd(createFfprobeCommand(), ["-show_entries", "format_tags=title", "-of", format, "/tagged.mp4"], vfs);
    assert.equal(result.stdout, output, format);
  }
});

for (const frequency of ["frequency=0", "f=0"]) {
  it(`generates silent lavfi sine audio for ${frequency}`, async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-v", "error", "-f", "lavfi", "-i",
      `sine=${frequency}:sample_rate=16000:duration=0.1`, "/silence.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/silence.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 16000);
    assert.equal(audio.channelData.length, 1);
    const samples = audio.channelData[0]!;
    assert.equal(samples.length, 1600);
    assert.ok(samples.every(sample => sample === 0), "every decoded sample must be silent");
  });
}

it("matches native lavfi sine waveform amplitude", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand(), [
    "-v", "error", "-f", "lavfi", "-i",
    "sine=frequency=440:sample_rate=16000:duration=0.1", "/tone.wav"
  ], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const audio = parseWav(vfs.store.get("/tone.wav")!).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 16000);
  assert.equal(audio.channelData.length, 1);
  const samples = audio.channelData[0]!;
  assert.equal(samples.length, 1600);
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  // Native FFmpeg pcm_s16le output for this source; allow two PCM quantization steps.
  const tolerance = 2 / 32768;
  assert.ok(Math.abs(peak - 0.124969482421875) <= tolerance, `peak: ${peak}`);
  assert.ok(Math.abs(rms - 0.08836870456) <= tolerance, `rms: ${rms}`);
});

it("matches native short sine and anullsrc sample counts and channel defaults", async () => {
  for (const [source, channels] of [["sine", 1], ["anullsrc", 2]] as const) {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", `${source}=sample_rate=16000:duration=0.01`, "/tone.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const track = parseWav(vfs.store.get("/tone.wav")!).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.channels, channels);
    assert.equal(track.codecDescriptions[0]!.sampleRate, 16000);
    for (const channel of track.decodedAudio!.channelData) {
      assert.equal(channel.length, 160);
    }
  }
});

it("matches native ffprobe flat numeric and string field types", async () => {
  const vfs = createTestVfs({ "/clip.mp4": createSyntheticMp4({ width: 80, height: 60, frameCount: 1, includeAudio: false }) });
  const result = await runCmd(createFfprobeCommand(), ["-of", "flat", "-show_entries", "stream=codec_name,width,height", "/clip.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'streams.stream.0.codec_name="h264"\nstreams.stream.0.width=80\nstreams.stream.0.height=60\n');
});


describe("GIF stream copy", () => {
  // An 8x8 black canvas followed by white 1x1 rectangles with local palettes.
  // Repeated LZW clear codes deliberately use a noncanonical compression.
  const codes = [...Array.from({ length: 64 }, () => [4, 0]).flat(), 5];
  const compressed = new Uint8Array(Math.ceil(codes.length * 3 / 8));
  codes.forEach((code, index) => {
    for (let bit = 0; bit < 3; bit++) compressed[Math.floor((index * 3 + bit) / 8)]! |= ((code >> bit) & 1) << ((index * 3 + bit) % 8);
  });
  const input = Uint8Array.from([
    ...Buffer.from("GIF89a"), 8, 0, 8, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255,
    33, 255, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, 2, 0, 0,
    33, 249, 4, 4, 10, 0, 0, 0,
    44, 0, 0, 0, 0, 8, 0, 8, 0, 0, 2, compressed.length, ...compressed, 0,
    ...[[3, 4, 20], [5, 2, 30]].flatMap(([x, y, delay]) => [
      33, 249, 4, 4, delay!, 0, 0, 0,
      44, x!, 0, y!, 0, 1, 0, 1, 0, 128, 0, 0, 0, 255, 255, 255, 2, 2, 76, 1, 0
    ]), 59
  ]);
  for (const sync of [false, true]) {
    it(`preserves descriptors, palettes, compressed data and delays (${sync ? "sync" : "async"})`, async () => {
      const vfs = createTestVfs({ "/input.gif": input.slice() });
      const args = ["-y", "-v", "error", "-i", "/input.gif", "-c:v", "copy", "/out.gif"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const expected = input.slice();
      const output = vfs.store.get("/out.gif")!.slice();
      // A muxer may update the loop count without changing any image packets.
      expected[35] = output[35] = 0;
      expected[36] = output[36] = 0;
      assert.deepEqual(output, expected);
    });
  }
});

describe("animated GIF and lavfi source regressions", () => {
  for (const args of [["-vf", "fps=10"], ["-r", "10"]]) {
    it(`resamples variable-duration GIF frames by presentation time with ${args.join(" ")}`, async () => {
      // Three 4x4 frames: red for 0.1s, green for 0.9s, blue for 0.1s.
      const input = Buffer.from("R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAFoAAAAsAAAAAAQABACAAIAAAAAAAgSEjwkFACH5BAAKAAAALAAAAAAEAAQAgAAA/wAAAAIEhI8JBQA7", "base64");
      const vfs = createTestVfs({ "/input.gif": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.gif", ...args, "/frame-%02d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const { decodeImage } = await import("@poe-code/image-ast/portable");
      const frames = [...vfs.store.entries()].filter(([path]) => path.endsWith(".png"));
      assert.equal(frames.length, 11);
      const pixels = frames.sort(([a], [b]) => a.localeCompare(b)).map(([, bytes]) => [...decodeImage(bytes).data.slice(0, 3)]);
      assert.deepEqual(pixels, [[255, 0, 0], ...Array.from({ length: 9 }, () => [0, 128, 0]), [0, 0, 255]]);
    });
  }

  for (const [option, filter] of [
    ["-vf", "not_a_video_filter"],
    ["-filter:v", "palettegen"],
    ["-vf", "paletteuse"],
    ["-filter_complex", "[0:v]scale=8:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse"]
  ]) {
    it(`rejects unsupported video filter ${filter} without replacing an existing output`, async () => {
      const original = new Uint8Array([17, 29, 43]);
      const vfs = createTestVfs({
        "/input.mp4": createSyntheticMp4({ width: 16, height: 12, frameCount: 2, includeAudio: false }),
        "/output.gif": original
      });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.mp4", option!, filter!, "/output.gif"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /unsupported video filter/i);
      assert.deepEqual(vfs.store.get("/output.gif"), original);
    });
  }

  it("keeps the null video filter as an explicit no-op", async () => {
    const vfs = createTestVfs({ "/input.mp4": createSyntheticMp4({ width: 16, height: 12, frameCount: 2, includeAudio: false }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-vf", "null", "-frames:v", "1", "/output.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const before = parseMp4(vfs.store.get("/input.mp4")!).tracks[0]!;
    const expected = [...decodeH264Samples(before.samples, before.codecDescriptions, 16, 12, before.timescale)];
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const actual = decodeImage(vfs.store.get("/output.png")!);
    assert.deepEqual(actual.data, expected[0]!.data);
  });

  it("encodes every filtered frame and probes animation timing", async () => {
    const vfs = createTestVfs();
    const source = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "testsrc=size=16x12:rate=4:duration=1.5", "master.mp4"], vfs);
    assert.equal(source.exitCode, 0, source.stderr);
    const encode = await runCmd(createFfmpegCommand(), ["-i", "master.mp4", "-vf", "fps=8,scale=8:6", "-loop", "0", "preview.gif"], vfs);
    assert.equal(encode.exitCode, 0, encode.stderr);
    const probe = await runCmd(createFfprobeCommand(), ["-show_format", "-show_streams", "-show_frames", "-of", "json", "preview.gif"], vfs);
    assert.equal(probe.exitCode, 0, probe.stderr);
    const result = JSON.parse(probe.stdout);
    assert.equal(result.streams[0].nb_frames, "12");
    assert.equal(result.streams[0].width, 8);
    assert.equal(result.streams[0].height, 6);
    assert.equal(result.frames.length, 12);
    assert.ok(Math.abs(Number(result.format.duration) - 1.5) <= 0.01);
  });

  it("renders static SMPTE bars with distinct upper, middle and lower bands", async () => {
    const vfs = createTestVfs();
    for (const name of ["smptebars", "testsrc"]) {
      const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", `${name}=size=28x12:rate=2:duration=1`, `${name}_%d.ppm`], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
    }
    assert.notDeepEqual(vfs.store.get("/smptebars_1.ppm"), vfs.store.get("/testsrc_1.ppm"));
    assert.deepEqual(vfs.store.get("/smptebars_1.ppm"), vfs.store.get("/smptebars_2.ppm"));
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const image = decodeImage(vfs.store.get("/smptebars_1.ppm")!);
    const pixel = (x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
    assert.deepEqual(pixel(0, 0), [191, 191, 191]);
    assert.deepEqual(pixel(0, 8), [0, 0, 191]);
    assert.deepEqual(pixel(7, 11), [255, 255, 255]);
  });
});

it("decodes AAC before audio filters, resampling and channel conversion", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../safe-bash-command-audio/fixtures/tone.m4a", import.meta.url));
  const command = createFfmpegCommand();
  const vfs = createTestVfs({ "/in.m4a": source });
  const plain = await runCmd(command, ["-i", "/in.m4a", "-c:a", "pcm_s16le", "/plain.wav"], vfs);
  assert.equal(plain.exitCode, 0, plain.stderr);
  for (const options of [["-af", "volume=0.5"], ["-af", "atempo=2"], ["-af", "areverse"], ["-ar", "24000"], ["-ac", "1"]]) {
    const result = await runCmd(command, ["-y", "-v", "error", "-i", "/in.m4a", ...options, "-c:a", "pcm_s16le", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const control = await runCmd(command, ["-y", "-i", "/plain.wav", ...options, "-c:a", "pcm_s16le", "/control.wav"], vfs);
    assert.equal(control.exitCode, 0, control.stderr);
    const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
    const expected = parseWav(vfs.store.get("/control.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(actual.sampleRate, expected.sampleRate);
    assert.equal(actual.channels, expected.channels);
    for (let channel = 0; channel < actual.channels; channel++) {
      assert.equal(actual.channelData[channel]!.length, expected.channelData[channel]!.length);
      for (let i = 0; i < actual.channelData[channel]!.length; i++) {
        assert.ok(Math.abs(actual.channelData[channel]![i]! - expected.channelData[channel]![i]!) <= 2 / 32768, options.join(" "));
      }
    }
  }
  const parsed = parseMp4(source);
  const broken = { ...parsed, tracks: parsed.tracks.map(track => ({
    ...track, samples: track.samples.map((sample, index) => index === 0 ? { ...sample, data: Uint8Array.of(255) } : sample)
  })) };
  vfs.store.set("/in.m4a", serializeMp4(broken));
  const previous = vfs.store.get("/out.wav");
  const failure = await runCmd(command, ["-y", "-i", "/in.m4a", "-af", "volume=0.5", "/out.wav"], vfs);
  assert.equal(failure.exitCode, 1);
  assert.match(failure.stderr, /AAC/);
  assert.deepEqual(vfs.store.get("/out.wav"), previous);
});

it("extracts external AAC to WAV and leaves existing output intact on corrupt AAC", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../mp4-ast/src/fixtures/aac-external.mp4", import.meta.url));
  const command = createFfmpegCommand();
  const vfs = createTestVfs({ "/demo.mp4": source });
  const result = await runCmd(command, ["-y", "-i", "demo.mp4", "-vn", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const wav = vfs.store.get("/audio.wav")!;
  const audio = parseWav(wav).tracks[0]!.decodedAudio!;
  assert.equal(audio.sampleRate, 24000);
  // Native FFmpeg 7.0.2 retains the final AAC frame beyond the 8-second edit.
  assert.equal(audio.channelData[0]!.length, 192512);
  const parsed = parseMp4(source);
  const broken = { ...parsed, tracks: parsed.tracks.map(track => track.type !== "audio" ? track : {
    ...track, samples: track.samples.map((sample, index) => index === 20 ? { ...sample, data: Uint8Array.of(255) } : sample)
  }) };
  vfs.store.set("/demo.mp4", serializeMp4(broken));
  const failure = await runCmd(command, ["-y", "-i", "demo.mp4", "-vn", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(failure.exitCode, 1);
  assert.match(failure.stderr, /AAC/);
  assert.deepEqual(vfs.store.get("/audio.wav"), wav);
  vfs.store.set("/control.wav", wav);
  const control = await runCmd(command, ["-y", "-i", "control.wav", "-c:a", "pcm_s16le", "audio.wav"], vfs);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.equal(parseWav(vfs.store.get("/audio.wav")!).durationSeconds, 192512 / 24000);
});

// ffmpeg -f lavfi -i testsrc2=size=64x48:rate=10:duration=1 -c:v libx264 -bf 3 -g 30 fixture.mp4
const seekH264 = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAACCNtZGF0AAACrAYF//+o3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDE2NSByMzIyMiBiMzU2MDVhIC0gSC4yNjQvTVBFRy00IEFWQyBjb2RlYyAtIENvcHlsZWZ0IDIwMDMtMjAyNSAtIGh0dHA6Ly93d3cudmlkZW9sYW4ub3JnL3gyNjQuaHRtbCAtIG9wdGlvbnM6IGNhYmFjPTEgcmVmPTMgZGVibG9jaz0xOjA6MCBhbmFseXNlPTB4MzoweDExMyBtZT1oZXggc3VibWU9NyBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTE2IGNocm9tYV9tZT0xIHRyZWxsaXM9MSA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0zIGJfcHlyYW1pZD0yIGJfYWRhcHQ9MSBiX2JpYXM9MCBkaXJlY3Q9MSB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTMwIGtleWludF9taW49MyBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTMwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAA/9liIQBf9RXbEfXd6NKk0vP473I5OWavVQJvghQBgab84741ZLDhyrwf6orDB+FS1YJO+MkNgtoaIOfvzmFbng+jIOueTLixAi9p+POnD4QiJfSgwFTSVe9EkhkV2cVS6ZTt7Vr4wKZIRR1bdERzupZkxeI7tkxPAyEGbXF9T0/ZMzuxSlgSVYcwrtareCEA3Hz7r9S9zjzbkypCqOAWIRuGP8nSkkzIpKB77j2Z2gm2SRvZVUrwQ/3N1ToN5w1Ue2b6tVc1vKoVLF/4P8CRqdsSEam2zy1OZYjFFOZnm7C1+HxlDRJMjf5s/rL8qpXoIIjAyGTCrgyn3pOHp2QyAH+2gQCy5NT4HKewUZoL3sWWrEBWdlQFKnRf8CReu6OL8RlxhDc0LNVfgllK5DsPhVP62v704VFe8CHwkRz0+slyhBzGRdRC1MV9wxpANShSfUsiywV2PzXd8yOcxayQ2fOfEokARE+KaVOIk0+veVeUpT8w01MU4UEK9fYMAQVEF2SbhHjzEqjyhFtUo56/fvBS0oRIc9mS0yFR81PvniinaHcbvSujGLbH+gGHRvvxRj7zJ6U4jLZqeKdDEtUi+cGoDTUW207VZohIa0NWf8dN5c44SY6QnUGwzMkWXHBju2NeGxOsT5GKvDH2Q97os8PJCoqPyj0Hgrymg2vW8xbBBvBIYVQQokHMsu8fBGp3LIwguR9ufLt/up3/OebzROslXhwYCO0K5Z8uEx17CzA+WPpMDjrAGE63Szn+TdFNINeyZHq5GDR0bbB5yK/ZNBAiQ3pc7OgWyh/tHE1ro6iRtQa1SCaGWTfbQQdgLHO6jbQrpWSAUIObleRdd4RUTKYCmJWADrI39eex6gI8ZX8Oni4gw8Jdo/GLEfBUb67wV48EDXcAZRTOPCcEFQh/yzQ0om4l12VjVweZlIL6j4JUDWImGTfxLrAit/HHqi+YFSCoZVlAxdX+ydhun+aW+rsBDcOrvM8MKUGf2iVfTcHRA9zwyR+HAdX2pL1cT93rykFv4i+153ZHae/G44S01D/ifax5p50oeOM6aTFqQDTH/wrKPJBVJPeyzYG7Lm1bbgAw3ZWb2uQV9LiSpw/Qkvrjcx5l2ZPr1o2D494nS7qAncv6qO8FS5wEsbsLlxtcth1Yt/mffkC3TfCsUyi+qM4MNv/HoYYsjd8Q3ck5s26XiwG+G+IXNQncXBjTQerCGazhJeyjsfAYbelYOSew9Tn5gObxGqm/cztnt51o9VjesMOpEngFqBt8sX1ZyAJfd4cv1Bt2SLFNzn345fpnCy21iTQwodPNyQ8+IqpanLRV5QjjVYmeq7K+mulsG3sq2gdjNKv26NffudnRLpSeWcAAAA/QZokbE3/xhrr/B2/g9KBXxZ3TdcBWFde37G9wRdncos+Acz+KtG7hirhWt+lsIouoJqaz9zFofyzZfTqkM4WAAAAHkGeQniM//qyGHnRB0PHmHhCY32redUXSaz0GxuGcQAAACcBnmF0Qh/2f4SvbjbpbfAjcTbdaF+QKQWGNUXOvkpx1HWzT9dZc7gAAAAIAZ5jakIfa0EAAABPQZpoSahBaJlMCM/xn67rUSt0k8uPIpyouGpeAlj9uFFJUgGZaOlfwQjVlUKm35RA1o/tV+KnkxZeqziwy3DR00wKOD2/02r/C0SfkC5xgQAAABpBnoZFESxn6x5cnDy/2c9elqJiZLVoDlwhsQAAAAsBnqV0Qh/2fQQzYQAAAA0BnqdqQh/gGbRR86eAAAAAN0GaqUmoQWyZTAhD/0UDvmZAMDOeo1/wwOGW/04r7aXR3KpJ39qlyGc3uffHOzYBtG9SLXj8qIAAAAOxbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAtx0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAAAwAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAIAAABAAAAAAJUbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB/21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAb9zdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAMABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UR7ARAAAAMAEAAAAwFA8SJZYAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAABA2AAAAAAAAAAYc3R0cwAAAAAAAAABAAAACgAABAAAAAAUc3RzcwAAAAAAAAABAAAAAQAAAGBjdHRzAAAAAAAAAAoAAAABAAAIAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAAFAAAAAABAAAIAAAAAAEAAAAAAAAAAQAABAAAAAABAAAIAAAAABxzdHNjAAAAAAAAAAEAAAABAAAACgAAAAEAAAA8c3RzegAAAAAAAAAAAAAACgAABrMAAABDAAAAIgAAACsAAAAMAAAAUwAAAB4AAAAPAAAAEQAAADsAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGF1ZHRhAAAAWW1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALGlsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDE=", "base64");

it("seeks H.264 B-frames in display order before limiting image output", async () => {
  const track = parseMp4(seekH264).tracks[0]!;
  assert.ok(track.samples.some(sample => sample.pts !== sample.dts));
  assert.ok(track.samples.some(sample => !sample.isKeyframe));
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const command = createFfmpegCommand({ asts: allMediaAsts() });
  assert.equal((await runCmd(command, ["-i", "in.mp4", "full_%03d.png"], vfs)).exitCode, 0);
  assert.equal([...vfs.store.keys()].filter(key => key.startsWith("/full_")).length, 10);
  const expected = vfs.store.get("/full_005.png")!;
  assert.notDeepEqual(expected, vfs.store.get("/full_001.png"));
  for (const seek of [["-ss", "0.4", "-i", "in.mp4"], ["-i", "in.mp4", "-ss", "0.4"]]) {
    for (const output of [["-frames:v", "1", "single.png"], ["sequence_%03d.png"], ["-frames:v", "1", "limited_%03d.png"], ["-vf", "scale=64:48", "-frames:v", "1", "filtered.png"]]) {
      const result = await runCmd(command, ["-y", ...seek, ...output], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const filename = output.at(-1)!.replace("%03d", "001");
      assert.deepEqual(vfs.store.get(`/${filename}`), expected, `${seek.join(" ")} ${output.join(" ")}`);
    }
  }
});

it("charges seek preroll to the decode budget and stops after the requested display frame", async () => {
  for (const [maxFrames, success] of [[4, false], [5, true]] as const) {
    const vfs = createTestVfs({ "in.mp4": seekH264 });
    const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts(), limits: { maxFrames } }),
      ["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs);
    assert.equal(result.exitCode === 0, success, result.stderr);
    assert.equal(vfs.store.has("/out.png"), success);
    if (!success) assert.match(result.stderr, /maxFrames/);
  }
});

it("rejects image extraction with no displayed frame", async () => {
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts() }),
    ["-ss", "2", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs);
  assert.notEqual(result.exitCode, 0);
  assert.equal(vfs.store.has("/out.png"), false);
});

it("cancels H.264 seeking before publishing an image", async () => {
  const vfs = createTestVfs({ "in.mp4": seekH264 });
  const controller = new AbortController();
  let turns = 0;
  registerYieldCheckpoint(controller.signal, () => {
    if (++turns === 4) controller.abort(new Error("cancel seek"));
  });
  try {
    const result = await runCmd(createFfmpegCommand({ asts: allMediaAsts() }),
      ["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"], vfs, new Uint8Array(), controller.signal);
    assert.notEqual(result.exitCode, 0);
  } catch (error) {
    assert.match(String(error), /cancel seek/);
  }
  assert.ok(turns >= 4);
  assert.equal(vfs.store.has("/out.png"), false);
});

it("declines synchronous encoded image extraction so decoding stays cooperative", () => {
  let published = false;
  const result = evalSyncFfmpeg(["-ss", "0.4", "-i", "in.mp4", "-frames:v", "1", "out.png"],
    undefined, () => seekH264, () => { published = true; return true; });
  assert.equal(result, undefined);
  assert.equal(published, false);
});

for (const [scale, width, height] of [["6:4", 6, 4], ["3:2", 3, 2], ["1:1", 1, 1]] as const) {
  it(`matches native default scale=${scale} pixels for a tiny RGB image`, async () => {
    const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
    const colors = [[255, 0, 0], [0, 128, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
    const input = encodeImage({
      width: 3, height: 2, channels: 4,
      data: new Uint8Array(colors.flatMap(color => [...color, 255])),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/input.png": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-y", "-i", "/input.png", "-vf", `scale=${scale}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, width);
    assert.equal(actual.height, height);
    // FFmpeg 9.0.1: bicubic support is capped to max(1, source dimension - 2).
    const expected = Array.from({ length: width * height }, (_, i) => {
      const x = Math.floor((i % width + 0.5) * 3 / width);
      const y = Math.min(1, Math.floor((Math.floor(i / width) + 0.5) * 2 / height));
      return [...colors[y * 3 + x]!, 255];
    }).flat();
    assert.deepEqual([...actual.data], expected);
  });
}

// Native FFmpeg 9.0.1 PNG reference pixels. Grayscale isolates the sampling
// curve from native RGB/YUV chroma conversion and subsampling.
for (const [width, height, pixels] of [
  [9, 8, [
    0,25,67,89,114,140,163,191,210,114,68,30,71,101,126,149,177,195,
    255,144,18,47,74,100,124,152,170,223,212,154,33,31,84,106,134,152,
    190,232,236,115,55,50,78,107,125,173,191,222,251,129,13,56,90,107,
    152,169,200,230,199,129,56,58,86,134,151,180,202,255,239,58,29,68
  ]],
  [3, 2, [115,88,151,190,144,86]]
] as const) {
  it(`matches native default bicubic sampling at 6x5 to ${width}x${height}`, async () => {
    const { decodeImage, encodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({
      width: 6, height: 5, channels: 4,
      data: Uint8Array.from({ length: 120 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * 37 + 19) % 256),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const vfs = createTestVfs({ "/input.png": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.png", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    assert.equal(actual.width, width);
    assert.equal(actual.height, height);
    assert.deepEqual([...actual.data], pixels.flatMap(value => [value, value, value, 255]));
  });
}

for (const [sourceRate, targetRate] of [[16000, 8000], [44100, 16000]] as const) {
  it(`low-pass filters audio downsampling from ${sourceRate} to ${targetRate}`, async () => {
    const channels = [1000, targetRate * 0.75].map(frequency =>
      Float64Array.from({ length: sourceRate }, (_, i) => 0.125 * Math.sin(2 * Math.PI * frequency * i / sourceRate)));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: sourceRate, channels }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", String(targetRate), "-c:a", "pcm_s16le", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, targetRate);
    assert.equal(audio.channels, 2);
    for (const [c, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, targetRate);
      const middle = samples.subarray(Math.floor(targetRate * 0.2), Math.floor(targetRate * 0.8));
      let sumSquares = 0;
      for (const sample of middle) sumSquares += sample * sample;
      const rms = Math.sqrt(sumSquares / middle.length);
      if (c === 0) assert.ok(Math.abs(rms - 0.125 / Math.SQRT2) < 0.001, `passband RMS: ${rms}`);
      else assert.ok(rms < 0.0001, `aliased RMS: ${rms}`);
    }
  });
}

describe("WAV encoder identification", () => {
  for (const sync of [false, true]) {
    for (const flags of [[], ["-bitexact"], ["-fflags", "+bitexact"]]) {
      for (const removeMetadata of [false, true]) {
        it(`${sync ? "sync" : "async"} writes WAV INFO with ${flags.join(" ") || "defaults"}, removeMetadata=${removeMetadata}`, async () => {
          const input = Uint8Array.from(Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64"));
          const vfs = createTestVfs({ "/in.wav": input });
          const args = ["-i", "/in.wav", ...flags,
            ...(removeMetadata ? ["-map_metadata", "-1"] : []), "/out.wav"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const output = vfs.store.get("/out.wav")!;
          const parsed = parseWav(output);
          assert.equal(parsed.metadata.encoder, flags.length ? undefined : "Lavf61.7.100");
          assert.equal(new TextDecoder().decode(output).includes("ISFT"), flags.length === 0);
          assert.equal(parsed.metadata.title, removeMetadata ? undefined : "Old title");
          assert.equal(parsed.metadata.artist, removeMetadata ? undefined : "Player");
          assert.deepEqual(parsed.tracks[0]!.decodedAudio, parseWav(input).tracks[0]!.decodedAudio);
        });
      }
    }
  }
});

describe("global metadata mapping", () => {
  for (const sync of [false, true]) {
    for (const sources of [[0, 1], [1, 0]]) {
      it(`${sync ? "sync" : "async"} merges repeated global metadata maps ${sources}`, async () => {
        const first = createSyntheticMp4({ frameCount: 2, includeAudio: true, metadata: { title: "First", artist: "Alice" } });
        const second = createSyntheticMp4({ frameCount: 1, includeAudio: true, metadata: { title: "Second", album: "Beta" } });
        const vfs = createTestVfs({ "/first.mp4": first, "/second.mp4": second });
        const args = ["-i", "/first.mp4", "-i", "/second.mp4",
          ...(sync ? [] : ["-map", "0:a:0"]),
          ...sources.flatMap(source => ["-map_metadata", String(source)]), "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        assert.equal(output.metadata.title, sources[0] === 0 ? "First" : "Second");
        assert.equal(output.metadata.artist, "Alice");
        assert.equal(output.metadata.album, "Beta");
        assert.deepEqual(output.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]),
          parseMp4(first).tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]));
      });
    }
  }
  for (const [option, suffix] of [["-map_metadata", ""], ["-map_metadata", ":g"], ["-map_metadata:g", ""], ["-map_metadata:g", ":g"]] as const) {
    for (const sync of [false, true]) {
      for (const [mapping, title] of [[undefined, "First"], ["0", "First"], ["1", "Second"], ["-1", undefined]] as const) {
        for (const override of [false, true]) {
          it(`${sync ? "sync" : "async"} maps ${option} metadata ${mapping ?? "by default"}${suffix} with override=${override}`, async () => {
            const vfs = createTestVfs({
              "/first.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "First", artist: "Artist" } }),
              "/second.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "Second", album: "Beta" } })
            });
            const args = ["-i", "/first.mp4", "-i", "/second.mp4",
              ...(sync ? [] : ["-map", "0:v"]),
              ...(mapping === undefined ? [] : [option, `${mapping}${suffix}`]),
              ...(override ? ["-metadata", "title=Override"] : []), "-c", "copy", "/out.mp4"];
            if (sync) {
              assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
                (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
            } else {
              const result = await runCmd(createFfmpegCommand(), args, vfs);
              assert.equal(result.exitCode, 0, result.stderr);
            }
            const tags = parseMp4(vfs.store.get("/out.mp4")!).metadata;
            assert.equal(tags.title, override ? "Override" : title);
            assert.equal(tags.album, mapping === "1" ? "Beta" : undefined);
            assert.equal(tags.artist, mapping === "1" || mapping === "-1" ? undefined : "Artist");
          });
        }
      }
      for (const mapping of ["2", "oops", "1.5", ":g", "0:s", "0:g:g"]) {
        it(`${sync ? "sync" : "async"} rejects ${option} metadata source ${mapping}${suffix} without writing output`, async () => {
          const vfs = createTestVfs({ "/first.mp4": createSyntheticMp4({ frameCount: 1 }) });
          const args = ["-i", "/first.mp4", option, `${mapping}${suffix}`, "-c", "copy", "/out.mp4"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
          } else {
            assert.notEqual((await runCmd(createFfmpegCommand(), args, vfs)).exitCode, 0);
          }
          assert.equal(vfs.store.has("/out.mp4"), false);
        });
      }
    }
  }
});

describe("chapter output seeking", () => {
  for (const sync of [false, true]) {
    for (const mapping of [undefined, "0", "-1"]) {
      for (const end of [["-t", "0.5"], ["-to", "0.75"]]) {
        it(`${sync ? "sync" : "async"} rebases chapters with ${end[0]} and mapping ${mapping ?? "default"}`, async () => {
          const base = parseMp4(createSyntheticMp4({ frameCount: 25, fps: 25, includeAudio: true }));
          const chapters = [
            { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.4, title: "Intro" },
            { id: 1, startTimeSeconds: 0.4, endTimeSeconds: 1, title: "Discussion" }
          ];
          const vfs = createTestVfs({
            "/chapters.mp4": serializeMp4({ ...base, chapters }),
            "/plain.mp4": serializeMp4(base)
          });
          const args = ["-i", "/chapters.mp4", "-i", "/plain.mp4",
            ...(sync ? [] : ["-map", "0:a:0"]), "-c", "copy",
            ...(mapping === undefined ? [] : ["-map_chapters", mapping]),
            "-ss", "0.25", ...end, "/out.mp4"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).chapters ?? [], mapping === "-1" ? [] : [
            { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.15, title: "Intro" },
            { id: 1, startTimeSeconds: 0.15, endTimeSeconds: 0.5, title: "Discussion" }
          ]);
        });
      }
    }
  }
});

describe("chapter mapping", () => {
  for (const sync of [false, true]) {
    for (const mapping of [undefined, "-1", "0", "1", "2"]) {
      it(`${sync ? "sync" : "async"} selects chapters independently of audio with mapping ${mapping ?? "default"}`, async () => {
        const plain = createSyntheticMp4({ frameCount: 25, fps: 25, includeAudio: true });
        const base = parseMp4(plain);
        const chapters = [
          { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.4, title: "Intro" },
          { id: 1, startTimeSeconds: 0.4, endTimeSeconds: 1, title: "Discussion" }
        ];
        const laterChapters = [{ id: 0, startTimeSeconds: 0, endTimeSeconds: 1, title: "Later" }];
        const vfs = createTestVfs({
          "/plain.mp4": plain,
          "/chapters.mp4": serializeMp4({ ...base, chapters }),
          "/later.mp4": serializeMp4({ ...base, chapters: laterChapters })
        });
        const args = ["-i", "/plain.mp4", "-i", "/chapters.mp4", "-i", "/later.mp4",
          ...(sync ? [] : ["-map", "0:a:0"]),
          ...(mapping === undefined ? [] : ["-map_chapters", mapping]), "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        const expected = mapping === "-1" || mapping === "0" ? [] : mapping === "2" ? laterChapters : chapters;
        assert.deepEqual(output.chapters ?? [], expected);
        assert.deepEqual(output.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]),
          base.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]));
      });
    }
  }
  for (const sync of [false, true]) {
    for (const mapping of [undefined, "-1", "0", "1"]) {
      it(`${sync ? "sync" : "async"} serializes chapter mapping ${mapping ?? "by default"}`, async () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true, metadata: { title: "Keep me" } }));
        const chapters = [
          { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.04, title: "Opening" },
          { id: 1, startTimeSeconds: 0.04, endTimeSeconds: base.durationSeconds, title: "Ending" }
        ];
        const input = serializeMp4({ ...base, chapters });
        assert.equal(parseMp4(input).chapters?.length, 2);
        const vfs = createTestVfs({ "/in.mp4": input, "/empty.mp4": serializeMp4(base) });
        const args = ["-i", "/in.mp4", "-i", "/empty.mp4",
          ...(sync ? [] : ["-map", "0:a"]),
          ...(mapping === undefined ? [] : ["-map_chapters", mapping]),
          "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        assert.deepEqual(output.chapters?.map(ch => [ch.startTimeSeconds, ch.title]) ?? [],
          mapping === "-1" || mapping === "1" ? [] : chapters.map(ch => [ch.startTimeSeconds, ch.title]));
        assert.equal(output.metadata.title, "Keep me");
        assert.deepEqual(output.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]),
          base.tracks.find(t => t.type === "audio")?.samples.map(s => [s.data, s.duration, s.pts]));
      });
    }
    for (const mapping of ["2", "oops", "1.5", ""]) {
      it(`${sync ? "sync" : "async"} rejects invalid chapter source ${mapping}`, async () => {
        const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 1 }) });
        const args = ["-i", "/in.mp4", "-map_chapters", mapping, "-c", "copy", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), undefined);
        } else {
          assert.notEqual((await runCmd(createFfmpegCommand(), args, vfs)).exitCode, 0);
        }
        assert.equal(vfs.store.has("/out.mp4"), false);
      });
    }
  }
});


describe("scaled audio frame limits", () => {
  for (const sync of [false, true]) {
    for (const option of ["-frames:a", "-aframes"]) {
      for (const [limit, count] of [["2", 1024], ["0.002k", 1024], ["1k", 16000], ["2Ki", 16000], ["2000m", 1024]] as const) {
        it(`${sync ? "sync" : "async"} ${option} ${limit} preserves scaled PCM samples`, async () => {
          const samples = Float64Array.from({ length: 16000 }, (_, i) => (i - 8000) / 32768);
          const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [samples] }) });
          const args = ["-i", "/in.wav", "-c:a", "copy", option, limit, "/out.wav"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
          assert.deepEqual(Array.from(actual), Array.from(samples.slice(0, count)));
        });
      }
    }
  }
  for (const limit of ["1m", "0.0025k", "2Kii", "Ki", "1e100k"]) {
    it(`rejects invalid scaled audio frame count ${limit}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-c:a", "copy",
        "-frames:a", limit, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /invalid audio frame limit/);
      assert.equal(vfs.store.has("/out.wav"), false);
    });
  }
});

describe("negative video frame limits", () => {
  for (const sync of [false, true]) {
    it(`negative video frame limits clear an earlier limit (${sync ? "sync" : "async"})`, async () => {
      const input = createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5 });
      const vfs = createTestVfs({ "/in.mp4": input });
      const args = ["-i", "/in.mp4", "-c:v", "copy", "-frames:v", "2", "-frames:v", "-1", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
    });
  }
  for (const option of ["-frames:v", "-frames:v:0", "-vframes"]) {
    for (const limit of [-2, -1, 0, 2, undefined]) {
      it(`${option} ${limit ?? "unlimited"} preserves the expected video packets`, async () => {
        const input = createSyntheticMp4({ width: 16, height: 16, fps: 5, frameCount: 5 });
        const vfs = createTestVfs({ "/in.mp4": input });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-c:v", "copy",
          ...(limit === undefined ? [] : [option, String(limit)]), "/out.mp4"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const before = parseMp4(input).tracks.find(track => track.type === "video")!;
        const after = parseMp4(vfs.store.get("/out.mp4")!).tracks.find(track => track.type === "video")!;
        const expected = limit === undefined || limit < 0 ? before.samples : before.samples.slice(0, limit);
        if (limit === 0) assert.equal(after, undefined);
        else assert.deepEqual(after.samples.map(sample => sample.data), expected.map(sample => sample.data));
      });
    }
  }
});

describe("negative audio frame limits", () => {
  for (const option of ["-frames:a", "-aframes"]) {
    for (const limit of [-2, -1, 0, 1, undefined]) {
      it(`${option} ${limit ?? "unlimited"} preserves the expected PCM samples`, async () => {
        const samples = Float64Array.from({ length: 16000 }, (_, i) => (i - 8000) / 32768);
        const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [samples] }) });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-c:a", "copy",
          ...(limit === undefined ? [] : [option, String(limit)]), "/out.wav"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
        const length = limit === undefined || limit < 0 ? samples.length : limit * 512;
        assert.deepEqual(Array.from(actual), Array.from(samples.slice(0, length)));
      });
    }
  }
});

describe("output stream frame selectors", () => {
  for (const sync of [false, true]) for (const [option, count] of [
    ["-frames", 512], ["-frames:0", 512], ["-frames:a:0", 512], ["-frames:a:1", 16000]
  ] as const) for (const codec of (sync ? ["copy"] : ["copy", "pcm_s16le"])) {
    it(`${sync ? "sync" : "async"} ${codec} ${option} selects output PCM packets`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 16000 }, (_, i) => (i - 8000) / 32768)] });
      const vfs = createTestVfs({ "/in.wav": input });
      const args = ["-i", "/in.wav", "-c:a", codec!, option, "1", "/out.wav"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(audio), Array.from({ length: count }, (_, i) => (i - 8000) / 32768));
    });
  }
  it("stops mapped audio streams at the earliest matching limit", async () => {
    const input = createSyntheticMp4({ frameCount: 5, includeAudio: true });
    const source = parseMp4(input).tracks.find(t => t.type === "audio")!;
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0:a", "-map", "0:a", "-c", "copy",
      "-frames", "1", "-frames:a:1", "2", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const tracks = parseMp4(vfs.store.get("/out.mp4")!).tracks;
    assert.deepEqual(tracks.map(t => t.samples.map(s => s.data)), [source.samples.slice(0, 1).map(s => s.data), source.samples.slice(0, 1).map(s => s.data)]);
  });
  it("counts blank timed-text packets toward subtitle limits", async () => {
    const vfs = createTestVfs({ "/in.mp4": readFileSync(new URL("../../mp4-ast/src/fixtures/timed-text-styles.mp4", import.meta.url)) });
    const source = mp4Ast().probe(vfs.store.get("/in.mp4")!, { showPackets: true }).packets!;
    assert.equal(Number(source[0]!.size), 2);
    const copied = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0:s", "-c:s", "copy", "-frames:s", "2", "/out.mp4"], vfs);
    assert.equal(copied.exitCode, 0, copied.stderr);
    const packets = mp4Ast().probe(vfs.store.get("/out.mp4")!, { showPackets: true }).packets!;
    assert.deepEqual(packets.map(p => [p.pts, p.size]), source.slice(0, 2).map(p => [p.pts, p.size]));
  });
  for (const option of ["-frames:1", "-frames:v:0"]) {
    it(`${option} resolves after reordered output mapping`, async () => {
      const input = createSyntheticMp4({ frameCount: 5, includeAudio: true });
      const source = parseMp4(input);
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0:a", "-map", "0:v", "-c", "copy", option, "2", "/out.mp4"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseMp4(vfs.store.get("/out.mp4")!);
      assert.equal(output.tracks.find(t => t.type === "video")!.samples.length, 2);
      assert.deepEqual(output.tracks.find(t => t.type === "audio")!.samples.map(s => s.data), source.tracks.find(t => t.type === "audio")!.samples.slice(0, 8).map(s => s.data));
    });
  }
});

describe("PCM audio frame limits", () => {
  for (const sampleRate of [8000, 44100]) {
    for (const channels of [1, 2]) {
      for (const inputFormat of ["s16le", "wav"]) {
        for (const outputFormat of ["s16le", "wav"]) {
          for (const codec of ["copy", "pcm_s16le", undefined]) {
            for (const limit of [1, 2, 3, undefined]) {
              it(`${sampleRate} Hz ${channels}ch ${inputFormat} to ${outputFormat} ${codec} frames=${limit ?? "unlimited"}`, async () => {
                const length = 8000;
                const pcm = new Uint8Array(length * channels * 2);
                const view = new DataView(pcm.buffer);
                for (let i = 0; i < length * channels; i++) view.setInt16(i * 2, i, true);
                const input = inputFormat === "s16le" ? pcm : encodeWav({ sampleRate,
                  channels: Array.from({ length: channels }, (_, ch) =>
                    Float64Array.from({ length }, (_, i) => (i * channels + ch) / 32768)) });
                const vfs = createTestVfs({ "/input": input });
                const args = [...(inputFormat === "s16le" ? ["-f", "s16le", "-ar", String(sampleRate), "-ac", String(channels)] : []),
                  "-i", "/input", ...(limit === undefined ? [] : ["-frames:a", String(limit)]),
                  ...(codec ? ["-c:a", codec] : []), "-f", outputFormat, "/output"];
                if (limit !== undefined && codec !== "copy") {
                  assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
                    () => { assert.fail("frame limiting must use the async path"); }), undefined);
                }
                const result = await runCmd(createFfmpegCommand(), args, vfs);
                assert.equal(result.exitCode, 0, result.stderr);
                const output = vfs.store.get("/output")!;
                const expectedLength = limit === undefined ? length : Math.min(length, limit * (sampleRate === 8000 ? 512 : 4096));
                if (outputFormat === "s16le") {
                  assert.equal(output.length, expectedLength * channels * 2);
                  assert.deepEqual(output, pcm.subarray(0, expectedLength * channels * 2));
                } else {
                  const audio = parseWav(output).tracks[0]!.decodedAudio!;
                  for (let ch = 0; ch < channels; ch++) {
                    assert.equal(audio.channelData[ch]!.length, expectedLength);
                    assert.deepEqual(Array.from(audio.channelData[ch]!),
                      Array.from({ length: expectedLength }, (_, i) => (i * channels + ch) / 32768));
                  }
                }
              });
            }
          }
        }
      }
    }
  }
});

describe("WAV output size limits", () => {
  const input = () => encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 16000 }, (_, i) => (i - 8000) / 32768)] });
  for (const sync of [false, true]) {
    for (const [limit, count] of [[undefined, 16000], ["4096", 2048], ["4Ki", 2048], ["16k", 8192], ["1", 0]] as const) {
      it(`${sync ? "sync" : "async"} -fs ${limit ?? "unlimited"} keeps complete WAV packets`, async () => {
        const vfs = createTestVfs({ "/in.wav": input() });
        const args = ["-i", "/in.wav", "-c:a", "copy", ...(limit ? ["-fs", limit] : []), "/out.wav"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseWav(vfs.store.get("/out.wav")!);
        const pcm = output.tracks[0]!.decodedAudio!.channelData[0]!;
        assert.equal(pcm.length, count);
        assert.deepEqual(Array.from(pcm, n => n * 32768), Array.from({ length: count }, (_, i) => i - 8000));
      });
    }
  }
  it("resets the limit for the next output and combines it with frame limits", async () => {
    const vfs = createTestVfs({ "/in.wav": input() });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-c:a", "copy", "-fs", "4096",
      "-frames:a", "1", "/short.wav", "-c:a", "copy", "/full.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(parseWav(vfs.store.get("/short.wav")!).tracks[0]!.decodedAudio!.channelData[0]!.length, 512);
    assert.equal(parseWav(vfs.store.get("/full.wav")!).tracks[0]!.decodedAudio!.channelData[0]!.length, 16000);
  });
  for (const value of ["-1", "bad", "4Kii", "", "9007199254740992"]) {
    it(`rejects invalid size ${JSON.stringify(value)}`, async () => {
      const result = await runCmd(createFfmpegCommand(),
        ["-i", "/in.wav", "-c:a", "copy", "-fs", value, "/out.wav"], createTestVfs({ "/in.wav": input() }));
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /invalid file size limit/);
    });
  }
  it("keeps the output resource budget in force", async () => {
    const vfs = createTestVfs({ "/in.wav": input() });
    const result = await runCmd(createFfmpegCommand({ limits: { maxOutputBytes: 4096 } }),
      ["-i", "/in.wav", "-c:a", "copy", "-fs", "4096", "/out.wav"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /maxOutputBytes/);
  });
});

describe("audio stream copy frame limits", () => {
  for (const sync of [false, true]) {
    for (const option of ["-frames:a", "-aframes"]) {
      for (const limit of [-2, -1, 0, 1, undefined]) {
        it(`${sync ? "sync" : "async"} ${option} ${limit ?? "unlimited"} preserves the selected AAC packets`, async () => {
          const base = parseMp4(createSyntheticMp4({ frameCount: 3, includeAudio: true }));
          const audio = base.tracks.find(t => t.type === "audio")!;
          assert.ok(audio.samples.length > 1);
          const input = serializeMp4({ ...base, tracks: [
            { ...audio, id: 1, language: "eng" },
            { ...audio, id: 2, language: "fra" }
          ] });
          const source = parseMp4(input).tracks[0]!;
          const vfs = createTestVfs({ "/in.mp4": input });
          const args = ["-i", "/in.mp4", ...(sync ? [] : ["-map", "0:a:0"]),
            ...(limit === undefined ? [] : [option, String(limit)]), "-c", "copy", "/out.mp4"];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const output = parseMp4(vfs.store.get("/out.mp4")!);
          const samples = output.tracks.flatMap(t => t.samples);
          const expected = source.samples.slice(0, limit !== undefined && limit < 0 ? undefined : limit);
          assert.equal(samples.length, expected.length);
          assert.deepEqual(samples.map(s => s.data), expected.map(s => s.data));
          if (samples.length) assert.deepEqual(output.tracks.map(t => t.language), ["eng"]);
        });
      }
    }
  }
});

describe("stream language mapping", () => {
  for (const [maps, languages] of [
    [["0:m:language:fra"], ["fra"]],
    [["0:a:m:language:fra"], ["fra"]],
    [["0:a:1"], ["fra"]],
    [["0:a:m:language"], ["eng", "fra"]],
    [["0:a", "-0:m:language:eng"], ["fra"]],
    [["0:a:1", "0:m:language:deu?"], ["fra"]],
    [["0:v:m:language:fra"], []],
    [["0:m:language:deu"], []]
  ] as const) {
    it(`maps ${maps.join(" ")} and preserves selected packets`, async () => {
      const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
      const audio = base.tracks.find(t => t.type === "audio")!;
      const input = serializeMp4({ ...base, tracks: [
        { ...audio, id: 1, language: "eng" },
        { ...audio, id: 2, language: "fra", samples: audio.samples.slice(0, 1) }
      ] });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4",
        ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mp4"], vfs);
      if (!languages.length) {
        assert.equal(result.exitCode, 234);
        assert.ok(result.stderr.includes("matches no streams"));
        assert.equal(vfs.store.has("/out.mp4"), false);
        return;
      }
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseMp4(vfs.store.get("/out.mp4")!);
      assert.deepEqual(output.tracks.map(t => t.language), languages);
      for (const track of output.tracks) {
        const source = parseMp4(input).tracks.find(t => t.language === track.language)!;
        assert.deepEqual(track.samples.map(s => s.data), source.samples.map(s => s.data));
      }
    });
  }
});

describe("stream language metadata", () => {
  for (const sync of [false, true]) {
    for (const [selector, expected] of [
      ["s:a:0", ["eng", "fra", "deu"]],
      ["s:a:1", ["eng", "eng", "fra"]],
      ["s:2", ["eng", "eng", "fra"]],
      ["s:a", ["eng", "fra", "fra"]],
      ["s", ["fra", "fra", "fra"]],
      ["s:a:9", ["eng", "eng", "deu"]]
    ] as const) {
      it(`${sync ? "sync" : "async"} applies ${selector} to output tracks`, async () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
        const audio = base.tracks.find(t => t.type === "audio")!;
        const input = serializeMp4({ ...base, tracks: [
          ...base.tracks.map(t => ({ ...t, language: "eng" })),
          { ...audio, id: 3, language: "deu" }
        ] });
        const vfs = createTestVfs({ "/in.mp4": input });
        const args = ["-i", "/in.mp4", ...(sync ? [] : ["-map", "0"]), "-c", "copy", "-metadata", "title=Global",
          `-metadata:${selector}`, "language=fra", "/out.mp4"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!);
        assert.deepEqual(output.tracks.map(t => t.language), sync ? expected.slice(0, 2) : expected);
        assert.equal(output.metadata.title, "Global");
        assert.deepEqual(output.tracks.map(t => t.samples.map(s => s.data)),
          parseMp4(input).tracks.slice(0, sync ? 2 : 3).map(t => t.samples.map(s => s.data)));
      });
    }
  }
  it("selects output audio ordinals after mapping and honors the last language assignment", async () => {
    const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
    const audio = base.tracks.find(t => t.type === "audio")!;
    const vfs = createTestVfs({ "/in.mp4": serializeMp4({ ...base, tracks: [
      ...base.tracks, { ...audio, id: 3, language: "deu" }
    ] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4",
      "-map", "0:a:1", "-map", "0:a:0", "-c", "copy",
      "-metadata:s:a", "language=eng", "-metadata:s:a:0", "language=fra", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks.map(t => t.language), ["fra", "eng"]);
  });
});

for (const [rate, nativePrefix] of [
  [16000, [0, 0.0546875, 0.16937255859375, 0.26300048828125]],
  [44100, [0, 0.007781982421875, 0.030029296875, 0.063751220703125]]
] as const) {
  for (const length of [8000, 8001]) it(`interpolates ${length} samples when resampling 8000 Hz to ${rate} Hz`, async () => {
    const tone = Float64Array.from({ length }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 8000));
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [tone, tone.map(value => -value)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", String(rate), "-c:a", "pcm_s16le", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, rate);
    assert.equal(audio.channels, 2);
    for (const [channel, samples] of audio.channelData.entries()) {
      assert.equal(samples.length, Math.round(length * rate / 8000));
      const sign = channel === 0 ? 1 : -1;
      // FFmpeg 9.0.2's reflected start boundary, including fractional phases.
      for (const [i, expected] of nativePrefix.entries()) {
        assert.ok(Math.abs(samples[i]! - sign * expected) < 0.003, `sample ${i}: ${samples[i]} versus ${sign * expected}`);
      }
      let squaredError = 0;
      for (let i = 200; i < rate - 200; i++) {
        squaredError += (samples[i]! - sign * 0.5 * Math.sin(2 * Math.PI * 440 * i / rate)) ** 2;
      }
      const rmsError = Math.sqrt(squaredError / (rate - 400));
      assert.ok(rmsError < 0.0001, `waveform RMS error: ${rmsError}`);
    }
  });
}

for (const length of [0, 80]) {
  for (const { args, rate, channels, gain, tempo } of [
    { args: [], rate: 8000, channels: 1, gain: 1, tempo: 1 },
    { args: ["-af", "volume=0.5"], rate: 8000, channels: 1, gain: 0.5, tempo: 1 },
    { args: ["-ar", "16000"], rate: 16000, channels: 1, gain: 1, tempo: 1 },
    { args: ["-ac", "2"], rate: 8000, channels: 2, gain: Math.SQRT1_2, tempo: 1 },
    { args: ["-af", "atempo=2,areverse"], rate: 8000, channels: 1, gain: 1, tempo: 2 }
  ]) {
    it(`preserves WAV sample count for ${length} samples with ${args.join(" ") || "no transform"}`, async () => {
      const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(length).fill(0.25)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", ...args, "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, rate);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      for (const samples of audio.channelData) {
        assert.equal(samples.length, tempo === 1 ? length * rate / 8000 : 0);
        for (const sample of samples) assert.ok(Math.abs(sample - 0.25 * gain) < 0.0001);
      }
    });
  }
}

describe("headerless PCM seeking", () => {
  for (const codec of ["copy", "pcm_s16le"]) {
    for (const position of ["input", "output", "both", "none"]) {
      it(`${codec} preserves the native sample range for ${position} seeking`, async () => {
        const input = new Uint8Array(16000);
        const view = new DataView(input.buffer);
        for (let i = 0; i < 8000; i++) view.setInt16(i * 2, i, true);
        const vfs = createTestVfs({ "/input.raw": input.slice() });
        const args = [
          "-f", "s16le", "-ar", "8000", "-ac", "1",
          ...(["input", "both"].includes(position) ? ["-ss", "0.25"] : []), "-i", "/input.raw",
          ...(["output", "both"].includes(position) ? ["-ss", "0.25"] : []),
          "-c:a", codec, "-f", "s16le", "/output.raw"
        ];
        if (codec === "copy" && position !== "none") {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            () => { assert.fail("raw copy seeking must use the async path"); }), undefined);
        }
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const start = position === "none" ? 0 : position === "input" ? 2000
          : position === "output" ? (codec === "copy" ? 2048 : 2000)
          : codec === "copy" ? 4048 : 4000;
        assert.deepEqual(vfs.store.get("/output.raw"), input.subarray(start * 2));
      });
    }
  }
});

for (const codec of ["copy", "pcm_s16le"]) {
  it(`preserves PCM integers during WAV ${codec}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 160 }, (_, i) => [-1, -0.75, -0.5, 0, 0.5, 0.75, 1, 0.25][i % 8]!)
    ] });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", codec, "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(parseWav(vfs.store.get("/output.wav")!).tracks[0]!.samples.map(s => s.data),
      parseWav(input).tracks[0]!.samples.map(s => s.data));
  });
}

for (const [gain, expected] of [
  [1, [-32768, -16384, -4095, -3, -1, 0, 1, 3, 4095, 16383, 32767]],
  [0.5, [-16384, -8192, -2048, -2, 0, 0, 0, 2, 2048, 8192, 16384]],
  [-0.5, [16384, 8192, 2048, 2, 0, 0, 0, -2, -2048, -8192, -16384]],
  [2, [-32768, -32768, -8190, -6, -2, 0, 2, 6, 8190, 32766, 32767]]
] as const) {
  it(`matches native PCM16 endpoints and nearest-even rounding at volume=${gain}`, async () => {
    const samples = [-32768, -16384, -4095, -3, -1, 0, 1, 3, 4095, 16383, 32767];
    const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `volume=${gain}`, "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    // Expected signed PCM values from native FFmpeg, including ties in both directions.
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), expected);
  });
}

for (const bitsPerSample of [8, 24, 32] as const) {
  it(`copies ${bitsPerSample}-bit WAV packets with their original precision`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([-1, -0.5, 0, 1 / 2147483648, 1 - 1 / 2147483648])
    ] }, { bitsPerSample });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", "copy", "-bitexact", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(vfs.store.get("/output.wav"), input);
  });
}

for (const channels of [1, 2, 3]) {
  for (const codec of [[], ["-c:a", "pcm_s16le"]]) {
    it(`matches native PCM16 mono mixing across every amplitude into ${channels} channels (${codec.join(" ") || "default"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 65536 }, (_, i) => (i - 32768) / 32768)
      ] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ac", String(channels), ...codec, "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, channels);
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, 65536);
        for (const [i, sample] of samples.entries()) {
          // Verified against native FFmpeg for all signed 16-bit input values.
          const expected = channels === 1 ? i - 32768 : channel === 2 ? 0
            : Math.floor(((i - 32768) * 23170 + 16384) / 32768);
          assert.equal(sample * 32768, expected, `channel ${channel}, input ${i - 32768}`);
        }
      }
    });
  }
}

for (const channels of [2, 3]) {
  for (const level of [0.5, -0.5]) {
    it(`matches native mono upmix to ${channels} channels at ${level}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(level)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", "-ac", String(channels), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, 80);
        // Native FFmpeg maps mono to FL/FR at equal power and leaves LFE silent.
        const expected = channel < 2 ? level * Math.SQRT1_2 : 0;
        for (const sample of samples) assert.ok(Math.abs(sample - expected) <= 1 / 32768, `channel ${channel}: ${sample} versus ${expected}`);
      }
    });
  }
}

for (const channels of [3, 4]) {
  for (const levels of [[0.5, -0.5], [0.25, 0.5]]) {
    it(`matches native stereo upmix to ${channels} channels for ${levels}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: levels.map(level => new Float64Array(800).fill(level)) });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/input.wav", "-ac", String(channels), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      assert.equal(audio.channelData.length, channels);
      // Native FFmpeg preserves FL/FR and leaves the added channels silent.
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, 800);
        const expected = levels[channel] ?? 0;
        for (const sample of samples) assert.ok(Math.abs(sample - expected) <= 1 / 32768, `channel ${channel}: ${sample} versus ${expected}`);
      }
    });
  }
}

for (const filter of ["aformat=channel_layouts=mono", "aformat=cl=mono", "aformat=channel_layouts=mono,pan=mono|c0=c0", "aformat=channel_layouts=mono,aformat=channel_layouts=mono"]) {
  it(`negotiates aformat stereo to mono: ${filter}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([1000, 2000, 3000, 4000], value => value / 32768),
      Float64Array.from([-4000, -3000, -2000, -1000], value => value / 32768)
    ] });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 1);
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), [-1500, -500, 500, 1500]);
  });
}

for (const [format, expected] of [
  ["u8", [0, -256, 256, -512, 256, -768, 512, -1024, -32768, 32512]],
  ["s16", [100, -200, 300, -400, 500, -600, 700, -800, -32768, 32767]]
] as const) {
  for (const key of ["sample_fmts", "f"]) {
    it(`quantizes aformat ${key}=${format} before PCM16 output`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([100, -200, 300, -400, 500, -600, 700, -800, -32768, 32767], value => value / 32768)
      ] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/input.wav", "-af", `aformat=${key}=${format}`, "-c:a", "pcm_s16le", "/output.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 1);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
    });
  }
}

for (const [format, expected] of [
  ["u8", [0, -256, 256, -512, 512, -512, 768, -768, -32768, 32512]],
  ["s16", [100, -200, 300, -400, 500, -600, 700, -800, -32768, 32767]]
] as const) {
  it(`quantizes floating input through aformat ${format}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([100, -200, 300, -400, 500, -600, 700, -800, -32768, 32767], value => value / 32768)
    ] }, { bitsPerSample: 64, float: true });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.wav", "-af", `aformat=sample_fmts=${format}`, "-c:a", "pcm_s16le", "/output.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
  });
}

for (const filter of ["aformat=channel_layouts=surround", "aformat=channel_layouts=", "aformat=sample_fmts=invalid", "aformat=sample_fmts="]) {
  it(`rejects unsupported aformat constraints without replacing output: ${filter}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(4), new Float64Array(4)] });
    const vfs = createTestVfs({ "/input.wav": input, "/output.wav": "existing" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
    assert.equal(result.exitCode, filter.endsWith("=") ? 1 : 234);
    assert.match(result.stderr, /aformat: unsupported/);
    assert.equal(new TextDecoder().decode(vfs.store.get("/output.wav")!), "existing");
  });
}

// Header emitted by native FFmpeg 9 from a 0.1-second, 8000 Hz PCM16 5.1 WAV.
const surroundWavHeader = "52494646ffffffff57415645666d742028000000feff0600401f0000007701000c001000160010003f0000000100000000001000800000aa00389b714c4953541a000000494e464f495346540d0000004c61766636332e312e313031000064617461ffffffff";

for (const mask of [0x3f, 0x60f]) {
  for (const [channel, expected] of [[0, 3393], [1, 3393], [2, 4799], [3, 0], [4, 2399], [5, 2399]]) {
    it(`matches native 5.1 mono downmix for mask ${mask}, channel ${channel}`, async () => {
      const header = Buffer.from(surroundWavHeader, "hex");
      const input = new Uint8Array(header.length + 800 * 12);
      input.set(header);
      const view = new DataView(input.buffer);
      view.setUint32(40, mask, true);
      for (let i = 0; i < 800; i++) view.setInt16(header.length + i * 12 + channel! * 2, 16384, true);
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ac", "1", "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = parseWav(vfs.store.get("/output.wav")!);
      assert.equal(output.durationSeconds, 0.1);
      const audio = output.tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 1);
      assert.equal(audio.channelData[0]!.length, 800);
      assert.ok(audio.channelData[0]!.every(sample => Math.abs(sample * 32768 - expected!) <= 1));
    });
  }
}

it("rejects unsupported surround downmix layouts without overwriting output", async () => {
  const header = Buffer.from(surroundWavHeader, "hex");
  const input = new Uint8Array(header.length + 800 * 12);
  input.set(header);
  new DataView(input.buffer).setUint32(40, 0x707, true);
  const vfs = createTestVfs({ "/input.wav": input, "/output.wav": "existing" });
  const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-ac", "1", "/output.wav"], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("Unsupported audio channel layout"), result.stderr);
  assert.equal(new TextDecoder().decode(vfs.store.get("/output.wav")), "existing");
});


it("rejects unknown setpts variables before downstream time selection without overwriting output", async () => {
  const vfs = createTestVfs({ "/out.gif": "existing" });
  const input = await runCmd(createFfmpegCommand(), [
    "-f", "lavfi", "-i", "testsrc2=size=16x16:rate=1:duration=3", "/in.gif"
  ], vfs);
  assert.equal(input.exitCode, 0, input.stderr);
  const before = new Map(vfs.store);
  const result = await runCmd(createFfmpegCommand(), [
    "-y", "-i", "/in.gif", "-vf", "setpts=PTS+1/UNKNOWN,select=gt(t\\,1.5)",
    "-fps_mode", "passthrough", "/out.gif"
  ], vfs);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("setpts: invalid or unsupported expression"), result.stderr);
  assert.deepEqual(vfs.store, before);

  const control = await runCmd(createFfmpegCommand(), [
    "-i", "/in.gif", "-vf", "select=gt(t\\,1.5)",
    "-fps_mode", "passthrough", "/selected_%d.png"
  ], vfs);
  assert.equal(control.exitCode, 0, control.stderr);
  assert.deepEqual([...vfs.store.keys()].filter(path => path.startsWith("/selected_")), ["/selected_1.png"]);
});

describe("image2 update option", () => {
  for (const value of ["nonsense", "auto", "-1", "2", "1.0", "1 ", "0x1"]) {
    it(`rejects ${JSON.stringify(value)} before overwriting output`, async () => {
      const vfs = createTestVfs({ "/last.png": "original image" });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "lavfi", "-i", "color=red:s=2x2:d=0.04",
        "-update", value, "/last.png"
      ], vfs);
      assert.equal(result.exitCode, 234, result.stderr);
      assert.ok(result.stderr.includes("-update"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/last.png")), "original image");
    });
  }
  for (const [enabled, values] of [
    [true, ["1", "yes", "true", "on", "y", "enable", "enabled", "TRUE", "+1", "01", " 1"]],
    [false, ["0", "no", "false", "off", "n", "disable", "disabled", "FALSE", "", "-0", "00"]]
  ] as const) {
    for (const value of values) it(`honors ${JSON.stringify(value)} for consecutive images`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const colors = [[255, 0, 0, 255], [0, 0, 255, 255], [0, 255, 0, 255]];
      const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
        i === 2 ? "/last.png" : `/f${i}.png`,
        encodeImage({ width: 1, height: 1, data: Uint8Array.from(color),
          channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72,
          hasAlpha: true }, { format: "png" }).data
      ])));
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-i", "/f%d.png", "-update", value, "/last.png"
      ], vfs);
      if (enabled) assert.equal(result.exitCode, 0, result.stderr);
      else {
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("Cannot write more than one file"), result.stderr);
      }
      assert.deepEqual([...decodeImage(vfs.store.get("/last.png")!).data], colors[enabled ? 1 : 0]);
    });
  }
});

describe("reverse timestamp slots", () => {
  const values = [12, 40, 40, 112, 144, 176, 176, 232];
  for (const [filter, expected] of [
    ["null", values],
    ["reverse", [...values].reverse()],
    ["select='eq(n,0)+eq(n,2)+eq(n,5)',reverse", [176, 40, 12]],
    ["select='eq(n,0)+eq(n,2)+eq(n,5)',reverse,select='lt(t,0.3)'", [176, 40]],
    ["trim=start_frame=3,reverse,select='lt(t,0.5)'", [232, 176]],
    ["select=0,reverse", []]
  ] as const) {
    it(`preserves input timestamp slots for ${filter}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (const [i, value] of values.entries()) {
        const data = new Uint8Array(32 * 32 * 4).fill(value);
        for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
        vfs.store.set(`/f${i}.png`, encodeImage({ width: 32, height: 32, data,
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "10", "-i", "/f%d.png", "-vf", filter,
        "-fps_mode", "passthrough", "/o%02d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = [...vfs.store.keys()].filter(path => path.startsWith("/o")).sort();
      assert.deepEqual(output.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
    });
  }
});

describe("fps start_time", () => {
  for (const [start, expected] of [["0.5", [100]], ["1", []], ["-0.5", [20, 20, 80]], ["0", [40, 80]]] as const) {
    for (const filter of [`fps=2:start_time=${start}`, `fps=2:${start}`]) {
      it(`places frames on the requested grid for ${filter}`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const files: Record<string, Uint8Array> = {};
        for (let i = 1; i <= 6; i++) {
          files[`/in${i}.png`] = encodeImage({ width: 1, height: 1,
            data: new Uint8Array([i * 20, i * 20, i * 20, 255]), format: "png",
            space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data;
        }
        const vfs = createTestVfs(files);
        const result = await runCmd(createFfmpegCommand(), [
          "-framerate", "5", "-i", "/in%d.png", "-vf", filter, "/out%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = [...vfs.store.keys()].filter(path => path.startsWith("/out")).sort();
        assert.deepEqual(output.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
        for (const [path, bytes] of Object.entries(files)) assert.deepEqual(vfs.store.get(path), bytes);
      });
    }
  }
});

describe("fps option validation", () => {
  for (const filter of ["fps=bogus", "fps=2garbage", "fps=1/0", "fps=-2", "fps=2:round=bogus", "fps=2:eof_action=bogus", "fps=2:no_such_option=1", "fps=2:start_time=bogus", "fps=2:0:bogus", "fps=2:0:near:round:extra"]) {
    for (const seeded of [false, true]) {
      it(`rejects ${filter} with ${seeded ? "existing" : "fresh"} output`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const files: Record<string, Uint8Array> = {};
        for (let i = 1; i <= 6; i++) {
          files[`/in${i}.png`] = encodeImage({ width: 1, height: 1,
            data: new Uint8Array([i * 20, i * 20, i * 20, 255]), format: "png",
            space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data;
        }
        if (seeded) files["/out1.png"] = files["/in6.png"]!.slice();
        const vfs = createTestVfs(files);
        const before = new Map(vfs.store);
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-framerate", "5", "-i", "/in%d.png", "-vf", filter, "/out%d.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0, result.stderr);
        assert.ok(result.stderr.includes("fps:"), result.stderr);
        assert.deepEqual(vfs.store, before);
        if (seeded) assert.equal(decodeImage(vfs.store.get("/out1.png")!).data[0], 120);
      });
    }
  }
  for (const filter of ["fps=2", "fps=10/5", "fps=fps=source_fps*0.4", "fps=2:start_time=0:round=near:eof_action=round", "fps=2:0:near:round"]) {
    it(`accepts ${filter}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=2x2:r=5:d=1", "-vf", filter, "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()], ["/out1.png", "/out2.png"]);
    });
  }
});

describe("image sequence output synchronization", () => {
  for (const [filter, count] of [
    ["select='eq(n,1)+eq(n,3)'", 3],
    ["setpts=2*PTS", 7],
    ["select='eq(n,1)+eq(n,3)',setpts=PTS", 3],
    ["select='eq(n,1)+eq(n,3)',setpts=PTS-STARTPTS", 3],
    ["fps=2", 8], ["fps=0.5", 2], ["reverse", 4], ["trim=start=1:end=3", 2]
  ] as const) {
    it(`matches native default cadence for ${filter}`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
        "-vf", filter, "/out_%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual([...vfs.store.keys()], Array.from({ length: count }, (_, i) => `/out_${i + 1}.png`));
    });
  }
  for (const flags of [["-fps_mode", "passthrough"], ["-vsync", "0"]]) {
    for (const [filter, count] of [["select='eq(n,1)+eq(n,3)'", 2], ["setpts=2*PTS", 4]] as const) {
      it(`honors ${flags.join(" ")} for ${filter}`, async () => {
        const vfs = createTestVfs();
        const result = await runCmd(createFfmpegCommand(), [
          "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
          "-vf", filter, ...flags, "/out_%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(vfs.store.size, count);
      });
    }
  }
  it("limits synchronized output frames before numbering", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
      "-vf", "setpts=2*PTS", "-frames:v", "5", "-start_number", "7", "/out_%d.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...vfs.store.keys()], [7, 8, 9, 10, 11].map(i => `/out_${i}.png`));
  });
});


for (const [filter, indices] of [
  ["setpts=2*PTS", [0, 1, 1, 2, 2, 3, 3]],
  ["select='eq(n,1)+eq(n,3)'", [1, 3, 3]],
  ["setpts=0.25*PTS", [0, 1, 2]]
] as const) {
  it(`matches native frame identity from image input for ${filter}`, async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
    const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
      `/in_${i + 1}.png`, encodeImage({ width: 1, height: 1, data: Uint8Array.from(color),
        channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data
    ])));
    const result = await runCmd(createFfmpegCommand(), [
      "-framerate", "1", "-i", "/in_%d.png", "-vf", filter, "/out_%d.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = [...vfs.store.entries()].filter(([name]) => name.startsWith("/out_"));
    assert.deepEqual(output.map(([, data]) => [...decodeImage(data).data]), indices.map(i => colors[i]));
  });
}


it("bounds frames duplicated by output synchronization", async () => {
  const vfs = createTestVfs();
  const result = await runCmd(createFfmpegCommand({ limits: { maxFrames: 5 } }), [
    "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=4",
    "-vf", "setpts=1000000*PTS", "/out_%d.png"
  ], vfs);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /maxFrames/);
  assert.ok(vfs.store.size <= 5);
});

for (const [width, height] of [[32, 24], [96, 72], [33, 25]]) {
  it(`matches native default scaling of decoded YUV H.264 pixels at ${width}x${height}`, async () => {
    const { readFileSync } = await import("node:fs");
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs({ "/input.mp4": readFileSync(new URL("../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url)) });
    const result = await runCmd(createFfmpegCommand(), [
      "-i", "/input.mp4", "-vf", `scale=${width}:${height}`, "-frames:v", "1", "/out.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = decodeImage(vfs.store.get("/out.png")!);
    // FFmpeg 9.0.2: -i h264-b-frames.mp4 -vf scale=32:24 -frames:v 1 reference.png
    const expected = decodeImage(readFileSync(new URL(`./fixtures/h264-scale-${width}x${height}.png`, import.meta.url)));
    assert.equal(actual.width, expected.width);
    assert.equal(actual.height, expected.height);
    const maximum = Math.max(...actual.data.map((value, index) => Math.abs(value - expected.data[index]!)));
    assert.ok(maximum <= 1, `maximum channel difference: ${maximum}`);
  });
}

// AArch64 FFmpeg 9.0.2: -i INPUT -frames:v 1 -pix_fmt rgba -f rawvideo pipe:1
for (const [fixture, digest] of [
  ["b-frames", "68986c03462fedd147eef9959cb52a43873aaf4e114e500e0021fd849da2d00d"],
  ["edit-list", "8dc4baf2a5199799ef15d73d05a4afea5eb4ba6219230df1f50becc1ef3743aa"],
  ["picture-types", "a253d97c06a4832773769dda0f4405fce188627d3ba7d2fdce809b2dca0d3520"]
]) {
  it(`matches native YUV-to-RGBA rounding for H.264 ${fixture}`, async () => {
    const { readFileSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs({ "/input.mp4": readFileSync(new URL(`../../mp4-ast/src/fixtures/h264-${fixture}.mp4`, import.meta.url)) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.mp4", "-frames:v", "1", "/out.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const pixels = decodeImage(vfs.store.get("/out.png")!).data;
    assert.equal(createHash("sha256").update(pixels).digest("hex"), digest);
  });
}

for (const [fixture, count] of [["cbr", 6912], ["vbr", 5760]] as const) {
  it(`decodes ${fixture} MP3 to PCM WAV with native sample count`, async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL(`../../safe-bash-command-audio/fixtures/${fixture}.mp3`, import.meta.url));
    const vfs = createTestVfs({ "/in.mp3": source });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/in.mp3", "-vn", "-c:a", "pcm_s16le", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 48000);
    assert.equal(audio.channels, 2);
    assert.equal(audio.channelData[0]!.length, count);
    // Native FFmpeg PCM reference; allow one s16 rounding step across decoder platforms.
    const reference = parseWav(readFileSync(new URL(`./fixtures/mp3-${fixture}.wav`, import.meta.url))).tracks[0]!.decodedAudio!;
    for (let channel = 0; channel < 2; channel++) {
      assert.equal(audio.channelData[channel]!.length, reference.channelData[channel]!.length);
      for (let sample = 0; sample < count; sample++) {
        assert.ok(Math.abs(audio.channelData[channel]![sample]! - reference.channelData[channel]![sample]!) <= 1 / 32768,
          `channel ${channel}, sample ${sample}`);
      }
    }
    vfs.store.set("/in.mp3", source.subarray(0, source.length - 1));
    const previous = vfs.store.get("/out.wav");
    const failure = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.mp3", "-c:a", "pcm_s16le", "/out.wav"], vfs);
    assert.equal(failure.exitCode, 1);
    assert.deepEqual(vfs.store.get("/out.wav"), previous);
  });
}

for (const [codec, bitsPerSample, float] of [
  ["pcm_u8", 8, false], ["pcm_s24le", 24, false], ["pcm_s32le", 32, false], ["pcm_f32le", 32, true]
] as const) {
  it(`honors requested WAV codec ${codec}`, async () => {
    const pcm = { sampleRate: 48000, channels: [Float64Array.from([-.75, -.25, 0, .25, .75])] };
    const vfs = createTestVfs({ "/input.wav": encodeWav(pcm, { bitsPerSample: 32, float: true }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", codec, "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = parseWav(vfs.store.get("/output.wav")!).tracks[0]!;
    const expected = parseWav(encodeWav(pcm, { bitsPerSample, float })).tracks[0]!;
    assert.equal(actual.codecDescriptions[0]!.codecName, codec);
    assert.equal(actual.codecDescriptions[0]!.bitsPerSample, bitsPerSample);
    assert.deepEqual(actual.samples.map(({ offset: _offset, ...sample }) => sample),
      expected.samples.map(({ offset: _offset, ...sample }) => sample));
  });
}

for (const [precision, gain, expected] of [
  ["fixed", "-1", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["0", "-0.5", [0, 0, 0, 0, 0, 0, 0, 0]],
  ["float", "-1", [-12000, -12001, -12002, -12003, 12001, 12003, -32767, 32767]],
  ["double", "-1", [-12000, -12001, -12002, -12003, 12001, 12003, -32767, 32767]],
  ["fixed", "0.5", [6000, 6001, 6001, 6002, -6000, -6001, 16384, -16384]],
  ["float", "0.5", [6000, 6000, 6001, 6002, -6000, -6002, 16384, -16384]],
  ["double", "0.5", [6000, 6000, 6001, 6002, -6000, -6002, 16384, -16384]],
  ["fixed", "0.1", [1219, 1219, 1219, 1219, -1219, -1219, 3328, -3328]]
] as const) {
  it(`matches native volume precision=${precision} gain=${gain}`, async () => {
    const samples = [12000, 12001, 12002, 12003, -12001, -12003, 32767, -32768];
    const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });
    for (const filter of [`volume=${gain}:precision=${precision}`, `volume=precision=${precision}:volume=${gain}`]) {
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), expected);
    }
  });
}

it("rejects invalid volume precision without replacing output", async () => {
  const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80).fill(0.25)] });
  const original = new Uint8Array([1, 2, 3]);
  const vfs = createTestVfs({ "/input.wav": input, "/output.wav": original });
  const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", "volume=0.5:precision=bogus", "/output.wav"], vfs);
  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /volume/);
  assert.deepEqual(vfs.store.get("/output.wav"), original);
});


describe("image2 pattern_type", () => {
  for (const [mode, pattern, indices] of [
    ["glob", "f*.png", [0, 1, 2, 3]],
    ["glob", "f0[12].png", [1, 2]],
    ["glob", "f0{2,0,2}.png", [2, 0, 2]],
    ["glob", "f0{0,1}.png", [0, 1]],
    ["glob", "f0{2,[01],2}.png", [2, 0, 1, 2]],
    ["glob", "f0{2,{1,0}}.png", [2, 1, 0]],
    ["glob", "{frames/,}f0{2,0}.png", [2, 0, 2, 0]],
    ["glob", "f0{missing,1}.png", [1]],
    ["glob", "f0\\{0,1\\}.png", [3]],
    ["none", "f0{0,1}.png", [3]],
    ["glob", "f0[!1].png", [0, 2]],
    ["glob", "f0[0-1].png", [0, 1]],
    ["glob", "literal\\%02d.png", [3]],
    ["glob", "f0?.png", [0, 1, 2]],
    ["glob", "frames*/f*.png", [0, 1, 2]],
    ["none", "literal%02d.png", [3]],
    ["sequence", "f%02d.png", [0, 1, 2]],
    [undefined, "f%02d.png", [0, 1, 2]]
  ] as const) {
    it(`selects native filenames and colors for ${mode ?? "default"}: ${pattern}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]];
      const images = colors.map(color => encodeImage({ width: 1, height: 1, data: Uint8Array.from(color),
        channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data);
      const vfs = createTestVfs({
        "/f02.png": images[2]!, "/f00.png": images[0]!, "/f01.png": images[1]!,
        "/literal%02d.png": images[3]!, "/literal00.png": images[0]!, "/literal01.png": images[1]!,
        "/f0{0,1}.png": images[3]!,
        "/.f03.png": images[3]!, "/other.png": images[3]!,
        "/frames/f02.png": images[2]!, "/frames/f00.png": images[0]!, "/frames/f01.png": images[1]!
      });
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "image2", ...(mode ? ["-pattern_type", mode] : []), "-i", pattern, "/out%02d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = [...vfs.store.entries()].filter(([name]) => name.startsWith("/out"));
      assert.deepEqual(output.map(([name]) => name), indices.map((_, i) => `/out${String(i + 1).padStart(2, "0")}.png`));
      assert.deepEqual(output.map(([, bytes]) => [...decodeImage(bytes).data]), indices.map(i => colors[i]));
      if (mode === "none") {
        const reset = await runCmd(createFfmpegCommand(), [
          "-pattern_type", "none", "-i", "literal%02d.png", "-i", "f%02d.png",
          "-map", "1:v", "/reset%02d.png"
        ], vfs);
        assert.equal(reset.exitCode, 0, reset.stderr);
        const resetOutput = [...vfs.store.entries()].filter(([name]) => name.startsWith("/reset"));
        assert.deepEqual(resetOutput.map(([, bytes]) => [...decodeImage(bytes).data]), colors.slice(0, 3));
      }
    });
  }
  for (const [mode, path] of [["glob", "missing*.png"], ["invalid", "f00.png"]]) {
    it(`rejects ${mode} without writing output`, async () => {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), ["-pattern_type", mode!, "-i", path!, "/out%02d.png"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(vfs.store.size, 0);
    });
  }
});

describe("image2 frame_pts", () => {
  for (const [values, timestamps] of [
    [["true", "yes", "on", "y", "enable", "enabled", "TrUe", "+01"], [0, 1]],
    [["false", "no", "off", "n", "disable", "disabled", "FaLsE", "", "-0"], [1, 2]]
  ] as const) {
    for (const value of values) {
      it(`accepts native boolean spelling ${JSON.stringify(value)}`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const colors = [[255, 0, 0, 255], [0, 0, 255, 255]];
        const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
          `/f${i}.png`, encodeImage({ width: 2, height: 2, data: Uint8Array.from(Array(4).fill(color).flat()),
            channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data
        ])));
        const result = await runCmd(createFfmpegCommand(), [
          "-framerate", "2", "-i", "f%d.png", "-frame_pts", value, "p%d.png"
        ], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const output = [...vfs.store.entries()].filter(([name]) => name.startsWith("/p"));
        assert.deepEqual(output.map(([name]) => name), timestamps.map(t => `/p${t}.png`));
        assert.deepEqual(output.map(([, bytes]) => [...decodeImage(bytes).data]), colors.map(color => Array(4).fill(color).flat()));
      });
    }
  }
  for (const [flags, timestamps, indices] of [
    [[], [1, 2, 3], [0, 1, 2]],
    [["-frame_pts", "0", "-start_number", "7"], [7, 8, 9], [0, 1, 2]],
    [["-frame_pts", "1", "-start_number", "7"], [0, 1, 2], [0, 1, 2]],
    [["-frame_pts", "1", "-vf", "setpts=2*PTS", "-fps_mode", "passthrough"], [0, 2, 4], [0, 1, 2]],
    [["-frame_pts", "1", "-vf", "setpts=2*PTS"], [0, 1, 2, 3, 4], [0, 1, 1, 2, 2]]
  ] as const) {
    it(`names frames and preserves pixels with ${flags.join(" ") || "defaults"}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
      const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
        `/f0${i}.png`, encodeImage({ width: 1, height: 1, data: Uint8Array.from(color),
          channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data
      ])));
      const result = await runCmd(createFfmpegCommand(), ["-i", "f%02d.png", ...flags, "o%02d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = [...vfs.store.entries()].filter(([name]) => name.startsWith("/o"));
      assert.deepEqual(output.map(([name]) => name), timestamps.map(t => `/o${String(t).padStart(2, "0")}.png`));
      assert.deepEqual(output.map(([, bytes]) => [...decodeImage(bytes).data]), indices.map(i => colors[i]));
    });
  }
  it("resets timestamp naming for each output", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=2",
      "-frame_pts", "1", "pts%d.png", "seq%d.png"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual([...vfs.store.keys()], ["/pts0.png", "/pts1.png", "/seq1.png", "/seq2.png"]);
  });
  for (const value of ["invalid", "2", "-1", "auto", "1.0", "0x1", "true "]) {
    it(`rejects invalid timestamp naming ${JSON.stringify(value)} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.png": "original" });
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1", "-frame_pts", value, "out.png"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /frame_pts/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "original");
    });
  }
});

describe("B-frame limit", () => {
  for (const sync of [false, true]) {
    for (const target of sync ? ["/out%02d.png"] : ["/out.mp4", "/out%02d.png"]) {
      it(`${sync ? "sync" : "async"} consumes -bf 0 for ${target}`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
        const vfs = createTestVfs(Object.fromEntries(colors.map((color, i) => [
          `/f0${i}.png`, encodeImage({ width: 16, height: 16,
            data: Uint8Array.from(Array(256).fill(color).flat()), channels: 4,
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
          }, { format: "png" }).data
        ])));
        const args = ["-y", "-v", "error", "-framerate", "25", "-i", sync ? "/f00.png" : "/f%02d.png",
          ...(target.endsWith("mp4") ? ["-c:v", "libx264"] : []), "-bf", "0", "-pix_fmt", "yuv420p", target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const outputs = [...vfs.store.keys()].filter(path => !path.startsWith("/f"));
        if (target.endsWith("mp4")) {
          assert.deepEqual(outputs, ["/out.mp4"]);
          const track = parseMp4(vfs.store.get(target)!).tracks[0]!;
          const frames = [...decodeH264Samples(track.samples, track.codecDescriptions, 16, 16, track.timescale)];
          assert.deepEqual(frames.map(frame => frame.ptsSeconds), [0, 0.04, 0.08]);
          for (const [i, frame] of frames.entries()) {
            for (let channel = 0; channel < 4; channel++) {
              assert.ok(Math.abs(frame.data[channel]! - colors[i]![channel]!) <= 3);
            }
          }
        } else {
          assert.deepEqual(outputs, sync ? ["/out01.png"] : ["/out01.png", "/out02.png", "/out03.png"]);
          assert.deepEqual(outputs.map(path => [...decodeImage(vfs.store.get(path)!).data.slice(0, 4)]), sync ? colors.slice(0, 1) : colors);
        }
      });
    }
  }
});

describe("subtitle packet trimming (FFmpeg 7.0.2)", () => {
  for (const sync of [false, true]) {
    for (const container of ["srt", "vtt", "mp4"]) {
      for (const [trim, expected] of [
        [[], "00:01.250 --> 00:03.500\nHello\n\n00:05.000 --> 00:06.750\nthere\n"],
        [["-ss", "2"], "00:05.000 --> 00:06.750\nthere\n"],
        [["-t", "2"], "00:01.250 --> 00:03.500\nHello\n"],
        [["-ss", "1.25", "-t", "3.75"], "00:01.250 --> 00:03.500\nHello\n"],
        [["-ss", "7"], ""]
      ] as const) {
        it(`${sync ? "sync" : "async"} ${container} ${trim.join(" ")}`, async () => {
          const vfs = createTestVfs({ "/in.srt": "1\n00:00:01,250 --> 00:00:03,500\nHello\n\n2\n00:00:05,000 --> 00:00:06,750\nthere\n" });
          const run = async (args: string[]) => {
            if (sync) {
              assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
                (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
            } else {
              const result = await runCmd(createFfmpegCommand(), args, vfs);
              assert.equal(result.exitCode, 0, result.stderr);
            }
          };
          if (container !== "srt") await run(["-i", "/in.srt", ...(container === "mp4" ? ["-c:s", "mov_text"] : []), `/in.${container}`]);
          await run(["-i", `/in.${container}`, ...trim, "/out.vtt"]);
          assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")), `WEBVTT\n${expected ? "\n" + expected : ""}`);
        });
      }
    }
  }
});


describe("SRT cue ordering", () => {
  for (const sync of [false, true]) {
    for (const end of ["02", "07"]) {
      it(`${sync ? "sync" : "async"} orders cues with earlier cue ending at ${end}s`, async () => {
        const vfs = createTestVfs({ "/in.srt": `1\n00:00:05,000 --> 00:00:06,000\nHello\n\n2\n00:00:01,000 --> 00:00:${end},000\nthere\n` });
        const args = ["-y", "-v", "error", "-i", "/in.srt", "/out.vtt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
          `WEBVTT\n\n00:01.000 --> 00:${end}.000\nthere\n\n00:05.000 --> 00:06.000\nHello\n`);
      });
    }
  }
});

describe("WebVTT cue side data", () => {
  for (const sync of [false, true]) {
    for (const codec of [[], ["-c:s", "copy"], ["-c", "copy"], ["-codec:s", "copy"], ["-scodec", "copy"], ["-c", "copy", "-c:s", "webvtt"]]) {
      it(`${sync ? "sync" : "async"} ${codec.join(" ") || "re-encode"}`, async () => {
        const vfs = createTestVfs({ "/in.vtt": "WEBVTT\n\nname-1\n00:01.250 --> 00:03.500 align:start position:15%\nOne\nTwo\n\nname-2\n00:05.000 --> 00:06.750\nThree\n" });
        const args = ["-y", "-v", "error", "-i", "/in.vtt", ...codec, "/out.vtt"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const copy = codec.at(-1) === "copy";
        assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
          `WEBVTT\n\n${copy ? "name-1\n" : ""}00:01.250 --> 00:03.500${copy ? " align:start position:15%" : ""}\nOne\nTwo\n\n${copy ? "name-2\n" : ""}00:05.000 --> 00:06.750\nThree\n`);
      });
    }
  }
});


describe("subtitle markup conversion", () => {
  for (const sync of [false, true]) {
    for (const source of ["srt", "vtt"]) {
      for (const mode of ["transcode", "copy", "same-format"]) {
        const copy = mode === "copy";
        it(`${sync ? "sync" : "async"} ${source} ${mode}`, async () => {
          const payload = source === "srt"
            ? '<b>bold</b> <i>ital</i> <u>under</u>\n<font color="red">red</font>'
            : '<v Alex><b>test</b></v><c.red>Hello</c> <i>ital</i> <u>under</u>';
          const expected = copy ? payload : mode === "same-format" && source === "srt"
            ? payload.replace('color="red"', 'color="#ff0000"') : source === "srt"
            ? '<b>bold</b> <i>ital</i> <u>under</u>\nred'
            : '<b>test</b>Hello <i>ital</i> <u>under</u>';
          const destination = mode !== "transcode" ? source : source === "srt" ? "vtt" : "srt";
          const document = (format: string, text: string) => format === "srt"
            ? `1\n00:00:01,250 --> 00:00:03,500\n${text}\n`
            : `WEBVTT\n\n00:01.250 --> 00:03.500\n${text}\n`;
          const vfs = createTestVfs({ [`/in.${source}`]: document(source, payload) });
          const args = ["-y", "-v", "error", "-i", `/in.${source}`, ...(copy ? ["-c:s", "copy"] : []), `/out.${destination}`];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          assert.equal(new TextDecoder().decode(vfs.store.get(`/out.${destination}`)), document(destination, expected) + (destination === "srt" ? "\n" : ""));
        });
      }
    }
  }
});


describe("native subtitle text serialization", () => {
  const srt = "1\n00:00:01,250 --> 00:00:03,500\nHello\nworld\n\n2\n00:59:59,999 --> 01:00:00,000\nboundary\n\n3\n01:02:03,400 --> 01:02:04,500\nthere\n\n";
  const vtt = "WEBVTT\n\n00:01.250 --> 00:03.500\nHello\nworld\n\n59:59.999 --> 01:00:00.000\nboundary\n\n01:02:03.400 --> 01:02:04.500\nthere\n";
  for (const sync of [false, true]) {
    for (const [inputFormat, input] of [["srt", srt], ["vtt", vtt]] as const) {
      for (const [outputFormat, expected] of [["srt", srt], ["vtt", vtt]] as const) {
        it(`${sync ? "sync" : "async"} ${inputFormat} to ${outputFormat} preserves multiline cues and hour boundaries`, async () => {
          const vfs = createTestVfs({ [`/in.${inputFormat}`]: input });
          const args = ["-y", "-v", "error", "-i", `/in.${inputFormat}`, `/out.${outputFormat}`];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          assert.equal(new TextDecoder().decode(vfs.store.get(`/out.${outputFormat}`)), expected);
        });
      }
    }
  }
});

describe("Matroska chapter stream copy", () => {
  for (const sync of [false, true]) {
    for (const mapping of [undefined, "0", "-1"]) {
      it(`${sync ? "sync" : "async"} preserves written chapters with mapping ${mapping ?? "default"}`, async () => {
        const input = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
        const vfs = createTestVfs({ "/in.mkv": input });
        const args = ["-i", "/in.mkv", ...(sync ? [] : ["-map", "0"]),
          ...(mapping === undefined ? [] : ["-map_chapters", mapping]), "-c", "copy", "/out.mkv"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        assert.deepEqual(parseMkv(vfs.store.get("/out.mkv")!).chapters,
          mapping === "-1" ? [] : parseMkv(input).chapters);
      });
    }
  }
});

describe("labeled audio filter graphs", () => {
  for (const [graph, gain, source] of [
    ["[0:a]volume=0.5[out]", 0.5, 0],
    ["[0:a]volume=0.5[mid];[mid]volume=0.5[out]", 0.25, 0],
    ["[mid]volume=0.5[out];[1:a:0]volume=0.5[mid]", 0.25, 1],
    ["[1:a]volume=0.5[out]", 0.5, 1]
  ] as const) {
    it(graph, async () => {
      const channels = [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]];
      const inputs = channels.map(samples => encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, sample => sample / 32768),
          Float64Array.from(samples, sample => -sample / 32768)] }));
      const vfs = createTestVfs({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]! });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/a.wav", "-i", "/b.wav",
        "-filter_complex", graph, "-map", "[out]", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const actual = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.deepEqual(Array.from(actual.channelData[0]!, sample => Math.round(sample * 32768)),
        channels[source]!.map(sample => sample * gain));
      assert.deepEqual(Array.from(actual.channelData[1]!, sample => Math.round(sample * 32768)),
        channels[source]!.map(sample => -sample * gain));
    });
  }
  for (const graph of ["[0:a]no_filter_xyz[out]", "[missing]volume=0.5[out]",
    "[loop]volume=0.5[loop];[loop]anull[out]"]) {
    it("rejects " + graph + " without overwriting output", async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
        channels: [new Float64Array([0.25, 0.5])] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav",
        "-filter_complex", graph, "-map", "[out]", "/out.wav"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")!), "keep");
    });
  }
});

describe("unconnected audio filter outputs", () => {
  for (const [graph, mapping, label] of [
    ["[1:a]volume=0.5[x]", ["-map", "0:a"], "x"],
    ["[0:a]channelsplit[l][r];[r]anull[o]", ["-map", "[o]"], "l"],
    ["[0:a]channelsplit[l][r];[l]anull[o]", ["-map", "[o]"], "r"],
    ["[0:a][1:a]astreamselect=map=1[o]", [], "o"],
    ["[0:a]volume=0.5[x];[1:a]volume=0.5[y]", ["-map", "[x]", "/first.wav", "-map", "[x]"], "y"]
  ] as const) {
    for (const existing of [false, true]) {
      it(`rejects unused ${label} in ${graph} (existing=${existing})`, async () => {
        const vfs = createTestVfs({
          "/a.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array([0.25, 0.5]), new Float64Array([-0.25, -0.5])] }),
          "/b.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array([-0.5, -0.25])] }),
          ...(existing ? { "/out.wav": "keep", "/first.wav": "keep" } : {})
        });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/a.wav", "-i", "/b.wav",
          "-filter_complex", graph, ...mapping, "/out.wav"], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("unconnected") && result.stderr.includes(label), result.stderr);
        for (const path of ["/out.wav", "/first.wav"]) {
          const bytes = vfs.store.get(path);
          assert.ok(bytes === undefined || bytes.length === 0 || new TextDecoder().decode(bytes) === "keep",
            `wrote media to ${path}`);
        }
      });
    }
  }
});

describe("audio output label availability", () => {
  for (const existing of [false, true]) {
    for (const [name, graph, mapping, label] of [
      ["missing", "[0:a]volume=0.5[v]", ["-map", "[typo]"], "typo"],
      ["mapped twice", "[0:a]volume=0.5[v]", ["-map", "[v]", "/left.wav", "-map", "[v]"], "v"],
      ["mapped twice in one output", "[0:a]volume=0.5[v]", ["-map", "[v]", "-map", "[v]"], "v"],
      ["consumed by a filter", "[0:a]volume=0.5[v];[v]volume=0.5[out]", ["-map", "[v]"], "v"]
    ] as const) {
      it(`${name}, ${existing ? "existing" : "fresh"} destination`, async () => {
        const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
          channels: [new Float64Array([0.25, 0.5])] }),
          ...(existing ? { "/out.wav": "existing" } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav",
          "-filter_complex", graph, ...mapping, "/out.wav"], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes(label), result.stderr);
        if (existing) assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")!), "existing");
        else assert.equal(vfs.store.has("/out.wav"), false);
      });
    }
  }
  it("maps distinct unused labels to separate outputs", async () => {
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000,
      channels: [new Float64Array([0.25, 0.5])] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav",
      "-filter_complex", "[0:a]volume=0.5[left];[0:a]volume=0.25[right]",
      "-map", "[left]", "/left.wav", "-map", "[right]", "/right.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const [file, samples] of [["left", [0.125, 0.25]], ["right", [0.0625, 0.125]]] as const) {
      assert.deepEqual(Array.from(parseWav(vfs.store.get(`/${file}.wav`)!).tracks[0]!.decodedAudio!.channelData[0]!), samples);
    }
  });
});

for (const channels of [1, 2]) {
  it(`copies ${channels} audio channels into the DASH representation`, async () => {
    const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true, channels, sampleRate: 8000 }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "/out.mpd"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const manifest = new TextDecoder().decode(vfs.store.get("/out.mpd")!);
    assert.ok(manifest.includes(`<AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="${channels}"/>`), manifest);
    const output = parseMp4(concatBytes([vfs.store.get("/init-stream1.m4s")!, vfs.store.get("/chunk-stream1-00001.m4s")!]));
    assert.equal(output.tracks[0]!.codecDescriptions[0]!.channels, channels);
  });
}

it("copies source stream bitrates into DASH representation bandwidths", async () => {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
  const vfs = createTestVfs({ "/in.mp4": input });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "/out.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const representations = new TextDecoder().decode(vfs.store.get("/out.mpd")!).split("<Representation ").slice(1);
  assert.equal(representations.length, 2);
  for (const [index, bandwidth] of [11224, 28588].entries()) {
    assert.ok(representations[index]!.split(">")[0]!.includes(`bandwidth="${bandwidth}"`), representations[index]);
  }
});

it("copies the input audio language into the DASH adaptation set", async () => {
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true }));
  const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({
    ...track, language: track.type === "audio" ? "fra" : "und"
  })) });
  const vfs = createTestVfs({ "/in.mp4": input });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "/out.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const manifest = new TextDecoder().decode(vfs.store.get("/out.mpd")!);
  assert.ok(manifest.includes('contentType="audio" segmentAlignment="true" lang="fra"'), manifest);
  const output = parseMp4(concatBytes([vfs.store.get("/init-stream1.m4s")!, vfs.store.get("/chunk-stream1-00001.m4s")!]));
  assert.equal(output.tracks[0]!.language, "fra");
  assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data),
    parseMp4(input).tracks.find(track => track.type === "audio")!.samples.map(sample => sample.data));
});

it("honors DASH seg_duration and preserves every packet across media chunks", async () => {
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
  const source = { ...base, tracks: base.tracks.map(t => ({ ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: t.type === "audio" || i % 4 === 0 })) })) };
  const vfs = createTestVfs({ "/in.mp4": serializeMp4(source) });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "/out.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal([...vfs.store.keys()].filter(p => p.startsWith("/chunk-stream0-")).length, 5);
  const manifest = new TextDecoder().decode(vfs.store.get("/out.mpd")!);
  assert.ok(manifest.includes('frameRate="4/1" par="4:3"'), manifest);
  assert.ok(manifest.includes('width="32" height="24" sar="1:1"'), manifest);
  for (let i = 0; i < source.tracks.length; i++) {
    const init = vfs.store.get(`/init-stream${i}.m4s`)!;
    const chunks = [...vfs.store.keys()].filter(p => p.startsWith(`/chunk-stream${i}-`)).sort().map(p => vfs.store.get(p)!);
    const parsed = parseMp4(concatBytes([init, ...chunks]));
    assert.deepEqual(parsed.tracks[0]!.samples.map(s => [s.dts, s.data]), source.tracks[i]!.samples.map(s => [s.dts, s.data]));
  }
});

for (const flags of [
  ["-init_seg_name", "i-$RepresentationID$.mp4"],
  ["-media_seg_name", "m-$RepresentationID$-$Number$.m4s"],
  ["-init_seg_name", "i-$RepresentationID$.mp4", "-media_seg_name", "m-$RepresentationID$-$Number$.m4s"]
]) {
  it(`honors DASH naming templates: ${flags.join(" ")}`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
    const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
    })) });
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, "/out/play.mpd"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const manifest = new TextDecoder().decode(vfs.store.get("/out/play.mpd")!);
    const init = flags.includes("-init_seg_name") ? "i-$RepresentationID$.mp4" : "init-stream$RepresentationID$.m4s";
    const media = flags.includes("-media_seg_name") ? "m-$RepresentationID$-$Number$.m4s" : "chunk-stream$RepresentationID$-$Number%05d$.m4s";
    assert.ok(manifest.includes(`initialization="${init}" media="${media}"`), manifest);
    const source = parseMp4(input);
    for (const [index, track] of source.tracks.entries()) {
      const initialization = init.replace("$RepresentationID$", String(index));
      const prefix = flags.includes("-media_seg_name") ? `/out/m-${index}-` : `/out/chunk-stream${index}-`;
      const chunks = [...vfs.store.keys()].filter(path => path.startsWith(prefix)).sort().map(path => vfs.store.get(path)!);
      assert.ok(chunks.length > 1);
      const output = parseMp4(concatBytes([vfs.store.get(`/out/${initialization}`)!, ...chunks]));
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
    }
  });
}

for (const option of ["-init_seg_name", "-media_seg_name"]) {
  it(`rejects a missing DASH naming argument for ${option}`, async () => {
    const result = await runCmd(createFfmpegCommand(), [option], createTestVfs({}));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(`missing ${option.slice(1)} filename`), result.stderr);
  });
}

for (const value of ["0", "1"]) {
  it(`supports DASH use_template ${value} with existing resource references`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
    const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({
      ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
    })) });
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "-use_template", value, "/out/play.mpd"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const manifest = vfs.store.get("/out/play.mpd")!;
    const text = new TextDecoder().decode(manifest);
    assert.equal(text.includes("<SegmentList"), value === "0");
    assert.equal(text.includes("<SegmentTemplate"), value === "1");
    const { parseStreamingManifest, dashAst } = await import("@poe-code/mp4-ast");
    const plan = parseStreamingManifest(manifest, "dash");
    for (const sequence of plan.sequences) {
      assert.ok(sequence.length > 1);
      for (const segment of sequence) {
        assert.ok(vfs.store.has(`/out/${segment.initialization}`));
        assert.ok(vfs.store.has(`/out/${segment.uri}`));
      }
    }
    const output = dashAst().parse(manifest, { resolveResource: uri => vfs.store.get(`/out/${uri}`)! });
    assert.deepEqual(output.tracks.map(t => t.samples.map(s => s.data)), parseMp4(input).tracks.map(t => t.samples.map(s => s.data)));
  });
}

for (const value of [undefined, "bad", "2"]) {
  it(`rejects invalid DASH use_template ${value}`, async () => {
    const result = await runCmd(createFfmpegCommand(), ["-use_template", ...(value === undefined ? [] : [value])], createTestVfs({}));
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("invalid use_template"), result.stderr);
  });
}

for (const value of ["0", "1"]) {
  for (const duration of [undefined, "1.25"]) {
    it(`supports DASH use_timeline ${value} with duration ${duration ?? "default"}`, async () => {
      const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
      const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({
        ...track, samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 5 === 0 }))
      })) });
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-use_timeline", value,
        ...(duration ? ["-seg_duration", duration] : []), "/play.mpd"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const manifest = vfs.store.get("/play.mpd")!;
      const text = new TextDecoder().decode(manifest);
      assert.ok(text.includes("<SegmentTemplate"));
      assert.equal(text.includes("<SegmentTimeline>"), value === "1");
      if (value === "0") assert.ok(text.includes(`timescale="1000000" duration="${Number(duration ?? 5) * 1000000}"`), text);
      const { dashAst } = await import("@poe-code/mp4-ast");
      const output = dashAst().parse(manifest, { resolveResource: uri => {
        assert.ok(vfs.store.has(`/${uri}`), uri);
        return vfs.store.get(`/${uri}`)!;
      } });
      assert.deepEqual(output.tracks.map(t => t.samples.map(s => [s.dts, s.data])), parseMp4(input).tracks.map(t => t.samples.map(s => [s.dts, s.data])));
    });
  }
}
for (const value of [undefined, "", "2", "-1", "nope"]) {
  it(`rejects invalid DASH use_timeline ${value}`, async () => {
    const result = await runCmd(createFfmpegCommand(), ["-use_timeline", ...(value === undefined ? [] : [value])], createTestVfs({}));
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("invalid use_timeline"), result.stderr);
  });
}

it("writes DASH single_file representations with valid inclusive byte ranges", async () => {
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
  const source = { ...base, tracks: base.tracks.map(t => ({ ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: t.type === "audio" || i % 4 === 0 })) })) };
  const vfs = createTestVfs({ "/in.mp4": serializeMp4(source) });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-single_file", "1", "-seg_duration", "1", "/out/play.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...vfs.store.keys()].filter(p => p.startsWith("/out/")).sort(), ["/out/play-stream0.mp4", "/out/play-stream1.mp4", "/out/play.mpd"]);
  const manifest = new TextDecoder().decode(vfs.store.get("/out/play.mpd")!);
  assert.ok(!manifest.includes("SegmentTemplate"), manifest);
  const representations = manifest.split("<Representation ").slice(1);
  for (const [index, representation] of representations.entries()) {
    const bytes = vfs.store.get(`/out/play-stream${index}.mp4`)!;
    assert.ok(representation.includes(`<BaseURL>play-stream${index}.mp4</BaseURL>`));
    const range = (value: string) => value.split("-").map(Number);
    const [initStart, initEnd] = range(representation.split('<Initialization range="')[1]!.split('"')[0]!);
    assert.equal(initStart, 0);
    assert.deepEqual(parseMp4Boxes(bytes.slice(initStart, initEnd! + 1)).map(b => b.type), ["ftyp", "moov"]);
    let offset = initEnd! + 1;
    const segments = representation.split("<SegmentURL ").slice(1);
    assert.ok(segments.length > 1);
    for (const segment of segments) {
      const [start, end] = range(segment.split('mediaRange="')[1]!.split('"')[0]!);
      const [indexStart, indexEnd] = range(segment.split('indexRange="')[1]!.split('"')[0]!);
      assert.equal(start, offset);
      assert.equal(indexStart, start);
      const boxes = parseMp4Boxes(bytes.slice(start, end! + 1));
      assert.deepEqual(boxes.map(b => b.type), ["sidx", "moof", "mdat"]);
      assert.equal(indexEnd! - indexStart! + 1, boxes[0]!.size);
      const sidx = new DataView(bytes.buffer, bytes.byteOffset + indexStart!, indexEnd! - indexStart! + 1);
      assert.equal(sidx.getUint32(40), end! - indexEnd!);
      offset = end! + 1;
    }
    assert.equal(offset, bytes.length);
    const parsed = parseMp4(bytes);
    assert.deepEqual(parsed.tracks[0]!.samples.map(s => [s.dts, s.data]), source.tracks[index]!.samples.map(s => [s.dts, s.data]));
  }
});


for (const value of ["2", "-1", "true", undefined]) {
  it(`rejects invalid DASH single_file ${value}`, async () => {
    const result = await runCmd(createFfmpegCommand(), ["-single_file", ...(value === undefined ? [] : [value])], createTestVfs({}));
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("invalid single_file"), result.stderr);
  });
}

it("retains separate DASH resources with single_file disabled", async () => {
  const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 4 }) });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-c", "copy", "-single_file", "0", "/out.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(vfs.store.has("/init-stream0.m4s"));
  assert.ok(new TextDecoder().decode(vfs.store.get("/out.mpd")!).includes("SegmentTemplate"));
});

for (const mapping of ["id=0,streams=a id=1,streams=v", "id=0,streams=1 id=1,streams=0"]) {
  it(`honors DASH adaptation_sets ${mapping} without renumbering resources`, async () => {
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true }));
    const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, language: track.type === "audio" ? "fra" : "und" })) });
    const vfs = createTestVfs({ "/in.mp4": input });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-adaptation_sets", mapping, "/out.mpd"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const sets = new TextDecoder().decode(vfs.store.get("/out.mpd")!).split("<AdaptationSet ").slice(1);
    assert.equal(sets.length, 2);
    for (const [index, type] of ["audio", "video"].entries()) {
      assert.ok(sets[index]!.startsWith(`id="${index}" contentType="${type}"`), sets[index]);
      const stream = 1 - index;
      assert.ok(sets[index]!.includes(`<Representation id="${stream}"`));
      if (type === "audio") assert.ok(sets[index]!.includes('lang="fra"'));
      const output = parseMp4(concatBytes([vfs.store.get(`/init-stream${stream}.m4s`)!, vfs.store.get(`/chunk-stream${stream}-00001.m4s`)!]));
      assert.equal(output.tracks[0]!.type, type);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(input).tracks[stream]!.samples.map(sample => sample.data));
    }
  });
}

for (const mapping of ["id=0,streams=2", "id=0,streams=v", "id=0,streams=0,1", "id=0,streams=v id=1,streams=v", "id=x,streams=a id=1,streams=v"]) {
  it(`rejects invalid DASH adaptation_sets ${mapping} before writing resources`, async () => {
    const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ includeAudio: true, frameCount: 2 }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-adaptation_sets", mapping, "/out.mpd"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("adaptation"), result.stderr);
    assert.deepEqual([...vfs.store.keys()], ["/in.mp4"]);
  });
}

it("groups multiple DASH representations in one explicit adaptation set", async () => {
  const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 2, includeAudio: true }) });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0:v", "-map", "0:v", "-map", "0:a", "-c", "copy", "-adaptation_sets", "id=7,streams=0,1 id=3,streams=a", "/out.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  const sets = new TextDecoder().decode(vfs.store.get("/out.mpd")!).split("<AdaptationSet ").slice(1);
  assert.equal(sets.length, 2);
  assert.ok(sets[0]!.startsWith('id="7" contentType="video"'));
  assert.ok(sets[0]!.includes('<Representation id="0"'));
  assert.ok(sets[0]!.includes('<Representation id="1"'));
  assert.ok(sets[1]!.startsWith('id="3" contentType="audio"'));
  assert.ok(sets[1]!.includes('<Representation id="2"'));
});

for (const flags of [[], ["-single_file", "1"], ["-init_seg_name", "custom-$RepresentationID$.mp4", "-media_seg_name", "custom-$RepresentationID$-$Number$.m4s"]]) {
  for (const remove of [undefined, "0", "1"]) {
    it(`DASH remove_at_exit ${remove} honors output lifecycle with ${flags.join(" ")}`, async () => {
      const input = createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true });
      const vfs = createTestVfs({ "/in.mp4": input, "/out/keep.m4s": "unrelated" });
      const result = await runCmd(createFfmpegCommand(), [
        "-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", ...flags,
        ...(remove === undefined ? [] : ["-remove_at_exit", remove]), "/out/play.mpd"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(vfs.store.get("/in.mp4"), input);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out/keep.m4s")), "unrelated");
      if (remove === "1") {
        assert.deepEqual([...vfs.store.keys()].sort(), ["/in.mp4", "/out/keep.m4s"]);
      } else {
        assert.ok(vfs.store.has("/out/play.mpd"));
        assert.ok(vfs.store.size > 3);
      }
    });
  }
}
for (const value of [undefined, "", "2", "-1", "nope"]) {
  it(`rejects invalid DASH remove_at_exit ${value}`, async () => {
    const vfs = createTestVfs({ "/out/play.mpd": "existing" });
    const result = await runCmd(createFfmpegCommand(), ["-remove_at_exit", ...(value === undefined ? [] : [value])], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("invalid remove_at_exit"), result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out/play.mpd")), "existing");
  });
}

it("keeps DASH window byte ranges aligned and fixed-duration templates unchanged", async () => {
  const { serializeDashDocument } = await import("@poe-code/mp4-ast");
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: false }));
  const source = { ...base, tracks: base.tracks.map(t => ({ ...t, samples: t.samples.map((s, i) => ({ ...s, isKeyframe: i % 4 === 0 })) })) };
  const full = serializeDashDocument(source, { segmentDuration: 1, singleFile: true });
  const window = serializeDashDocument(source, { segmentDuration: 1, singleFile: true, windowSize: 2 });
  const text = new TextDecoder().decode(window.manifest);
  const all = new TextDecoder().decode(full.manifest);
  const urls = (manifest: string) => manifest.split("<SegmentURL ").slice(1).map(s => s.split("/>")[0]);
  assert.deepEqual(urls(text), urls(all).slice(-2));
  assert.ok(text.includes(`<S t="${3 * source.tracks[0]!.timescale}" d="${source.tracks[0]!.timescale}" r="1"/>`), text);
  assert.deepEqual(window.resources, full.resources);
  const fixed = serializeDashDocument(source, { segmentDuration: 1, useTimeline: false, windowSize: 2 });
  assert.ok(new TextDecoder().decode(fixed.manifest).includes('startNumber="1"/>'));
  for (const windowSize of [-1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => serializeDashDocument(source, { windowSize }), /Invalid DASH window size/);
  }
});

for (const windowSize of [0, 1, 2, 20]) {
  for (const useTemplate of ["0", "1"]) {
    it(`bounds DASH manifest windows to ${windowSize} segments with use_template ${useTemplate}`, async () => {
      const { parseStreamingManifest } = await import("@poe-code/mp4-ast");
      const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
      const source = { ...base, tracks: base.tracks.map(t => ({ ...t,
        timescale: t.type === "audio" ? t.timescale / 2 : t.timescale,
        samples: t.samples.map((s, i) => ({ ...s, isKeyframe: t.type === "audio" || i % 4 === 0 }))
      })) };
      const vfs = createTestVfs({ "/in.mp4": serializeMp4(source) });
      const args = ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", "-use_template", useTemplate];
      const full = await runCmd(createFfmpegCommand(), [...args, "/full.mpd"], vfs);
      assert.equal(full.exitCode, 0, full.stderr);
      const all = parseStreamingManifest(vfs.store.get("/full.mpd")!, "dash");
      assert.notEqual(all.sequences[0]!.length, all.sequences[1]!.length);
      const result = await runCmd(createFfmpegCommand(), [...args, "-window_size", String(windowSize), "/window.mpd"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const window = parseStreamingManifest(vfs.store.get("/window.mpd")!, "dash");
      assert.deepEqual(window.sequences, all.sequences.map(sequence => windowSize ? sequence.slice(-windowSize) : sequence));
      for (const sequence of window.sequences) {
        for (const segment of sequence) {
          assert.ok(vfs.store.has(`/${segment.initialization}`));
          assert.ok(vfs.store.has(`/${segment.uri}`));
        }
      }
    });
  }
}

for (const value of ["-1", "1.5", "no", "2147483648", ""]) {
  it(`rejects invalid DASH window_size ${value}`, async () => {
    const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4() });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-c", "copy", "-window_size", value, "/out.mpd"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("window_size"), result.stderr);
    assert.equal(vfs.store.has("/out.mpd"), false);
  });
}


for (const enabled of ["0", "1"]) {
  it(`DASH hls_playlist ${enabled} emits companion playlists only when enabled`, async () => {
    const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-hls_playlist", enabled, "/out/play.mpd"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(vfs.store.has("/out/play.mpd"));
    assert.equal(vfs.store.has("/out/master.m3u8"), enabled === "1");
    for (const index of [0, 1]) {
      assert.equal(vfs.store.has(`/out/media_${index}.m3u8`), enabled === "1");
      if (enabled === "0") continue;
      const { hlsAst } = await import("@poe-code/mp4-ast");
      const output = hlsAst().parse(vfs.store.get(`/out/media_${index}.m3u8`)!, { resolveResource: uri => {
        assert.ok(vfs.store.has(`/out/${uri}`), uri);
        return vfs.store.get(`/out/${uri}`)!;
      } });
      assert.ok(output.tracks[0]!.samples.length > 0);
    }
  });
}

for (const value of [undefined, "", "2", "-1", "nope"]) {
  it(`rejects invalid DASH hls_playlist ${value}`, async () => {
    const vfs = createTestVfs({ "/out/play.mpd": "existing" });
    const result = await runCmd(createFfmpegCommand(), ["-hls_playlist", ...(value === undefined ? [] : [value])], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("invalid hls_playlist"), result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out/play.mpd")), "existing");
  });
}

it("DASH hls_playlist resources follow remove_at_exit", async () => {
  const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 2, includeAudio: true }), "/out/keep": "unrelated" });
  const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash",
    "-hls_playlist", "1", "-remove_at_exit", "1", "/out/play.mpd"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual([...vfs.store.keys()].sort(), ["/in.mp4", "/out/keep"]);
});

for (const segmentDuration of [1, 5]) {
  for (const fragmentType of ["none", "every_frame"]) {
    it(`writes DASH ${fragmentType} fragments inside ${segmentDuration}s segments`, async () => {
      const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 20, includeAudio: true }));
      const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track,
        samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
      })) });
      const source = parseMp4(input);
      const vfs = createTestVfs({ "/in.mp4": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.mp4", "-map", "0", "-c", "copy", "-f", "dash",
        "-seg_duration", String(segmentDuration), "-frag_type", fragmentType, "/out.mpd"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal([...vfs.store.keys()].filter(path => path.startsWith("/chunk-stream0-")).length, 5 / segmentDuration);
      for (const [index, track] of source.tracks.entries()) {
        const chunks = [...vfs.store.keys()].filter(path => path.startsWith(`/chunk-stream${index}-`)).sort().map(path => vfs.store.get(path)!);
        let sequence = 0;
        for (const chunk of chunks) {
          const moofs = parseMp4Boxes(chunk).filter(box => box.type === "moof");
          if (fragmentType === "none") assert.equal(moofs.length, 1);
          else if (track.type === "video") assert.equal(moofs.length, segmentDuration * 4);
          for (const moof of moofs) assert.equal(new DataView(chunk.buffer, chunk.byteOffset).getUint32(moof.offset + 20), ++sequence);
        }
        const output = parseMp4(concatBytes([vfs.store.get(`/init-stream${index}.m4s`)!, ...chunks]));
        assert.deepEqual(output.tracks[0]!.samples.map(s => [s.dts, s.pts, s.duration, s.isKeyframe, s.data]),
          track.samples.map(s => [s.dts, s.pts, s.duration, s.isKeyframe, s.data]));
        if (fragmentType === "every_frame") assert.equal(sequence, track.samples.length);
      }
    });
  }
}


for (const value of [undefined, "unsupported"]) {
  it(`rejects unsupported DASH frag_type ${value}`, async () => {
    const vfs = createTestVfs({});
    const result = await runCmd(createFfmpegCommand(), ["-frag_type", ...(value === undefined ? [] : [value])], vfs);
    assert.equal(result.exitCode, 234);
    assert.ok(result.stderr.includes("unsupported frag_type"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
}

it("probes and maps every video representation in a DASH adaptation set", async () => {
  const { serializeDashDocument } = await import("@poe-code/mp4-ast");
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12, includeAudio: true }));
  const small = parseMp4(createSyntheticMp4({ width: 16, height: 12, fps: 4, frameCount: 12 }));
  const tracks = [base.tracks[0]!, small.tracks[0]!, base.tracks[1]!];
  const { manifest, resources } = serializeDashDocument({ ...base, tracks }, { adaptationSets: "id=0,streams=v id=1,streams=a", segmentDuration: 1 });
  const vfs = createTestVfs({ "/in.mpd": manifest, ...Object.fromEntries([...resources].map(([uri, bytes]) => [`/${uri}`, bytes])) });
  const probe = await runCmd(createFfprobeCommand(), ["-show_streams", "-of", "json", "/in.mpd"], vfs);
  assert.equal(probe.exitCode, 0, probe.stderr);
  const streams = JSON.parse(probe.stdout).streams;
  assert.deepEqual(streams.map((s: { codec_type: string; width?: number; height?: number }) => [s.codec_type, s.width, s.height]), [["video", 32, 24], ["video", 16, 12], ["audio", undefined, undefined]]);
  for (const mapping of ["0", "0:v:1"]) {
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.mpd", "-map", mapping, "-c", "copy", "/out.mp4"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = parseMp4(vfs.store.get("/out.mp4")!);
    const expected = mapping === "0" ? tracks : [tracks[1]!];
    assert.deepEqual(output.tracks.map(t => [t.type, t.width, t.height]), expected.map(t => [t.type, t.width, t.height]));
    // Native DASH demux stops after the 120th AAC packet when video reaches EOF.
    assert.deepEqual(output.tracks.map(t => t.samples.map(s => s.data)), expected.map(t => (t.type === "audio" ? t.samples.slice(0, 120) : t.samples).map(s => s.data)));
  }
});

it("probes DASH manifest language and preserves it when copying to MP4", async () => {
  const { serializeDashDocument } = await import("@poe-code/mp4-ast");
  const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true }));
  // Keep initialization segments at und; only the MPD declares French audio.
  const { resources } = serializeDashDocument(base);
  const { manifest } = serializeDashDocument({ ...base, tracks: base.tracks.map(track => ({
    ...track, language: track.type === "audio" ? "fra" : "und"
  })) });
  const vfs = createTestVfs({ "/in.mpd": manifest, ...Object.fromEntries([...resources].map(([uri, bytes]) => [`/${uri}`, bytes])) });
  const probe = await runCmd(createFfprobeCommand(), ["-show_streams", "-of", "json", "/in.mpd"], vfs);
  assert.equal(probe.exitCode, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout).streams.map((stream: { tags: { language: string } }) => stream.tags.language), ["und", "fra"]);
  const copy = await runCmd(createFfmpegCommand(), ["-i", "/in.mpd", "-map", "0", "-c", "copy", "/out.mp4"], vfs);
  assert.equal(copy.exitCode, 0, copy.stderr);
  const output = parseMp4(vfs.store.get("/out.mp4")!);
  assert.deepEqual(output.tracks.map(track => track.language), ["und", "fra"]);
  assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)),
    base.tracks.map(track => (track.type === "audio" ? track.samples.slice(0, 6) : track.samples).map(sample => sample.data)));
});


describe("volumedetect", () => {
  for (const filter of ["volumedetect", "volumedetect=", "volumedetect@meter", "volumedetect@meter="]) {
    it(`accepts an empty option list and preserves native f32le output for ${filter}`, async () => {
      const samples = Float64Array.from({ length: 2400 }, (_, i) => [0, 512, 256, 16384][i % 4]! / 32768);
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [samples] }) });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-nostats", "-v", "info",
        "-i", "/in.wav", "-af", filter, "-f", "f32le", "-"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "n_samples: 2400\nmean_volume: -12.0 dB\nmax_volume: -6.0 dB\nhistogram_6db: 600\n");
      const expected = new Uint8Array(9600);
      const view = new DataView(expected.buffer);
      samples.forEach((sample, i) => view.setFloat32(i * 4, sample, true));
      assert.deepEqual(result.stdoutBytes, expected);
    });
  }
  for (const filter of ["volumedetect=unknown=1", "volumedetect@meter=unknown=1"]) {
    it(`rejects nonempty options for ${filter}`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "-f", "f32le", "-"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("Unsupported audio filter:"), result.stderr);
      assert.equal(result.stdoutBytes.length, 0);
    });
  }
  for (const [name, samples, expected] of [
    ["sparse peaks", [32767, 16384, 16384, ...Array(4).fill(8192), ...Array(3993).fill(1024)],
      Array.from({ length: 13 }, (_, db) => `histogram_${db}db: ${db === 0 ? 1 : db === 6 ? 2 : db === 12 ? 4 : 0}`)],
    ["integer threshold", [32767, ...Array(1998).fill(1024)], ["histogram_0db: 1"]],
    ["fewer than 1000 samples", Array(999).fill(16384), []],
    ["silence", Array(1000).fill(0), ["histogram_91db: 1000"]],
    ["negative full scale", Array(1000).fill(-32768), ["histogram_0db: 1000"]],
    ["truncated decibels", Array(1000).fill(12000), ["histogram_8db: 1000"]]
  ] as const) {
    it(`reports native peak histogram for ${name} without changing PCM`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, n => n / 32768)] });
      const vfs = createTestVfs({ "/in.wav": input });
      for (const filter of ["volumedetect", "anull"]) {
        const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-nostats", "-y", "-v", "info",
          "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(result.stderr.split("\n").filter(line => line.startsWith("histogram_")),
          filter === "volumedetect" ? expected : []);
        assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData,
          parseWav(input).tracks[0]!.decodedAudio!.channelData);
      }
    });
  }
  for (const [filter, control, mean, peak] of [
    ["volumedetect", "anull", "-12.0", "-6.0"],
    ["volume=0.5,volumedetect", "volume=0.5", "-18.1", "-12.0"],
    ["volumedetect,volume=0.5", "volume=0.5", "-12.0", "-6.0"],
    ["volume=0,volumedetect@silent", "volume=0", "-91.0", "-91.0"]
  ]) {
    it(`reports native levels and preserves PCM for ${filter}`, async () => {
      const channels = [new Float64Array(96000), new Float64Array(96000)];
      for (let i = 0; i < 96000; i++) {
        const sign = i % 48 < 24 ? 1 : -1;
        channels[0]![i] = i >= 24000 && i < 72000 ? sign / 4 : 0;
        channels[1]![i] = i >= 48000 && i < 84000 ? sign / 2 : 0;
      }
      const input = encodeWav({ sampleRate: 48000, channels });
      const vfs = createTestVfs({ "/levels.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-loglevel", "info",
        "-i", "/levels.wav", "-af", filter!, "-c:a", "pcm_s16le", "-y", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      for (const line of ["n_samples: 192000", `mean_volume: ${mean} dB`, `max_volume: ${peak} dB`]) {
        assert.ok(result.stderr.includes(line), result.stderr);
      }
      const reference = await runCmd(createFfmpegCommand(), ["-i", "/levels.wav", "-af", control!,
        "-c:a", "pcm_s16le", "/control.wav"], vfs);
      assert.equal(reference.exitCode, 0, reference.stderr);
      const pcm = (bytes: Uint8Array) => parseWav(bytes).tracks[0]!.decodedAudio!.channelData;
      assert.deepEqual(pcm(vfs.store.get("/out.wav")!), pcm(vfs.store.get("/control.wav")!));
      if (control === "anull") assert.deepEqual(pcm(vfs.store.get("/out.wav")!), pcm(input));
    });
  }
});


describe("silencedetect", () => {
  for (const [filter, expected] of [
    ["silencedetect=noise=-40dB:d=0.1", ["silence_start: 0", "silence_end: 0.5 | silence_duration: 0.5", "silence_start: 1.75", "silence_end: 2 | silence_duration: 0.25"]],
    ["silencedetect=n=0.01:duration=0.1:mono=1", ["channel: 0 | silence_start: 0", "channel: 1 | silence_start: 0", "channel: 0 | silence_end: 0.5 | silence_duration: 0.5", "channel: 1 | silence_end: 1 | silence_duration: 1", "channel: 0 | silence_start: 1.5", "channel: 1 | silence_start: 1.75", "channel: 0 | silence_end: 2 | silence_duration: 0.5", "channel: 1 | silence_end: 2 | silence_duration: 0.25"]],
    ["silencedetect=d=0.6", []],
    ["volume=0,silencedetect@quiet=d=0.1", ["silence_start: 0", "silence_end: 2 | silence_duration: 2"]],
    ["silencedetect", []]
  ] as const) {
    it(`reports native intervals and preserves PCM for ${filter}`, async () => {
      const channels = [new Float64Array(96000), new Float64Array(96000)];
      for (let i = 0; i < 96000; i++) {
        const sign = i % 48 < 24 ? 1 : -1;
        channels[0]![i] = i >= 24000 && i < 72000 ? sign / 4 : 0;
        channels[1]![i] = i >= 48000 && i < 84000 ? sign / 2 : 0;
      }
      const input = encodeWav({ sampleRate: 48000, channels });
      const vfs = createTestVfs({ "/levels.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-loglevel", "info", "-i", "/levels.wav", "-af", filter, "-c:a", "pcm_s16le", "-y", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stderr.trim().split("\n").filter(line => line.includes("silence_")), expected);
      const output = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(output.channelData[0]!.length, 96000);
      assert.deepEqual(output.channelData, filter.startsWith("volume=0")
        ? [new Float32Array(96000), new Float32Array(96000)]
        : parseWav(input).tracks[0]!.decodedAudio!.channelData);
    });
  }
  for (const option of ["noise=bad", "d=-1", "mono=2", "unknown=1"]) {
    it(`rejects invalid ${option} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `silencedetect=${option}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("astats", () => {
  for (const [filter, control, peaks, rms, overall] of [
    ["astats=metadata=0:reset=0", "anull", [-12.040935, -6.020335], [-15.051235, -10.280022], -12.040935],
    ["astats@levels,volume=0.5", "volume=0.5", [-12.040935, -6.020335], [-15.051235, -10.280022], -12.040935],
    ["volume=0.5,astats", "volume=0.5", [-18.0618, -12.0412], [-21.0721, -16.300887], -18.0618],
    ["volume=0,astats", "volume=0", [-Infinity, -Infinity], [-Infinity, -Infinity], -Infinity]
  ] as const) {
    it(`reports channel and overall levels without changing PCM: ${filter}`, async () => {
      const channels = [new Float64Array(96000), new Float64Array(96000)];
      for (let i = 0; i < 96000; i++) {
        const sign = i % 48 < 24 ? 1 : -1;
        channels[0]![i] = i >= 24000 && i < 72000 ? sign / 4 : 0;
        channels[1]![i] = i >= 48000 && i < 84000 ? sign / 2 : 0;
      }
      const input = encodeWav({ sampleRate: 48000, channels });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-loglevel", "info", "-i", "/in.wav",
        "-af", filter, "-c:a", "pcm_s16le", "-y", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const sections = result.stderr.split("Channel: ").slice(1);
      assert.equal(sections.length, 2, result.stderr);
      const measure = (section: string, key: string, expected: number) => {
        const value = section.split(`${key}: `)[1]?.split("\n")[0];
        if (expected === -Infinity) assert.equal(value, "-inf");
        else assert.ok(Math.abs(Number(value) - expected) < 0.00001, `${key}: ${value}, expected ${expected}`);
      };
      sections.forEach((section, index) => {
        assert.ok(section.startsWith(`${index + 1}\n`));
        measure(section, "Peak level dB", peaks[index]!);
        measure(section, "RMS level dB", rms[index]!);
      });
      const summary = result.stderr.split("Overall\n")[1]!;
      assert.ok(summary, result.stderr);
      measure(summary, "Peak level dB", Math.max(...peaks));
      measure(summary, "RMS level dB", overall);
      measure(summary, "Number of samples", 96000);
      const reference = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", control, "-c:a", "pcm_s16le", "/control.wav"], vfs);
      assert.equal(reference.exitCode, 0, reference.stderr);
      const pcm = (bytes: Uint8Array) => parseWav(bytes).tracks[0]!.samples.map(sample => sample.data);
      assert.deepEqual(pcm(vfs.store.get("/out.wav")!), pcm(vfs.store.get("/control.wav")!));
      if (control === "anull") assert.deepEqual(pcm(vfs.store.get("/out.wav")!), pcm(input));
    });
  }
  for (const [masks, expected] of [
    ["measure_perchannel=RMS_level:measure_overall=none",
      "Channel: 1\nRMS level dB: -17.490106\nChannel: 2\nRMS level dB: -7.268309\n"],
    ["measure_perchannel=none:measure_overall=RMS_level",
      "Overall\nRMS level dB: -9.884384\n"],
    ["measure_perchannel=DC_offset+Min_level+Max_level:measure_overall=none",
      "Channel: 1\nDC offset: 0.054689\nMin level: -4096.000000\nMax level: 8192.000000\nChannel: 2\nDC offset: -0.371105\nMin level: -16384.000000\nMax level: 512.000000\n"],
    ["measure_perchannel=none:measure_overall=DC_offset+Min_level+Max_level",
      "Overall\nDC offset: -0.371105\nMin level: -16384.000000\nMax level: 8192.000000\n"],
    ["measure_perchannel=none:measure_overall=none", ""],
    ["measure_perchannel=Peak_level+Number_of_samples:measure_overall=none",
      "Channel: 1\nPeak level dB: -12.040935\nNumber of samples: 2048\nChannel: 2\nPeak level dB: -6.020335\nNumber of samples: 2048\n"]
  ]) {
    it(`honors independent measurement masks and preserves PCM: ${masks}`, async () => {
      // Reconstruct the native comparison fixture directly in memory.
      const channels = [new Float64Array(2048), new Float64Array(2048)];
      for (let i = 0; i < 2048; i++) {
        channels[0]![i] = (i < 1536 ? [8192, -4096, 0, 4096][i % 4]! : 1024) / 32768;
        channels[1]![i] = (i < 1536 ? -16384 : 512) / 32768;
      }
      const input = encodeWav({ sampleRate: 8000, channels });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-nostats", "-y", "-v", "info",
        "-i", "/in.wav", "-af", `astats=${masks}`, "-c:a", "pcm_s16le", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, expected);
      const pcm = (bytes: Uint8Array) => parseWav(bytes).tracks[0]!.samples.map(sample => sample.data);
      assert.deepEqual(pcm(vfs.store.get("/out.wav")!), pcm(input));
    });
  }
  for (const option of ["metadata=2", "metadata=maybe", "metadata=1=0", "reset=-1", "reset=1.5", "reset=2147483648", "reset=", "reset=NaN", "reset=Infinity", "reset=nope", "unknown=0", "measure_perchannel=unknown", "measure_overall=RMS_level+unknown", "measure_perchannel=", "measure_overall=RMS_level=none"]) {
    it(`rejects unsupported astats ${option} without replacing output`, async () => {
      const original = new Uint8Array([1, 2, 3]);
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(4)] }), "/out.wav": original });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `astats=${option}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("astats:"), result.stderr);
      assert.deepEqual(vfs.store.get("/out.wav"), original);
    });
  }
});


describe("ebur128", () => {
  it("matches native 100 ms loudness measurements and preserves every PCM frame", async () => {
    const channels = [new Float64Array(96000), new Float64Array(96000)];
    for (let i = 0; i < 96000; i++) {
      const sign = i % 48 < 24 ? 1 : -1;
      channels[0]![i] = i >= 24000 && i < 72000 ? sign / 4 : 0;
      channels[1]![i] = i >= 48000 && i < 84000 ? sign / 2 : 0;
    }
    const input = encodeWav({ sampleRate: 48000, channels });
    const vfs = createTestVfs({ "/in.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-loglevel", "info", "-i", "/in.wav",
      "-af", "ebur128=peak=sample", "-c:a", "pcm_s16le", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const measurements = result.stderr.split("\n").filter(line => line.startsWith("t:"));
    assert.equal(measurements.length, 20);
    const integrated = [-70, -70, -70, -70, -70, -17.2, -15.5, -14.2, -13.3, -12.8,
      -11.6, -10.4, -9.3, -8.3, -7.7, -7.3, -6.7, -6.5, -6.6, -6.7];
    const momentary = [-120.7, -120.7, -120.7, -163.5, -163.5, -17.2, -14.2, -12.5,
      -11.2, -11.2, -8.2, -6.4, -5.2, -4.2, -4.2, -4.4, -4.7, -5.5, -7.2, -9.5];
    measurements.forEach((line, index) => {
      assert.ok(Math.abs(Number(line.split("t:")[1]!.trim().split(" ")[0]) - ((index + 1) / 10 - 1 / 48000)) < 0.00001);
      // A histogram bin at a decimal tie can round either way at displayed precision.
      assert.ok(Math.abs(Number(line.split("I:")[1]!.trim().split(" ")[0]) - integrated[index]!) <= 0.100001, line);
      assert.equal(Number(line.split("M:")[1]!.trim().split(" ")[0]), momentary[index]);
    });
    assert.match(result.stderr, /I:\s+-6.7 LUFS\n\s+Threshold:\s+-17.0 LUFS/);
    assert.match(result.stderr, /Sample peak:\n\s+Peak:\s+-6.0 dBFS/);
    assert.match(measurements.at(-1)!, /SPK:\s+-12.0\s+-6.0 dBFS/);
    assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData,
      parseWav(input).tracks[0]!.decodedAudio!.channelData);
  });
});



describe("ebur128 dual mono", () => {
  for (const [options, level, correction] of [
    ["dualmono=false", -15.4, 0], ["dualmono=true", -12.4, 3.01029995663978],
    ["dualmono=1:panlaw=-6", -9.4, 6], ["dualmono=true:panlaw=0", -15.4, 0],
    ["dualmono=true:panlaw=-10", -5.4, 10], ["panlaw=-6", -15.4, 0],
    ["dualmono=0:panlaw=-6", -15.4, 0]
  ] as const) {
    it(`matches native mono compensation for ${options}`, async () => {
      // Native FFmpeg fixture: 3.5 s of 700 Hz followed by 20 ms at PCM 30000.
      const samples = Float64Array.from({ length: 28160 }, (_, i) =>
        (i < 28000 ? Math.trunc(8192 * Math.sin(2 * Math.PI * 700 * i / 8000)) : 30000) / 32768);
      const input = encodeWav({ sampleRate: 8000, channels: [samples] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af",
        `ebur128=${options}:peak=sample`, "-c:a", "pcm_s16le", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const measurements = result.stderr.split("\n").filter(line => line.startsWith("t:"));
      assert.ok(measurements[0]!.includes(`M:${(-120.691 + correction).toFixed(1).padStart(6)}`));
      assert.match(measurements[0]!, /I:\s+-70.0 LUFS/);
      for (const field of ["M:", "S:", "I:"]) {
        assert.equal(Number(measurements.at(-1)!.split(field)[1]!.trim().split(" ")[0]), level);
      }
      const summary = result.stderr.slice(result.stderr.indexOf("Summary:"));
      assert.ok(summary.includes(`I:         ${level.toFixed(1)} LUFS`), summary);
      assert.ok(summary.includes(`Threshold: ${(level - 10).toFixed(1)} LUFS`), summary);
      assert.ok(summary.includes(`Threshold: ${(level - 20).toFixed(1)} LUFS`), summary);
      assert.ok(summary.includes(`LRA low:   ${level.toFixed(1)} LUFS`), summary);
      assert.ok(summary.includes(`LRA high:  ${level.toFixed(1)} LUFS`), summary);
      assert.match(summary, /LRA:\s+0.0 LU/);
      assert.match(summary, /Peak:\s+-0.8 dBFS/);
      assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData,
        parseWav(input).tracks[0]!.decodedAudio!.channelData);
    });
  }
  for (const amplitude of [0, 0.0001]) {
    it(`keeps ungated mono integrated loudness at -70 for amplitude ${amplitude}`, async () => {
      const samples = Float64Array.from({ length: 3200 }, (_, i) => amplitude * Math.sin(2 * Math.PI * 700 * i / 8000));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [samples] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", "ebur128=dualmono=true:panlaw=-6", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const summary = result.stderr.slice(result.stderr.indexOf("Summary:"));
      assert.match(summary, /I:\s+-70.0 LUFS/);
      assert.match(summary, /Threshold:\s+6.0 LUFS/);
      assert.match(summary, /LRA low:\s+6.0 LUFS\n\s+LRA high:\s+6.0 LUFS/);
    });
  }
  it("ignores compensation for stereo input", async () => {
    const samples = Float64Array.from({ length: 3200 }, (_, i) => Math.sin(i) / 4);
    const input = encodeWav({ sampleRate: 8000, channels: [samples, samples] });
    const outputs = [];
    for (const options of ["", "=dualmono=true:panlaw=-6"]) {
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", `ebur128${options}`, "/out.wav"],
        createTestVfs({ "/in.wav": input }));
      assert.equal(result.exitCode, 0, result.stderr);
      outputs.push(result.stderr);
    }
    assert.equal(outputs[0], outputs[1]);
  });
  for (const options of ["dualmono=maybe", "dualmono=2", "panlaw=1", "panlaw=-11", "panlaw=NaN", "panlaw=", "panlaw=-Infinity"]) {
    it(`rejects invalid ${options} without overwriting output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `ebur128=${options}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ebur128: invalid/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});

describe("ebur128 edge cases", () => {
  for (const peak of ["0", "1", "2", "3", "none", "sample"]) {
    it(`accepts peak=${peak} and preserves PCM including a final partial interval`, async () => {
      const samples = Float64Array.from({ length: 28160 }, (_, i) =>
        (i < 28000 ? Math.round(8192 * Math.sin(2 * Math.PI * 1000 * i / 8000)) : 30000) / 32768);
      const input = encodeWav({ sampleRate: 8000, channels: [samples] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-hide_banner", "-nostats", "-y", "-v", "info",
        "-i", "/in.wav", "-af", `ebur128=peak=${peak}`, "-c:a", "pcm_s16le", "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const reportsPeak = ["2", "3", "sample"].includes(peak);
      assert.equal(result.stderr.includes("Sample peak:"), reportsPeak);
      assert.equal(result.stderr.includes("SPK:"), reportsPeak);
      if (reportsPeak) assert.match(result.stderr, /Sample peak:\n\s+Peak:\s+-0.8 dBFS/);
      assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData,
        parseWav(input).tracks[0]!.decodedAudio!.channelData);
    });
  }
  for (const [filter, peak] of [["ebur128", false], ["volume=0,ebur128=peak=sample", true]] as const) {
    it(`reports silence for ${filter}`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });
      const vfs = createTestVfs({ "/in.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", filter, "/out.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.match(result.stderr, /I:\s*-70.0 LUFS/);
      assert.equal(result.stderr.includes("Sample peak:"), peak);
      if (peak) assert.match(result.stderr, /Peak:\s+-inf dBFS/);
      assert.deepEqual(parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!.channelData,
        parseWav(input).tracks[0]!.decodedAudio!.channelData);
    });
  }
  it("measures short-term loudness and range at 44.1 kHz", async () => {
    const samples = Float64Array.from({ length: 154350 }, (_, i) => Math.round(8192 * Math.sin(2 * Math.PI * 1000 * i / 44100)) / 32768);
    const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 44100, channels: [samples] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.wav", "-af", "ebur128@meter=peak=sample", "/out.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const summary = result.stderr.slice(result.stderr.indexOf("Summary:"));
    assert.match(summary, /I:\s+-15.0 LUFS\n\s+Threshold:\s+-25.0 LUFS/);
    assert.match(summary, /LRA:\s+0.0 LU\n\s+Threshold:\s+-35.0 LUFS/);
    assert.match(summary, /LRA low:\s+-15.0 LUFS\n\s+LRA high:\s+-15.0 LUFS/);
    assert.match(summary, /Peak:\s+-12.0 dBFS/);
    assert.equal(result.stderr.split("\n").filter(line => line.startsWith("t:")).length, 35);
  });
  for (const option of ["peak=true+bogus", "peak=bogus", "peak=banana", "peak=true+banana", "peak=sample+banana"]) {
    it(`rejects unsupported ${option} without replacing the output`, async () => {
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), "/out.wav": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.wav", "-af", `ebur128=${option}`, "/out.wav"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /ebur128: unsupported option/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.wav")), "keep");
    });
  }
});


describe("WAV RF64 output", () => {
  for (const sync of [false, true]) for (const copy of [false, true]) for (const mode of ["always", "auto", "never", undefined]) {
    it(`${sync ? "sync" : "async"} ${copy ? "copies" : "encodes"} ${mode ?? "default"} headers and exact PCM`, async () => {
      const values = [-32768, 32767, -12345, 23456, -1, 0, 1, 256];
      const channels = [0, 1].map(channel => Float64Array.from({ length: 1024 },
        (_, frame) => values[(frame * 2 + channel) % values.length]! / 32768));
      const input = encodeWav({ sampleRate: 8000, channels });
      const vfs = createTestVfs({ "/in.wav": input });
      const args = ["-i", "/in.wav", ...(mode ? ["-rf64", mode] : []), ...(copy ? ["-c:a", "copy"] : []), "/out.wav"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const output = vfs.store.get("/out.wav")!;
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      const fourcc = (offset: number) => new TextDecoder().decode(output.subarray(offset, offset + 4));
      assert.equal(fourcc(0), mode === "always" ? "RF64" : "RIFF");
      assert.equal(view.getUint32(4, true), mode === "always" ? 0xffffffff : output.length - 8);
      assert.equal(fourcc(12), mode === "always" ? "ds64" : mode === "auto" ? "JUNK" : "fmt ");
      if (mode === "always") {
        assert.equal(view.getUint32(16, true), 28);
        assert.equal(view.getBigUint64(20, true), BigInt(output.length - 8));
        assert.equal(view.getBigUint64(28, true), 4096n);
        assert.equal(view.getBigUint64(36, true), 1024n);
        assert.equal(view.getUint32(44, true), 0);
      }
      let offset = mode === "always" || mode === "auto" ? 48 : 12;
      while (fourcc(offset) !== "data") offset += 8 + view.getUint32(offset + 4, true) + (view.getUint32(offset + 4, true) % 2);
      assert.equal(view.getUint32(offset + 4, true), mode === "always" ? 0xffffffff : 4096);
      for (let i = 0; i < 2048; i++) assert.equal(view.getInt16(offset + 8 + i * 2, true), values[i % 8]);
    });
  }
  for (const value of ["invalid", ""]) it(`rejects invalid RF64 mode ${value}`, async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-rf64", value, "/out.wav"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("rf64"));
    assert.equal(vfs.store.size, 0);
  });
});

describe("WAV Broadcast Wave metadata", () => {
  for (const sync of [false, true]) for (const copy of [false, true]) for (const mode of ["1", "0", undefined]) {
    it(`${sync ? "sync" : "async"} ${copy ? "copy" : "encode"} write_bext=${mode ?? "default"} preserves chunks and PCM`, async () => {
      const values = [-32768, 32767, -12345, 23456, -1, 0, 1, 256];
      const channels = [0, 1].map(channel => Float64Array.from({ length: 1024 },
        (_, frame) => values[(frame * 2 + channel) % values.length]! / 32768));
      const vfs = createTestVfs({ "/in.wav": encodeWav({ sampleRate: 8000, channels }) });
      const args = ["-i", "/in.wav", ...(mode ? ["-write_bext", mode] : []),
        "-metadata", "description=Fixture description", "-metadata", "originator=Test author",
        "-metadata", "originator_reference=Reference", "-metadata", "origination_date=2026-11-07",
        "-metadata", "origination_time=12:34:56", "-metadata", "time_reference=4294967297",
        "-metadata", "coding_history=PCM", ...(copy ? ["-c:a", "copy"] : []), "/out.wav"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const output = vfs.store.get("/out.wav")!;
      const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
      assert.equal(view.getUint32(4, true), output.length - 8);
      const chunks = new Map<string, Uint8Array>();
      let offset = 12;
      while (offset + 8 <= output.length) {
        const size = view.getUint32(offset + 4, true);
        assert.ok(offset + 8 + size <= output.length);
        chunks.set(new TextDecoder().decode(output.subarray(offset, offset + 4)), output.subarray(offset + 8, offset + 8 + size));
        offset += 8 + size + size % 2;
      }
      assert.equal(offset, output.length);
      assert.equal(chunks.has("bext"), mode === "1");
      if (mode === "1") {
        const bext = chunks.get("bext")!;
        assert.equal(bext.length, 606);
        for (const [start, length, value] of [[0, 256, "Fixture description"], [256, 32, "Test author"],
          [288, 32, "Reference"], [320, 10, "2026-11-07"], [330, 8, "12:34:56"]] as const) {
          const expected = new Uint8Array(length);
          expected.set(new TextEncoder().encode(value));
          assert.deepEqual(bext.subarray(start, start + length), expected);
        }
        const fields = new DataView(bext.buffer, bext.byteOffset, bext.byteLength);
        assert.equal(fields.getBigUint64(338, true), 4294967297n);
        assert.equal(fields.getUint16(346, true), 1);
        assert.ok(bext.subarray(348, 602).every(byte => byte === 0));
        assert.equal(new TextDecoder().decode(bext.subarray(602)), "PCM\0");
      }
      const pcm = chunks.get("data")!;
      assert.equal(pcm.length, 4096);
      const samples = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
      for (let i = 0; i < 2048; i++) assert.equal(samples.getInt16(i * 2, true), values[i % 8]);
      assert.deepEqual(parseWav(output).tracks[0]!.decodedAudio!.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
    });
  }
});


describe("input -itsscale", () => {
  const subtitle = "1\n00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n";
  for (const sync of [false, true]) {
    for (const [flags, times] of [
      [[], [[1000, 3500], [2250, 5000]]],
      [["-itsscale", "2"], [[2000, 4500], [4500, 7250]]],
      [["-itsscale:s:0", "0.5"], [[500, 3000], [1125, 3875]]],
      [["-itsscale", "3", "-itsscale:s", "2"], [[2000, 4500], [4500, 7250]]],
    ] as const) {
      it(`${sync ? "sync" : "async"} preserves subtitle text and durations: ${flags.join(" ")}`, async () => {
        const vfs = createTestVfs({ "/in.srt": subtitle });
        const args = [...flags, "-i", "/in.srt", "/out.vtt"];
        if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const doc = allMediaAsts().find(ast => ast.id === "webvtt")!.parse(vfs.store.get("/out.vtt")!);
        const track = doc.tracks[0]!;
        assert.deepEqual(track.samples.map(sample => [sample.pts * 1000 / track.timescale,
          (sample.pts + sample.duration) * 1000 / track.timescale]), times);
        assert.deepEqual(track.samples.map(sample => new TextDecoder().decode(sample.data)), ["Café costs €2", "Second line"]);
      });
    }
    it(`${sync ? "sync" : "async"} scales only video packets in MP4`, async () => {
      const input = createSyntheticMp4({ fps: 5, frameCount: 5, includeAudio: true });
      const vfs = createTestVfs({ "/in.mp4": input });
      const args = ["-itsscale:v", "2", "-i", "/in.mp4", "-c", "copy", "/out.mp4"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
        (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const before = parseMp4(input), after = parseMp4(vfs.store.get("/out.mp4")!);
      for (const track of before.tracks) {
        const output = after.tracks.find(candidate => candidate.type === track.type)!;
        const factor = track.type === "video" ? 2 : 1;
        assert.deepEqual(output.samples.map(sample => sample.pts / output.timescale),
          track.samples.map(sample => factor * sample.pts / track.timescale));
        assert.deepEqual(output.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
      }
    });
  }
  it("resets scaling for the next input", async () => {
    const vfs = createTestVfs({ "/in.srt": subtitle });
    const result = await runCmd(createFfmpegCommand(), ["-itsscale", "2", "-i", "/in.srt", "-i", "/in.srt", "-map", "1:s", "/out.srt"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.srt")), subtitle);
  });
  for (const flags of [["-itsscale"], ["-itsscale", "NaN"], ["-itsscale", "Infinity"], ["-itsscale", ""], ["-itsscale:bogus", "2"]]) {
    it(`rejects invalid scaling without writing output: ${flags.join(" ")}`, async () => {
      const vfs = createTestVfs({ "/out.vtt": "keep" });
      const result = await runCmd(createFfmpegCommand(), [...flags, "-i", "/in.srt", "/out.vtt"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")), "keep");
    });
  }
});

for (const frameOption of ["-frames:s", "-frames:s:0", "-frames:0", "-frames"]) describe(`subtitle ${frameOption}`, () => {
  const subtitle = "1\n00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n";
  for (const sync of [false, true]) {
    for (const limit of [undefined, 0, 1, 2, 10]) {
      it(`${sync ? "sync" : "async"} limits cue count to ${limit} without trimming cues`, async () => {
        const vfs = createTestVfs({ "/in.srt": subtitle });
        const args = ["-i", "/in.srt", ...(limit === undefined ? [] : [frameOption, String(limit)]), "/out.vtt"];
        if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const doc = allMediaAsts().find(ast => ast.id === "webvtt")!.parse(vfs.store.get("/out.vtt")!);
        const track = doc.tracks[0]!;
        assert.deepEqual(track.samples.map(sample => [
          sample.pts / track.timescale, (sample.pts + sample.duration) / track.timescale,
          new TextDecoder().decode(sample.data)
        ]), [[1, 3.5, "Café costs €2"], [2.25, 5, "Second line"]].slice(0, limit));
      });
    }
  }
  for (const value of ["-1", "1.5", "nope", ""]) {
    it(`rejects invalid subtitle frame count ${value} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.srt": subtitle, "/out.vtt": "existing" });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.srt", frameOption, value, "/out.vtt"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes(frameOption.startsWith("-frames:s") ? "invalid subtitle frame limit" : "invalid frame limit"), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")), "existing");
    });
  }
});

describe("MicroDVD subtitles", () => {
  for (const sync of [false, true]) {
    for (const explicit of [false, true]) {
      for (const copy of [false, true]) {
        it(`${sync ? "sync" : "async"} ${explicit ? "explicit" : "detected"} ${copy ? "copies frames" : "decodes declared fps"}`, async () => {
          const input = "{1}{1}25.000\n{31}{70}First line|continuation\n{85}{125}Last & final\n";
          const vfs = createTestVfs({ "/in.sub": input });
          const output = copy ? "/out.sub" : "/out.vtt";
          const args = ["-v", "error", "-y", ...(explicit ? ["-f", "microdvd"] : []), "-i", "/in.sub",
            ...(copy ? ["-c:s", "copy", "-f", "microdvd"] : []), output];
          if (sync) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          assert.equal(new TextDecoder().decode(vfs.store.get(output)), copy
            ? "{31}{70}First line|continuation\n{85}{125}Last & final\n"
            : "WEBVTT\n\n00:01.240 --> 00:02.800\nFirst line\ncontinuation\n\n00:03.400 --> 00:05.000\nLast & final\n");
          assert.equal(new TextDecoder().decode(vfs.store.get("/in.sub")), input);
        });
      }
    }
  }
});

for (const explicit of [false, true]) {
  for (const sync of [false, true]) {
    it(`reads SubViewer ${explicit ? "explicit" : "detected"} subtitles (${sync ? "sync" : "async"})`, async () => {
      const input = "[INFORMATION]\n[TITLE]Fixture\n[END INFORMATION]\n[SUBTITLE]\n00:00:01.24,00:00:02.80\nFirst line[br]continuation\n\n00:00:03.40,00:00:05.00\nLast & final\n";
      const vfs = createTestVfs({ "/subviewer.sub": input });
      const args = ["-v", "error", "-y", ...(explicit ? ["-f", "subviewer"] : []), "-i", "/subviewer.sub", "/out.vtt"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.vtt")),
        "WEBVTT\n\n00:01.240 --> 00:02.800\nFirst line\ncontinuation\n\n00:03.400 --> 00:05.000\nLast & final\n");
    });
  }
}

describe("APNG output", () => {
  for (const sync of [false, true]) for (const plays of [undefined, 0, 2]) {
    it(`${sync ? "sync" : "async"} writes one animation with plays=${plays ?? "default"}`, async () => {
      const { encodeImage } = await import("@poe-code/image-ast/portable");
      const { inflateSync } = await import("node:zlib");
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
      const input = encodeImage({ width: 1, height: 3, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(colors.flat()) }, { format: "gif", pageHeight: 1, delay: [200, 400, 200], loop: 2 }).data;
      const target = plays === undefined ? "/out.apng" : "/out.bin";
      const vfs = createTestVfs({ "/in.gif": input });
      const args = ["-v", "error", "-y", "-i", "/in.gif", ...(plays === undefined ? [] : ["-plays", String(plays), "-f", "apng"]), target];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else { const result = await runCmd(createFfmpegCommand(), args, vfs); assert.equal(result.exitCode, 0, result.stderr); }
      assert.deepEqual([...vfs.store.keys()], ["/in.gif", target]);
      const bytes = vfs.store.get(target)!;
      assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      const delays: number[] = [], pixels: number[][] = [], types: string[] = [];
      for (let offset = 8; offset < bytes.length;) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
        const length = view.getUint32(0), type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
        types.push(type);
        if (type === "acTL") { assert.equal(view.getUint32(8), 3); assert.equal(view.getUint32(12), plays ?? 1); }
        if (type === "fcTL") delays.push(view.getUint16(28) * 1000 / view.getUint16(30));
        if (type === "IDAT" || type === "fdAT") {
          const row = inflateSync(bytes.subarray(offset + (type === "IDAT" ? 8 : 12), offset + 8 + length));
          assert.ok(row[0]! <= 4); pixels.push([...row.subarray(1)]);
        }
        offset += length + 12;
      }
      assert.equal(types.filter(type => type === "acTL").length, 1);
      assert.equal(types.filter(type => type === "fdAT").length, 2);
      assert.deepEqual(delays, [200, 400, 400]);
      assert.deepEqual(pixels, colors);
    });
  }
  for (const value of ["-1", "1.5", "4294967296", "bad", ""]) it(`rejects APNG plays=${value} without replacing output`, async () => {
    const vfs = createTestVfs({ "/out.apng": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-plays", value, "/out.apng"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("plays"), result.stderr);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.apng")), "keep");
  });
});

// Construct the directory and DIB directly, independently of the ICO encoder.
describe("ICO video streams", () => {
  async function icon(kind: number, png: boolean) {
    const { encodeImage } = await import("@poe-code/image-ast/portable");
    const sizes = [16, 32, 64];
    const payloads = sizes.map((size, index) => {
      const data = new Uint8Array(size * size * 4);
      for (let p = 0; p < data.length; p += 4) { data[p + index] = 255; data[p + 3] = p ? 255 : 0; }
      if (png) return encodeImage({ width: size, height: size, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true }, { format: "png" }).data;
      const stride = Math.ceil(size / 32) * 4;
      const dib = new Uint8Array(40 + data.length + stride * size), view = new DataView(dib.buffer);
      view.setUint32(0, 40, true); view.setInt32(4, size, true); view.setInt32(8, size * 2, true);
      view.setUint16(12, 1, true); view.setUint16(14, 32, true);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const source = (y * size + x) * 4, target = 40 + ((size - y - 1) * size + x) * 4;
        dib.set([data[source + 2]!, data[source + 1]!, data[source]!, data[source + 3]!], target);
      }
      dib[40 + data.length + (size - 1) * stride] = 128;
      return dib;
    });
    const bytes = new Uint8Array(54 + payloads.reduce((sum, p) => sum + p.length, 0)), view = new DataView(bytes.buffer);
    view.setUint16(2, kind, true); view.setUint16(4, 3, true);
    let offset = 54;
    payloads.forEach((payload, index) => {
      const entry = 6 + index * 16;
      bytes[entry] = sizes[index]!; bytes[entry + 1] = sizes[index]!;
      view.setUint16(entry + 4, kind === 1 ? 1 : 3, true); view.setUint16(entry + 6, kind === 1 ? 32 : 7, true);
      view.setUint32(entry + 8, payload.length, true); view.setUint32(entry + 12, offset, true);
      bytes.set(payload, offset); offset += payload.length;
    });
    return bytes;
  }
  for (const kind of [1, 2]) for (const png of [true, false]) {
    for (const map of [undefined, "0:v:0", "0:v:1", "0:v:2", "0:1"]) {
      it(`selects ${map ?? "largest"} from ${png ? "PNG" : "DIB"} ${kind === 1 ? "ICO" : "CUR"}`, async () => {
        const { decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs({ "/input.bin": await icon(kind, png) });
        const result = await runCmd(createFfmpegCommand(), ["-i", "/input.bin", ...(map ? ["-map", map] : []), "/out.png"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const page = map ? Number(map.split(":").at(-1)) : 2;
        const image = decodeImage(vfs.store.get("/out.png")!);
        assert.equal(image.width, [16, 32, 64][page]); assert.equal(image.height, image.width);
        assert.equal(image.data[3], 0);
        assert.deepEqual([...image.data.slice(4, 8)], [page === 0 ? 255 : 0, page === 1 ? 255 : 0, page === 2 ? 255 : 0, 255]);
      });
    }
  }
  it("probes entries in directory order with their dimensions", async () => {
    const vfs = createTestVfs({ "/in.ico": await icon(1, true) });
    const result = await runCmd(createFfprobeCommand(), ["-show_streams", "-of", "json", "/in.ico"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const probe = JSON.parse(result.stdout);
    assert.deepEqual(probe.streams.map((stream: { width: number; height: number }) => [stream.width, stream.height]), [[16, 16], [32, 32], [64, 64]]);
  });
  for (const limits of [{ maxStreams: 2 }, { maxFrames: 2 }, { maxPixelsPerFrame: 1024 }, { maxMemoryBytes: 4096 }]) {
    it(`bounds icon decoding with ${JSON.stringify(limits)}`, async () => {
      const vfs = createTestVfs({ "/in.ico": await icon(1, false), "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-i", "/in.ico", "/out.png"], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  it("rejects malformed directories and missing streams without replacing output", async () => {
    const bytes = await icon(1, true);
    for (const [input, map] of [[bytes.slice(0, -1), "0:v:1"], [bytes, "0:v:3"]] as const) {
      const vfs = createTestVfs({ "/in.ico": input, "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.ico", "-map", map, "/out.png"], vfs);
      assert.notEqual(result.exitCode, 0); assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    }
  });
});


describe("GIF output loop counts", () => {
  it("resets the repeat count for each output", async () => {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "color=red:s=2x2:d=1:r=1", "-loop", "2", "/first.gif", "/second.gif"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    for (const [name, expected] of [["first", 2], ["second", 0]] as const) {
      const bytes = vfs.store.get(`/${name}.gif`)!;
      const at = Buffer.from(bytes).indexOf("NETSCAPE2.0");
      assert.ok(at >= 0);
      assert.equal(bytes[at + 13]! | bytes[at + 14]! << 8, expected);
    }
  });
  for (const source of ["png", "sequence", "copy", "input-loop"]) {
    for (const loop of [undefined, -1, 0, 1, 2, 65535]) {
      it(`writes native loop ${loop} from ${source}`, async () => {
        const { encodeImage } = await import("@poe-code/image-ast/portable");
        const image = { width: 2, height: 2, channels: 4 as const, format: "png" as const, space: "srgb" as const, depth: "uchar" as const, density: 72, hasAlpha: true, data: new Uint8Array(16).fill(255) };
        const png = encodeImage(image, { format: "png" }).data;
        const gif = encodeImage({ ...image, height: 4, data: new Uint8Array(32).fill(255) }, { format: "gif", pageHeight: 2, delay: [100, 200], loop: 8 }).data;
        const vfs = createTestVfs({ "/in.png": png.slice(), "/f0.png": png.slice(), "/f1.png": png.slice(), "/in.gif": gif });
        const input = source === "copy" ? ["-i", "/in.gif", "-c", "copy"]
          : source === "sequence" ? ["-framerate", "5", "-i", "/f%d.png"]
          : source === "input-loop" ? ["-loop", "1", "-i", "/in.png", "-frames:v", "2"] : ["-i", "/in.png"];
        const result = await runCmd(createFfmpegCommand(), [...input, ...(loop === undefined ? [] : ["-loop", String(loop)]), "/out.gif"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        const bytes = vfs.store.get("/out.gif")!;
        const at = Buffer.from(bytes).indexOf("NETSCAPE2.0");
        if (loop === -1) assert.equal(at, -1);
        else {
          assert.ok(at >= 0, "missing loop extension");
          assert.equal(bytes[at + 13]! | bytes[at + 14]! << 8, loop ?? 0);
        }
      });
    }
  }
  for (const loop of ["-2", "65536", "1.5", "no", ""]) {
    it(`rejects invalid output loop ${loop} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.gif": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "lavfi", "-i", "color=red:s=2x2:d=1", "-loop", loop, "/out.gif"], vfs);
      assert.equal(result.exitCode, 1);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.gif")), "keep");
    });
  }
});

describe("GIF final_delay", () => {
  for (const sync of [false, true]) for (const copy of [false, true]) for (const delay of [undefined, -1, 0, 57, 65535]) {
    it(`${sync ? "sync" : "async"} ${copy ? "copy" : "sequence"} final_delay=${delay}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const colors = [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]];
      const image = { width: 1, height: 3, channels: 4 as const, format: "png" as const, space: "srgb" as const, depth: "uchar" as const, density: 72, hasAlpha: true, data: Uint8Array.from(colors.flat()) };
      const vfs = createTestVfs({ "/in.gif": encodeImage(image, { format: "gif", pageHeight: 1, delay: [100, 200, 300] }).data });
      for (const [index, color] of colors.entries()) vfs.store.set(`/f${index}.png`, encodeImage({ ...image, height: 1, data: Uint8Array.from(color) }, { format: "png" }).data);
      const args = ["-y", ...(copy ? ["-i", "/in.gif", "-c:v", "copy"] : sync ? ["-i", "/in.gif"] : ["-framerate", "5", "-start_number", "0", "-i", "/f%d.png"]), ...(delay === undefined ? [] : ["-final_delay", String(delay)]), "/out.gif"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else { const result = await runCmd(createFfmpegCommand(), args, vfs); assert.equal(result.exitCode, 0, result.stderr); }
      const output = decodeImage(vfs.store.get("/out.gif")!, { animated: true });
      assert.deepEqual(output.delay, [...(copy || sync ? [100, 200] : [200, 200]), delay === undefined || delay < 0 ? (copy || sync ? 300 : 200) : delay * 10]);
      assert.deepEqual(output.data, image.data);
    });
  }
  for (const sync of [false, true]) for (const value of ["-2", "65536", "1.5", "bad", ""]) {
    it(`rejects invalid final_delay=${value} sync=${sync}`, async () => {
      const vfs = createTestVfs({ "/out.gif": "keep" });
      const args = ["-y", "-final_delay", value, "/out.gif"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), () => false), undefined);
      else { const result = await runCmd(createFfmpegCommand(), args, vfs); assert.notEqual(result.exitCode, 0); assert.ok(result.stderr.includes("final_delay"), result.stderr); }
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.gif")), "keep");
    });
  }
});


describe("GIF encoder flags", () => {
  for (const [flags, cropped, differenced] of [
    [undefined, true, true], ["-offsetting-transdiff", false, false],
    ["-offsetting", false, true], ["-transdiff", true, false],
    ["0", false, false], ["3", true, true],
    ["offsetting", true, false], ["transdiff", false, true]
  ] as const) {
    it(`encodes rectangles and transparent differences for ${flags ?? "defaults"}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(8 * 8 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const files: Record<string, Uint8Array> = {};
      const originals: Uint8Array[] = [];
      for (let frame = 0; frame < 3; frame++) {
        if (frame > 0) for (const x of [2, 4]) data.set([255, 255, 255, 255], ((frame + 1) * 8 + x) * 4);
        originals.push(data.slice());
        files[`/f${frame}.png`] = encodeImage({ width: 8, height: 8, data, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data;
      }
      const vfs = createTestVfs(files);
      const result = await runCmd(createFfmpegCommand(), ["-framerate", "5", "-i", "/f%d.png", ...(flags === undefined ? [] : ["-gifflags", flags]), "/out.gif"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const bytes = vfs.store.get("/out.gif")!;
      const image = decodeImage(bytes, { animated: true });
      assert.deepEqual(image.delay, [200, 200, 200]);
      assert.deepEqual(image.data, Uint8Array.from(originals.flatMap(frame => Array.from(frame))));
      for (let page = 1; page < 3; page++) {
        const patch = decodeImage(bytes, { page, coalesce: false });
        assert.deepEqual([patch.virtualCanvas!.x, patch.virtualCanvas!.y, patch.width, patch.height], cropped ? [2, page + 1, 3, 1] : [0, 0, 8, 8]);
        const unchanged = cropped ? 1 : 0;
        assert.equal(patch.data[unchanged * 4 + 3], differenced ? 0 : 255);
      }
    });
  }
  for (const value of ["", "unknown", "4", "-offsetting-nope"]) {
    it(`rejects invalid GIF flags ${value}`, async () => {
      const vfs = createTestVfs({ "/out.gif": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-gifflags", value, "/out.gif"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /gifflags/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.gif")), "keep");
    });
  }
});

describe("GIF global_palette", () => {
  for (const sync of [false, true]) for (const global of [undefined, 0, 1]) {
    it(`writes GIF color tables and preserves frames: global_palette=${global}, sync=${sync}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const data = new Uint8Array(8 * 8 * 3 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      for (const frame of [1, 2]) data.fill(255, (frame * 64 + 4 * 8 + 3) * 4, (frame * 64 + 4 * 8 + 3) * 4 + 4);
      data.fill(255, (2 * 64 + 2 * 8 + 5) * 4, (2 * 64 + 2 * 8 + 5) * 4 + 4);
      const image = { width: 8, height: 24, channels: 4 as const, format: "png" as const, space: "srgb" as const, depth: "uchar" as const, density: 72, hasAlpha: false, data };
      const vfs = createTestVfs({ "/in.gif": encodeImage(image, { format: "gif", pageHeight: 8, delay: 200 }).data });
      for (let i = 0; i < 3; i++) vfs.store.set(`/f${i}.png`, encodeImage({ ...image, height: 8, data: data.subarray(i * 256, (i + 1) * 256) }, { format: "png" }).data);
      const args = [...(sync ? ["-i", "/in.gif"] : ["-framerate", "5", "-start_number", "0", "-i", "/f%d.png"]), ...(global === undefined ? [] : ["-global_palette", String(global)]), "/out.gif"];
      if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path), (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      else { const result = await runCmd(createFfmpegCommand(), args, vfs); assert.equal(result.exitCode, 0, result.stderr); }
      const bytes = vfs.store.get("/out.gif")!;
      assert.equal(Boolean(bytes[10]! & 128), global !== 0);
      let at = 13 + (bytes[10]! & 128 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0), frames = 0;
      while (bytes[at] !== 59) {
        const block = bytes[at++];
        if (block === 33) at++;
        else {
          assert.equal(block, 44);
          const flags = bytes[at + 8]!;
          assert.equal(Boolean(flags & 128), global === 0);
          frames++;
          at += 9 + (flags & 128 ? 3 * (1 << ((flags & 7) + 1)) : 0) + 1;
        }
        while (bytes[at]) at += bytes[at]! + 1;
        at++;
      }
      assert.equal(frames, 3);
      const decoded = decodeImage(bytes, { animated: true });
      assert.deepEqual(decoded.delay, [200, 200, 200]);
      assert.deepEqual(decoded.data, data);
    });
  }
  for (const value of ["-1", "2", "bad", ""]) it(`rejects invalid global_palette=${value} without overwriting output`, async () => {
    const vfs = createTestVfs({ "/out.gif": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-global_palette", value, "/out.gif"], vfs);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("global_palette"));
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.gif")), "keep");
  });
});


describe("GIF input ignore_loop", () => {
  it("preserves timestamps across repeats and keeps output loop independent", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({ width: 1, height: 3, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: new Uint8Array(12).fill(255) }, { format: "gif", pageHeight: 1, delay: [100, 200, 300], loop: 0 }).data;
    const vfs = createTestVfs({ "/in.gif": input });
    const result = await runCmd(createFfmpegCommand(), ["-ignore_loop", "0", "-i", "/in.gif", "-t", "1.2", "-fps_mode", "passthrough", "-loop", "4", "/out.gif"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const output = decodeImage(vfs.store.get("/out.gif")!, { animated: true });
    assert.equal(output.pages, 6);
    assert.equal(output.loop, 5);
    assert.deepEqual(output.delay, [100, 200, 300, 100, 200, 300]);
    const unbounded = await runCmd(createFfmpegCommand(), ["-ignore_loop", "0", "-i", "/in.gif", "/unbounded.gif"], vfs);
    assert.equal(unbounded.exitCode, 1);
    assert.match(unbounded.stderr, /finite frame count or duration/);
    assert.equal(vfs.store.has("/unbounded.gif"), false);
  });
  it("resets ignore_loop for the next input", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const input = encodeImage({ width: 1, height: 2, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]) }, { format: "gif", pageHeight: 1, delay: [100, 200], loop: 0 }).data;
    const vfs = createTestVfs({ "/in.gif": input });
    const result = await runCmd(createFfmpegCommand(), ["-ignore_loop", "0", "-t", "0.6", "-i", "/in.gif", "-i", "/in.gif", "-map", "1:v", "-fps_mode", "passthrough", "/out.gif"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(decodeImage(vfs.store.get("/out.gif")!, { animated: true }).pages, 2);
  });
  for (const args of [["-ignore_loop", "2", "-i", "/in.gif"], ["-i", "/in.gif", "-ignore_loop", "0"]]) {
    it(`rejects invalid or misplaced input option: ${args.join(" ")}`, async () => {
      const vfs = createTestVfs({ "/out.gif": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", ...args, "/out.gif"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /-ignore_loop requires/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.gif")), "keep");
    });
  }
  for (const [loop, ignore, frames, expected] of [
    [3, undefined, 6, 3], [3, "1", 6, 3], [3, "0", 6, 6],
    [3, "0", 20, 6], [0, "0", 7, 7], [1, "0", 6, 3]
  ] as const) {
    it(`reads loop=${loop}, ignore_loop=${ignore}, frames=${frames}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const colors = [[0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]];
      const input = encodeImage({ width: 1, height: 3, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data: Uint8Array.from(colors.flat()) }, { format: "gif", pageHeight: 1, delay: [100, 200, 300], loop }).data;
      const vfs = createTestVfs({ "/in.gif": input });
      const result = await runCmd(createFfmpegCommand(), [...(ignore === undefined ? [] : ["-ignore_loop", ignore]), "-i", "/in.gif", "-frames:v", String(frames), "-fps_mode", "passthrough", "/f%02d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(vfs.store.size, expected + 1);
      for (let index = 0; index < expected; index++) {
        assert.deepEqual(Array.from(decodeImage(vfs.store.get(`/f${String(index + 1).padStart(2, "0")}.png`)!).data), colors[index % 3]);
      }
    });
  }
});


describe("GIF input timing options", () => {
  for (const options of [[], ["-min_delay", "1"], ["-default_delay", "35"], ["-max_gif_delay", "15"]]) {
    it(`preserves native decoded timing and pixels for ${options.join(" ") || "control"}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast");
      const data = new Uint8Array(8 * 8 * 3 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      for (const frame of [1, 2]) data.fill(255, (frame * 64 + 4 * 8 + 3) * 4, (frame * 64 + 4 * 8 + 3) * 4 + 3);
      data.fill(255, (2 * 64 + 2 * 8 + 5) * 4, (2 * 64 + 2 * 8 + 5) * 4 + 3);
      const input = encodeImage({ width: 8, height: 24, channels: 4, format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true, data }, { format: "gif", pageHeight: 8, delay: [10, 200, 300], loop: 2 }).data;
      const vfs = createTestVfs({ "/short.gif": input });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", ...options, "-i", "/short.gif", "-vf", "fps=100", "-frames:v", "75", "/f%02d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const frames = [...vfs.store.entries()].filter(([name]) => name.endsWith(".png"));
      assert.equal(frames.length, 51);
      for (const [index, [, bytes]] of frames.entries()) {
        const frame = index < 1 ? 0 : index < 21 ? 1 : 2;
        assert.deepEqual(decodeImage(bytes).data, data.slice(frame * 256, (frame + 1) * 256));
      }
    });
  }
  for (const [option, max] of [["-min_delay", 6000], ["-default_delay", 6000], ["-max_gif_delay", 65535]] as const) {
    for (const value of ["", "bad", "-1", String(max + 1), "1.5"]) {
      it(`rejects ${option}=${value} without replacing output`, async () => {
        const vfs = createTestVfs({ "/out.png": "keep" });
        const result = await runCmd(createFfmpegCommand(), ["-y", option, value, "-i", "/in.gif", "/out.png"], vfs);
        assert.equal(result.exitCode, 1);
        assert.ok(result.stderr.includes(option));
        assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
      });
    }
    it(`rejects output-side ${option}`, async () => {
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.gif", option, "1", "/out.png"], createTestVfs());
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(option));
    });
  }
});

describe("WAV pipe lengths", () => {
  for (const target of ["pipe:1", "pipe:", "-", "/dev/stdout", "/dev/fd/1", "/out.wav"]) {
    for (const codec of ["copy", "pcm_s16le"]) {
      for (const bitexact of [false, true]) {
        it(`${target} ${codec} bitexact=${bitexact} preserves PCM and marks only pipe lengths unknown`, async () => {
          const input = Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64");
          const vfs = createTestVfs({ "/in.wav": input });
          const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-i", "/in.wav", "-c:a", codec,
            ...(bitexact ? ["-bitexact"] : []), "-f", "wav", target], vfs);
          assert.equal(result.exitCode, 0, result.stderr);
          const file = target === "/out.wav";
          const bytes = Buffer.from(file ? vfs.store.get(target)! : result.stdoutBytes);
          assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
          assert.equal(bytes.readUInt32LE(4), file ? bytes.length - 8 : 0xffffffff);
          assert.equal(bytes.toString("ascii", 8, 12), "WAVE");
          let offset = 12;
          while (offset + 8 <= bytes.length && bytes.toString("ascii", offset, offset + 4) !== "data") {
            const length = bytes.readUInt32LE(offset + 4);
            offset += 8 + length + length % 2;
          }
          assert.equal(bytes.toString("ascii", offset, offset + 4), "data");
          assert.equal(bytes.readUInt32LE(offset + 4), file ? 10 : 0xffffffff);
          assert.equal(bytes.subarray(offset + 8).toString("hex"), "008000ff00000001007f");
        });
      }
    }
  }
});

describe("waveform", () => {
  for (const [filter, limits, error] of [
    ["waveform=unknown=1", {}, "waveform: options"],
    ["waveform", { maxPixelsPerFrame: 1024 }, "maxPixelsPerFrame"]
  ] as const) {
    it(`preserves existing output when rejected: ${error}`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand({ limits }), ["-y", "-f", "lavfi", "-i",
        "color=red:s=16x16:d=0.04", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes(error), result.stderr);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  it("accumulates repeated values and saturates the plotted component", async () => {
    const { decodeImage } = await import("@poe-code/image-ast/portable");
    for (const height of [2, 30]) {
      const vfs = createTestVfs();
      const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i",
        `color=red:s=2x${height}:d=0.04`, "-vf", "waveform", "/out.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = decodeImage(vfs.store.get("/out.png")!);
      assert.deepEqual(Array.from(output.data.slice(16, 20)), [Math.min(255, height * 10), 0, 0, 255]);
      assert.deepEqual(Array.from(output.data.slice(8, 12)), [0, 0, 0, 255]);
    }
  });
  it("renders each RGB frame with native FFmpeg waveform pixels", async () => {
    const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
    const vfs = createTestVfs();
    for (let t = 0; t < 2; t++) {
      const data = new Uint8Array(32 * 24 * 4);
      for (let y = 0; y < 24; y++) {
        for (let x = 0; x < 32; x++) {
          data.set([(7 * x + 3 * y + 87 * t) % 256, (2 * x + 9 * y + 53 * t) % 256,
            (4 * x + 11 * y + 23 * t) % 256, 255], (y * 32 + x) * 4);
        }
      }
      vfs.store.set(`/f${t}.png`, encodeImage({ width: 32, height: 24, data,
        format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false }, { format: "png" }).data);
    }
    const result = await runCmd(createFfmpegCommand(), ["-framerate", "5", "-i", "/f%d.png", "-vf", "waveform", "/o%d.png"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const hashes = ["0518a77c01716614881287b2d9035be2", "661afaebd874f681e7c969cc1999ce96"];
    for (let i = 0; i < 2; i++) {
      const output = decodeImage(vfs.store.get(`/o${i + 1}.png`)!);
      assert.equal(output.width, 32);
      assert.equal(output.height, 256);
      const rgb = output.data.filter((_, index) => index % 4 !== 3);
      assert.equal(createHash("md5").update(rgb).digest("hex"), hashes[i]);
    }
    assert.equal(vfs.store.has("/o3.png"), false);
  });
});

describe("fps timestamp rounding", () => {
  for (const [options, expected] of [
    ["2", [40, 80]],
    ["2:round=near", [40, 80]],
    ["2:round=down", [60, 100]],
    ["2:round=zero", [60, 100]],
    ["2:round=up", [20, 60, 120]],
    ["2:round=inf", [20, 60, 120]]
  ] as const) {
    it(`selects native frames for fps=${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 0; i < 6; i++) {
        const gray = (i + 1) * 20;
        vfs.store.set(`/in${i + 1}.png`, encodeImage({
          width: 1, height: 1, data: new Uint8Array([gray, gray, gray, 255]),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "5", "-i", "/in%d.png", "-vf", `fps=${options}`, "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const outputs = [...vfs.store.keys()].filter(path => path.startsWith("/out"))
        .sort((a, b) => Number(a.slice(4, -4)) - Number(b.slice(4, -4)));
      assert.equal(outputs.length, expected.length);
      assert.deepEqual(outputs.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
    });
  }
});

describe("showinfo", () => {
  for (const filter of ["showinfo", "showinfo=checksum=0", "showinfo=0", "null,showinfo,null"]) {
    it(`reports native RGB frame timing and preserves pixels for ${filter}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const frames = [0, 1].map(t => Uint8Array.from(Array.from({ length: 32 * 24 }, (_, i) => {
        const x = i % 32, y = Math.floor(i / 32);
        return [(7*x+3*y+87*t)%256, (2*x+9*y+53*t)%256, (4*x+11*y+23*t)%256, 255];
      }).flat()));
      const files = Object.fromEntries(frames.map((data, i) => [`/f${i}.png`, encodeImage({
        width: 32, height: 24, data, format: "png", space: "srgb", channels: 4,
        depth: "uchar", density: 72, hasAlpha: false
      }, { format: "png", pngColorType: 2 }).data]));
      const vfs = createTestVfs(files);
      const result = await runCmd(createFfmpegCommand(), ["-v", "info", "-framerate", "5", "-i", "/f%d.png", "-vf", filter, "/o%d.png"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const lines = result.stderr.split("\n").filter(line => line.includes("pts_time:"));
      assert.equal(lines.length, 2, result.stderr);

      for (const [i, line] of lines.entries()) {
        assert.match(line, new RegExp(`n:\\s*${i} pts:\\s*${i} pts_time:${i / 5}`));
        assert.match(line, /duration:\s*1 duration_time:0.2/);
        assert.match(line, /fmt:rgb24.*s:32x24/);
        if (filter.endsWith("0")) assert.doesNotMatch(line, /checksum|mean:|stdev:/);
        else {
          const checksum = ["321C913C", "3C5DA93C"][i];
          assert.ok(line.includes(`checksum:${checksum} plane_checksum:[${checksum}]`), line);
          assert.ok(line.includes(`mean:[${[130, 133][i]}] stdev:[${["69.0", "75.1"][i]}]`), line);
        }
        assert.deepEqual(decodeImage(vfs.store.get(`/o${i + 1}.png`)!).data, frames[i]);
      }
    });
  }
  it("reports dimensions and timestamps at its position in the chain", async () => {
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", "color=red:s=4x4:d=0.04", "-vf", "showinfo,scale=2:2,setpts=PTS+1,showinfo", "/out.png"], createTestVfs());
    assert.equal(result.exitCode, 0, result.stderr);
    const lines = result.stderr.split("\n").filter(line => line.includes("pts_time:"));
    assert.equal(lines.length, 2);
    assert.match(lines[0]!, /pts_time:0 .*s:4x4/);
    assert.match(lines[1]!, /pts:1 .*s:2x2/);
  });
  for (const filter of ["showinfo=checksum=2", "showinfo=unknown=1", "showinfo=1:0"]) {
    it(`rejects ${filter} without replacing output`, async () => {
      const vfs = createTestVfs({ "/out.png": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-f", "lavfi", "-i", "color=red:s=2x2:d=0.04", "-vf", filter, "/out.png"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /showinfo: checksum must be a boolean/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "keep");
    });
  }
  it("suppresses info diagnostics at error log level", async () => {
    const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-f", "lavfi", "-i", "color=red:s=2x2:d=0.04", "-vf", "showinfo", "/out.png"], createTestVfs());
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
  });
});

describe("fps end-of-file action", () => {
  for (const [options, expected] of [
    ["0.25", []],
    ["0.25:eof_action=round", []],
    ["0.25:eof_action=pass", [120]],
    ["2", [40, 80]],
    ["2:eof_action=round", [40, 80]],
    ["2:eof_action=0", [40, 80]],
    ["2:eof_action=pass", [40, 80, 120]],
    ["2:eof_action=1", [40, 80, 120]],
    ["2:0:near:pass", [40, 80, 120]],
    ["5:eof_action=pass", [20, 40, 60, 80, 100, 120]]
  ] as const) {
    it(`selects native frames for fps=${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 0; i < 6; i++) {
        const gray = (i + 1) * 20;
        vfs.store.set(`/in${i + 1}.png`, encodeImage({
          width: 1, height: 1, data: new Uint8Array([gray, gray, gray, 255]),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "5", "-i", "/in%d.png", "-vf", `fps=${options}`, "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const outputs = [...vfs.store.keys()].filter(path => path.startsWith("/out"))
        .sort((a, b) => Number(a.slice(4, -4)) - Number(b.slice(4, -4)));
      assert.equal(outputs.length, expected.length);
      assert.deepEqual(outputs.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
    });
  }
});

describe("trim time validation", () => {
  for (const option of ["start", "end", "duration", "starti", "endi", "durationi"]) {
    for (const value of ["bogus", "1bogus", "NaN", "Infinity", "", "1e3", "0x10"]) {
      it(`rejects ${option}=${value} before writing output`, async () => {
        const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
        const vfs = createTestVfs();
        for (let i = 1; i <= 6; i++) {
          vfs.store.set(`/in${i}.png`, encodeImage({ width: 1, height: 1,
            data: Uint8Array.from([i * 20, i * 20, i * 20, 255]),
            format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
        }
        const previous = vfs.store.get("/in6.png")!.slice();
        vfs.store.set("/out1.png", previous.slice());
        const result = await runCmd(createFfmpegCommand(), [
          "-y", "-framerate", "4", "-i", "/in%d.png", "-vf", `trim=${option}=${value}`, "/out%d.png"
        ], vfs);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes(`trim: invalid ${option.endsWith("i") ? option.slice(0, -1) : option}`), result.stderr);
        assert.deepEqual(vfs.store.get("/out1.png"), previous);
        const output = [...vfs.store.keys()].filter(path => path.startsWith("/out"));
        assert.deepEqual(output, ["/out1.png"]);
        assert.deepEqual(output.map(path => decodeImage(vfs.store.get(path)!).data[0]), [120]);
      });
    }
  }
  for (const [options, expected] of [
    ["start=0.5:end=1", [60, 80]],
    ["start=500ms:duration=500000us", [60, 80]],
    ["0.5", [60, 80, 100, 120]],
    ["start=-1:end=0.5", [20, 40]],
    ["", [20, 40, 60, 80, 100, 120]]
  ] as const) {
    it(`accepts valid trim ${options}`, async () => {
      const { encodeImage, decodeImage } = await import("@poe-code/image-ast/portable");
      const vfs = createTestVfs();
      for (let i = 1; i <= 6; i++) {
        vfs.store.set(`/in${i}.png`, encodeImage({ width: 1, height: 1,
          data: Uint8Array.from([i * 20, i * 20, i * 20, 255]),
          format: "png", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false
        }, { format: "png" }).data);
      }
      const result = await runCmd(createFfmpegCommand(), [
        "-framerate", "4", "-i", "/in%d.png", "-vf", options ? `trim=${options}` : "trim",
        "-fps_mode", "passthrough", "/out%d.png"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const output = [...vfs.store.keys()].filter(path => path.startsWith("/out")).sort();
      assert.deepEqual(output.map(path => decodeImage(vfs.store.get(path)!).data[0]), expected);
    });
  }
});

describe("raw PCM input sample_rate option", () => {
  for (const synchronous of [false, true]) {
    for (const rateOption of ["-ar", "-sample_rate"]) {
      it(`preserves stereo frames with ${rateOption} (sync=${synchronous})`, async () => {
        const samples = [100, -200, 300, -400, 500, -600];
        const input = new Uint8Array(samples.length * 2);
        const view = new DataView(input.buffer);
        samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
        const vfs = createTestVfs({ "/in.raw": input });
        const args = ["-hide_banner", "-v", "error", "-y", "-f", "s16le", rateOption, "8000",
          "-ac", "2", "-i", "/in.raw", "-c:a", "pcm_s16le", "/out.wav"];
        if (synchronous) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, data) => { vfs.store.set(path, data); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, 2);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => Math.round(value * 32768))),
          [[100, 300, 500], [-200, -400, -600]]);
      });
    }
  }
});


describe("raw PCM input channel layout options", () => {
  for (const option of ["-ch_layout", "-channel_layout"]) {
    it(`scopes ${option} to the next input`, async () => {
      const input = new Uint8Array([100, 0, 200, 0, 44, 1, 144, 1]);
      const vfs = createTestVfs({ "/in.raw": input });
      const result = await runCmd(createFfmpegCommand(), [
        "-f", "s16le", "-ar", "8000", option, "stereo", "-i", "/in.raw",
        "-f", "s16le", "-i", "/in.raw", "-map", "1:a", "-c:a", "pcm_s16le", "/out.wav"
      ], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 44100);
      assert.equal(audio.channels, 1);
      assert.deepEqual(Array.from(audio.channelData[0]!, value => Math.round(value * 32768)), [100, 200, 300, 400]);
    });
  }
  for (const synchronous of [false, true]) {
    for (const option of ["-ac", "-ch_layout", "-channel_layout"]) {
      for (const channels of [1, 2]) {
        it(`preserves ${channels} channels with ${option} (sync=${synchronous})`, async () => {
          const samples = [100, -200, 300, -400, 500, -600];
          const input = new Uint8Array(samples.length * 2);
          const view = new DataView(input.buffer);
          samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
          const vfs = createTestVfs({ "/in.raw": input });
          const args = ["-hide_banner", "-v", "error", "-y", "-f", "s16le", "-ar", "8000",
            option, option === "-ac" ? String(channels) : channels === 1 ? "mono" : "stereo",
            "-i", "/in.raw", "-c:a", "pcm_s16le", "/out.wav"];
          if (synchronous) {
            assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
              (path, data) => { vfs.store.set(path, data); return true; }), "");
          } else {
            const result = await runCmd(createFfmpegCommand(), args, vfs);
            assert.equal(result.exitCode, 0, result.stderr);
          }
          const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
          assert.equal(audio.sampleRate, 8000);
          assert.equal(audio.channels, channels);
          assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => Math.round(value * 32768))),
            channels === 1 ? [samples] : [[100, 300, 500], [-200, -400, -600]]);
        });
      }
    }
  }
});


describe("raw PCM skip_initial_bytes", () => {
  for (const synchronous of [false, true]) {
    for (const skip of [undefined, 0, 4]) {
      it(`decodes exact stereo samples after skipping ${skip ?? "no"} bytes (sync=${synchronous})`, async () => {
        const samples = [100, -200, 300, -400, 500, -600];
        const input = new Uint8Array(samples.length * 2);
        const view = new DataView(input.buffer);
        samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
        const vfs = createTestVfs({ "/in.raw": input });
        const args = ["-hide_banner", "-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2",
          ...(skip === undefined ? [] : ["-skip_initial_bytes", String(skip)]),
          "-i", "/in.raw", "-c:a", "pcm_s16le", "/out.wav"];
        if (synchronous) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
            (path, data) => { vfs.store.set(path, data); return true; }), "");
        } else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, 2);
        assert.equal(audio.channelData[0]!.length, skip === 4 ? 2 : 3);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, value => Math.round(value * 32768))),
          skip === 4 ? [[300, 500], [-400, -600]] : [[100, 300, 500], [-200, -400, -600]]);
      });
    }
  }
});


describe("skip_initial_bytes input scope", () => {
  it("resets the offset for the next input", async () => {
    const bytes = Uint8Array.from([100, 0, 200, 0, 44, 1]);
    const vfs = createTestVfs({ "/first.raw": bytes.slice(), "/second.raw": bytes.slice() });
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "s16le", "-skip_initial_bytes", "2", "-i", "/first.raw",
      "-f", "s16le", "-i", "/second.raw", "-map", "1:a", "-c:a", "pcm_s16le", "/out.wav"
    ], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/out.wav")!).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 44100);
    assert.deepEqual(Array.from(audio.channelData[0]!, value => Math.round(value * 32768)), [100, 200, 300]);
  });

  for (const value of ["-1", "1.5", "no", "Infinity"]) {
    it(`rejects invalid offset ${value} without replacing output`, async () => {
      const original = Uint8Array.from([1, 2, 3]);
      const vfs = createTestVfs({ "/in.raw": new Uint8Array(12), "/out.wav": original });
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-f", "s16le", "-skip_initial_bytes", value, "-i", "/in.raw", "/out.wav"
      ], vfs);
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /skip_initial_bytes/);
      assert.deepEqual(vfs.store.get("/out.wav"), original);
    });
  }
});


describe("rawvideo output", () => {
  const planes = Uint8Array.from([0x10, 0x30, 0x50, 0x70, 0x80, 0x90, 0x90, 0xb0, 0xd0, 0xeb, 0x40, 0x48]);
  const fixture = () => concatBytes([new TextEncoder().encode("YUV4MPEG2 W2 H2 F2:1 Ip A1:1 C420jpeg\nFRAME\n"), planes.slice(0, 6), new TextEncoder().encode("FRAME\n"), planes.slice(6)]);
  for (const target of ["-", "/out.raw"]) {
    for (const codec of [[], ["-c:v", "copy"], ["-c:v", "rawvideo"]]) {
      it(`writes exact YUV planes to ${target} with ${codec.join(" ") || "default codec"}`, async () => {
        const vfs = createTestVfs({ "/in.y4m": fixture() });
        const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-y", "-i", "/in.y4m", ...codec, "-f", "rawvideo", target], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.deepEqual(target === "-" ? result.stdoutBytes : vfs.store.get(target), planes);
      });
    }
  }
  for (const args of [["-pix_fmt", "nv12"], ["-c:v", "libx264"]]) {
    it(`rejects unsupported encoding ${args.join(" ")} without replacing output`, async () => {
      const vfs = createTestVfs({ "/in.y4m": fixture(), "/out.raw": "keep" });
      const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/in.y4m", ...args, "-f", "rawvideo", "/out.raw"], vfs);
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /Unsupported rawvideo/);
      assert.equal(new TextDecoder().decode(vfs.store.get("/out.raw")), "keep");
    });
  }
  it("checks output limits before writing", async () => {
    const result = await runCmd(createFfmpegCommand({ limits: { maxOutputBytes: 11 } }), ["-i", "/in.y4m", "-f", "rawvideo", "-"], createTestVfs({ "/in.y4m": fixture() }));
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /maxOutputBytes/);
    assert.equal(result.stdoutBytes.length, 0);
  });
  it("honors the output frame limit", async () => {
    const result = await runCmd(createFfmpegCommand(), ["-i", "/in.y4m", "-frames:v", "1", "-f", "rawvideo", "-"], createTestVfs({ "/in.y4m": fixture() }));
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, planes.slice(0, 6));
  });
});


describe("rawvideo AVI packets", () => {
  // Independently constructed 3x2 BI_RGB AVI, with two bottom-up padded rows per packet.
  const u32 = (value: number) => { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, true); return bytes; };
  const text = (value: string) => new TextEncoder().encode(value);
  const chunk = (id: string, bytes: Uint8Array) => concatBytes([text(id), u32(bytes.length), bytes]);
  const packets = Array.from({ length: 4 }, (_, frame) => Uint8Array.from(Array.from({ length: 24 }, (_, i) => frame * 40 + i)));
  const header = new Uint8Array(56);
  header.set(text("vids"));
  header.set(u32(1), 20); header.set(u32(2), 24); header.set(u32(4), 32);
  const bitmap = concatBytes([u32(40), u32(3), u32(2), Uint8Array.of(1, 0, 24, 0), u32(0), u32(24), new Uint8Array(16)]);
  const input = chunk("RIFF", concatBytes([text("AVI "), chunk("LIST", concatBytes([text("hdrl"), chunk("LIST", concatBytes([text("strl"), chunk("strh", header), chunk("strf", bitmap)]))])), chunk("LIST", concatBytes([text("movi"), ...packets.map(packet => chunk("00db", packet))]))]));
  for (const copy of [true, false]) {
    it(copy ? "preserves padded packets during stream copy" : "encodes packed RGB without padding", async () => {
      const result = await runCmd(createFfmpegCommand(), ["-i", "/in.avi", "-c:v", copy ? "copy" : "rawvideo", "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], createTestVfs({ "/in.avi": input.slice() }));
      assert.equal(result.exitCode, 0, result.stderr);
      const expected = copy ? concatBytes(packets) : Uint8Array.from(packets.flatMap(packet => [12, 15, 18, 0, 3, 6].flatMap(offset => [packet[offset + 2]!, packet[offset + 1]!, packet[offset]!] )));
      assert.deepEqual(result.stdoutBytes, expected);
    });
  }
});

describe("Y4M frame marker validation", () => {
  for (const markers of [["FRAME", "FRAME"], ["WRONG", "WRONG"], ["FRAME", "WRONG", "FRAME"], ["FRAME Xtag=1", "FRAME"]]) {
    it(`copies only frames before an invalid marker: ${markers.join(", ")}`, async () => {
      const encode = (text: string) => new TextEncoder().encode(text);
      const header = encode("YUV4MPEG2 W2 H2 F25:1 Ip A1:1 C420jpeg\n");
      const input = concatBytes([header, ...markers.flatMap((marker, i) => [encode(`${marker}\n`), new Uint8Array(6).fill(128 + i * 16)])]);
      const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-y", "-i", "/in.y4m", "-c:v", "copy", "-f", "yuv4mpegpipe", "-"], createTestVfs({ "/in.y4m": input }));
      const invalid = markers.indexOf("WRONG");
      const count = invalid < 0 ? markers.length : invalid;
      if (invalid >= 0) {
        assert.equal(evalSyncFfmpeg(["-i", "/in.y4m", "-c:v", "copy", "-f", "yuv4mpegpipe", "-"], undefined, () => input), undefined);
      }
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr.includes("Error during demuxing: Invalid data found when processing input"), invalid >= 0);
      const headerEnd = result.stdoutBytes.indexOf(10) + 1;
      assert.ok(new TextDecoder().decode(result.stdoutBytes.subarray(0, headerEnd)).includes("C420jpeg"));
      assert.deepEqual(result.stdoutBytes.subarray(headerEnd), concatBytes(Array.from({ length: count }, (_, i) => concatBytes([encode("FRAME\n"), new Uint8Array(6).fill(128 + i * 16)]))));
    });
  }
});

for (const expression of ["1/0", "-inf", "inf", "-1/0", "1/0,volume=0", "1/0:eval=frame"]) {
  it(`matches FFmpeg 7.0.2 infinite volume=${expression} on PCM16 output`, async () => {
    const samples = [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767];
    const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });
    const vfs = createTestVfs({ "/input.wav": input });
    const result = await runCmd(createFfmpegCommand(), ["-v", "error", "-y", "-i", "/input.wav",
      "-af", `volume=${expression}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!, value => value * 32768), samples.map(() => 0));
  });
}

describe("video frame limit operand validation", () => {
  for (const option of ["-frames:v", "-vframes"]) {
    for (const value of ["2garbage", "1.5", "hello", ""]) for (const existing of [false, true]) {
      it(`rejects ${option} ${JSON.stringify(value)} (existing=${existing})`, async () => {
        const vfs = createTestVfs({
          "/in.mp4": createSyntheticMp4({ frameCount: 5, includeAudio: false }),
          ...(existing ? { "/out.mp4": "EXISTING" } : {})
        });
        const before = vfs.store.get("/out.mp4")?.slice();
        const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", option, value, "/out.mp4"];
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /invalid frame limit/);
        assert.deepEqual(vfs.store.get("/out.mp4"), before);
        assert.equal(vfs.store.has("/out.mp4"), existing);
      });
    }
    it(`accepts ${option} 2 and preserves the first two packets`, async () => {
      const input = createSyntheticMp4({ frameCount: 5, includeAudio: false });
      const vfs = createTestVfs({ "/in.mp4": input, "/out.mp4": "EXISTING" });
      const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", option, "2", "/out.mp4"];
      const result = await runCmd(createFfmpegCommand(), args, vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(input).tracks[0]!.samples.slice(0, 2).map(sample => sample.data));
    });
  }
});

describe("input display_rotation scope", () => {
  for (const rotatedInput of [0, 1]) {
    for (const selectedInput of [0, 1]) {
      it(`rotates input ${rotatedInput} while mapping input ${selectedInput}`, async () => {
        const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 2 }) });
        const args = [0, 1].flatMap(input => [
          ...(input === rotatedInput ? ["-display_rotation", "-90"] : []), "-i", "/in.mp4"
        ]);
        const result = await runCmd(createFfmpegCommand(),
          [...args, "-map", `${selectedInput}:v`, "-c:v", "copy", "/out.mp4"], vfs);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!.rotation,
          rotatedInput === selectedInput ? 90 : 0);
      });
    }
  }

  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} keeps the second input's rotation off the automatic first input`, async () => {
      const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 2 }) });
      const args = ["-i", "/in.mp4", "-display_rotation", "-90", "-i", "/in.mp4", "-c:v", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      assert.equal(parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!.rotation, 0);
    });

    it(`${sync ? "sync" : "async"} rejects display_rotation without a following input`, async () => {
      const vfs = createTestVfs({ "/in.mp4": createSyntheticMp4({ frameCount: 2 }) });
      const args = ["-i", "/in.mp4", "-display_rotation", "90", "-c:v", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          () => { assert.fail("must not write output"); }), undefined);
      } else {
        const result = await runCmd(createFfmpegCommand(), args, vfs);
        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr, /display_rotation must precede an input/);
      }
      assert.equal(vfs.store.has("/out.mp4"), false);
    });
  }
});


describe("H.264 filter_units", () => {
  for (const sync of [false, true]) {
    for (const filter of ["null", "filter_units=remove_types=6", "filter_units=remove_types=6|9", "filter_units=remove_types=6-9", "h264_metadata=aud=insert,filter_units=remove_types=6", "h264_metadata=aud=insert,filter_units=remove_types=6|9"]) {
      it(`filters packet bytes with ${filter} (sync=${sync})`, async () => {
        const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 4 }));
        const track = doc.tracks[0]!;
        const sei = new Uint8Array([0, 0, 0, 4, 6, 0, 0, 128]);
        const input = serializeMp4({ ...doc, tracks: [{ ...track, samples: track.samples.map((sample, i) => ({
          ...sample, data: i === 0 ? concatBytes([sei, sample.data]) : sample.data
        })) }] });
        const vfs = createTestVfs({ "/in.mp4": input });
        const args = ["-i", "/in.mp4", "-c:v", "copy", "-bsf:v", filter, "/out.mp4"];
        if (sync) assert.equal(evalSyncFfmpeg(args, undefined, path => vfs.store.get(path),
          (path, bytes) => { vfs.store.set(path, bytes); return true; }), "");
        else {
          const result = await runCmd(createFfmpegCommand(), args, vfs);
          assert.equal(result.exitCode, 0, result.stderr);
        }
        const output = parseMp4(vfs.store.get("/out.mp4")!).tracks[0]!;
        assert.equal(output.samples.length, track.samples.length);
        for (const [i, sample] of output.samples.entries()) {
          const prefix = filter === "null" && i === 0 ? sei
            : filter === "h264_metadata=aud=insert,filter_units=remove_types=6" ? new Uint8Array([0, 0, 0, 2, 9, 240]) : new Uint8Array();
          assert.deepEqual(sample.data, concatBytes([prefix, track.samples[i]!.data]));
          assert.equal(sample.duration, track.samples[i]!.duration);
        }
      });
    }
  }
});
