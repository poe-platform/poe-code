import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: two 2x2 gray fields at 4 fps.
for (const name of ["weave", "doubleweave"]) {
  for (const [option, status, output] of [
    [String.raw`first_field=st(0\,1)`, 0, "2d741158bb029fe6"],
    ["first_field=ld(0)", 0, "11582d749fe6bb02"],
    ["first_field=none", 0, "11582d749fe6bb02"],
    ["first_field=all", 222, ""],
    ["first_field=bottom", 0, "2d741158bb029fe6"],
    ["first_field=top", 0, "11582d749fe6bb02"],
    ["'st(9,1);ld(9)'", 0, "2d741158bb029fe6"],
    ["first_field='st(0,1)':first_field=ld(0)", 0, "11582d749fe6bb02"],
    ["first_field='st(0,0.5)'", 0, "11582d749fe6bb02"],
    ["first_field='st(0,2)'", 222, ""],
    ["first_field='st(0)'", 234, ""]
  ] as const) {
    for (const complex of [false, true]) {
      for (const destination of ["pipe:1", "/out.raw"]) {
        it(`${name}=${option} returns ${status} with exact bytes (${complex ? "graph" : "simple"}, ${destination})`, async () => {
          const input = Buffer.from("11589fe62d74bb02", "hex");
          const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
          const stdout: Uint8Array[] = [];
          let stderr = "";
          const filter = `${name}=${option}`;
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-nostats", "-v", "error", "-y", "-f", "rawvideo",
              "-pixel_format", "gray", "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
              ...(complex ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
              "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", destination],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, status, stderr);
          assert.equal(Buffer.concat(stdout).toString("hex"), destination === "pipe:1" ? output : "");
          assert.deepEqual(volume.readFileSync("/out.raw"), status === 0 && destination === "/out.raw"
            ? Buffer.from(output, "hex") : Buffer.from("KEEP"));
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
          if (status === 0) assert.equal(stderr, "");
          else assert.ok(stderr.includes(name), stderr);
        });
      }
    }
  }
}
