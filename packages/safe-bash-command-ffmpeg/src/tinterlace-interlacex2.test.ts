import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const order of ["p", "t", "b"]) {
  for (const color of [false, true]) {
    for (const mode of ["interlacex2", "mode=interlacex2", "6"]) {
      it(`doubles tinterlace cadence and preserves ${order} ${color ? "color" : "gray"} planes with ${mode}`, async () => {
        const frames = Array.from({ length: 6 }, (_, i) => Buffer.from(
          Array.from({ length: 48 }, (_, n) => {
            const row = Math.floor(n % 16 / 4);
            return n < 16 ? 32 + 24 * i + 3 * row : !color ? 128
              : n < 32 ? 35 + 9 * i + row : 216 - 8 * i - row;
          })
        ));
        const volume = Volume.fromJSON({
          "/in.y4m": Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H4 F6:1 I${order} A1:1 C444\n`),
            ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]),
          "/out.y4m": "KEEP"
        });
        const errors: Uint8Array[] = [];
        const run = async (filter: string) => {
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
              "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          const bytes = volume.readFileSync("/out.y4m") as Buffer;
          const end = bytes.indexOf(10);
          const payload: Buffer[] = [];
          for (let offset = end + 1; offset < bytes.length; offset += 54) {
            assert.equal(bytes.subarray(offset, offset + 6).toString(), "FRAME\n");
            payload.push(bytes.subarray(offset + 6, offset + 54));
          }
          return { header: bytes.subarray(0, end).toString().split(" "), payload };
        };
        const output = await run(`tinterlace=${mode}`);
        assert.ok(output.header.includes("F12:1"));
        assert.ok(output.header.includes(order === "t" ? "It" : "Ib"));
        assert.equal(output.payload.length, 10);
        // Native FFmpeg reference hashes cover every luma and chroma sample.
        const hash = order === "t"
          ? color ? "9b76d04e5530e43a901fe441ce2b36ec1ccfc6d34a4529dc5903774fc6e9ed40" : "b260f648fde206f4cf06fc49088d6047e8335fb2d83d014ee06e0f8a4947e116"
          : color ? "ff03a8a87805d1f22d05d6e6fcd68c2e6b3b3130b0dcf252b24ca364859bdf91" : "38261296be1c635ef208fc1325250d538f92aa7c4ce5458da622d25b04688f53";
        assert.equal(createHash("sha256").update(Buffer.concat(output.payload)).digest("hex"), hash);
        const selected = await run(`tinterlace=${mode},select='eq(n,1)*between(t,0.0833,0.0834)+eq(n,9)*between(t,0.7499,0.7501)'`);
        assert.deepEqual(selected.payload, [output.payload[1], output.payload[9]]);
        assert.equal((await run(`trim=end_frame=1,tinterlace=${mode}`)).payload.length, 0);
        assert.deepEqual((await run(`trim=end_frame=2,tinterlace=${mode}`)).payload, output.payload.slice(0, 2));
      });
    }
  }
}
