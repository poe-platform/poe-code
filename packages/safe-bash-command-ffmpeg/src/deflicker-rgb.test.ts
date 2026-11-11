import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(format: string, input: Buffer, filter: string, graph = false, size = "2x2") {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", size,
      "-framerate", "2", "-i", "/in.raw",
      ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
      "-fps_mode", "passthrough", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
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
  return Buffer.concat(stdout);
}

// FFmpeg 7.0.2, 2x2 raw frames at 2 fps, deflicker=s=2 and packed output.
const cases = [
  ["rgb24", "114477aadd104376a9dc0f4275a8db0e4174a7da0d4073a6d90c3f72a5d80b3e71a4d70a",
    "15487bb7ea1e4b7eb1e216486fa2d50b3e71a0d3073c6fa2d80c3f73a5d90b3e71a3d60a"],
  ["rgba", "114477aadd104376a9dc0f4275a8db0e4174a7da0d4073a6d90c3f72a5d80b3e71a4d70a3d70a3d6093c6fa2d5083b6e",
    "0c3f72abd60a3d769dd105426a9dd00e3d70a3db0a3d70a7d5093c729dd1053e71a4d70a3d70a3d7093b6fa3d5093c6e"],
  ["rgb48le", "114477aadd104376a9dc0f4275a8db0e4174a7da0d4073a6d90c3f72a5d80b3e71a4d70a3d70a3d6093c6fa2d5083b6ea1d4073a6da0d306396c9fd205386b9ed104376a9dd00336",
    "703eefa4590ba76e29d5913ae9a4420b967026d5813ad3a05a10b07526dc134291a8fc0ec97548dcb1410ea5680bbb70abd4053a58a0dd06336cabd2f437729edd04256aa4d00d36"]
] as const;

for (const [format, input, expected] of cases) {
  for (const graph of [false, true]) for (const filter of ["null", "deflicker=s=2"]) {
    it(`matches native ${format} bytes for ${filter} (graph=${graph})`, async () => {
      const output = await run(format, Buffer.from(input, "hex"), filter, graph);
      assert.equal(output.toString("hex"), filter === "null" ? input : expected);
    });
  }
}

// FFmpeg 7.0.2 references exercise chroma rounding, alpha and both 16-bit byte orders.
for (const [format, channels, filtered, bypassed] of [
  ["rgb24", 3, "874b8fd0c7a017b076bb09334a0e953a3d12bbcd11c8f31ed2424218904c3cfa", "723fbee576cd4435f2a950a2d26484e2f7f5018ede20d374f055a436e8955176"],
  ["rgba", 4, "1322798cb6421b0d4d7788f792b5d5c5b70fc7d59669b1180932576575d167a0", "280a4ad65035de89ed9efde793a99e1007eabc0390f8f9df94dbf45ad0ae8866"],
  ["rgb48le", 6, "cc3404a86eaf3b084d155b18cfcd70866bf12bb5bb2ffea60cdbcec7b624b7ea", "52761a1cc2bbd3f4a656a1f40b988eb34b68cd4a041d682328b776d785a95ae3"],
  ["rgb48be", 6, "a130affc0c4b05d57add108bb4c8fbc93a21f10e9749273dc32a84f062c1bd6a", "bd9c587ff7d228470f4aeb1d2f5f860ce212acad13d383b6e8b35037bb2c8226"]
] as const) for (const bypass of [false, true]) {
  it(`matches native ${format} negotiation for odd dimensions (bypass=${bypass})`, async () => {
    const input = Buffer.from(Array.from({ length: 5 * 3 * channels * 4 }, (_, i) => (i * 73 + Math.floor(i / 7) * 31) % 256));
    const output = await run(format, input, `deflicker=s=2:bypass=${Number(bypass)}`, false, "5x3");
    assert.equal(output.length, input.length);
    assert.equal(createHash("sha256").update(output).digest("hex"), bypass ? bypassed : filtered);
  });
}
