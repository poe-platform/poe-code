import { FsError, outputFailure, type ByteSink, type CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { Budget, LineEndingError, sameIdentity, settings, type ConversionOptions, type Direction, type LineEndingCommandsOptions } from "./internal.js";
import { Lifecycle, Reader, Writer } from "./io.js";
import { Files, Stage } from "./stage.js";
import { convert } from "./convert.js";

function definition(direction: Direction, options: LineEndingCommandsOptions): CommandDefinition {
  const limits = settings(options);
  return { name: direction, description: "Convert DOS and Unix line endings in bounded VFS files or streams", async execute(context) {
    let life: Lifecycle | undefined;
    const caller = context.signal;
    caller.throwIfAborted();
    const stdout = context.stdout;
    caller.throwIfAborted();
    const capability = stdout.ownedOutput;
    caller.throwIfAborted();
    const consumer = capability?.consumerClosed;
    caller.throwIfAborted();
    consumer?.throwIfAborted();
    const failureHandler = stdout[outputFailure];
    caller.throwIfAborted();
    consumer?.throwIfAborted();
    const registerCleanup = context.registerCleanup;
    caller.throwIfAborted();
    consumer?.throwIfAborted();
    const admission = { closed: false };
    const destination = capability ?? stdout;
    const write = async (bytes: Uint8Array): Promise<void> => {
      life!.assertOpen();
      const method = destination.write;
      life!.assertOpen();
      await Reflect.apply(method, destination, [bytes]);
    };
    const captured: ByteSink = {
      write,
      ...(capability ? { ownedOutput: { consumerClosed: consumer!, write } } : {}),
      ...(failureHandler ? { [outputFailure]: failureHandler } : {}),
    };
    const output = createOutputOperation({ signal: caller, ...(registerCleanup ? { registerCleanup(cleanup) {
      caller.throwIfAborted();
      Reflect.apply(registerCleanup, context, [() => { admission.closed = true; return cleanup(); }]);
    } } : {}) }, captured);
    const budget = new Budget(context, limits, output.signal, caller, admission);
    let failure: { reason: unknown } | undefined;
    let primary: { reason: unknown } | undefined;
    let status = 0;
    try {
      life = new Lifecycle(budget, output, captured, caller, admission);
      const active = life;
      const files = new Files(active);
      const args = await budget.arguments();
      const flags: ConversionOptions = { keepBom: direction === "unix2dos", addBom: false, keepUtf16: false, assume: "bytes", force: false, quiet: false, newline: false, sevenBit: false, keepDate: false, newFile: false };
      const state = { high: 1 };
      const diagnostic = async (text: string) => { await active.diagnostic(`${direction}: ${text}\n`); };
      const file = async (name: string, destination: string) => {
        budget.file();
        const inputPath = files.path(name);
        const outputPath = files.path(destination);
        const expected = await files.stat(outputPath);
        if (expected?.type === "symlink") {
          if (!flags.quiet) await diagnostic(flags.newFile ? `Skipping ${name}, output file ${destination} is a symbolic link.` : `Skipping symbolic link ${name}.`);
          return;
        }
        let input = await files.stat(inputPath);
        if (!input || input.type !== "file" && input.type !== "symlink") {
          if (!flags.quiet) {
            if (!input) { status = 2; await diagnostic(`${name}: No such file or directory`); }
            await diagnostic(`Skipping ${name}, not a regular file.`);
          }
          return;
        }
        let path = inputPath;
        if (input.type === "symlink") {
          path = await files.call(fs => fs.realpath, [path, { signal: budget.signal }]);
          path = files.path(path);
          input = await files.stat(path);
          if (!input || input.type !== "file") {
            if (!flags.quiet) await diagnostic(`Skipping symbolic link ${name}, target is not a regular file.`);
            return;
          }
        }
        if (!sameIdentity(input, input) || expected && (expected.type !== "file" || !sameIdentity(expected, expected))) throw new LineEndingError("file conversion requires stable regular-file identities");
        const reader = new Reader(active);
        const stage = new Stage(files, outputPath, expected);
        const writer = new Writer(active, bytes => stage.append(bytes));
        let result: Awaited<ReturnType<typeof convert>> | undefined;
        let failed: { reason: unknown } | undefined;
        try {
          await reader.open(path, input);
          let opened = false;
          try { await stage.open(); opened = true; }
          catch (error) {
            if (error instanceof FsError && error.code === "ENOENT") {
              if (!flags.quiet) { status = 2; await diagnostic("Failed to open temporary output file: No such file or directory"); await diagnostic(`problems converting file ${name}${flags.newFile ? ` to file ${destination}` : ""}`); }
            } else throw error;
          }
          if (opened && await files.stat(outputPath) !== undefined && expected === undefined) throw new LineEndingError("destination appeared during acquisition");
          if (opened) result = await convert(direction, reader, writer, active, flags, state, name, false);
          await reader.close();
          if (result?.kind === "ok") {
            await stage.publish(input, flags);
            if (!flags.quiet) {
              const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C";
              const outFormat = flags.keepUtf16 ? result.encoding : locale === "C" || locale === "POSIX" ? "ANSI_X3.4-1968" : "UTF-8";
              const encoding = result.encoding ? `${result.encoding} ` : "";
              const target = result.encoding ? `${outFormat} ` : "";
              await diagnostic(`converting ${encoding}file ${name} to ${flags.newFile ? `${target}file ${destination} in ` : target}${direction === "dos2unix" ? "Unix" : "DOS"} format...`);
            }
          } else if (result?.kind === "unicode") status ||= 1;
          else if (result?.kind === "bom-error" && !flags.quiet) await diagnostic(`problems converting file ${name}${flags.newFile ? ` to file ${destination}` : ""}`);
        } catch (error) { failed = { reason: error }; }
        try { await reader.close(); await stage.cleanup(); }
        catch (error) { throw failed ? new AggregateError([failed.reason, error], "line-ending conversion and cleanup failed") : error; }
        finally { writer.release(); }
        if (failed) throw failed.reason;
      };
      let paired = true, processOptions = true, sawFile = false, stop = false;
      let index = 0;
      for (; index < args.length && !stop; index++) {
        const argument = args[index]!;
        if (processOptions && argument.startsWith("-")) {
          switch (argument) {
            case "--": processOptions = false; break;
            case "-b": case "--keep-bom": flags.keepBom = true; break;
            case "-r": case "--remove-bom": flags.keepBom = false; flags.addBom = false; break;
            case "-m": case "--add-bom": flags.addBom = true; break;
            case "-f": case "--force": flags.force = true; break;
            case "-s": case "--safe": flags.force = false; break;
            case "-q": case "--quiet": flags.quiet = true; break;
            case "-l": case "--newline": flags.newline = true; break;
            case "-k": case "--keepdate": flags.keepDate = true; break;
            case "-u": case "--keep-utf16": flags.keepUtf16 = true; break;
            case "-ul": case "--assume-utf16le": flags.assume = "le"; break;
            case "-ub": case "--assume-utf16be": flags.assume = "be"; break;
            case "-7": flags.sevenBit = true; flags.assume = "bytes"; break;
            case "-ascii": flags.assume = "bytes"; flags.sevenBit = false; flags.keepUtf16 = false; break;
            case "-S": case "--skip-symlink": break;
            case "-o": case "--oldfile": case "-n": case "--newfile":
              if (!paired) { await diagnostic(`target of file ${args[index - 1]} not specified in new-file mode`); status = 1; sawFile = true; stop = true; }
              flags.newFile = argument === "-n" || argument === "--newfile";
              break;
            case "-c": case "--convmode": {
              const mode = args[++index];
              if (mode === undefined) { await diagnostic(`option '${argument}' requires an argument`); status = 1; sawFile = true; stop = true; }
              else if (mode.toLowerCase() === "ascii") { flags.sevenBit = false; flags.assume = "bytes"; flags.keepUtf16 = false; }
              else if (mode.toLowerCase() === "7bit") { flags.sevenBit = true; flags.assume = "bytes"; }
              else { await diagnostic(`invalid ${mode} conversion mode specified`); status = 1; sawFile = true; stop = true; }
              break;
            }
            case "-h": case "--help": {
              const bytes = new TextEncoder().encode(`Usage: ${direction} [options] [file ...] [-n infile outfile ...]\nVirtual byte/UTF-16 profile: -o -n -b -r -m -f -s -q -k -l -u -ul -ub -7 -ascii --\n`);
              budget.emitted(bytes.length); await active.stdout(bytes); stop = true; sawFile = true; break;
            }
            default: throw new LineEndingError(`unsupported option in virtual profile: ${argument}`);
          }
        } else {
          sawFile = true;
          if (!flags.newFile) await file(argument, argument);
          else if (paired) paired = false;
          else { await file(args[index - 1]!, argument); paired = true; }
        }
      }
      if (!sawFile) {
        const reader = new Reader(active);
        const writer = new Writer(active, bytes => active.stdout(bytes));
        await reader.open();
        const result = await convert(direction, reader, writer, active, flags, state, "stdin", true);
        if (result.kind === "binary" && !flags.quiet) status ||= 1;
      }
      if (!paired) { await diagnostic(`target of file ${args[Math.min(index - 1, args.length - 1)]} not specified in new-file mode`); status = 1; }
    } catch (error) {
      primary = { reason: error };
      if (error instanceof LineEndingError && life && !output.signal.aborted) {
        status = error.status;
        try { await life.diagnostic(`${direction}: ${error.message}\n`); }
        catch (reporting) { failure = { reason: new AggregateError([error, reporting], "line-ending failure reporting failed") }; }
      } else failure = { reason: error };
    }
    try { await output.close(); }
    catch (cleanup) { const previous = failure ?? primary; failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "line-ending execution and cleanup failed") : cleanup }; }
    caller.throwIfAborted(); output.signal.throwIfAborted();
    if (life?.diagnosticCancellation) throw life.diagnosticCancellation.reason;
    if (failure) throw failure.reason;
    return { exitCode: status };
  } };
}
export function createDos2unixCommand(options: LineEndingCommandsOptions = {}): CommandDefinition { return definition("dos2unix", options); }
export function createUnix2dosCommand(options: LineEndingCommandsOptions = {}): CommandDefinition { return definition("unix2dos", options); }
