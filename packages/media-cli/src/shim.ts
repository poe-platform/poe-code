import { discover } from "./discover.js";
import { grammarRevision, nativeReference } from "./options.generated.js";
import type { Discovery, Tool } from "./types.js";

export interface NativeInvocation<Context> {
  readonly tool: Tool;
  readonly executable: (typeof nativeReference.executables)[Tool];
  readonly argv: readonly Uint8Array[];
  readonly discovery: Discovery;
  /** Carries the caller's scoped filesystem, descriptors, streams, signal and env.
   * The binding owns transfer, native execution and draining/cleanup. */
  readonly context: Context;
}
export interface NativeBinding<Context> {
  readonly build: string;
  readonly grammarRevision: string;
  readonly argv: "bytes";
  readonly lateAccess: "complete";
  readonly effects: "live";
  /** Authenticated runtime must verify its build and mediate ALL accesses, even
   * discovery misses. These declarations alone are not qualification evidence.
   * Resolve only after native streams/effects and owned cleanup settle. Native
   * failures resolve with native status; remote failures reject with their error. */
  run(invocation: NativeInvocation<Context>): Promise<{ exitCode: number }>;
}

export function createFFmpegShims<Context>(binding: NativeBinding<Context>): Record<Tool, (argv: readonly Uint8Array[], context: Context) => Promise<{ exitCode: number }>> {
  if (binding.build !== nativeReference.id) throw new Error("Native build does not match the pinned reference");
  if (binding.grammarRevision !== grammarRevision) throw new Error("Native grammar revision drift");
  if (binding.lateAccess !== "complete" || binding.effects !== "live") throw new Error("Native binding requires complete late access and live effects");
  if (binding.argv !== "bytes") throw new Error("Native binding must preserve argv bytes");
  // Keep the admitted execution method, including its receiver, rather than
  // consulting caller-owned configuration again on each invocation.
  const run = binding.run.bind(binding);
  return Object.fromEntries((["ffmpeg", "ffprobe"] as const).map(tool => [tool,
    async (args: readonly Uint8Array[], context: Context) => {
      if (!Array.isArray(args)) throw new TypeError('Native argv must be an array of byte arguments');
      const argumentCount = args.length;
      const argv = Array.from({ length: argumentCount }, (_, index) => {
        if (!Object.hasOwn(args, index)) throw new TypeError('Native argv slot is missing');
        const arg = args[index];
        if (!(arg instanceof Uint8Array)) throw new TypeError('Native argv arguments must be bytes');
        return new Uint8Array(arg);
      });
      if (args.length !== argumentCount) throw new TypeError('Native argv changed during capture');
      if (argv.some(arg => arg.includes(0))) throw new Error("NUL is not representable in native argv");
      let discovery: Discovery;
      try {
        discovery = discover(tool, argv);
      } catch {
        // Prediction is optional. Only the admitted native binding can decide
        // whether the command is valid and which resources it actually opens.
        discovery = {
          tool, grammarRevision, argv: argv.map(arg => new Uint8Array(arg)),
          globals: [], groups: [], dependencies: [],
          deferred: [{ index: -1, reason: 'native-access' }],
        };
      }
      const result = await run({ tool, executable: nativeReference.executables[tool], argv, discovery, context });
      const exitCode = result?.exitCode;
      if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) throw new TypeError('Invalid native exit status');
      return { exitCode };
    }
  ])) as Record<Tool, (argv: readonly Uint8Array[], context: Context) => Promise<{ exitCode: number }>>;
}
