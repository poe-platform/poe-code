import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 native rawvideo results, including complete output bytes.
for (const [filter, level, hex, fields] of [
  ["showinfo", "info", "11589fe62d74bb02", [["0", "0/1", "P", "0EB0034C"]]],
  ["setfield=tff,showinfo", "info", "11589fe62d74bb02", [["0", "0/1", "T", "0EB0034C"]]],
  ["setfield=bff,showinfo", "info", "11589fe62d74bb02", [["0", "0/1", "B", "0EB0034C"]]],
  ["setsar=2,setfield=tff,separatefields,showinfo", "info", "11582d749fe6bb02", [["0", "2/1", "P", "021A010A"], ["0.125", "2/1", "P", "06A60242"]]],
  ["setfield=tff,separatefields", "error", "11582d749fe6bb02", []],
  ["setfield=tff,separatefields,showinfo", "error", "11582d749fe6bb02", []],
  ["setsar=3/2,setfield=bff,showinfo=checksum=0", "info", "11589fe62d74bb02", [["0", "3/2", "B", undefined]]],
] as const) {
  for (const graph of [false, true]) {
    it(`reports frame descriptors for ${filter} at ${level} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("11589fe62d74bb02", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", level, "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x4", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), hex);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
      if (level === "error") assert.equal(stderr, "");
      const rows = stderr.split("\n").filter(line => line.startsWith("[showinfo] n:"));
      assert.equal(rows.length, fields.length, stderr);
      for (const [n, [pts, sar, order, checksum]] of fields.entries()) {
        const row = rows[n]!;
        for (const field of [`pts_time:${pts}`, "cl:unspecified", `sar:${sar}`, `i:${order}`, "type:I"]) {
          assert.ok(row.split(" ").includes(field), row);
        }
        if (checksum) assert.ok(row.includes(` checksum:${checksum} `), row);
        else assert.ok(!row.includes("checksum:"), row);
      }
    });
  }
}
