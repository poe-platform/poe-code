import { probeAudio } from "@poe-code/audio-ast";
import {
  getCommandArguments,
  readBytes,
  writeBytes,
  writeText,
  type CommandContext,
  type CommandDefinition,
  type VirtualShellPlugin
} from "safe-bash-contracts";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { effects, numeric, processAudio, type FormatOptions } from "./process.js";
export interface SoxLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSamples: number;
  readonly maxWorkSamples: number;
  readonly maxFiles: number;
}
export interface SoxCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<SoxLimits>;
}
export function audioLimits(options: SoxCommandsOptions): SoxLimits {
  const limits = {
    maxInputBytes: 32 * 1024 * 1024,
    maxOutputBytes: 32 * 1024 * 1024,
    maxSamples: 4 * 1024 * 1024,
    maxWorkSamples: 128 * 1024 * 1024,
    maxFiles: 64,
    ...options.limits
  };
  for (const value of Object.values(limits))
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid audio limit");
  return limits;
}
export async function readAudio(
  context: CommandContext,
  file: string,
  maxBytes: number
): Promise<Uint8Array> {
  let data: Uint8Array;
  if (file === "-") {
    const chunks: Uint8Array[] = [];
    let length = 0;
    for await (const chunk of readBytes(context.stdin, context.signal)) {
      length += chunk.length;
      if (length > maxBytes) throw new Error("Input byte limit exceeded");
      chunks.push(new Uint8Array(chunk));
    }
    data = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      data.set(chunk, offset);
      offset += chunk.length;
    }
  } else
    data = await context.fs.readFile(file.startsWith("/") ? file : context.cwd + "/" + file, {
      signal: context.signal,
      maxBytes
    });
  if (data.length > maxBytes) throw new Error("Input byte limit exceeded");
  return data;
}
export async function audioInfo(
  context: CommandContext,
  args: readonly string[],
  limits: SoxLimits
): Promise<void> {
  let flag: string | undefined;
  const files: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-") && arg !== "-") {
      if (flag || !["-t", "-r", "-c", "-s", "-d", "-D", "-b", "-B", "-a"].includes(arg))
        throw new Error(`Unsupported info option ${arg}`);
      flag = arg;
    } else files.push(arg);
  }
  if (!files.length || files.length > limits.maxFiles)
    throw new Error("Expected bounded input files");
  let total = 0;
  let text = "";
  for (const file of files) {
    const data = await readAudio(context, file, limits.maxInputBytes - total);
    total += data.length;
    context.inputBudget?.check(total);
    const audio = probeAudio(data, { maxAtomDepth: 64 }),
      s = audio.streams[0];
    if (!s) throw new Error("No audio stream");
    const duration = `${String(Math.floor(s.duration / 3600)).padStart(2, "0")}:${String(Math.floor(s.duration / 60) % 60).padStart(2, "0")}:${(s.duration % 60).toFixed(2).padStart(5, "0")}`;
    const values: Record<string, string> = {
      "-t": audio.format === "m4a" ? "m4a" : audio.format,
      "-r": String(s.sampleRate),
      "-c": String(s.channels),
      "-s": String(s.samples),
      "-d": duration,
      "-D": s.duration.toFixed(6),
      "-b": String(s.bitsPerSample ?? 0),
      "-B": `${(audio.bitrate / 1000).toPrecision(3)}k`,
      "-a": Object.entries(audio.tags)
        .map(([k, v]) => k + "=" + v)
        .join("\n")
    };
    text += flag
      ? values[flag] + "\n"
      : `\nInput File     : '${file}'\nChannels       : ${s.channels}\nSample Rate    : ${s.sampleRate}\nPrecision      : ${s.bitsPerSample ?? 0}-bit\nDuration       : ${duration} = ${s.samples} samples\nBit Rate       : ${values["-B"]}\n`;
    if (new TextEncoder().encode(text).length > limits.maxOutputBytes)
      throw new Error("Output byte limit exceeded");
  }
  await writeText(context.stdout, text);
}
export function createSoxCommand(options: SoxCommandsOptions = {}): CommandDefinition {
  const limits = audioLimits(options);
  return {
    name: "sox",
    description: "Transform WAV audio in the virtual filesystem",
    async execute(context) {
      context.signal.throwIfAborted();
      const args = getCommandArguments(context).args;
      try {
        if (args.includes("--help") || args.includes("-h")) {
          await writeText(
            context.stdout,
            "Usage: sox [FORMAT] INPUT... [FORMAT] OUTPUT [trim|pad|norm|gain -n|rate|channels|remix|fade|reverse|stat|stats|synth ...]\n       sox --i [-t|-r|-c|-s|-d|-D|-b|-B|-a] FILE\nFORMAT: -r RATE -c CHANNELS -b BITS -e ENCODING; -n is the null device. PCM processing reads and writes WAV.\n"
          );
          return { exitCode: 0 };
        }
        if (args[0] === "--i") {
          await audioInfo(context, args.slice(1), limits);
          return { exitCode: 0 };
        }
        const files: { name: string; options: FormatOptions }[] = [];
        let pending: FormatOptions = {};
        let index = 0;
        for (; index < args.length; index++) {
          const arg = args[index]!;
          if (effects.has(arg)) break;
          if (["-r", "-c", "-b", "-e", "-t"].includes(arg)) {
            const value = args[++index];
            if (value === undefined) throw new Error(`Missing ${arg}`);
            if (arg === "-e") pending.encoding = value;
            else if (arg === "-t") {
              if (value !== "wav") throw new Error("Only WAV PCM format is supported");
              pending.type = "wav";
            } else {
              const number = numeric(value, arg);
              if (!Number.isInteger(number) || number < 1) throw new Error(`Invalid ${arg}`);
              if (arg === "-r") pending.rate = number;
              else if (arg === "-c") {
                if (number > 64) throw new Error("Channel limit exceeded");
                pending.channels = number;
              } else pending.bits = number;
            }
          } else {
            if (arg.startsWith("-") && arg !== "-" && arg !== "-n")
              throw new Error(`Unknown option ${arg}`);
            files.push({ name: arg, options: pending });
            pending = {};
          }
        }
        if (Object.keys(pending).length) throw new Error("Format options require a file");
        if (files.length < 2 || files.length > limits.maxFiles + 1)
          throw new Error("Expected input and output files");
        const output = files.pop()!;
        const inputs: Uint8Array[] = [];
        const inputOptions: FormatOptions[] = [];
        let total = 0;
        for (const input of files) {
          if (input.name === "-n") {
            if (files.length !== 1) throw new Error("Null input must stand alone");
            continue;
          }
          const data = await readAudio(context, input.name, limits.maxInputBytes - total);
          total += data.length;
          context.inputBudget?.check(total);
          inputs.push(data);
          inputOptions.push(input.options);
        }
        const nullOptions = files[0]?.name === "-n" ? files[0].options : {};
        const result = processAudio(
          inputs,
          args.slice(index),
          { ...nullOptions, ...output.options },
          limits,
          inputOptions
        );
        if (result.bytes.length > limits.maxOutputBytes)
          throw new Error("Output byte limit exceeded");
        if (output.name === "-") await writeBytes(context.stdout, result.bytes, context.signal);
        else if (output.name !== "-n") {
          if (output.options.type !== "wav" && !output.name.toLowerCase().endsWith(".wav"))
            throw new Error("Output must be WAV (.wav)");
          const path = output.name.startsWith("/") ? output.name : context.cwd + "/" + output.name;
          await writeFileOutput(context, result.bytes, (data) =>
            context.fs.writeFile(path, data, { signal: context.signal })
          );
        }
        if (result.stderr) await writeText(context.stderr, result.stderr);
        return { exitCode: 0 };
      } catch (error) {
        context.signal.throwIfAborted();
        await writeText(
          context.stderr,
          `sox: ${error instanceof Error ? error.message : String(error)}\n`
        );
        return { exitCode: 1 };
      }
    }
  };
}
export function createSoxCommands(options: SoxCommandsOptions = {}): readonly CommandDefinition[] {
  return [createSoxCommand(options)];
}
export function soxCommands(options: SoxCommandsOptions = {}): VirtualShellPlugin {
  const command = createSoxCommand(options);
  return {
    name: "sox-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    }
  };
}
