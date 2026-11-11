import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 consumes the complete frame that discovers output EOF.
const input = Buffer.from("2823000000000000282300000000000000002823000000000000000000000000", "hex");
const cases: { args: string[]; samples: number; consumed: number; start?: number; tail?: string; output?: string }[] = [
  { args: ["-t", "0.001"], samples: 1, consumed: 8 },
  { args: ["-to", "0.006"], samples: 6, consumed: 12 },
  { args: ["-t", "0.004"], samples: 4, consumed: 8 },
  { args: ["-ss", "0.004", "-t", "0.001"], start: 4, samples: 1, consumed: 12 },
  { args: ["-ss", "0.004", "-to", "0.006"], start: 4, samples: 2, consumed: 12 },
  { args: ["-t", "0.001", "-to", "0.006"], samples: 1, consumed: 8 },
  { args: ["-t", "0.001", "-frames:a", "1"], samples: 1, consumed: 4 },
  { args: ["-frames:a", "1"], samples: 4, consumed: 4 },
  { args: ["-t", "0.1"], samples: 16, consumed: 16 },
  { args: [], samples: 16, consumed: 16 },
  { args: ["-t", "0.001"], samples: 1, consumed: 8, tail: ",anull" },
  { args: ["-t", "0.001"], samples: 1, consumed: 16, tail: ",areverse", output: "0000" }
];
for (const graph of [false, true]) {
  for (const metadata of [false, true]) {
    for (const { args, samples, consumed, start = 0, tail = "", output } of cases) {
      it(`stops silence detection at output EOF (${args.join(" ") || "unbounded"}, graph=${graph}, metadata=${metadata}, tail=${tail})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = "asetnsamples=n=4:p=0,silencedetect=n=0.1:d=0.002" + (metadata ? ",ametadata=print" : "") + tail;
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...args, "-f", "s16le", "pipe:1"],
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
        assert.deepEqual(Buffer.concat(stdout), output === undefined ? input.subarray(start * 2, (start + samples) * 2) : Buffer.from(output, "hex"));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        const lines = stderr.trim().split("\n");
        assert.deepEqual(lines.filter(line => line.startsWith("silence_")), [
          "silence_start: 0.001", "silence_end: 0.004 | silence_duration: 0.003",
          ...(consumed >= 8 ? ["silence_start: 0.005", consumed === 8
            ? "silence_end: 0.008 | silence_duration: 0.003"
            : "silence_end: 0.009 | silence_duration: 0.004"] : []),
          ...(consumed >= 12 ? ["silence_start: 0.01", consumed === 12
            ? "silence_end: 0.012 | silence_duration: 0.002"
            : "silence_end: 0.016 | silence_duration: 0.006"] : [])
        ]);
        assert.deepEqual(lines.filter(line => line.startsWith("lavfi.")), metadata ? [
          "lavfi.silence_start=0.001",
          ...(consumed >= 8 ? ["lavfi.silence_end=0.004", "lavfi.silence_duration=0.003", "lavfi.silence_start=0.005"] : []),
          ...(consumed >= 12 ? ["lavfi.silence_end=0.009", "lavfi.silence_duration=0.004", "lavfi.silence_start=0.01"] : [])
        ] : []);
      });
    }
  }
}
