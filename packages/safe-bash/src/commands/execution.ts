import { FsError, readBytes, writeBytes, type ByteSource, type CommandDefinition, type CommandHandler } from "../contracts/index.js";
import { define, emptyInput, encoder, escapeBytes, integer, options, output, pathOf, UsageError, value } from "./internal.js";
import { EnvSplitError, parseEnvOptions } from "./env-split.js";

export function directExecutor(fallback: CommandHandler): CommandHandler {
  return async context => {
    context.signal.throwIfAborted();
    const invoke = context.invoke;
    if (invoke) return invoke(context.command, context.args, {
      stdin: context.stdin, cwd: context.cwd, env: context.env, stdout: context.stdout, stderr: context.stderr,
      ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
    });
    return fallback(context);
  };
}

async function* argumentsFrom(source: ByteSource, signal: AbortSignal, delimiter?: string, replacement = false): AsyncGenerator<string> {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let current = "";
  let active = false;
  let escaped = false;
  let quote = "";
  const parse = function* (text: string): Generator<string> {
    for (const character of text) {
      if (delimiter !== undefined) {
        if (character === delimiter) { yield current; current = ""; active = false; }
        else { current += character; active = true; }
      } else if (escaped) { current += character; active = true; escaped = false; }
      else if (quote) {
        if (character === "\n") throw new UsageError("unmatched quote in input");
        if (character === quote) quote = "";
        else current += character;
      } else if (character === "\\") { escaped = true; active = true; }
      else if (character === "'" || character === '"') { quote = character; active = true; }
      else if (character === "\n" || !replacement && /[ \t\r\v\f]/u.test(character)) {
        if (active) { yield current; current = ""; active = false; }
      } else if (replacement && !active && /[ \t]/u.test(character)) continue;
      else { current += character; active = true; }
      if (current.length > 131072) throw new UsageError("argument exceeds 128 KiB limit");
    }
  };
  for await (const chunk of readBytes(source, signal)) { signal.throwIfAborted(); yield* parse(utf8.decode(chunk, { stream: true })); }
  yield* parse(utf8.decode());
  if (quote || escaped) throw new UsageError(quote ? "unmatched quote in input" : "trailing backslash in input");
  if (active) yield current;
}

export function executionCommands(execute: CommandHandler): CommandDefinition[] {
  return [
    define("env", async context => {
      let parsed: ReturnType<typeof options>;
      try { parsed = await parseEnvOptions(context.args, context.env, context.signal); }
      catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof EnvSplitError)) throw error;
        await writeBytes(context.stderr, encoder.encode(`${context.command}: ${error.message}\n`), context.signal);
        return { exitCode: 125 };
      }
      const env: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, parsed.flags.has("i") ? {} : context.env);
      for (const name of parsed.values.get("u") ?? []) delete env[name];
      const inheritedNames = Object.keys(env);
      const addedNames: string[] = [];
      let offset = 0;
      while (parsed.operands[offset]?.includes("=")) {
        const assignment = parsed.operands[offset++]!;
        const equals = assignment.indexOf("=");
        const name = assignment.slice(0, equals);
        if (!name || name.includes("\0")) throw new UsageError("invalid environment variable name");
        const content = assignment.slice(equals + 1);
        if (content.includes("\0")) throw new UsageError("environment values cannot contain NUL");
        if (!Object.hasOwn(env, name)) addedNames.push(name);
        env[name] = content;
      }
      const names = [...addedNames.reverse(), ...inheritedNames];
      if (offset < parsed.operands.length && parsed.flags.has("0")) throw new UsageError("cannot specify --null with a command");
      let cwd = context.cwd;
      const directory = value(parsed, "C");
      if (directory !== undefined) {
        cwd = pathOf(context, directory);
        if ((await context.fs.stat(cwd, { signal: context.signal })).type !== "directory") throw new FsError("ENOTDIR", { path: cwd });
        cwd = await context.fs.realpath(cwd, { signal: context.signal });
      }
      if (offset < parsed.operands.length) {
        const childEnv: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, Object.fromEntries(names.map(name => [name, env[name]!])));
        if (context.invoke) return context.invoke(parsed.operands[offset]!, parsed.operands.slice(offset + 1), {
          env: childEnv, replaceEnv: true, cwd, stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
          ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
        });
        return execute({ ...context, command: parsed.operands[offset]!, args: parsed.operands.slice(offset + 1), env: childEnv, cwd });
      }
      for (const name of names) await output(context, `${name}=${env[name]}${parsed.flags.has("0") ? "\0" : "\n"}`);
      return { exitCode: 0 };
    }),
    define("xargs", async context => {
      const parsed = options(context.args, "0rn:s:I:d:tP:xE:", { null: "0", "no-run-if-empty": "r", "max-args": "n", "max-chars": "s", replace: "I", delimiter: "d", verbose: "t", "max-procs": "P", exit: "x", eof: "E" }, true);
      if (integer(value(parsed, "P") ?? "1") !== 1) throw new UsageError("only sequential execution (-P 1) is supported");
      const replacement = value(parsed, "I");
      if (replacement === "") throw new UsageError("replacement string cannot be empty");
      if (replacement !== undefined && parsed.flags.has("n")) throw new UsageError("cannot combine -I and -n");
      const maxArgs = replacement === undefined ? integer(value(parsed, "n") ?? "5000", 1) : 1;
      const maxBytes = integer(value(parsed, "s") ?? "131072", 1);
      if (maxBytes > 131072) throw new UsageError("command size limit cannot exceed 128 KiB");
      let delimiter = parsed.flags.has("0") ? "\0" : undefined;
      const suppliedDelimiter = value(parsed, "d");
      if (suppliedDelimiter !== undefined) {
        const bytes = escapeBytes(suppliedDelimiter).bytes;
        if (bytes.length !== 1 || bytes[0]! > 127) throw new UsageError("delimiter must be one ASCII byte");
        delimiter = String.fromCharCode(bytes[0]!);
      }
      const command = parsed.operands[0] ?? "echo";
      const initial = parsed.operands.slice(1);
      const baseBytes = encoder.encode(command).length + 1 + initial.reduce((sum, argument) => sum + encoder.encode(argument).length + 1, 0);
      if (baseBytes >= maxBytes) throw new UsageError("initial arguments exceed command size limit");
      let batch: string[] = [];
      let bytes = baseBytes;
      let executed = false;
      let status = 0;
      let stop = false;
      const dispatch = async () => {
        const args = replacement === undefined ? [...initial, ...batch] : initial.map(argument => argument.split(replacement).join(batch[0] ?? ""));
        const size = encoder.encode(command).length + 1 + args.reduce((sum, argument) => sum + encoder.encode(argument).length + 1, 0);
        if (size > maxBytes) throw new UsageError("expanded arguments exceed command size limit");
        if (parsed.flags.has("t")) await writeBytes(context.stderr, encoder.encode([command, ...args].map(argument => /^[A-Za-z0-9_./-]+$/u.test(argument) ? argument : `'${argument.replaceAll("'", "'\\''")}'`).join(" ") + "\n"), context.signal);
        const result = await execute({ ...context, command, args, stdin: emptyInput(), stdinIsDefault: true, env: { ...context.env } });
        executed = true;
        if (result.exitCode === 255) { status = 124; stop = true; }
        else if (result.exitCode === 126 || result.exitCode === 127) { status = result.exitCode; stop = true; }
        else if (result.exitCode !== 0) status = 123;
        batch = []; bytes = baseBytes;
      };
      const eof = value(parsed, "E");
      for await (const argument of argumentsFrom(context.stdin, context.signal, delimiter, replacement !== undefined)) {
        if (delimiter === undefined && eof !== undefined && eof !== "" && argument === eof) break;
        const size = encoder.encode(argument).length + 1;
        if (replacement === undefined && baseBytes + size > maxBytes) throw new UsageError("single argument exceeds command size limit");
        if (batch.length && (batch.length === maxArgs || bytes + size > maxBytes)) {
          if (parsed.flags.has("x") && batch.length < maxArgs) throw new UsageError("command size limit exceeded");
          await dispatch();
          if (stop) break;
        }
        batch.push(argument); bytes += size;
        if (batch.length === maxArgs) { await dispatch(); if (stop) break; }
      }
      if (!stop && (batch.length || !executed && !parsed.flags.has("r") && replacement === undefined)) await dispatch();
      return { exitCode: status };
    }),
  ];
}
