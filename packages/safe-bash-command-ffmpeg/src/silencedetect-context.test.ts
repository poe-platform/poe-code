import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.alloc(48 * 4);
for (let i = 0; i < 48; i++) {
  pcm.writeInt16LE((i >= 8 && i < 16) || i >= 34 ? 5000 : 0, i * 4);
  pcm.writeInt16LE((i >= 11 && i < 19) || (i >= 32 && i < 38) ? -8000 : 0, i * 4 + 2);
}
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from({ length: 48 }, (_, i) => pcm.readInt16LE(i * 4 + channel * 2) / 32768)) });
const events = [
  ["silence_start: 0", "silence_end: 0.001 | silence_duration: 0.001",
    "silence_start: 0.002", "silence_end: 0.00425 | silence_duration: 0.00225"],
  ["silence_start: 0", "silence_end: 0.001375 | silence_duration: 0.001375",
    "silence_start: 0.002375", "silence_end: 0.004 | silence_duration: 0.001625",
    "silence_start: 0.00475", "silence_end: 0.006 | silence_duration: 0.00125"]
];

for (const split of [false, true]) {
  for (const [levelArgs, severity, reports] of [
    [["-loglevel", "info"], false, true],
    [["-loglevel", "level+info"], true, true],
    [["-v", "repeat+level+32"], true, true],
    [["-loglevel", "level+warning"], true, false],
    [["-loglevel", "level+info", "-v", "-level"], false, true],
    [["-loglevel", "info", "-v", "+level"], true, true]
  ] as const) {
    it(`identifies silence detectors with ${levelArgs.join(" ")} (split=${split})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const detector = "silencedetect=n=0.01:d=0.0005:m=1";
      let stderr = "";
      const stdout: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", ...levelArgs, "-i", "/in.wav", ...(split
          ? ["-filter_complex", `[0:a]channelsplit=channel_layout=stereo[L][R];[L]${detector}[l];[R]${detector}[r];[l][r]amerge=inputs=2[o]`, "-map", "[o]"]
          : ["-af", detector]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      assert.deepEqual(Buffer.concat(stdout), pcm);
      assert.equal(createHash("sha256").update(Buffer.concat(stdout)).digest("hex"),
        "d78d19f717c9404f29c3efaebdb58bddfbbc8ccf602f5c732811b4ee68c71a2c");
      const lines = stderr.trim().split("\n").filter(line => line.includes("silence_"));
      if (!reports) {
        assert.deepEqual(lines, []);
        return;
      }
      assert.equal(lines.length, 10);
      const contexts = new Set<string>();
      const actual = new Map<string, string[]>();
      for (const line of lines) {
        const end = line.indexOf("] ");
        assert.ok(line.startsWith("[silencedetect @ ") && end > 17, line);
        const context = line.slice(0, end + 1);
        contexts.add(context);
        const message = line.slice(end + 2);
        assert.equal(message.startsWith("[info] "), severity, line);
        const event = severity ? message.slice("[info] ".length) : message;
        const channel = Number(event.slice("channel: ".length, event.indexOf(" | ")));
        assert.ok(channel === 0 || (!split && channel === 1), line);
        const key = split ? context : String(channel);
        const group = actual.get(key) ?? [];
        group.push(event.slice(event.indexOf(" | ") + 3));
        actual.set(key, group);
      }
      assert.equal(contexts.size, split ? 2 : 1);
      assert.deepEqual([...actual.values()], events);
    });
  }
}
