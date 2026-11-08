import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

async function run(bytes: Uint8Array, options: string[] = [], pipe = false) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/rgb.raw", bytes);
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-f", "rawvideo", "-pixel_format", "rgb24",
      "-video_size", "3x2", "-framerate", "5", "-of", "json", ...options, pipe ? "pipe:0" : "/rgb.raw"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () { if (pipe) for (const byte of bytes) yield Uint8Array.of(byte); })(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  return { ...result, stdout, stderr };
}

for (const pipe of [false, true]) for (const tail of [false, true]) {
  it(`probes raw RGB packets independently of decoding (pipe=${pipe}, tail=${tail})`, async () => {
    const bytes = Uint8Array.from({ length: tail ? 74 : 72 }, (_, i) => i < 72 ? (i * 7 + 11) % 256 : 90);
    const result = await run(bytes, ["-count_frames", "-count_packets", "-show_entries",
      "stream=codec_name,pix_fmt,width,height,nb_read_packets,nb_read_frames:packet=pts,size"], pipe);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      streams: [{ codec_name: "rawvideo", pix_fmt: "rgb24", width: 3, height: 2,
        nb_read_packets: tail ? "5" : "4", nb_read_frames: "4" }],
      packets: Array.from({ length: tail ? 5 : 4 }, (_, pts) => ({ pts, size: pts === 4 ? "2" : "18" }))
    });
  });
}

it("rejects invalid rawvideo geometry, pixel formats and frame rates without output", async () => {
  for (const options of [["-video_size", "0x2"], ["-video_size", "3x2x1"], ["-pixel_format", "unknown"], ["-framerate", "0"], ["-framerate", "1/0"]]) {
    const result = await run(new Uint8Array(72), options);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  }
});

it("keeps synchronous probe packet sizes and timestamps aligned with the command", () => {
  const result = evalSyncFfprobe(new Uint8Array(74), ["-f", "rawvideo", "-pixel_format", "rgb24",
    "-video_size", "3x2", "-framerate", "30000/1001", "-show_entries", "packet=pts,pts_time,size", "-of", "json", "-"]);
  expect(JSON.parse(result!).packets).toEqual(Array.from({ length: 5 }, (_, pts) => ({
    pts, pts_time: (pts * 1001 / 30000).toFixed(6), size: pts === 4 ? "2" : "18"
  })));
});

it("exposes the short tail payload and supports packet interval selection", async () => {
  const result = await run(Uint8Array.from({ length: 74 }, (_, i) => i < 72 ? 0 : 90),
    ["-read_intervals", "0.8%+#1", "-show_data", "-show_entries", "packet=pts,size,data"]);
  expect(result.exitCode, result.stderr).toBe(0);
  const packets = JSON.parse(result.stdout).packets;
  expect(packets).toHaveLength(1);
  expect(packets[0]).toMatchObject({ pts: 4, size: "2" });
  expect(packets[0].data).toContain("5a5a");
});
