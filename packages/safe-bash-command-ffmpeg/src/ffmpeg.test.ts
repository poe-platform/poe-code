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

describe("-abort_on empty_output", () => {
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
      assert.equal(result.exitCode, secondOutput ? 0 : 234, result.stderr);
      assert.ok(vfs.store.has("/empty.wav"));
    }
  });
});

describe("per-frame audio checksums", () => {
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
  it("rejects unknown digest algorithms without replacing a file", async () => {
    const vfs = createTestVfs({ "/i.wav": encodeWav({ sampleRate: 8000, channels }), "/digest.txt": "keep" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/i.wav", "-f", "hash", "-hash", "invalid", "/digest.txt"], vfs);
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
    for (const options of [[], ["-ac", "-1"], ["-ac", "0"], ["-ac", "1"]]) {
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

describe("tile frame grouping", () => {
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
        assert.deepEqual([...image.data.subarray(offset, offset + 4)], [240, 248, 255, alpha]);
      }
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

  for (const expression of ["unknown", "1junk", "1/0", "(ow-iw", "sin(0)"]) {
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

  for (const expression of ["unknown", "1junk", "1/0", "(iw-2", "sin(0)"]) {
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

  it("merges multiple MP4 videos via -f concat, concat: protocol, and -filter_complex concat", async () => {
    const clip1 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 5 });
    const clip2 = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 7 });
    const listTxt = "ffconcat version 1.0\nfile '/clip1.mp4'\nfile '/clip2.mp4'\n";
    const vfs = createTestVfs({
      "/clip1.mp4": clip1,
      "/clip2.mp4": clip2,
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

    // 2. concat:/clip1.mp4|/clip2.mp4
    const r2 = await runCmd(
      ffmpeg,
      ["-i", "concat:/clip1.mp4|/clip2.mp4", "-c", "copy", "/merged_protocol.mp4"],
      vfs
    );
    assert.equal(r2.exitCode, 0);
    const doc2 = parseMp4(vfs.store.get("/merged_protocol.mp4")!);
    assert.equal(doc2.tracks.find((t) => t.type === "video")?.samples.length, 12);

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
        ? parseMp4(concatBytes([vfs.store.get("/init.mp4")!, vfs.store.get(`/out${index}.m4s`)!])).tracks[0]!
        : parseMpegTs(vfs.store.get(`/out${index}.ts`)!).tracks[0]!);
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
          assert.ok(lines.includes(`#EXT-X-MEDIA-SEQUENCE:${listSize === 0 ? 5 : 6}`));
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

describe("HLS start_number", () => {
  for (const [pattern, names] of [
    [undefined, ["out5.ts", "out6.ts"]],
    ["/hls/part%d.ts", ["part5.ts", "part6.ts"]],
    ["/hls/part%03d.ts", ["part005.ts", "part006.ts"]],
    ["/hls/part%%_%03d.ts", ["part%_005.ts", "part%_006.ts"]]
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

  for (const size of ["-1", "bad", "1.5", ""]) {
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
        ...Array.from({ length: 5 - sequence }, (_, i) => [`#EXTINF:1.000000,`, `segments/out${sequence + i}.ts`]).flat(),
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

  for (const filter of ["volume=volume=invalid", "volume=wrong=0.5", "atempo=tempo=0.25", "atempo=wrong=1",
    "volume@quiet=invalid", "atempo@fast=0.25", "unsupported@label", "volume=0.5@quiet",
    "anull,unsupported", "unsupported,anull", "anull=invalid"]) {
    it(`rejects ${filter} without replacing output`, async () => {
      const vfs = createTestVfs({
        "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(800).fill(0.25)] }),
        "/output.wav": "existing output"
      });
      const before = vfs.store.get("/output.wav")!.slice();
      const result = await runCmd(createFfmpegCommand(), [
        "-y", "-i", "/input.wav", "-af", filter, "/output.wav"
      ], vfs);
      assert.equal(result.exitCode, 1);
      assert.deepEqual(vfs.store.get("/output.wav"), before);
    });
  }

  for (const filter of ["volume=1", "areverse", "anull", "anull@identity"]) {
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

  for (const expression of ["banana", "1junk", "", "dB", "bananadB", "6junkdB", "NaN", "Infinity", "1/0", "(1+2", "sin(0)"]) {
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

  for (const tempo of [0.5, 8, 100]) {
    it(`honors atempo=${tempo} without clamping`, async () => {
      const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(16000).fill(0.25)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", `atempo=${tempo}`, "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 16000);
      assert.equal(audio.channelData[0]!.length, Math.round(16000 / tempo));
    });
  }

  for (const tempo of ["0.25", "0", "-1", "100.1", "Infinity", "NaN", "", "8junk", "0.25,atempo=4",
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

  for (const [filter, tempo, rate] of [["atempo=2", 2, 16000], ["atempo=0.5", 0.5, 16000], ["atempo=2,atempo=2", 4, 8000]] as const) {
    it(`preserves pitch and stereo alignment with ${filter} at ${rate} Hz`, async () => {
      const tone = Float64Array.from({ length: 16000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 16000));
      const input = encodeWav({ sampleRate: 16000, channels: [tone, tone.map(value => -value)] });
      const vfs = createTestVfs({ "/input.wav": input });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", filter, "-ar", String(rate), "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const audio = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!;
      const left = audio.channelData[0]!;
      const right = audio.channelData[1]!;
      assert.equal(left.length, Math.round(rate / tempo));
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

  for (const [length, stereo] of [[5760, false], [5760, true], [6240, true], [1440, true]] as const) {
    it(`preserves a trailing tone when doubling a ${length}-sample ${stereo ? "stereo" : "mono"} clip`, async () => {
      const toneStart = length - 960;
      const tone = Float64Array.from({ length }, (_, i) => i < toneStart ? 0 : 0.5 * Math.sin(2 * Math.PI * 500 * (i - toneStart) / 48000));
      const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 48000, channels: stereo ? [tone, tone.map(value => -value)] : [tone] }) });
      const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-af", "atempo=2", "-c:a", "pcm_s16le", "/output.wav"], vfs);
      assert.equal(result.exitCode, 0, result.stderr);
      const [left, right] = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData;
      assert.equal(left!.length, length / 2);
      assert.ok(left!.some(sample => Math.abs(sample) > 0.49), "The trailing tone must remain audible");
      for (let i = left!.length - 240; i < left!.length; i++) {
        assert.ok(Math.abs(left![i]! - tone[length - left!.length + i]!) < 0.0001, "Retain the final tone samples without changing pitch");
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
    assert.equal(samples.length, 8000);
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
      assert.equal(samples.length, length * 2);
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

  for (const filter of ["no_such_filter", "highpass=f=200", "volume=0.5,no_such_filter,areverse"]) {
    for (const existing of [false, true]) {
      it(`rejects unsupported audio filter ${filter} and preserves ${existing ? "existing" : "absent"} output`, async () => {
        const input = encodeWav({ sampleRate: 16000, channels: [new Float64Array(160).fill(0.5)] });
        const original = new Uint8Array([1, 2, 3]);
        const vfs = createTestVfs({ "/input.wav": input, ...(existing ? { "/output.wav": original } : {}) });
        const result = await runCmd(createFfmpegCommand(), ["-y", "-v", "error", "-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
        assert.equal(result.exitCode, 1, result.stderr);
        assert.ok(result.stderr.includes("Unsupported audio filter:"), result.stderr);
        assert.ok(result.stderr.includes(filter.includes("no_such_filter") ? "no_such_filter" : "highpass"), result.stderr);
        assert.deepEqual(vfs.store.get("/output.wav"), existing ? original : undefined);
        assert.deepEqual(vfs.store.get("/input.wav"), input);
      });
    }
  }

  for (const [options, sampleRate, channels, samples] of [
    [["-ar", "8000"], 8000, 1, 80],
    [["-ac", "2"], 16000, 2, 160],
    [["-af", "volume=0.5"], 16000, 1, 160],
    [["-af", "atempo=2"], 16000, 1, 80]
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
      [["-i", "concat:/four.wav|/four.wav"], 8],
      [["-i", "/four.wav", "-af", "volume=0.5", "-t", "1"], 1],
      [["-i", "/four.wav", "-af", "atempo=2.0,areverse"], 2]
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

  for (const position of ["x=unknown:y=0", "x=0:y=2garbage", "x=iw/:y=0", "x=1/0:y=0", "x=sin(1):y=0"]) {
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

  for (const [crop, width, height] of [["16:16", 16, 16], ["8:4", 8, 4], ["w=iw/2:h=ih/2", 8, 8]] as const) {
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
    ["red@0", [0, 0, 255, 255]],
    ["red@1", [255, 0, 0, 255]],
    ["red", [255, 0, 0, 255]],
    ["red@0.5", [127, 0, 127, 255]],
    ["#ff0000@0.5", [127, 0, 127, 255]],
    ["0xff0000@0x80", [128, 0, 126, 255]],
    ["0xff000080", [128, 0, 126, 255]],
    ["ff000080@0", [0, 0, 255, 255]]
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
            x >= 1 && x < 3 && y >= 1 && y < 3 ? [...expected] : [0, 0, 255, 255]);
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
      assert.equal(result.exitCode, 1);
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
  assert.equal(audio.channelData[0]!.length, 192000);
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
  assert.equal(parseWav(vfs.store.get("/audio.wav")!).durationSeconds, 8);
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

describe("global metadata mapping", () => {
  for (const sync of [false, true]) {
    for (const [mapping, title] of [[undefined, "First"], ["0", "First"], ["1", "Second"], ["-1", undefined]] as const) {
      for (const override of [false, true]) {
        it(`${sync ? "sync" : "async"} maps metadata ${mapping ?? "by default"} with override=${override}`, async () => {
          const vfs = createTestVfs({
            "/first.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "First", artist: "Artist" } }),
            "/second.mp4": createSyntheticMp4({ frameCount: 1, metadata: { title: "Second" } })
          });
          const args = ["-i", "/first.mp4", "-i", "/second.mp4",
            ...(sync ? [] : ["-map", "0:v"]),
            ...(mapping === undefined ? [] : ["-map_metadata", mapping]),
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
          assert.equal(tags.artist, mapping === "1" || mapping === "-1" ? undefined : "Artist");
        });
      }
    }
    for (const mapping of ["2", "oops", "1.5"]) {
      it(`${sync ? "sync" : "async"} rejects metadata source ${mapping} without writing output`, async () => {
        const vfs = createTestVfs({ "/first.mp4": createSyntheticMp4({ frameCount: 1 }) });
        const args = ["-i", "/first.mp4", "-map_metadata", mapping, "-c", "copy", "/out.mp4"];
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

describe("chapter mapping", () => {
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


describe("audio stream copy frame limits", () => {
  for (const sync of [false, true]) {
    for (const option of ["-frames:a", "-aframes"]) {
      for (const limit of [0, 1, undefined]) {
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
          const expected = source.samples.slice(0, limit);
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
        assert.equal(samples.length, length * rate / 8000 / tempo);
        for (const sample of samples) assert.ok(Math.abs(sample - 0.25 * gain) < 0.0001);
      }
    });
  }
}

it("preserves constant audio when upsampling clips shorter than the filter", async () => {
  for (const length of [1, 8]) {
    const vfs = createTestVfs({ "/input.wav": encodeWav({ sampleRate: 8000, channels: [new Float64Array(length).fill(0.25)] }) });
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-ar", "16000", "/output.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const samples = parseWav(vfs.store.get("/output.wav")!).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.equal(samples.length, length * 2);
    for (const sample of samples) assert.ok(Math.abs(sample - 0.25) < 0.0001);
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
    const result = await runCmd(createFfmpegCommand(), ["-i", "/input.wav", "-c:a", "copy", "/output.wav"], vfs);
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

for (const filter of ["aformat=channel_layouts=surround", "aformat=channel_layouts=", "aformat=sample_fmts=s16"]) {
  it(`rejects unsupported aformat constraints without replacing output: ${filter}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(4), new Float64Array(4)] });
    const vfs = createTestVfs({ "/input.wav": input, "/output.wav": "existing" });
    const result = await runCmd(createFfmpegCommand(), ["-y", "-i", "/input.wav", "-af", filter, "/output.wav"], vfs);
    assert.equal(result.exitCode, 1);
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


it("rejects unsupported setpts offsets before downstream time selection without overwriting output", async () => {
  const vfs = createTestVfs({ "/out.gif": "existing" });
  const input = await runCmd(createFfmpegCommand(), [
    "-f", "lavfi", "-i", "testsrc2=size=16x16:rate=1:duration=3", "/in.gif"
  ], vfs);
  assert.equal(input.exitCode, 0, input.stderr);
  const before = new Map(vfs.store);
  const result = await runCmd(createFfmpegCommand(), [
    "-y", "-i", "/in.gif", "-vf", "setpts=PTS+1/TB,select=gt(t\\,1.5)",
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
    ["glob", "f*.png", [0, 1, 2]],
    ["glob", "f0[12].png", [1, 2]],
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
        "/.f03.png": images[3]!, "/other.png": images[3]!,
        "/frames/f02.png": images[2]!, "/frames/f00.png": images[0]!, "/frames/f01.png": images[1]!
      });
      const result = await runCmd(createFfmpegCommand(), [
        ...(mode ? ["-pattern_type", mode] : []), "-i", pattern, "/out%02d.png"
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
  it("rejects invalid timestamp naming without replacing output", async () => {
    const vfs = createTestVfs({ "/out.png": "original" });
    const result = await runCmd(createFfmpegCommand(), [
      "-f", "lavfi", "-i", "color=c=red:s=16x16:r=1:d=1", "-frame_pts", "invalid", "out.png"
    ], vfs);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /frame_pts/);
    assert.equal(new TextDecoder().decode(vfs.store.get("/out.png")), "original");
  });
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
          const expected = copy || (mode === "same-format" && source === "srt") ? payload : source === "srt"
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
  for (const graph of ["[0:a]apad=pad_len=4[out]", "[missing]volume=0.5[out]",
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


for (const value of [undefined, "unsupported", "duration"]) {
  it(`rejects unsupported DASH frag_type ${value}`, async () => {
    const vfs = createTestVfs({});
    const result = await runCmd(createFfmpegCommand(), ["-frag_type", ...(value === undefined ? [] : [value])], vfs);
    assert.equal(result.exitCode, 234);
    assert.ok(result.stderr.includes("unsupported frag_type"), result.stderr);
    assert.equal(vfs.store.size, 0);
  });
}
