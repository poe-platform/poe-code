import { expect, it } from "vitest";
import { Volume } from "memfs";
import { encodeWav, decodePcm } from "@poe-code/audio-ast";
import type { CommandContext } from "safe-bash-contracts";
import { createAudioCommand, createAudioCommands, audioCommands } from "./index.js";
const wav = encodeWav(
  {
    sampleRate: 8000,
    channels: [Float64Array.from({ length: 800 }, (_, i) => Math.sin(i / 5) * 0.2)]
  },
  { tags: { title: "tone" } }
);
async function run(
  name: string,
  args: string[],
  options: Parameters<typeof createAudioCommands>[0] = {},
  stdin: Uint8Array = wav
) {
  const fs = Volume.fromJSON({ "/in.wav": Buffer.from(wav), "/two.wav": Buffer.from(wav) });
  const out: Uint8Array[] = [],
    err: Uint8Array[] = [];
  const command = createAudioCommands(options).find((c) => c.name === name)!;
  const context = {
    args,
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: (async function* () {
      yield stdin;
    })(),
    stdout: {
      write: async (bytes: Uint8Array) => {
        out.push(bytes.slice());
      }
    },
    stderr: {
      write: async (bytes: Uint8Array) => {
        err.push(bytes.slice());
      }
    },
    fs: {
      readFile: async (path: string) => new Uint8Array(fs.readFileSync(path) as Buffer),
      writeFile: async (path: string, data: Uint8Array) => {
        fs.writeFileSync(path, Buffer.from(data));
      }
    }
  } as unknown as CommandContext;
  const result = await command.execute(context);
  return {
    ...result,
    stdout: Buffer.concat(out).toString(),
    stderr: Buffer.concat(err).toString(),
    fs
  };
}
it.each([
  ["-t", "wav"],
  ["-r", "8000"],
  ["-c", "1"],
  ["-s", "800"],
  ["-D", "0.100000"],
  ["-d", "00:00:00.10"],
  ["-b", "16"],
  ["-a", "title=tone"]
])("soxi and sox --i support %s", async (flag, value) => {
  for (const name of ["soxi", "sox"]) {
    const result = await run(name, [...(name === "sox" ? ["--i"] : []), flag, "in.wav"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(value);
  }
});
it("reports human readable information and bitrate", async () => {
  expect((await run("soxi", ["in.wav"])).stdout).toContain("Sample Rate");
  expect((await run("soxi", ["-B", "in.wav"])).stdout).toContain("k");
});
it("transforms multiple input files and honors output format overrides", async () => {
  const result = await run("sox", [
    "in.wav",
    "two.wav",
    "-r",
    "4000",
    "-c",
    "2",
    "-b",
    "32",
    "-e",
    "floating-point",
    "out.wav",
    "reverse",
    "fade",
    "l",
    "0.01",
    "0.15",
    "0.02"
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  const pcm = decodePcm(new Uint8Array(result.fs.readFileSync("/out.wav") as Buffer));
  expect(pcm.channels).toHaveLength(2);
  expect(pcm.channels[0]).toHaveLength(600);
  expect(pcm.sampleRate).toBe(4000);
});
it.each([
  ["-b", "8", "-e", "unsigned-integer"],
  ["-b", "24", "-e", "signed-integer"],
  ["-b", "64", "-e", "floating-point"]
])("supports WAV encoding %j", async (...flags) => {
  const result = await run("sox", ["in.wav", ...flags, "out.wav"]);
  expect(result.exitCode, result.stderr).toBe(0);
});
it("synthesizes null input, analyzes null output, and reads stdin", async () => {
  expect(
    (await run("sox", ["-r", "8000", "-n", "out.wav", "synth", "0.05", "sine", "440"])).exitCode
  ).toBe(0);
  const result = await run("sox", ["-", "-n", "stats"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(result.stderr).toContain("RMS lev dB");
  expect(result.fs.existsSync("/-n")).toBe(false);
  expect((await run("ffprobe", ["-of", "json", "-show_streams", "-"])).stdout).toContain(
    "pcm_s16le"
  );
});
it("selects and combines remix channels", async () => {
  const result = await run("sox", ["in.wav", "out.wav", "remix", "1", "1", "0"]);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(
    decodePcm(new Uint8Array(result.fs.readFileSync("/out.wav") as Buffer)).channels
  ).toHaveLength(3);
});
it("fails without output for unknown effects, missing values and allocation limits", async () => {
  for (const args of [
    ["in.wav", "out.wav", "unknown"],
    ["in.wav", "out.wav", "pad", "99999"],
    ["in.wav", "-r"],
    ["in.wav", "out.mp3"]
  ]) {
    const result = await run("sox", args);
    expect(result.exitCode, args.join(" ")).not.toBe(0);
    expect(result.fs.existsSync("/out.wav")).toBe(false);
  }
  expect(
    (
      await run("ffprobe", ["-show_streams", "in.wav"], {
        ffprobe: { limits: { maxInputBytes: 10 } }
      })
    ).exitCode
  ).toBe(1);
  expect(
    (await run("sox", ["in.wav", "out.wav"], { sox: { limits: { maxInputBytes: 10 } } })).exitCode
  ).toBe(1);
});
it("preflights ffprobe collisions before registering any commands", () => {
  const registered: string[] = [];
  expect(() =>
    audioCommands().setup({
      commands: {
        has: (name: string) => name === "ffprobe",
        register: (c: { name: string }) => registered.push(c.name)
      }
    } as never)
  ).toThrow("already registered");
  expect(registered).toEqual([]);
  audioCommands({ replace: true }).setup({
    commands: {
      register: (c: { name: string }, opts: { replace: boolean }) => {
        expect(opts.replace).toBe(true);
        registered.push(c.name);
      }
    }
  } as never);
  expect(registered).toEqual(["ffprobe", "sox", "soxi"]);
});

it("creates individual audio commands by name", () => {
  expect(createAudioCommand().name).toBe("sox");
  expect(createAudioCommand({}, "ffprobe").name).toBe("ffprobe");
  expect(createAudioCommand({}, "soxi").name).toBe("soxi");
});
