import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg outputs: three 2x2 frames at 1 fps.
// The first three fixtures reproduce the FFmpeg 7.0.2 reports; the rest cover
// byte order, accumulator width, plane selection, and weighted clipping.
const cases = [
  {
    format: "gray16le", filter: "tmix=frames=2",
    input: "ff03ff03ff03ff0301000100010001000903090309030903",
    expected: "ff03ff03ff03ff0300020002000200028501850185018501"
  },
  {
    format: "rgb48le", filter: "tmix=frames=2:weights=1 3",
    input: "ff0300010003ff0300010003ff0300010003ff030001000301008900400301008900400301008900400301008900400309034d019a0209034d019a0209034d019a0209034d019a02",
    expected: "ff0300010003ff0300010003ff0300010003ff03000100030001a70030030001a70030030001a70030030001a700300347021c01c40247021c01c40247021c01c40247021c01c402"
  },
  {
    format: "yuv444p10le", filter: "tmix=frames=2:planes=0",
    input: "ff03ff03ff03ff030001000100010001000300030003000301000100010001008900890089008900400340034003400309030903090309034d014d014d014d019a029a029a029a02",
    expected: "ff03ff03ff03ff0300010001000100010003000300030003ff03ff03ff03ff0300010001000100010003000300030003010001000100010089008900890089004003400340034003"
  },
  {
    format: "gray16be", filter: "tmix=frames=2",
    input: "ffffffffffffffff0001000100010001c351c351c351c351",
    expected: "ffffffffffffffff800080008000800061a961a961a961a9"
  },
  {
    format: "gray16be", filter: "tmix=frames=2:weights=1 3:planes=1",
    input: "ffffffffffffffff0001000100010001c351c351c351c351",
    expected: "ffffffffffffffff4000400040004000927d927d927d927d"
  },
  {
    format: "gray16be", filter: "tmix=frames=2:weights=1 3:scale=1",
    input: "ffffffffffffffff0001000100010001c351c351c351c351",
    expected: "ffffffffffffffffffffffffffffffffffffffffffffffff"
  },
  {
    format: "rgba64be", filter: "tmix=frames=2",
    input: "ffff03ff0003fffaffff03ff0003fffaffff03ff0003fffaffff03ff0003fffa0001c3510009ea600001c3510009ea600001c3510009ea600001c3510009ea6056cf9c430005ffff56cf9c430005ffff56cf9c430005ffff56cf9c430005ffff",
    expected: "ffff03ff0003fffaffff03ff0003fffaffff03ff0003fffaffff03ff0003fffa800063a80006f52d800063a80006f52d800063a80006f52d800063a80006f52d2b68afca0007f5302b68afca0007f5302b68afca0007f5302b68afca0007f530"
  },
  {
    format: "rgba64be", filter: "tmix=frames=2:weights=1 3:planes=1",
    input: "ffff03ff0003fffaffff03ff0003fffaffff03ff0003fffaffff03ff0003fffa0001c3510009ea600001c3510009ea600001c3510009ea600001c3510009ea6056cf9c430005ffff56cf9c430005ffff56cf9c430005ffff56cf9c430005ffff",
    expected: "ffff03ff0003fffaffff03ff0003fffaffff03ff0003fffaffff03ff0003fffa4000937c0008efc64000937c0008efc64000937c0008efc64000937c0008efc6411ca6060006fa97411ca6060006fa97411ca6060006fa97411ca6060006fa97"
  },
  {
    format: "rgba64be", filter: "tmix=frames=2:weights=1 3:scale=1",
    input: "ffff03ff0003fffaffff03ff0003fffaffff03ff0003fffaffff03ff0003fffa0001c3510009ea600001c3510009ea600001c3510009ea600001c3510009ea6056cf9c430005ffff56cf9c430005ffff56cf9c430005ffff56cf9c430005ffff",
    expected: "ffff0ffc000cffffffff0ffc000cffffffff0ffc000cffffffff0ffc000cffffffffffff001effffffffffff001effffffffffff001effffffffffff001effffffffffff0018ffffffffffff0018ffffffffffff0018ffffffffffff0018ffff"
  },
  {
    format: "yuv420p16le", filter: "tmix=frames=2",
    input: "ffffffffffffffffff0351c30100010001000100f50161ea439c439c439c439ce7033175",
    expected: "ffffffffffffffffff0351c30080008000800080fa02d9d6224e224e224e224eee02c9af"
  },
  {
    format: "yuv420p16le", filter: "tmix=frames=2:weights=1 3:planes=1",
    input: "ffffffffffffffffff0351c30100010001000100f50161ea439c439c439c439ce7033175",
    expected: "ffffffffffffffffff0351c30040004000400040ff0351c33275327532753275f50161ea"
  },
  {
    format: "yuv420p16le", filter: "tmix=frames=2:weights=1 3:scale=1",
    input: "ffffffffffffffffff0351c30100010001000100f50161ea439c439c439c439ce7033175",
    expected: "fffffffffffffffffc0fffffffffffffffffffffde09ffffffffffffffffffffaa0dffff"
  },
  {
    format: "yuv444p10le", filter: "tmix=frames=2",
    input: "ff03ff03ff03ff030001000100010001000300030003000301000100010001008900890089008900400340034003400309030903090309034d014d014d014d019a029a029a029a02",
    expected: "ff03ff03ff03ff03000100010001000100030003000300030002000200020002c500c500c500c50020032003200320038501850185018501eb00eb00eb00eb00ed02ed02ed02ed02"
  },
  {
    format: "yuv444p10le", filter: "tmix=frames=2:weights=1 3:planes=1",
    input: "ff03ff03ff03ff030001000100010001000300030003000301000100010001008900890089008900400340034003400309030903090309034d014d014d014d019a029a029a029a02",
    expected: "ff03ff03ff03ff0300010001000100010003000300030003000100010001000100010001000100010003000300030003470247024702470289008900890089004003400340034003"
  },
  {
    format: "yuv444p10le", filter: "tmix=frames=2:weights=1 3:scale=1",
    input: "ff03ff03ff03ff030001000100010001000300030003000301000100010001008900890089008900400340034003400309030903090309034d014d014d014d019a029a029a029a02",
    expected: "ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff039b029b029b029b02ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03ff03"
  }
];

for (const { format, filter, input, expected } of cases) {
  for (const selected of [filter, "null", "tmix=frames=1"]) {
    it(`preserves source precision for ${format} with ${selected}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "2x2",
          "-framerate", "1", "-i", "/in.raw", "-vf", selected, "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(stdout).toString("hex"), selected === filter ? expected : input);
    });
  }
}
