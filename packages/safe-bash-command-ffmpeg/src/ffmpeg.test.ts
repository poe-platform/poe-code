import { describe, expect, it } from "vitest";
import { createSyntheticMp4, mp4Ast, parseMp4 } from "@poe-code/mp4-ast";
import {
  allMediaAsts,
  cloudflareWorkerLimits,
  createFfmpegCommand,
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
    expect(jsonRes.exitCode).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.streams.length).toBe(2);
    expect(parsed.streams[0].codec_name).toBe("h264");
    expect(parsed.streams[0].width).toBe(128);
    expect(parsed.streams[0].height).toBe(72);
    expect(parsed.format.tags.title).toBe("Test Clip");

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
    expect(widthRes.exitCode).toBe(0);
    expect(widthRes.stdout.trim()).toBe("128");
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
    expect(r1.exitCode).toBe(0);
    const doc1 = parseMp4(vfs.store.get("/merged_concat_demuxer.mp4")!);
    expect(doc1.tracks.find((t) => t.type === "video")?.samples.length).toBe(12);

    // 2. concat:/clip1.mp4|/clip2.mp4
    const r2 = await runCmd(
      ffmpeg,
      ["-i", "concat:/clip1.mp4|/clip2.mp4", "-c", "copy", "/merged_protocol.mp4"],
      vfs
    );
    expect(r2.exitCode).toBe(0);
    const doc2 = parseMp4(vfs.store.get("/merged_protocol.mp4")!);
    expect(doc2.tracks.find((t) => t.type === "video")?.samples.length).toBe(12);

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
    expect(r3.exitCode).toBe(0);
    const doc3 = parseMp4(vfs.store.get("/merged_filter.mp4")!);
    expect(doc3.tracks.find((t) => t.type === "video")?.samples.length).toBe(12);
  });

  it("decides supported formats strictly from the registered AST plugins", async () => {
    const clip = createSyntheticMp4({ width: 64, height: 48, fps: 10, frameCount: 4 });
    const vfs = createTestVfs({ "/clip.mp4": clip });

    // Configure ffmpeg with ONLY mp4Ast()
    const mp4OnlyFfmpeg = createFfmpegCommand({ asts: [mp4Ast()] });

    // MP4 -> MP4 succeeds
    const okRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/copy.mp4"], vfs);
    expect(okRes.exitCode).toBe(0);

    // MP4 -> MKV fails because mkvAst() is not registered
    const failRes = await runCmd(mp4OnlyFfmpeg, ["-i", "/clip.mp4", "-c", "copy", "/out.mkv"], vfs);
    expect(failRes.exitCode).toBe(1);
    expect(failRes.stderr).toContain("format AST not registered");

    // With allMediaAsts(), MP4 -> MKV, TS, AVI, FLV, Y4M, WAV all succeed!
    const fullFfmpeg = createFfmpegCommand({ asts: allMediaAsts() });
    for (const ext of ["mkv", "webm", "ts", "avi", "flv", "y4m", "wav", "gif"]) {
      const res = await runCmd(fullFfmpeg, ["-i", "/clip.mp4", `/out.${ext}`], vfs);
      expect(res.exitCode).toBe(0);
      expect(vfs.store.get(`/out.${ext}`)?.byteLength).toBeGreaterThan(10);
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
    expect(genRes.exitCode).toBe(0);
    const filteredDoc = parseMp4(vfs.store.get("/filtered.mp4")!);
    const vTrack = filteredDoc.tracks.find((t) => t.type === "video")!;
    expect(vTrack.width).toBe(48);
    expect(vTrack.height).toBe(32);
    expect(vTrack.samples.length).toBe(5);

    // Extract frames to PNG sequence
    const seqRes = await runCmd(
      ffmpeg,
      ["-i", "/filtered.mp4", "/frame_%03d.png"],
      vfs
    );
    expect(seqRes.exitCode).toBe(0);
    expect(vfs.store.has("/frame_001.png")).toBe(true);
    expect(vfs.store.has("/frame_005.png")).toBe(true);

    // Re-assemble PNG sequence back to MP4
    const assembleRes = await runCmd(
      ffmpeg,
      ["-framerate", "10", "-i", "/frame_%03d.png", "/reassembled.mp4"],
      vfs
    );
    expect(assembleRes.exitCode).toBe(0);
    const reassembledDoc = parseMp4(vfs.store.get("/reassembled.mp4")!);
    expect(reassembledDoc.tracks[0]?.samples.length).toBe(5);
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
    expect(copyRes.exitCode).toBe(0);
    expect(capturedStats?.decodedFrames).toBe(0);

    // Pixel filter (`-vf negate`) decodes frames and hits maxFrames: 4 limit
    const filterRes = await runCmd(boundedFfmpeg, ["-i", "/clip.mp4", "-vf", "negate", "/neg.mp4"], vfs);
    expect(filterRes.exitCode).toBe(1);
    expect(filterRes.stderr).toContain("maxFrames");

    // Opt-out of videoTranscode (`features: { videoTranscode: false }`)
    const remuxOnlyFfmpeg = createFfmpegCommand({
      features: { videoTranscode: false }
    });
    const optOutRes = await runCmd(remuxOnlyFfmpeg, ["-i", "/clip.mp4", "-vf", "scale=32:32", "/scaled.mp4"], vfs);
    expect(optOutRes.exitCode).toBe(1);
    expect(optOutRes.stderr).toContain("disabled by consumer feature configuration");
  });
});
