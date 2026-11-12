import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, bits = 32, values = [0, bits === 32 ? 2 ** -149 : Number.MIN_VALUE, bits === 32 ? -(2 ** -148) : -2 * Number.MIN_VALUE, 0.125]) {
  const bytes = bits / 8;
  const input = Buffer.alloc(44 + values.length * bytes);
  input.write("RIFF");
  input.writeUInt32LE(input.length - 8, 4);
  input.write("WAVEfmt ", 8);
  input.writeUInt32LE(16, 16);
  input.writeUInt16LE(3, 20);
  input.writeUInt16LE(1, 22);
  input.writeUInt32LE(8000, 24);
  input.writeUInt32LE(8000 * bytes, 28);
  input.writeUInt16LE(bytes, 32);
  input.writeUInt16LE(bits, 34);
  input.write("data", 36);
  input.writeUInt32LE(values.length * bytes, 40);
  values.forEach((value, i) => bits === 32 ? input.writeFloatLE(value, 44 + i * bytes) : input.writeDoubleLE(value, 44 + i * bytes));
  const volume = Volume.fromJSON({ "/in.wav": input });
  let stderr = "";
  const stdout: Buffer[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af", filter, "-f", "s16le", "pipe:1"],
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
  assert.equal(result.exitCode, 0, stderr);
  return { stderr, output: Buffer.concat(stdout).toString("hex"), volume };
}

const flags = "Number_of_NaNs+Number_of_Infs+Number_of_denormals";
for (const bits of [32, 64]) {
  for (const options of ["", `=measure_perchannel=${flags}:measure_overall=${flags}`]) {
    it(`reports float${bits} counters with ${options || "default measurements"}`, async () => {
      const { stderr } = await run(`astats${options}`, bits);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("Number of") && !line.startsWith("Number of samples")), [
        "Number of NaNs: 0", "Number of Infs: 0", "Number of denormals: 2",
        "Number of NaNs: 0.000000", "Number of Infs: 0.000000", "Number of denormals: 2.000000"
      ]);
    });
  }
}
for (const key of ["lavfi.astats.Number of denormals", "lavfi.astats.1.Number of denormals", "lavfi.astats.Overall.Max_level"]) {
  it(`retains the frame selected by ${key}`, async () => {
    assert.equal((await run(`astats=metadata=1,ametadata=select:key=${key}:value=0:function=greater`)).output, "0000000000000010");
  });
}
it("omits floating counters after integer conversion", async () => {
  const { stderr } = await run("aformat=sample_fmts=s16,astats");
  assert.ok(stderr.includes("Number of samples: 4"));
  assert.ok(!stderr.includes("Number of denormals"));
  assert.ok(!stderr.includes("Number of NaNs"));
  assert.ok(!stderr.includes("Number of Infs"));
});

it("uses current floating precision when classifying subnormals", async () => {
  const { stderr } = await run("aformat=sample_fmts=dbl,astats");
  assert.ok(stderr.includes("Number of denormals: 0\n"));
});

it("publishes masked counters cumulatively and honors frame resets", async () => {
  for (const reset of [0, 1]) {
    const { volume } = await run(`asetnsamples=n=2:p=0,astats=metadata=1:reset=${reset}:measure_perchannel=Number_of_denormals:measure_overall=Number_of_denormals,ametadata=print:file=/tags.txt`);
    assert.equal(volume.readFileSync("/tags.txt", "utf8"),
      "frame:0    pts:0       pts_time:0\n" +
      "lavfi.astats.1.Number of denormals=1.000000\n" +
      "lavfi.astats.Number of denormals=1.000000\n" +
      "frame:1    pts:2       pts_time:0.00025\n" +
      `lavfi.astats.1.Number of denormals=${reset ? 1 : 2}.000000\n` +
      `lavfi.astats.Number of denormals=${reset ? 1 : 2}.000000\n`);
  }
});
