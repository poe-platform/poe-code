import { type CommandDefinition, type VirtualShellPlugin } from "../../contracts/index.js";
import { compare } from "./compare.js";
import { errorText, InputError, inputDiagnostic, Session } from "./io.js";
import { limitsFor, parseArguments, UsageError, type CmpCommandsOptions } from "./options.js";

export type { CmpCommandsOptions, CmpLimits } from "./options.js";

export function createCmpCommand(options: CmpCommandsOptions = {}): CommandDefinition {
  const limits = limitsFor(options);
  const comparisonBlockBytes = options.comparisonBlockBytes;
  if (comparisonBlockBytes !== undefined && (!Number.isSafeInteger(comparisonBlockBytes) || comparisonBlockBytes < 1)) {
    throw new RangeError("cmp comparisonBlockBytes must be a positive safe integer");
  }
  return {
    name: "cmp", description: "Compare two inputs byte by byte",
    async execute(context) {
      context.signal.throwIfAborted();
      const session = new Session(context, limits, comparisonBlockBytes);
      let silent = false, exitCode = 0;
      let failure: { reason: unknown } | undefined;
      try {
        const args = parseArguments(context.args, context.env.POSIXLY_CORRECT !== undefined);
        silent = args.mode === "silent";
        if (args.information) {
          await session.output(args.information === "version" ? "cmp (virtual-bash, GNU diffutils 3.12 profile)\n"
            : `Usage: cmp [OPTION]... FILE1 [FILE2 [SKIP1 [SKIP2]]]
Compare two files byte by byte.

The optional SKIP1 and SKIP2 specify the number of bytes to skip
at the beginning of each file (zero by default).

Mandatory arguments to long options are mandatory for short options too.
  -b, --print-bytes          print differing bytes
  -i, --ignore-initial=SKIP         skip first SKIP bytes of both inputs
  -i, --ignore-initial=SKIP1:SKIP2  skip first SKIP1 bytes of FILE1 and
                                      first SKIP2 bytes of FILE2
  -l, --verbose              output byte numbers and differing byte values
  -n, --bytes=LIMIT          compare at most LIMIT bytes
  -s, --quiet, --silent      suppress all normal output
      --help                 display this help and exit
  -v, --version              output version information and exit

SKIP values may be followed by the following multiplicative suffixes:
kB 1000, K 1024, MB 1,000,000, M 1,048,576,
GB 1,000,000,000, G 1,073,741,824, and so on for T, P, E, Z, Y.

If a FILE is '-' or missing, read standard input.
Exit status is 0 if inputs are the same, 1 if different, 2 if trouble.

Report bugs to: bug-diffutils@gnu.org
GNU diffutils home page: <https://www.gnu.org/software/diffutils/>
General help using GNU software: <https://www.gnu.org/gethelp/>
`);
        } else exitCode = await compare(session, args);
      } catch (error) {
        failure = { reason: error };
      }
      try { await session.close(false); }
      catch (error) { failure ??= { reason: error }; }
      context.signal.throwIfAborted();
      session.signal.throwIfAborted();
      if (!failure) return { exitCode };
      const error = failure.reason;
      if (error instanceof UsageError) await session.output(`cmp: ${error.message}\ncmp: Try 'cmp --help' for more information.\n`, true);
      else if (error instanceof InputError) {
        if (!silent || !error.opening) await session.output(inputDiagnostic(error), true);
      } else await session.output(`cmp: ${errorText(error)}\n`, true);
      return { exitCode: 2 };
    },
  };
}

export function createCmpCommands(options: CmpCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createCmpCommand(options)]);
}

export function cmpCommands(options: CmpCommandsOptions = {}): VirtualShellPlugin {
  const commands = createCmpCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "cmp-commands",
    setup(host) {
      if (!replace) for (const command of commands) {
        if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
      }
      for (const command of commands) host.commands.register(command, { replace });
    },
  };
}
