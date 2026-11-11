import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg rawvideo output for two frames with bytes (7 + 29 * i) % 256.
const cases = [
  [
    "gray",
    "w=2:h=2:t=1:c=red",
    "4c4c4c4c4c984cd24c4c4c4c4c804cba4c4c4c4c4c684ca24c4c4c4c4c504c8a"
  ],
  [
    "rgba",
    "x=1:y=1:w=3:h=3:t=1:c=white@0.5",
    "0724415ebccbd9d2ef0c294663809dbaeaf9872ea4b3c1a2deedfb1698a7b58aa7c4e1fe8c9ba9728facc9e603203d5a7794b1cef48391425f7c99b6d3f00d2a4764819edcebf9122f4c6986a3c0ddfa8a99a76ec4d3e1e2ff8d9b56b8c7d5cae704213eacbbc9b2cfec092643607d9ab7d4f10e94a3b1829fbcd9f613304d6a"
  ],
  [
    "rgba",
    "-1:-2:3:4:red:2",
    "ff00005e7b98b5d2ff000046ff0000baff00002e4b6885a2ff000016ff00008aff0000feff000072ff0000e6ff00005aff0000ceff000042ff0000b6ff00002aff00009ebbd8f512ff000086ff0000faff00006e8ba8c5e2ff000056ff0000caff00003eff0000b2ff000026ff00009aff00000eff000082ff0000f6ff00006a"
  ],
  [
    "rgba",
    "width=iw/2:height=ih/2:color=red:thickness=0",
    "0724415e7b98b5d2ef0c294663809dbad7f4112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794b1ceeb0825425f7c99b6d3f00d2a4764819ebbd8f5122f4c6986a3c0ddfa1734516e8ba8c5e2ff1c39567390adcae704213e5b7895b2cfec092643607d9ab7d4f10e2b4865829fbcd9f613304d6a"
  ],
  [
    "rgba",
    "w=3:h=3:t=fill:c=white@0.5:replace=1",
    "ffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7fffffff7f"
  ],
  [
    "rgba",
    "",
    "0000005e000000d200000046000000ba0000002e4b6885a2bfdcf91633506d8a000000fe1b3855728facc9e603203d5a000000ceeb0825425f7c99b6d3f00d2a0000009e0000001200000086000000fa0000006e8ba8c5e2ff1c39567390adca0000003e5b7895b2cfec092643607d9a0000000e2b4865829fbcd9f613304d6a"
  ],
  [
    "rgba",
    "x=5:y=5:w=3:h=3:c=invert",
    "0724415e7b98b5d210f3d64663809dbad7f4112e4b6885a24023061633506d8a583b1efee4c7aa72705336e6fcdfc25a7794b1ceeb082542a08366b6d3f00d2a4764819ebbd8f512d0b39686a3c0ddfa1734516e8ba8c5e200e3c6567390adca18fbde3ea4876ab23013f626bc9f829ab7d4f10e2b486582604326f613304d6a"
  ],
  [
    "rgba",
    "w=2:h=3:c=red:enable=lt(n\\,1)",
    "ff00005eff0000d2ff000046ff0000baff00002e4b6885a2ff00001633506d8aff0000fe1b385572ff0000e603203d5aff0000ceff000042ff0000b6ff00002a4764819ebbd8f5122f4c6986a3c0ddfa1734516e8ba8c5e2ff1c39567390adcae704213e5b7895b2cfec092643607d9ab7d4f10e2b4865829fbcd9f613304d6a"
  ]
] as const;

for (const [format, options, expected] of cases) {
  it(`drawgrid ${format} ${options} matches native pixels across two frames`, async () => {
    const input = Buffer.from(Array.from({ length: (format === "gray" ? 16 : 64) * 2 }, (_, i) => (7 + 29 * i) % 256));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format, "-video_size", "4x4",
        "-framerate", "2", "-i", "/in.raw", "-vf", `drawgrid${options ? `=${options}` : ""}`,
        "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
