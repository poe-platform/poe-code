import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decodePcm, stats, parseAudio } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import type { CommandContext } from "safe-bash-contracts";
import { createAudioCommands } from "./index.js";

async function virtual(name: string, args: string[], paths: string[]) {
  const fs = Volume.fromJSON(Object.fromEntries(paths.map((path) => [path, readFileSync(path)])));
  const stdout: Uint8Array[] = [],
    stderr: Uint8Array[] = [];
  const command = createAudioCommands().find((command) => command.name === name)!;
  const result = await command.execute({
    args,
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: {
      write: async (bytes: Uint8Array) => {
        stdout.push(bytes.slice());
      }
    },
    stderr: {
      write: async (bytes: Uint8Array) => {
        stderr.push(bytes.slice());
      }
    },
    fs: {
      readFile: async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer),
      writeFile: async (path: string, data: Uint8Array) => {
        fs.writeFileSync(path, Buffer.from(data));
      }
    }
  } as unknown as CommandContext);
  expect(result.exitCode, Buffer.concat(stderr).toString()).toBe(0);
  return { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString(), fs };
}

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const available = (tool: string) =>
  spawnSync(tool, [tool === "ffprobe" ? "-version" : "--version"], { timeout: 2000 }).status === 0;
function native(tool: string, args: string[]) {
  const result = spawnSync(tool, args, { timeout: 5000, maxBuffer: 1024 * 1024 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr?.toString()).toBe(0);
  return result;
}
// Raw output avoids SoX's deliberately unfinalized non-seekable WAV headers.
function nativePcm(paths: string[], effects: string[]) {
  const bytes = native("sox", ["-D", ...paths, "-t", "f64", "-L", "-", ...effects]).stdout;
  const channels = effects.includes("channels") ? 1 : 2;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sampleRate: effects.includes("rate") ? 16000 : 48000,
    channels: Array.from({ length: channels }, (_, channel) =>
      Float64Array.from({ length: bytes.length / 8 / channels }, (_, i) =>
        view.getFloat64((i * channels + channel) * 8, true)
      )
    )
  };
}
const enabled = process.env.AUDIO_NATIVE_TESTS === "1";
const names = [
  "u8.wav",
  "s16.wav",
  "s24.wav",
  "f32.wav",
  "cbr.mp3",
  "vbr.mp3",
  "tone.flac",
  "tone.ogg",
  "tone.m4a"
];
const recorded = JSON.parse(readFileSync(fixture("ffprobe.json"), "utf8"));
it("filters Ogg stream fields without leaking stream tags", async () => {
  const path = fixture("tone.ogg");
  const result = await virtual(
    "ffprobe",
    ["-of", "json", "-show_entries", "stream=sample_rate", path],
    [path]
  );
  expect(JSON.parse(result.stdout.toString()).streams).toEqual([{ sample_rate: "48000" }]);
});
describe("encoded fixture stress corpus", () => {
  it.each(names)("rejects truncated container structures for %s", (name) => {
    const bytes = readFileSync(fixture(name));
    // FLAC inspection treats compressed frames as opaque; truncate its final
    // metadata block instead. MPEG frames and Ogg pages are structurally parsed.
    const end = name.endsWith(".flac")
      ? parseAudio(bytes).nodes.find((node) => node.type === "FRAMES")!.offset
      : bytes.length;
    for (const length of [0, 1, 3, 7, 10, end - 1]) {
      expect(() => parseAudio(bytes.subarray(0, length)), `${name}/${length}`).toThrow();
    }
  });
});
for (const live of [false, true]) {
  describe.skipIf(live && (!enabled || !available("ffprobe")))(
    live ? "native ffprobe differential" : "recorded ffprobe differential",
    () => {
      it.each(names)("compares supported fields for %s", async (name) => {
        const path = fixture(name);
        const args = [
          "-v",
          "quiet",
          "-print_format",
          "json",
          "-show_format",
          "-show_streams",
          path
        ];
        const expected = live
          ? JSON.parse(native("ffprobe", args).stdout.toString())
          : structuredClone(recorded[name]);
        expected.format.filename = path;
        const actual = JSON.parse((await virtual("ffprobe", args, [path])).stdout.toString());
        expect(actual.streams).toHaveLength(expected.streams.length);
        for (const [index, stream] of actual.streams.entries()) {
          for (const required of [
            "index",
            "codec_name",
            "codec_type",
            "sample_rate",
            "channels",
            "bits_per_sample",
            "duration"
          ]) {
            expect(stream).toHaveProperty(required);
          }
          for (const [key, value] of Object.entries(stream)) {
            expect(value, `${name} stream.${key}`).toEqual(expected.streams[index][key]);
          }
        }
        for (const required of [
          "filename",
          "nb_streams",
          "format_name",
          "duration",
          "size",
          "bit_rate"
        ]) {
          expect(actual.format).toHaveProperty(required);
        }
        for (const [key, value] of Object.entries(actual.format)) {
          expect(value, `${name} format.${key}`).toEqual(expected.format[key]);
        }
      });
    }
  );
}
describe.skipIf(!enabled || !available("sox"))("native SoX differential", () => {
  const path = fixture("s16.wav");
  it.each([
    ["trim", ["trim", "0.02", "0.06"], 1 / 32768],
    ["channels", ["channels", "1"], 1 / 32768],
    ["norm", ["norm", "-3"], 1 / 32768],
    // Independent windowed-sinc implementations differ at boundaries; require
    // <0.002 RMS error across every sample, including the edges.
    ["rate", ["rate", "16000"], 0.002]
  ] as const)("compares %s samples", async (_name, effects, tolerance) => {
    const expected = nativePcm([path], [...effects]);
    const actual = decodePcm(
      (await virtual("sox", [path, "/out.wav", ...effects], [path])).fs.readFileSync(
        "/out.wav"
      ) as Buffer
    );
    expect(actual.sampleRate).toBe(expected.sampleRate);
    expect(actual.channels.length).toBe(expected.channels.length);
    actual.channels.forEach((channel, index) => {
      const reference = expected.channels[index]!;
      expect(channel.length).toBe(reference.length);
      const error = Math.sqrt(
        channel.reduce((sum, value, i) => sum + (value - reference[i]!) ** 2, 0) / channel.length
      );
      expect(error).toBeLessThanOrEqual(tolerance);
    });
  });
  it.each(["-t", "-r", "-c", "-s", "-D", "-b"])("compares soxi %s", async (flag) => {
    const expected = native("soxi", [flag, path]).stdout.toString().trim();
    const actual = await virtual("soxi", [flag, path], [path]);
    expect(actual.stdout.toString().trim()).toBe(expected);
  });
  it("compares concatenation sample for sample", async () => {
    const expected = nativePcm([path, path], []);
    const actual = decodePcm(
      (await virtual("sox", [path, path, "/out.wav"], [path])).fs.readFileSync("/out.wav") as Buffer
    );
    expect(actual).toEqual(expected);
  });
  it("compares stat RMS and peak", async () => {
    const output = native("sox", [path, "-n", "stat"]).stderr.toString();
    const fields = Object.fromEntries(
      output.split("\n").map((line) => {
        const colon = line.indexOf(":");
        return [
          line.slice(0, colon).split(" ").filter(Boolean).join(" "),
          Number(line.slice(colon + 1).trim())
        ];
      })
    );
    const actual = stats(decodePcm(readFileSync(path)));
    expect(actual.rms).toBeCloseTo(fields["RMS amplitude"]!, 6);
    expect(actual.peak).toBeCloseTo(
      Math.max(Math.abs(fields["Maximum amplitude"]!), Math.abs(fields["Minimum amplitude"]!)),
      6
    );
    const report = (await virtual("sox", [path, "-n", "stat"], [path])).stderr;
    expect(report).toContain(actual.rms.toFixed(6));
    expect(report).toContain(actual.peak.toFixed(6));
  });
});
