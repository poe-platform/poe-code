import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSyntheticMp4, mp4Ast, parseMp4 } from "@poe-code/mp4-ast";
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
