import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  concatMp4,
  createMediaAstRegistry,
  createSyntheticMp4,
  MediaLimitExceededError,
  mp4Ast,
  muxMp4,
  parseAvi,
  parseFlv,
  parseMkv,
  parseMp4, parseFfmetadata, serializeFfmetadata, parseSubtitleDocument, serializeSubtitleDocument,
  parseMpegTs,
  parseY4m,
  probeMp4,
  serializeAvi,
  serializeFlv,
  serializeMkv,
  serializeMp4,
  serializeMpegTs,
  serializeY4m,
  sliceMp4
} from "./index.js";

describe("@poe-code/mp4-ast", () => {
  it("creates, parses, and probes a standard H.264 + AAC MP4 with faststart", () => {
    const mp4Bytes = createSyntheticMp4({
      width: 64,
      height: 48,
      fps: 10,
      frameCount: 10,
      includeAudio: true,
      faststart: true,
      metadata: { title: "Demo Video", artist: "Poe Agent" }
    });

    const doc = parseMp4(mp4Bytes, { decodeFrames: true });
    assert.equal(doc.containerFormat, "mp4");
    assert.equal(doc.faststart, true);
    assert.equal(doc.tracks.length, 2);
    assert.equal(doc.metadata.title, "Demo Video");
    assert.equal(doc.metadata.artist, "Poe Agent");

    const vTrack = doc.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.width, 64);
    assert.equal(vTrack.height, 48);
    assert.equal(vTrack.samples.length, 10);
    assert.equal(vTrack.decodedVideoFrames?.length, 10);

    const probe = probeMp4(mp4Bytes, { showPackets: true, showFrames: true });
    assert.equal(probe.streams.length, 2);
    assert.equal(probe.streams[0]?.codec_name, "h264");
    assert.equal(probe.streams[0]?.width, 64);
    assert.equal(probe.streams[0]?.height, 48);
    assert.equal(probe.streams[1]?.codec_name, "aac");
    assert.ok(probe.packets && probe.packets.length >= 10);
    assert.ok(probe.frames && probe.frames.length >= 10);
  });

  it("merges multiple MP4 videos losslessly via concatMp4 including different resolutions (multi-stsd)", () => {
    const clipA = parseMp4(
      createSyntheticMp4({ width: 64, height: 64, fps: 10, frameCount: 5, includeAudio: true })
    );
    const clipB = parseMp4(
      createSyntheticMp4({ width: 128, height: 96, fps: 10, frameCount: 7, includeAudio: true })
    );

    const mergedDoc = concatMp4([clipA, clipB]);
    const mergedBytes = serializeMp4(mergedDoc, { faststart: true });
    const reparsed = parseMp4(mergedBytes);

    const vTrack = reparsed.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.samples.length, 12);
    // Because clipA is 64x64 and clipB is 128x96, stsd has 2 sample description entries!
    assert.equal(vTrack.codecDescriptions.length, 2);
    assert.equal(vTrack.samples[0]?.sampleDescriptionIndex, 1);
    assert.equal(vTrack.samples[5]?.sampleDescriptionIndex, 2);
    assert.ok(Math.abs((reparsed.durationSeconds) - (1.2)) < 0.5 * 10 ** -(1));
  });

  it("supports fragmented MP4 (fMP4) serialization and parsing", () => {
    const fmp4Bytes = createSyntheticMp4({
      width: 64,
      height: 64,
      fps: 10,
      frameCount: 6,
      fragmented: true
    });

    const parsed = parseMp4(fmp4Bytes);
    assert.equal(parsed.isFragmented, true);
    const vTrack = parsed.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.samples.length, 6);
  });

  it("slices MP4 by time range and supports muxMp4 track stripping and rotation", () => {
    const baseDoc = parseMp4(
      createSyntheticMp4({ width: 64, height: 64, fps: 10, frameCount: 20, includeAudio: true })
    );
    const sliced = sliceMp4(baseDoc, { startSeconds: 0.5, endSeconds: 1.5 });
    const vSliced = sliced.tracks.find((t) => t.type === "video")!;
    assert.equal(vSliced.samples.length, 10);

    const muxed = muxMp4([sliced], { stripAudio: true, rotation: 90 });
    const outBytes = serializeMp4(muxed);
    const reparsed = parseMp4(outBytes);
    assert.equal(reparsed.tracks.length, 1);
    assert.equal(reparsed.tracks[0]?.rotation, 90);
  });

  it("roundtrips across MKV/WebM, MPEG-TS, AVI, FLV, and Y4M containers", () => {
    const doc = parseMp4(
      createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 4, includeAudio: true }),
      { decodeFrames: true }
    );

    // MKV
    const mkvBytes = serializeMkv(doc);
    const mkvParsed = parseMkv(mkvBytes);
    assert.equal(mkvParsed.containerFormat, "matroska");
    assert.equal(mkvParsed.tracks.length, 2);

    // MPEG-TS
    const tsBytes = serializeMpegTs(doc);
    const tsParsed = parseMpegTs(tsBytes);
    assert.equal(tsParsed.containerFormat, "mpegts");
    assert.equal(tsParsed.tracks.find((t) => t.type === "video")?.samples.length, 4);

    // AVI
    const aviBytes = serializeAvi(doc);
    const aviParsed = parseAvi(aviBytes);
    assert.equal(aviParsed.containerFormat, "avi");
    assert.equal(aviParsed.tracks.find((t) => t.type === "video")?.samples.length, 4);

    // FLV
    const flvBytes = serializeFlv(doc);
    const flvParsed = parseFlv(flvBytes);
    assert.equal(flvParsed.containerFormat, "flv");
    assert.equal(flvParsed.tracks.find((t) => t.type === "video")?.samples.length, 4);

    // Y4M
    const y4mBytes = serializeY4m(doc);
    const y4mParsed = parseY4m(y4mBytes);
    assert.equal(y4mParsed.containerFormat, "yuv4mpegpipe");
    assert.equal(y4mParsed.tracks[0]?.decodedVideoFrames?.length, 4);
  });

  it("imposes no limits by default and enforces consumer-supplied limits when configured", () => {
    const mp4Bytes = createSyntheticMp4({ width: 64, height: 64, fps: 10, frameCount: 5 });

    // No limits by default
    assert.doesNotThrow(() => parseMp4(mp4Bytes));

    // Consumer limit on maxInputBytes
    assert.throws(() => parseMp4(mp4Bytes, { limits: { maxInputBytes: 100 } }), MediaLimitExceededError);

    // Cloudflare preset helper with custom override
    const cfLimits = cloudflareWorkerLimits({ maxFrames: 2 });
    assert.throws(() => parseMp4(mp4Bytes, { decodeFrames: true, limits: cfLimits }), MediaLimitExceededError);
  });

  it("determines supported formats dynamically from the AST registry", () => {
    const mp4OnlyRegistry = createMediaAstRegistry([mp4Ast()]);
    assert.notEqual(mp4OnlyRegistry.findByFilename("video.mp4"), undefined);
    assert.equal(mp4OnlyRegistry.findByFilename("video.mkv"), undefined);

    const fullRegistry = createMediaAstRegistry(allMediaAsts());
    assert.notEqual(fullRegistry.findByFilename("video.mp4"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.mkv"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.webm"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.ts"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.avi"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.flv"), undefined);
    assert.notEqual(fullRegistry.findByFilename("video.y4m"), undefined);
    assert.notEqual(fullRegistry.findByFilename("audio.aac"), undefined);
    assert.notEqual(fullRegistry.findByFilename("audio.wav"), undefined);
  });

  it("merges multi-resolution MP4 clips using multiple stsd entries without re-encoding", () => {
    const clip1 = parseMp4(
      createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 3, includeAudio: true })
    );
    const clip2 = parseMp4(
      createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 4, includeAudio: true })
    );
    const merged = concatMp4([clip1, clip2]);
    const serialized = serializeMp4(merged, { faststart: true });
    const reparsed = parseMp4(serialized);
    const vTrack = reparsed.tracks.find((t) => t.type === "video")!;
    assert.equal(vTrack.samples.length, 7);
    assert.equal(vTrack.codecDescriptions.length, 2);
    assert.equal(vTrack.samples[0]!.sampleDescriptionIndex, 1);
    assert.equal(vTrack.samples[3]!.sampleDescriptionIndex, 2);
  });

  it("parses and muxes SubRip (.srt) and WebVTT (.vtt) subtitles into MP4 (tx3g) and MKV (S_TEXT/UTF8) with exact cue timing", () => {
    const srtText = [
      "1",
      "00:00:00,200 --> 00:00:00,900",
      "HELLO WORLD",
      "",
      "2",
      "00:00:01,100 --> 00:00:01,800",
      "SECOND CUE",
      ""
    ].join("\n");
    const srtDoc = parseSubtitleDocument(new TextEncoder().encode(srtText), "srt");
    const vttBytes = serializeSubtitleDocument(srtDoc, "webvtt");
    assert.ok((new TextDecoder().decode(vttBytes)).includes("00:00:00.200 --> 00:00:00.900"));

    const baseVideo = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 20 }));
    const muxedMp4 = serializeMp4(muxMp4([baseVideo, srtDoc]));
    const reparsedMp4 = parseMp4(muxedMp4);
    const subTrack = reparsedMp4.tracks.find((t) => t.type === "subtitle")!;
    assert.equal(subTrack.samples.length, 2);
    assert.equal(subTrack.samples[0]!.pts, 200);
    assert.equal(subTrack.samples[0]!.duration, 700);
    assert.equal(subTrack.samples[1]!.pts, 1100);
    assert.equal(subTrack.samples[1]!.duration, 700);
  });

  it("parses and serializes Nero chpl chapters in MP4 and FFmetadata (;FFMETADATA1) documents", () => {
    const ffmetaText = [
      ";FFMETADATA1",
      "title=ChapterTest",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=0",
      "END=1000",
      "title=Chapter One",
      "[CHAPTER]",
      "TIMEBASE=1/1000",
      "START=1000",
      "END=2000",
      "title=Chapter Two",
      ""
    ].join("\n");
    const metaDoc = parseFfmetadata(new TextEncoder().encode(ffmetaText));
    assert.equal(metaDoc.chapters?.length, 2);

    const videoDoc = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 20 }));
    const muxed = muxMp4([videoDoc, metaDoc]);
    const mp4Bytes = serializeMp4(muxed);
    const reparsed = parseMp4(mp4Bytes);
    assert.equal(reparsed.chapters?.length, 2);
    assert.equal(reparsed.chapters?.[0]?.title, "Chapter One");
    assert.equal(reparsed.chapters?.[1]?.title, "Chapter Two");
    assert.ok(Math.abs((reparsed.chapters?.[1]?.startTimeSeconds) - (1.0)) < 0.5 * 10 ** -(3));

    const reserializedFfmeta = new TextDecoder().decode(serializeFfmetadata(reparsed));
    assert.ok((reserializedFfmeta).includes("title=Chapter One"));
    assert.ok((reserializedFfmeta).includes("title=Chapter Two"));
  });
});
