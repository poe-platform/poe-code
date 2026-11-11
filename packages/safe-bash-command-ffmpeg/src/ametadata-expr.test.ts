import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.from("2823000000000000282300000000000000002823000000000000000000000000", "hex");

async function run(selection: string, tagValue = "3", prefix = "") {
  const volume = Volume.fromJSON({ "/in.raw": pcm, "/tags": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "in.raw",
      "-af", `asetnsamples=n=4:p=0,${prefix}ametadata=mode=add:key=k:value=${tagValue},ametadata=${selection},ametadata=mode=print:file=tags`,
      "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, stdout: Buffer.concat(stdout), tags: volume.readFileSync("/tags", "utf8") };
}

// Native FFmpeg 7.0.2: comparison operands, aliases, and integer truth conversion.
for (const [options, keep] of [
  ["value=2:function=expr:expr=gt(VALUE1\\,VALUE2)", true],
  ["value=4:function=expr:expr=gt(VALUE1\\,VALUE2)", false],
  ["value=2:function=expr:expr='gt(FRAMEVAL,USERVAL)'", true],
  ["value=4:function=expr:expr='gt(FRAMEVAL,USERVAL)'", false],
  ["value=3:function=same_str", true],
  ["value=2:function=expr:expr=0.5", false],
  ["value=2:function=expr:expr=-1", true],
  ["value=2:function=expr:expr=0/0", true],
  ["value=2:function=expr:expr='gt(VALUE1/(VALUE2-2),0)'", true],
  ["function=expr:expr=0", true],
  ["value=word:function=expr:expr=1", false]
] as const) {
  it(`selects audio using ${options}`, async () => {
    const result = await run(`mode=select:key=k:${options}`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, keep ? pcm : Buffer.alloc(0));
    assert.equal(result.tags, keep ? [0, 4, 8, 12].map((pts, n) =>
      `frame:${String(n).padEnd(5)}pts:${String(pts).padEnd(7)} pts_time:${pts / 1000}\nk=3\n`).join("") : "");
  });
}

it("evaluates each frame's value and preserves selected timestamps", async () => {
  const result = await run("mode=select:key=k:value=2:function=expr:expr='gt(VALUE1,VALUE2)'", "3",
    "ametadata=mode=add:key=k:value=1:enable='eq(n,1)',");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.concat([pcm.subarray(0, 8), pcm.subarray(16)]));
  assert.equal(result.tags, "frame:0    pts:0       pts_time:0\nk=3\n"
    + "frame:1    pts:8       pts_time:0.008\nk=3\nframe:2    pts:12      pts_time:0.012\nk=3\n");
});

it("keeps expression registers across frames without evaluating validation as a frame", async () => {
  const result = await run("mode=select:key=k:value=2:function=expr:expr='gt(st(0,ld(0)+1),VALUE2)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, pcm.subarray(16));
});

for (const tag of ["word", ""]) {
  it(`drops nonnumeric metadata ${JSON.stringify(tag)} even for a constant true expression`, async () => {
    const result = await run("mode=select:key=k:value=2:function=expr:expr=1", tag);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, 0);
  });
}

for (const options of ["function=expr", "function=expr:expr=", "function=expr:expr=gt(VALUE1)", "function=expr:expr=UNKNOWN"]) {
  it(`rejects ${options} before replacing output`, async () => {
    const result = await run(`mode=select:key=missing:value=2:${options}`);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes("ametadata"), result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.tags, "KEEP");
  });
}

for (const mode of ["print", "delete"]) {
  for (const value of [2, 4]) {
    it(`applies expression matching to ${mode} with VALUE2=${value}`, async () => {
      const result = await run(`mode=${mode}:key=k:value=${value}:function=expr:expr='gt(VALUE1,VALUE2)'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.stdout, pcm);
      if (mode === "print") assert.equal(result.stderr.includes("k=3"), value === 2);
      else assert.equal(result.tags.includes("k=3"), value !== 2);
    });
  }
}

it("bypasses disabled frames without advancing expression registers", async () => {
  const result = await run("mode=select:key=k:value=2:function=expr:expr='gt(st(0,ld(0)+1),VALUE2)':enable='gt(n,0)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.concat([pcm.subarray(0, 8), pcm.subarray(24)]));
});

for (const [tag, value, expression] of [
  ["3tail", "2suffix", "gt(VALUE1,VALUE2)"],
  ["0x3", "0x1p1", "gt(VALUE1,VALUE2)"],
  ["NaN", "2", "isnan(VALUE1)"],
  ["3", "NaN", "isnan(VALUE2)"],
  ["inf", "2", "gt(VALUE1,VALUE2)"],
  ["3", "-inf", "gt(VALUE1,VALUE2)"],
  ["1.0000000001", "1", "gt(VALUE1,VALUE2)"]
]) {
  it(`compares native double operands ${tag} and ${value}`, async () => {
    const result = await run(`mode=select:key=k:value=${value}:function=expr:expr='${expression}'`, tag);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, pcm);
  });
}
