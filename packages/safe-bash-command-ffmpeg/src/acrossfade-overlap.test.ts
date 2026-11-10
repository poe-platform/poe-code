import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string) {
  const volume = Volume.fromJSON({ "/out.pcm": "sentinel" });
  for (const [name, length, value] of [["a", 1301, 12000], ["b", 891, -4000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(length).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, output: volume.readFileSync("/out.pcm") };
}

it("acrossfade trims whitespace at option key and value boundaries", async () => {
  const control = await run("ns=4:o=1");
  assert.equal(control.result.exitCode, 0, control.stderr);
  for (const options of [
    "ns=4: o = 1", "ns=4:o= 1", " ns = 4 : overlap = 1 ",
    "\tnb_samples\t=\t4\t:\to\t=\t1\t", " 4 : 0 : 1 ",
    " ns = 4 : duration = 0 : o = 1 : curve1 = tri : curve2 = tri "
  ]) {
    const actual = await run(options);
    assert.equal(actual.result.exitCode, 0, `${options}: ${actual.stderr}`);
    assert.deepEqual(actual.output, control.output, options);
  }
});

it("acrossfade still rejects invalid options after trimming whitespace", async () => {
  for (const [options, error] of [
    ["ns=4: unknown = 1 ", "unsupported option unknown"],
    ["ns=4: o = 2 ", "invalid overlap"],
    ["ns=4: o = tr ue ", "invalid overlap"],
    [" ns = 0 : o = 1 ", "invalid sample count"]
  ] as const) {
    const actual = await run(options);
    assert.equal(actual.result.exitCode, 1, options);
    assert.ok(actual.stderr.includes(`acrossfade: ${error}`), actual.stderr);
    assert.equal(actual.output.toString(), "sentinel");
  }
});

for (const prefix of ["ns=128:o=", "ns=128:overlap=", "128:0:"]) {
  for (const [overlap, values] of [
    [false, ["0", "no", "No", "OFF", "off", "false", "FaLsE", "n", "disable", "disabled", "", "-0", "00"]],
    [true, ["1", "yes", "YES", "on", "On", "true", "TrUe", "y", "enable", "enabled", "+1", "01"]]
  ] as const) {
    it(`acrossfade ${prefix} accepts native ${overlap ? "true" : "false"} spellings without changing PCM`, async () => {
      const control = await run(`ns=128:o=${overlap ? 1 : 0}`);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.equal(control.output.length, (overlap ? 2064 : 2192) * 2);
      for (const value of values) {
        if (prefix === "128:0:" && value === "") continue;
        const { result, stderr, output } = await run(`${prefix}${value}`);
        assert.equal(result.exitCode, 0, `${value}: ${stderr}`);
        assert.deepEqual(output, control.output, value);
      }
    });
  }
  it(`acrossfade ${prefix} rejects invalid Boolean values without replacing output`, async () => {
    for (const value of ["2", "-1", "1.0", "0x1", "auto", "none", "truejunk"]) {
      const { result, stderr, output } = await run(`${prefix}${value}`);
      assert.equal(result.exitCode, 1, value);
      assert.ok(stderr.includes("acrossfade: invalid overlap"), stderr);
      assert.equal(output.toString(), "sentinel", value);
    }
  });
}
