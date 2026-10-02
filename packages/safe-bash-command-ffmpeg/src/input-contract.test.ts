import assert from "node:assert/strict";
import { it } from "node:test";
import type { CommandContext } from "safe-bash-contracts/command";
import { createSyntheticMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, createFfprobeCommand } from "./index.js";

const media = createSyntheticMp4({ width: 16, height: 16, frameCount: 1 });
function fixture(args: string[], files: Record<string, Uint8Array> = { "/in.mp4": media }) {
  const output: Uint8Array[] = [];
  const errors: string[] = [];
  const controller = new AbortController();
  const totals: number[] = [];
  const context = {
    args, cwd: "/", env: {}, signal: controller.signal,
    inputBudget: { check(n: number) { totals.push(n); } },
    stdin: (async function* () { yield media.subarray(0, 10); yield media.subarray(10); })(),
    fs: {
      async readFile(path: string) {
        if (files[path]) return files[path];
        throw Object.assign(new Error(path), { code: "ENOENT" });
      },
      async stat() { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
      async writeFile(path: string, bytes: Uint8Array) { files[path] = bytes; },
      async mkdir() {}
    },
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(new TextDecoder().decode(bytes)); } }
  } as unknown as CommandContext;
  return { context, totals, output, errors, files, controller };
}
for (const probe of [false, true]) {
  const command = probe ? createFfprobeCommand : createFfmpegCommand;
  const args = (input: string) => probe ? [input] : ["-i", input, "-c", "copy", "-f", "mp4", "/dev/stdout"];
  for (const input of ["/in.mp4", "-", "/dev/stdin", "/dev/fd/0"]) {
    it(`${probe ? "ffprobe" : "ffmpeg"} accounts for ${input}`, async () => {
      const f = fixture(args(input));
      assert.equal((await command().execute(f.context)).exitCode, 0);
      assert.equal(f.totals.at(-1), media.length);
      assert.ok(f.output.length > 0);
      assert.equal(f.files["/dev/stdout"], undefined);
    });
  }
  for (const kind of ["BudgetExceededError", "EPIPE", "abort"]) {
    it(`${probe ? "ffprobe" : "ffmpeg"} propagates ${kind}`, async () => {
      const f = fixture(args("/in.mp4"));
      const error = Object.assign(new Error(kind), { name: kind, code: kind });
      f.context.fs.readFile = async () => {
        if (kind === "abort") f.controller.abort(error);
        throw error;
      };
      await assert.rejects(async () => command().execute(f.context), e => e === error);
    });
  }
}
it("counts multiple inputs cumulatively", async () => {
  const f = fixture(["-i", "in.mp4", "-i", "in.mp4", "-c", "copy", "out.mp4"]);
  assert.equal((await createFfmpegCommand().execute(f.context)).exitCode, 0);
  assert.deepEqual(f.totals, [media.length, media.length * 2]);
});
it("enforces media limits during stdin collection", async () => {
  const f = fixture(["-"]);
  assert.equal((await createFfprobeCommand({ limits: { maxInputBytes: 5 } }).execute(f.context)).exitCode, 1);
  assert.deepEqual(f.totals, [10]);
});

const playlist = new TextEncoder().encode("#EXTM3U\n#EXTINF:1,\nin.mp4\n");
const subtitles = new TextEncoder().encode("1\n00:00:00,000 --> 00:00:01,000\nHello\n");
for (const scenario of [
  { name: "HLS playlist", args: ["-i", "in.m3u8"], files: { "/in.m3u8": playlist }, first: playlist.length },
  { name: "HLS segments", args: ["-i", "in.m3u8"], files: { "/in.m3u8": playlist, "/in.mp4": media }, first: playlist.length + media.length },
  { name: "image sequences", args: ["-i", "frame%02d.png"], files: { "/frame00.png": media }, first: media.length },
  { name: "subtitles", args: ["-i", "in.mp4", "-vf", "subtitles=in.srt"], files: { "/in.mp4": media, "/in.srt": subtitles }, first: media.length + subtitles.length }
]) {
  for (const shellLimit of [false, true]) {
    it(`enforces ${shellLimit ? "shell" : "media"} input limits on ${scenario.name}`, async () => {
      const f = fixture([...scenario.args, "out.mp4"], scenario.files);
      const error = Object.assign(new Error("input limit"), { name: "BudgetExceededError" });
      f.context.inputBudget!.check = n => { f.totals.push(n); if (shellLimit && n >= scenario.first) throw error; };
      const command = createFfmpegCommand(shellLimit ? {} : { limits: { maxInputBytes: scenario.first - 1 } });
      if (shellLimit) await assert.rejects(async () => command.execute(f.context), e => e === error);
      else {
        assert.equal((await command.execute(f.context)).exitCode, 1);
        assert.match(f.errors.join(""), /maxInputBytes/);
      }
      assert.equal(f.totals.at(-1), scenario.first);
      assert.equal(f.files["/out.mp4"], undefined);
    });
  }
}
for (const output of ["-", "pipe:", "pipe:1", "/dev/stdout", "/dev/fd/1"]) {
  it(`streams output to ${output} with -n`, async () => {
    const f = fixture(["-n", "-i", "in.mp4", "-c", "copy", "-f", "mp4", output]);
    f.context.fs.stat = async () => { throw new Error("must not stat stdout"); };
    assert.equal((await createFfmpegCommand().execute(f.context)).exitCode, 0);
    assert.ok(f.output.length > 0);
    assert.deepEqual(Object.keys(f.files), ["/in.mp4"]);
  });
}
for (const probe of [false, true]) {
  it(`stops ${probe ? "ffprobe" : "ffmpeg"} stdin at the first over-budget chunk`, async () => {
    const f = fixture(probe ? ["-"] : ["-i", "-", "out.mp4"]);
    const error = Object.assign(new Error("input limit"), { name: "BudgetExceededError" });
    f.context.inputBudget!.check = n => { f.totals.push(n); throw error; };
    await assert.rejects(async () => (probe ? createFfprobeCommand() : createFfmpegCommand()).execute(f.context), e => e === error);
    assert.deepEqual(f.totals, [10]);
  });
}

for (const command of [createFfmpegCommand, createFfprobeCommand]) {
  it(`${command.name} accounts for shared initialization and segment resources`, async () => {
    const playlist = new TextEncoder().encode('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:1,\npart.m4s\n');
    const files = { "/index.m3u8": playlist, "/init.mp4": media, "/part.m4s": new Uint8Array([1, 2, 3]) };
    const args = command === createFfmpegCommand ? ["-i", "index.m3u8", "out.mp4"] : ["index.m3u8"];
    const f = fixture(args, files);
    const total = playlist.length + media.length + 3;
    const result = await command({ limits: { maxInputBytes: total - 1 } }).execute(f.context);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(f.totals, [playlist.length, playlist.length + media.length, total]);
    assert.ok(f.errors.join("").includes("maxInputBytes"));
  });
}
