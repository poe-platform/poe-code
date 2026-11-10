import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const existing of [false, true]) {
    it(`missing numeric channel leaves an empty PCM file (graph=${graph}, existing=${existing})`, async () => {
      const { volume, result, stderr } = await run("2|0", graph, existing, existing ? ["-y"] : []);
      assert.equal(result.exitCode, 234, stderr);
      assert.equal(volume.readFileSync("/out.raw").length, 0);
      assert.equal(stderr, "ffmpeg: channelmap: unavailable input channel 2\n");
    });
  }
  it(`valid channelmap preserves PCM bytes (graph=${graph})`, async () => {
    const { volume, result, stderr } = await run("0|1", graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "64009cffc80038ff");
  });
}

for (const overwrite of [[], ["-n"]]) {
  it(`missing channel respects existing-file protection (${overwrite[0] ?? "default"})`, async () => {
    const { volume, stderr } = await run("2|0", false, true, overwrite);
    assert.ok(stderr.includes("already exists"), stderr);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

for (const [format, target] of [["null", "/out.raw"], ["s16le", "-"], ["s16le", "/dev/null"], ["s16le", "md5:/out.raw"]]) {
  it(`missing channel creates no file for ${format} ${target}`, async () => {
    const { volume, result, stderr } = await run("2|0", false, false, ["-y"], format, target);
    assert.equal(result.exitCode, 234, stderr);
    assert.deepEqual(volume.readdirSync("/"), ["in.raw"]);
  });
}

async function run(map: string, graph: boolean, existing = false, overwrite: string[] = [], format = "s16le", target = "/out.raw") {
  const volume = Volume.fromJSON(existing ? { "/out.raw": "KEEP" } : {});
  volume.writeFileSync("/in.raw", Buffer.from("64009cffc80038ff", "hex"));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: [...overwrite, "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:a]channelmap=${map}[out]`, "-map", "[out]"] : ["-af", `channelmap=${map}`]),
      "-c:a", "pcm_s16le", "-f", format, target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
