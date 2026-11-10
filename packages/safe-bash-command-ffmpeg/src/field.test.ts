import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: Buffer, filter: string, format = "yuv444p", muxer = "yuv4mpegpipe") {
  const volume = Volume.fromJSON({ "/in.y4m": input, "/out": "KEEP" });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", muxer, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out") as Buffer };
}

for (const color of [false, true]) {
  const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
    ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
  ]));
  const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
    ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);

  for (const [field, parity, hash] of [
    ["top", 0, "f5c08b7279cdab89f1b6fb013b706e08bb0e255a4d2c4618740d820dc46f6bda"],
    ["bottom", 1, "dc7068b74317e3b6b758c2fafcc79debaa8248255232edbca2c0ac440214fcdc"]
  ] as const) {
    for (const option of [field, `type=${field}`, String(parity), `type=${parity}`, ...(parity === 0 ? [""] : [])]) {
      it(`extracts ${color ? "color" : "gray"} ${field} rows with field${option ? `=${option}` : ""}`, async () => {
        const result = await run(input, `field${option ? `=${option}` : ""}`);
        assert.equal(result.exitCode, 0, result.stderr);
        const headerEnd = result.output.indexOf(10);
        assert.deepEqual(result.output.subarray(0, headerEnd).toString().split(" ").slice(0, 7),
          ["YUV4MPEG2", "W4", "H2", "F6:1", "Ip", "A1:1", "C444"]);
        const expected = frames.map(frame => Buffer.concat(Array.from({ length: 6 }, (_, row) =>
          frame.subarray((row * 2 + parity) * 4, (row * 2 + parity + 1) * 4))));
        assert.deepEqual(result.output.subarray(headerEnd + 1),
          Buffer.concat(expected.flatMap(frame => [Buffer.from("FRAME\n"), frame])));
        if (!color) {
          // Native Linux FFmpeg 7.0.2 payload hashes, excluding Y4M framing.
          const payload = Buffer.concat(Array.from({ length: 6 }, (_, i) =>
            result.output.subarray(headerEnd + 7 + i * 30, headerEnd + 31 + i * 30)));
          assert.equal(createHash("sha256").update(payload).digest("hex"), hash);
        }
      });
    }
  }

  it(`preserves the ${color ? "color" : "gray"} null control`, async () => {
    const result = await run(input, "null");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, input);
  });

  it(`retains ${color ? "color" : "gray"} field timestamps and clears interlacing`, async () => {
    const interlaced = Buffer.from(input.toString("latin1").replace(" Ip ", " It "), "latin1");
    const result = await run(interlaced, "field=bottom,select=eq(t\\,1/3)*eq(interlace_type\\,PROGRESSIVE)");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.subarray(result.output.indexOf(10) + 1).length, 30);
    assert.equal(result.output[result.output.indexOf(10) + 7], 83);
  });

  for (const option of ["type=sideways", "type=2", "unknown=top", "top:bottom", "top:enable=1"]) {
    it(`rejects field=${option} without replacing output (${color ? "color" : "gray"})`, async () => {
      const result = await run(input, `field=${option}`);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("field:"), result.stderr);
      assert.equal(result.output.toString(), "KEEP");
    });
  }

  it(`extracts modified ${color ? "color" : "gray"} RGB rows after native planes are invalidated`, async () => {
    const source = await run(input, "format=rgba,negate", "rgba", "rawvideo");
    assert.equal(source.exitCode, 0, source.stderr);
    const result = await run(input, "format=rgba,negate,field=bottom", "rgba", "rawvideo");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, Buffer.concat(Array.from({ length: 12 }, (_, row) =>
      source.output.subarray((row * 2 + 1) * 16, (row * 2 + 2) * 16))));
  });
}

for (const [chroma, format, hsub, vsub, depth] of [
  ["422", "yuv422p", 2, 1, 8],
  ["420jpeg", "yuv420p", 2, 2, 8],
  ["444p10", "yuv444p10le", 1, 1, 10],
  ["444p16", "yuv444p16le", 1, 1, 16]
] as const) {
  for (const parity of [0, 1]) {
    it(`selects field ${parity} independently in each ${format} plane`, async () => {
      const planes = Array.from({ length: 3 }, (_, p) => {
        const width = p === 0 ? 4 : 4 / hsub;
        const height = p === 0 ? 4 : 4 / vsub;
        const data = Buffer.alloc(width * height * (depth === 8 ? 1 : 2));
        for (let i = 0; i < width * height; i++) {
          const sample = (30 + p * 60 + i) * 2 ** (depth - 8) + (depth === 8 ? 0 : 3);
          if (depth === 8) data[i] = sample;
          else data.writeUInt16LE(sample, i * 2);
        }
        return data;
      });
      const input = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 It A1:1 C${chroma}\nFRAME\n`), ...planes]);
      const expected = Buffer.concat(planes.map((plane, p) => {
        const height = p === 0 ? 4 : 4 / vsub;
        const stride = plane.length / height;
        return Buffer.concat(Array.from({ length: height / 2 }, (_, row) =>
          plane.subarray((row * 2 + parity) * stride, (row * 2 + parity + 1) * stride)));
      }));
      const result = await run(input, `field=${parity}`, format, "rawvideo");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected);
      const extracted = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H2 F6:1 Ip A1:1 C${chroma}\nFRAME\n`), expected]);
      const rgb = await run(input, `field=${parity},format=rgba`, "rgba", "rawvideo");
      const control = await run(extracted, "scale=iw:ih,format=rgba", "rgba", "rawvideo");
      assert.equal(rgb.exitCode, 0, rgb.stderr);
      assert.equal(control.exitCode, 0, control.stderr);
      assert.deepEqual(rgb.output, control.output);
    });
  }
}
