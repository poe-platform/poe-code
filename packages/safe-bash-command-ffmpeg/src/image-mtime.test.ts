import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

async function run(inputArgs: string[], outputArgs: string[] = []) {
  const volume = new Volume();
  for (const index of [1, 2, 4, 5, 8]) {
    const path = `/f-${String(index).padStart(2, "0")}.png`;
    volume.writeFileSync(path, encodeImage({
      width: 2, height: 2, channels: 3,
      data: Uint8Array.from({ length: 16 }, (_, channel) => [20 * index, 0, 0, 255][channel % 4]!),
      format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
    }, { format: "png" }).data);
    volume.utimesSync(path, 1700000000 + 1.25 * index, 1700000000 + 1.25 * index);
  }
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...inputArgs, "-fps_mode", "passthrough", "-enc_time_base", "demux",
      "-pix_fmt", "rgb24", ...outputArgs, "-f", "framecrc", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); },
      async readdir(path: string) { return volume.readdirSync(path, { withFileTypes: true }); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout, stderr };
}

for (const [mode, clock, gap] of [[undefined, 25, 1], ["0", 25, 1], ["1", 1, 1], ["2", 1000000000, 1250000000]] as const) {
  it(`uses image2 timestamp mode ${mode ?? "default"} without changing payloads or crossing sequence gaps`, async () => {
    const result = await run(["-f", "image2", ...(mode === undefined ? [] : ["-ts_from_file", mode]), "-i", "f-%02d.png"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes(`#tb 0: 1/${clock}\n`), result.stdout);
    assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(value => value.trim())), [
      ["0", "0", "0", "1", "12", "0x02580050"],
      ["0", String(gap), String(gap), "1", "12", "0x04b000a0"]
    ]);
  });
}

it("applies file timestamps to glob inputs in filename order", async () => {
  const result = await run(["-f", "image2", "-pattern_type", "glob", "-ts_from_file", "2", "-i", "f-*.png"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")).map(line => Number(line.split(",")[2])),
    [0, 1250000000, 3750000000, 5000000000, 8750000000]);
});

for (const format of [[], ["-f", "image2"]]) {
  it(`preserves a literal image mtime with -copyts ${format.join(" ")}`, async () => {
    const result = await run([...format, "-ts_from_file", "1", "-i", "f-01.png"], ["-copyts"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(result.stdout.includes("#tb 0: 1/1\n"), result.stdout);
    assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")).map(line => Number(line.split(",")[2])), [1700000001]);
  });
}

it("resets ts_from_file after each input", async () => {
  const result = await run(["-f", "image2", "-ts_from_file", "2", "-i", "f-%02d.png", "-f", "image2", "-i", "f-%02d.png"], ["-map", "1:v"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("#tb 0: 1/25\n"), result.stdout);
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")).map(line => Number(line.split(",")[2])), [0, 1]);
});

for (const value of ["-1", "3", "1.5", "bad", ""]) {
  it(`rejects invalid ts_from_file ${JSON.stringify(value)}`, async () => {
    const result = await run(["-ts_from_file", value, "-i", "f-%02d.png"]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("ts_from_file"), result.stderr);
    assert.equal(result.stdout, "");
  });
}

it("retains an explicit frame rate when file timestamps are disabled", async () => {
  const result = await run(["-framerate", "2", "-ts_from_file", "0", "-i", "f-%02d.png"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("#tb 0: 1/2\n"), result.stdout);
});

it("rebases file timestamps with -copyts -start_at_zero", async () => {
  const result = await run(["-ts_from_file", "2", "-i", "f-%02d.png"], ["-copyts", "-start_at_zero"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\n").filter(line => line.startsWith("0,")).map(line => Number(line.split(",")[2])), [0, 1250000000]);
});

it("preserves encoded image packets while copying file timestamps", async () => {
  const baseline = await run(["-i", "f-%02d.png"], ["-c:v", "copy"]);
  const result = await run(["-ts_from_file", "2", "-i", "f-%02d.png"], ["-c:v", "copy"]);
  assert.equal(baseline.exitCode, 0, baseline.stderr);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(result.stdout.includes("#tb 0: 1/1000000000\n"), result.stdout);
  const rows = (text: string) => text.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(value => value.trim()));
  assert.deepEqual(rows(result.stdout).map(row => row.slice(4)), rows(baseline.stdout).map(row => row.slice(4)));
  assert.deepEqual(rows(result.stdout).map(row => row.slice(1, 4)), [["0", "0", "1"], ["1250000000", "1250000000", "1"]]);
});
