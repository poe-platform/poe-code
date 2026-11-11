import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 `-layouts`, in native speaker order.
const layouts = [
  ["mono", "FC"],
  ["stereo", "FL+FR"],
  ["2.1", "FL+FR+LFE"],
  ["3.0", "FL+FR+FC"],
  ["3.0(back)", "FL+FR+BC"],
  ["4.0", "FL+FR+FC+BC"],
  ["quad", "FL+FR+BL+BR"],
  ["quad(side)", "FL+FR+SL+SR"],
  ["3.1", "FL+FR+FC+LFE"],
  ["5.0", "FL+FR+FC+BL+BR"],
  ["5.0(side)", "FL+FR+FC+SL+SR"],
  ["4.1", "FL+FR+FC+LFE+BC"],
  ["5.1", "FL+FR+FC+LFE+BL+BR"],
  ["5.1(side)", "FL+FR+FC+LFE+SL+SR"],
  ["6.0", "FL+FR+FC+BC+SL+SR"],
  ["6.0(front)", "FL+FR+FLC+FRC+SL+SR"],
  ["3.1.2", "FL+FR+FC+LFE+TFL+TFR"],
  ["hexagonal", "FL+FR+FC+BL+BR+BC"],
  ["6.1", "FL+FR+FC+LFE+BC+SL+SR"],
  ["6.1(back)", "FL+FR+FC+LFE+BL+BR+BC"],
  ["6.1(front)", "FL+FR+LFE+FLC+FRC+SL+SR"],
  ["7.0", "FL+FR+FC+BL+BR+SL+SR"],
  ["7.0(front)", "FL+FR+FC+FLC+FRC+SL+SR"],
  ["7.1", "FL+FR+FC+LFE+BL+BR+SL+SR"],
  ["7.1(wide)", "FL+FR+FC+LFE+BL+BR+FLC+FRC"],
  ["7.1(wide-side)", "FL+FR+FC+LFE+FLC+FRC+SL+SR"],
  ["5.1.2", "FL+FR+FC+LFE+BL+BR+TFL+TFR"],
  ["octagonal", "FL+FR+FC+BL+BR+BC+SL+SR"],
  ["cube", "FL+FR+BL+BR+TFL+TFR+TBL+TBR"],
  ["5.1.4", "FL+FR+FC+LFE+BL+BR+TFL+TFR+TBL+TBR"],
  ["7.1.2", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR"],
  ["7.1.4", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBL+TBR"],
  ["7.2.3", "FL+FR+FC+LFE+BL+BR+SL+SR+TFL+TFR+TBC+LFE2"],
  ["9.1.4", "FL+FR+FC+LFE+BL+BR+FLC+FRC+SL+SR+TFL+TFR+TBL+TBR"],
  ["hexadecagonal", "FL+FR+FC+BL+BR+BC+SL+SR+TFL+TFC+TFR+TBL+TBC+TBR+WL+WR"],
  ["downmix", "DL+DR"],
  ["22.2", "FL+FR+FC+LFE+BL+BR+FLC+FRC+BC+SL+SR+TC+TFL+TFC+TFR+TBL+TBC+TBR+LFE2+TSL+TSR+BFC+BFL+BFR"]
] as const;

for (const [layout, speakers] of layouts) {
  const names = speakers.split("+");
  for (const numbered of [false, true]) {
    for (const complex of [false, true]) {
      it(`routes every ${layout} speaker (${numbered ? "numbered" : "named"}, ${complex ? "graph" : "simple"})`, async () => {
        const samples = [1024, -2048, 3200];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        // Native pan reads LFE2 as LFE, so address the second subwoofer by index.
        const equations = names.map((name, index) => `${numbered || name === "LFE2" ? `c${index}` : name}=${(index + 1) / 32}*c0`);
        const filter = `pan=${layout}|${equations.join("|")}`;
        const filters = complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
          : ["-af", filter];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...filters, "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const expected = samples.flatMap(sample => names.map((_, index) => sample * (index + 1) / 32));
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(bytes.length, expected.length * 2);
        assert.deepEqual(expected.map((_, index) => bytes.readInt16LE(index * 2)), expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
