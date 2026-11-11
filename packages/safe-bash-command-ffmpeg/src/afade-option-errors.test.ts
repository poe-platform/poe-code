import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, eight mono PCM16 samples of 16000 at 8 kHz.
for (const [option, exitCode, output] of [
  ["t=2", 222, ""],
  ["c=23", 222, ""],
  ["ns=0", 222, ""],
  ["threads=-1", 222, ""],
  ["t=oops", 234, ""],
  ["c=oops", 234, ""],
  ["ns=oops", 234, ""],
  ["threads=oops", 234, ""],
  ["", 0, "0000a00f401fe02e803e803e803e803e"],
  ["unity=2", 222, ""],
  ["unity=all", 222, ""],
  ["unity=1.1", 222, ""],
  ["unity=3/2", 222, ""],
  ["silence=-1/4", 222, ""],
  ["silence=2/1", 222, ""],
  ["unity=", 234, ""],
  ["unity=1/0", 222, ""],
  ["silence=-1/0", 222, ""],
  ["silence=0/0", 234, ""],
  ["unity=-0.1", 222, ""],
  ["unity=oops", 234, ""],
  ["silence=2", 222, ""],
  ["silence=-0.1", 222, ""],
  ["silence=oops", 234, ""],
  ["unity=st(0\\,2)", 222, ""],
  ["unity=st(0\\,0.5)", 0, "0000d007a00f7017401f401f401f401f"],
  ["unity=0.5", 0, "0000d007a00f7017401f401f401f401f"],
  ["silence=0.5", 0, "401f1027e02eb036803e803e803e803e"]
] as const) {
  for (const graph of [false, true]) {
    for (const existing of [false, true, "pipe"] as const) {
      it(`afade ${option} returns native status through ${graph ? "filter_complex" : "af"} with ${existing === "pipe" ? "pipe" : existing ? "existing" : "new"} output`, async () => {
        const fs = Volume.fromJSON(existing ? { "/out.raw": "KEEP" } : {});
        fs.writeFileSync("/in.raw", Buffer.from("803e".repeat(8), "hex"));
        const filter = `afade=ns=4${option ? `:${option}` : ""}`;
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", existing === "pipe" ? "pipe:1" : "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, exitCode, stderr);
        if (existing === "pipe") assert.deepEqual(Buffer.concat(stdout), Buffer.from(output, "hex"));
        else if (exitCode === 0) assert.deepEqual(fs.readFileSync("/out.raw"), Buffer.from(output, "hex"));
        else {
          assert.ok(stderr.includes("afade:"), stderr);
          if (existing) assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
          else assert.equal(fs.existsSync("/out.raw"), false);
        }
      });
    }
  }
}
