import { describe, expect, it } from "vitest";
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
  parseMp4, parseSubtitleDocument, serializeSubtitleDocument,
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
    expect(doc.containerFormat).toBe("mp4");
    expect(doc.faststart).toBe(true);
    expect(doc.tracks.length).toBe(2);
    expect(doc.metadata.title).toBe("Demo Video");
    expect(doc.metadata.artist).toBe("Poe Agent");

    const vTrack = doc.tracks.find((t) => t.type === "video")!;
    expect(vTrack.width).toBe(64);
    expect(vTrack.height).toBe(48);
    expect(vTrack.samples.length).toBe(10);
    expect(vTrack.decodedVideoFrames?.length).toBe(10);

    const probe = probeMp4(mp4Bytes, { showPackets: true, showFrames: true });
    expect(probe.streams.length).toBe(2);
    expect(probe.streams[0]?.codec_name).toBe("h264");
    expect(probe.streams[0]?.width).toBe(64);
    expect(probe.streams[0]?.height).toBe(48);
    expect(probe.streams[1]?.codec_name).toBe("aac");
    expect(probe.packets && probe.packets.length).toBeGreaterThanOrEqual(10);
    expect(probe.frames && probe.frames.length).toBeGreaterThanOrEqual(10);
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
    expect(vTrack.samples.length).toBe(12);
    // Because clipA is 64x64 and clipB is 128x96, stsd has 2 sample description entries!
    expect(vTrack.codecDescriptions.length).toBe(2);
    expect(vTrack.samples[0]?.sampleDescriptionIndex).toBe(1);
    expect(vTrack.samples[5]?.sampleDescriptionIndex).toBe(2);
    expect(reparsed.durationSeconds).toBeCloseTo(1.2, 1);
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
    expect(parsed.isFragmented).toBe(true);
    const vTrack = parsed.tracks.find((t) => t.type === "video")!;
    expect(vTrack.samples.length).toBe(6);
  });

  it("slices MP4 by time range and supports muxMp4 track stripping and rotation", () => {
    const baseDoc = parseMp4(
      createSyntheticMp4({ width: 64, height: 64, fps: 10, frameCount: 20, includeAudio: true })
    );
    const sliced = sliceMp4(baseDoc, { startSeconds: 0.5, endSeconds: 1.5 });
    const vSliced = sliced.tracks.find((t) => t.type === "video")!;
    expect(vSliced.samples.length).toBe(10);

    const muxed = muxMp4([sliced], { stripAudio: true, rotation: 90 });
    const outBytes = serializeMp4(muxed);
    const reparsed = parseMp4(outBytes);
    expect(reparsed.tracks.length).toBe(1);
    expect(reparsed.tracks[0]?.rotation).toBe(90);
  });

  it("roundtrips across MKV/WebM, MPEG-TS, AVI, FLV, and Y4M containers", () => {
    const doc = parseMp4(
      createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 4, includeAudio: true }),
      { decodeFrames: true }
    );

    // MKV
    const mkvBytes = serializeMkv(doc);
    const mkvParsed = parseMkv(mkvBytes);
    expect(mkvParsed.containerFormat).toBe("matroska");
    expect(mkvParsed.tracks.length).toBe(2);

    // MPEG-TS
    const tsBytes = serializeMpegTs(doc);
    const tsParsed = parseMpegTs(tsBytes);
    expect(tsParsed.containerFormat).toBe("mpegts");
    expect(tsParsed.tracks.find((t) => t.type === "video")?.samples.length).toBe(4);

    // AVI
    const aviBytes = serializeAvi(doc);
    const aviParsed = parseAvi(aviBytes);
    expect(aviParsed.containerFormat).toBe("avi");
    expect(aviParsed.tracks.find((t) => t.type === "video")?.samples.length).toBe(4);

    // FLV
    const flvBytes = serializeFlv(doc);
    const flvParsed = parseFlv(flvBytes);
    expect(flvParsed.containerFormat).toBe("flv");
    expect(flvParsed.tracks.find((t) => t.type === "video")?.samples.length).toBe(4);

    // Y4M
    const y4mBytes = serializeY4m(doc);
    const y4mParsed = parseY4m(y4mBytes);
    expect(y4mParsed.containerFormat).toBe("yuv4mpegpipe");
    expect(y4mParsed.tracks[0]?.decodedVideoFrames?.length).toBe(4);
  });

  it("imposes no limits by default and enforces consumer-supplied limits when configured", () => {
    const mp4Bytes = createSyntheticMp4({ width: 64, height: 64, fps: 10, frameCount: 5 });

    // No limits by default
    expect(() => parseMp4(mp4Bytes)).not.toThrow();

    // Consumer limit on maxInputBytes
    expect(() => parseMp4(mp4Bytes, { limits: { maxInputBytes: 100 } })).toThrow(
      MediaLimitExceededError
    );

    // Cloudflare preset helper with custom override
    const cfLimits = cloudflareWorkerLimits({ maxFrames: 2 });
    expect(() => parseMp4(mp4Bytes, { decodeFrames: true, limits: cfLimits })).toThrow(
      MediaLimitExceededError
    );
  });

  it("determines supported formats dynamically from the AST registry", () => {
    const mp4OnlyRegistry = createMediaAstRegistry([mp4Ast()]);
    expect(mp4OnlyRegistry.findByFilename("video.mp4")).toBeDefined();
    expect(mp4OnlyRegistry.findByFilename("video.mkv")).toBeUndefined();

    const fullRegistry = createMediaAstRegistry(allMediaAsts());
    expect(fullRegistry.findByFilename("video.mp4")).toBeDefined();
    expect(fullRegistry.findByFilename("video.mkv")).toBeDefined();
    expect(fullRegistry.findByFilename("video.webm")).toBeDefined();
    expect(fullRegistry.findByFilename("video.ts")).toBeDefined();
    expect(fullRegistry.findByFilename("video.avi")).toBeDefined();
    expect(fullRegistry.findByFilename("video.flv")).toBeDefined();
    expect(fullRegistry.findByFilename("video.y4m")).toBeDefined();
    expect(fullRegistry.findByFilename("audio.aac")).toBeDefined();
    expect(fullRegistry.findByFilename("audio.wav")).toBeDefined();
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
    expect(vTrack.samples.length).toBe(7);
    expect(vTrack.codecDescriptions.length).toBe(2);
    expect(vTrack.samples[0]!.sampleDescriptionIndex).toBe(1);
    expect(vTrack.samples[3]!.sampleDescriptionIndex).toBe(2);
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
    expect(new TextDecoder().decode(vttBytes)).toContain("00:00:00.200 --> 00:00:00.900");

    const baseVideo = parseMp4(createSyntheticMp4({ width: 32, height: 32, fps: 10, frameCount: 20 }));
    const muxedMp4 = serializeMp4(muxMp4([baseVideo, srtDoc]));
    const reparsedMp4 = parseMp4(muxedMp4);
    const subTrack = reparsedMp4.tracks.find((t) => t.type === "subtitle")!;
    expect(subTrack.samples.length).toBe(2);
    expect(subTrack.samples[0]!.pts).toBe(200);
    expect(subTrack.samples[0]!.duration).toBe(700);
    expect(subTrack.samples[1]!.pts).toBe(1100);
    expect(subTrack.samples[1]!.duration).toBe(700);
  });
});
