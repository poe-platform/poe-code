import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSyntheticMp4, mp4Ast, parseMp4, serializeMp4, parseMpegTs, parseWav } from "@poe-code/mp4-ast";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  createFfmpegCommand,
  createFfmpegCommands,
  createFfprobeCommand,
  type FfmpegCommandsOptions
} from "./index.js";

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
  stdinBytes = new Uint8Array(0)
): Promise<{ exitCode: number; stdout: string; stderr: string; stdoutBytes: Uint8Array }> {
  const outChunks: Uint8Array[] = [];
  const errChunks: Uint8Array[] = [];
  const controller = new AbortController();

  const res = await cmdDef.execute({
    args,
    cwd: "/",
    env: {},
    fs: vfs.fs as never,
    signal: controller.signal,
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

    // With allMediaAsts(), MP4 -> MKV, TS, AVI, FLV, Y4M, WAV all succeed!
    const fullFfmpeg = createFfmpegCommand({ asts: allMediaAsts() });
    for (const ext of ["mkv", "webm", "ts", "avi", "flv", "y4m", "wav", "gif"]) {
      const res = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", `/out.${ext}`], vfs);
      assert.equal(res.exitCode, 0);
      assert.ok((vfs.store.get(`/out.${ext}`)?.byteLength ?? 0) > 10);
    }
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

    // 4. Whisper audio resampling (-vn -ar 16000 -ac 1)
    const r4 = await runCmd(ffmpeg, ["-i", "/v.mp4", "-vn", "-ar", "16000", "-ac", "1", "/audio.wav"], vfs);
    assert.equal(r4.exitCode, 0);
    const wavProbe = JSON.parse((await runCmd(ffprobe, ["-v", "quiet", "-print_format", "json", "-show_streams", "/audio.wav"], vfs)).stdout);
    assert.equal(wavProbe.streams[0].sample_rate, "16000");
    assert.equal(wavProbe.streams[0].channels, 1);
  });

  it("segments MP4 into HLS (.m3u8 + .ts) and rejoins back to MP4, probes chapters, and applies xfade/setpts/reverse/atempo", async () => {
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
    assert.equal(vfs.store.has("/seg_001.ts"), true);

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

    // 3. xfade + setpts + reverse + atempo
    const xfRes = await runCmd(
      ffmpeg,
      ["-i", "/v.mp4", "-i", "/v.mp4", "-filter_complex", "[0:v][1:v]xfade=transition=fade:duration=0.4:offset=1.6", "-vf", "setpts=0.5*PTS,reverse", "-af", "atempo=2.0,areverse", "/xf.mp4"],
      vfs
    );
    assert.equal(xfRes.exitCode, 0);
    const xfDoc = parseMp4(vfs.store.get("/xf.mp4")!);
    assert.equal(xfDoc.tracks.find((t) => t.type === "video")!.samples.length, 36);
  });
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

describe("decoded audio editing", () => {
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
      [["-i", "/four.wav", "-af", "volume=0.5", "-t", "1"], 1]
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
  const probe = await runCmd(createFfprobeCommand(), ["-of", "json", "/hls/media.playlist"], vfs);
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
  const native = Buffer.from("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", "base64");
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

it("matches native sine mono and anullsrc stereo channel defaults", async () => {
  for (const [source, channels] of [["sine", 1], ["anullsrc", 2]] as const) {
    const vfs = createTestVfs();
    const result = await runCmd(createFfmpegCommand(), ["-f", "lavfi", "-i", `${source}=sample_rate=16000:duration=0.01`, "/tone.wav"], vfs);
    assert.equal(result.exitCode, 0, result.stderr);
    const track = parseWav(vfs.store.get("/tone.wav")!).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.channels, channels);
    assert.equal(track.codecDescriptions[0]!.sampleRate, 16000);
  }
});

it("matches native ffprobe flat numeric and string field types", async () => {
  const vfs = createTestVfs({ "/clip.mp4": createSyntheticMp4({ width: 80, height: 60, frameCount: 1, includeAudio: false }) });
  const result = await runCmd(createFfprobeCommand(), ["-of", "flat", "-show_entries", "stream=codec_name,width,height", "/clip.mp4"], vfs);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, 'streams.stream.0.codec_name="h264"\nstreams.stream.0.width=80\nstreams.stream.0.height=60\n');
});
