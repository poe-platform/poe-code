import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, input: string, filter: string, graph = false, outputFormat = format) {
  const bytes = Buffer.from(input, "hex");
  const volume = Volume.fromJSON({ "/in.raw": bytes });
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  const argumentValues = createCommandArguments([
    "-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
    ...(graph ? ["-filter_complex", `[0:v]${filter}[v]`, "-map", "[v]"] : ["-vf", filter]),
    "-frames:v", "5", "-fps_mode", "passthrough", "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"
  ]);
  const result = await createFfmpegCommand().execute({
    command: "ffmpeg", args: argumentValues.args, argumentValues,
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { stdout.push(data); } },
    stderr: { async write(data: Uint8Array) { stderr.push(data); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/in.raw"), bytes);
  return { code: result.exitCode, output: Buffer.concat(stdout).toString("hex"), error: Buffer.concat(stderr).toString() };
}

// Complete outputs from native FFmpeg 7.0.2; five identical frames at 4 fps.
const gray = "111c2732";
const rgba = "111c27323d48535e69747f8a95a0abb6";
const yuv = "111c27323d48";
const rgb48 = "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e";
const rgb48Converted = "131c26323f48545e6974818a96a0acb6c1ccbce2faf8030e";
for (const [format, input, filter, expected] of [
  ["gray", gray, "fade=in:d=1ms", "00000000" + gray.repeat(4)],
  ["gray", gray, "fade=t=in:s=1:n=2", "00000000".repeat(2) + "090e1419" + gray.repeat(2)],
  ["gray", gray, "fade=in:st=0.25:d=0.5", "00000000".repeat(2) + "080e1319" + gray.repeat(2)],
  ["gray", gray, "fade=in:s=1:d=0.5", "00000000".repeat(2) + "080e1319" + gray.repeat(2)],
  ["gray", gray, "fade=in:st=0.25:n=2", "00000000".repeat(2) + "090e1419" + gray.repeat(2)],
  ["gray", gray, "fade=in:s=2:st=0.25:d=0.5", "00000000".repeat(2) + "080e1319" + gray.repeat(2)],
  ["gray", gray, "fade=in:st=0.3:d=0.4", "00000000".repeat(2) + "080e1319" + gray.repeat(2)],
  ["gray", gray, "setpts=PTS+4,fade=in:st=1.25:d=0.5", "00000000".repeat(2) + "080e1319" + gray.repeat(2)],
  ["gray", gray, "fade=in:1:2:enable=gte(n\\,2)", gray.repeat(2) + "090e1419" + gray.repeat(2)],
  ["gray", gray, "fade=in:1:2:threads=1:thread_type=slice:extra_hw_frames=-1", "00000000".repeat(2) + "090e1419" + gray.repeat(2)],
  ["gray", gray, "fade=in:1:2,fade=out:3:1", "00000000".repeat(2) + "090e1419" + gray + "00000000"],
  ["gray", gray, "fade=in:n=3", "0000000006090d110b131a21" + gray.repeat(2)],
  ["rgba", rgba, "fade=out:1:2:alpha=1", rgba.repeat(2) + "111c27193d48532f69747f4595a0ab5b" + "111c27003d48530069747f0095a0ab00".repeat(2)],
  ["rgba", rgba, "fade=in:1:2", "00".repeat(32) + "090e14191f242a2f353a40454b50565b" + rgba.repeat(2)],
  ["rgba", rgba, "fade=t=in:s=1:n=2:c=0xff0000", "ff000032ff00005eff00008aff0000b6".repeat(2) + "880e14329e242a5eb43a408aca5056b6" + rgba.repeat(2)],
  ["rgba", rgba, "fade=in:1:2:alpha=true:color=red", "111c27003d48530069747f0095a0ab00".repeat(2) + "111c27193d48532f69747f4595a0ab5b" + rgba.repeat(2)],
  ["gray", gray, "fade=in:1:2", "00000000".repeat(2) + "090e1419" + gray.repeat(2)],
  ["gray", gray, "fade=out:1:2", gray.repeat(2) + "080e1319" + "00000000".repeat(2)],
  ["gray", gray, "fade=type=out:start_time=0.25:duration=0.5", gray.repeat(2) + "090e1419" + "00000000".repeat(2)],
  ["rgba", rgba, "fade=in:1:2:alpha=1", "111c27003d48530069747f0095a0ab00".repeat(2) + "111c27193d48532f69747f4595a0ab5b" + rgba.repeat(2)],
  ["rgba", rgba, "fade=in:1:2:color=red", "ff000032ff00005eff00008aff0000b6".repeat(2) + "880e14329e242a5eb43a408aca5056b6" + rgba.repeat(2)],
  ["yuv420p", yuv, "fade=in:1:2", "101010108080".repeat(2) + "11161c215e64" + yuv.repeat(2)],
  ["rgb48le", rgb48, "fade=in:1:2", "00".repeat(48) + "0a0e13191f242b2f353a41454c50555b61665f717d7c0207" + rgb48Converted.repeat(2)]
] as const) {
  for (const graph of [false, true]) {
    it(`${format} ${filter} (${graph ? "graph" : "simple"})`, async () => {
      assert.deepEqual(await run(format, input.repeat(5), filter, graph), { code: 0, output: expected, error: "" });
    });
  }
}
for (const [format, input] of [["gray", gray], ["rgba", rgba], ["yuv420p", yuv], ["rgb48le", rgb48]] as const) {
  it(`null preserves ${format} control`, async () => {
    assert.deepEqual(await run(format, input.repeat(5), "null"), { code: 0, output: input.repeat(5), error: "" });
  });
}

for (const [filter, code] of [
  ["fade=n=0", 222], ["fade=s=-1", 222], ["fade=t=bad", 234],
  ["fade=alpha=bad", 234], ["fade=unknown=1", 8], ["fade=st=-1", 222],
  ["fade=d=-1", 222], ["fade=st=no", 234], ["fade=c=bad", 234]
] as const) {
  it(`rejects ${filter} without emitting frames`, async () => {
    const result = await run("gray", gray.repeat(5), filter);
    assert.equal(result.code, code, result.error);
    assert.equal(result.output, "");
    assert.notEqual(result.error, "");
  });
}

it("keeps RGB input opaque when output adds alpha", async () => {
  const input = "111c273d485369747f95a0ab";
  const expected = "000000ff".repeat(8) + "090e14ff1f242aff353a40ff4b5056ff" + "111c27ff3d4853ff69747fff95a0abff".repeat(2);
  assert.deepEqual(await run("rgb24", input.repeat(5), "fade=in:1:2", false, "rgba"), { code: 0, output: expected, error: "" });
});
