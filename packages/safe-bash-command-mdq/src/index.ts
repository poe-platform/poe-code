import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { readBytes, writeBytes, toByteSource, type ByteSource } from "safe-bash-contracts/io";
import { createOutputOperation, type OutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { shellValueByteLength } from "safe-bash-contracts/value";
import { ProgramError } from "safe-bash-regex-engine/text/budget";
import { MdqBudget, admitLimits, type LimitOptions } from "./budget.js";
import { MdqError, optionsArgv, parseMdqArguments, type MdqOptions } from "./options.js";
import { parseDocument } from "./document.js";
import { parseQuery, select } from "./query.js";
import { render } from "./render.js";
import { information } from "./information.js";

export { parseMdqArguments, MdqError } from "./options.js";
export type { MdqOptions } from "./options.js";
export type { LimitOptions as MdqLimits } from "./budget.js";
export interface MdqCommandsOptions { readonly limits?: LimitOptions; readonly replace?: boolean }
export type MdqCommandOptions = MdqCommandsOptions;
export interface MdqRunOptions extends MdqOptions, MdqCommandOptions { readonly argv?: readonly string[] }
export interface MdqResult { readonly exitCode: number; readonly accounting: Readonly<MdqBudget["counts"]> }

export async function mdq(context: CommandContext, options: MdqRunOptions = {}): Promise<MdqResult> {
  const limits = admitLimits(options.limits), controller = new AbortController();
  const callerAbort = (): void => controller.abort(context.signal.reason);
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<MdqResult | undefined> = Promise.resolve(undefined), closing: Promise<void> | undefined, accepting = true;
  const outputAbort = (): void => controller.abort(stdout!.signal.reason);
  const close = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    closing = Promise.resolve().then(async () => {
      await task?.catch(() => {});
      context.signal.removeEventListener("abort", callerAbort);
      stdout?.signal.removeEventListener("abort", outputAbort);
      const outcomes = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      const failures = outcomes.filter(r => r.status === "rejected").map(r => r.reason);
      if (failures.length) throw new AggregateError(failures, "mdq cleanup failed");
    });
    controller.abort(new Error("mdq invocation closed"));
    return closing;
  };
  context.registerCleanup?.(close);
  const budget = new MdqBudget({ ...context, signal: controller.signal }, limits);
  const args: string[] = [];
  let argumentFailure: { error: unknown } | undefined;
  try {
    const typed = Object.keys(options).some(k => !["limits", "replace", "argv"].includes(k));
    if (typed && options.argv !== undefined) throw new TypeError("Use either mdq argv or typed options");
    const argv = typed ? optionsArgv(options) : options.argv ?? context.args;
    budget.bound("arguments", argv.length);
    for (const arg of argv) {
      budget.bound("arguments", args.length + 1);
      if (typeof arg !== "string") throw new TypeError("mdq arguments must be strings");
      budget.bound("argumentBytes", (budget.counts.argumentBytes ?? 0) + arg.length);
      budget.checkpoint(arg.length);
      budget.charge("argumentBytes", shellValueByteLength(arg));
      budget.charge("retainedBytes", arg.length * 2 + 8);
      args.push(arg);
    }
    if (!typed && options.argv === undefined) {
      const carrier = getCommandArguments(context), decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
      for (let i = 0; i < carrier.args.length; i++) {
        try { decoder.decode(carrier.bytes(i)); } catch { throw new MdqError("mdq: arguments must be valid UTF-8\n", 2); }
      }
    }
  } catch (error) { argumentFailure = { error }; }
  task = Promise.resolve().then(async () => {
    context.signal.throwIfAborted();
    if (!accepting) throw controller.signal.reason;
    context.signal.addEventListener("abort", callerAbort, { once: true });
    let status = 0;
    try {
      if (argumentFailure) throw argumentFailure.error;
      const parsed = parseMdqArguments(args);
      if (!parsed.quiet || parsed.information) {
        stdout = createOutputOperation(context, context.stdout);
        if (stdout.signal.aborted) outputAbort();
        else stdout.signal.addEventListener("abort", outputAbort, { once: true });
        controller.signal.throwIfAborted();
      }
      const emit = async (value: string): Promise<void> => {
        budget.bound("outputBytes", (budget.counts.outputBytes ?? 0) + value.length);
        budget.checkpoint(value.length);
        const length = shellValueByteLength(value), encoder = new TextEncoder();
        budget.charge("outputBytes", length);
        budget.charge("retainedBytes", length + value.length * 2);
        for (let start = 0; start < value.length;) {
          let end = Math.min(value.length, start + 4096);
          const last = value.charCodeAt(end - 1);
          if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
          const bytes = encoder.encode(value.slice(start, end));
          await writeBytes(stdout!.output, bytes, controller.signal);
          await budget.cooperate(end - start); start = end;
        }
      };
      if (parsed.information) { await emit(information[parsed.information]); return { exitCode: 0, accounting: { ...budget.counts } }; }
      budget.bound("files", parsed.files.length);
      const fragments: string[] = [];
      let sourceLength = 0, usedStdin = false;
      for (const file of parsed.files.length ? parsed.files : ["-"]) {
        controller.signal.throwIfAborted();
        if (file === "-" && usedStdin) {
          budget.charge("retainedBytes", 66); fragments.push("\n"); sourceLength++; continue;
        }
        let hostInputFailure = false;
        const checkHostInput = (total: number): void => {
          try { context.inputBudget?.check(total); }
          catch (error) { hostInputFailure = true; throw error; }
        };
        try {
          let input: ByteSource;
          if (file === "-") { usedStdin = true; input = context.stdin; }
          else {
            const path = file.startsWith("/") ? file : context.cwd + "/" + file;
            if (context.fs.readStream) input = context.fs.readStream(path, { signal: controller.signal });
            else {
              const inputUsed = budget.counts.inputBytes ?? 0;
              const retainedUsed = budget.counts.retainedBytes ?? 0;
              const inputRemaining = limits.inputBytes - inputUsed;
              const hostRemaining = (context.inputBudget?.maxBytes ?? Infinity) - inputUsed;
              const retainedRemaining = limits.retainedBytes - retainedUsed;
              const maxBytes = Math.min(inputRemaining, hostRemaining, retainedRemaining);
              let bytes: Uint8Array;
              try {
                bytes = await context.fs.readFile(path, {
                  signal: controller.signal,
                  ...(maxBytes === Infinity ? {} : { maxBytes })
                });
              } catch (error) {
                if (error instanceof FsError && error.code === "EFBIG" && maxBytes !== Infinity) {
                  // A capped read proves at least one byte beyond the admission quota.
                  if (inputRemaining === maxBytes) budget.bound("inputBytes", inputUsed + maxBytes + 1);
                  if (retainedRemaining === maxBytes) budget.bound("retainedBytes", retainedUsed + maxBytes + 1);
                  if (hostRemaining === maxBytes) checkHostInput(inputUsed + maxBytes + 1);
                }
                throw error;
              }
              budget.charge("retainedBytes", bytes.byteLength);
              input = toByteSource(bytes);
            }
          }
          controller.signal.throwIfAborted();
          const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }), producer = input[Symbol.asyncIterator]();
          let inputClosing: Promise<IteratorResult<Uint8Array>> | undefined, completed = false;
          const closeInput = (): Promise<IteratorResult<Uint8Array>> => inputClosing ??= Promise.resolve().then(() => producer.return ? producer.return() : { done: true, value: undefined });
          let readFailure: { error: unknown } | undefined;
          try {
            for await (const bytes of readBytes({ [Symbol.asyncIterator]() {
              return { next: producer.next.bind(producer), return: closeInput };
            } }, controller.signal)) {
              budget.charge("inputBytes", bytes.byteLength);
              checkHostInput(budget.counts.inputBytes ?? 0);
              if (!bytes.length) budget.charge("emptyChunks", 1);
              else {
                budget.charge("retainedBytes", bytes.byteLength * 2 + 64);
                const text = decoder.decode(bytes, { stream: true });
                fragments.push(text); sourceLength += text.length;
              }
              await budget.cooperate(bytes.byteLength + 1);
            }
            completed = true;
            const tail = decoder.decode();
            if (tail) { budget.charge("retainedBytes", tail.length * 2 + 64); fragments.push(tail); sourceLength += tail.length; }
          } catch (error) { readFailure = { error }; }
          if (!completed) {
            try { await closeInput(); }
            catch (error) {
              if (readFailure) throw new AggregateError([readFailure.error, error], "mdq input and cleanup failed");
              throw error;
            }
          }
          if (readFailure) throw readFailure.error;
        } catch (error) {
          controller.signal.throwIfAborted();
          if (hostInputFailure || error instanceof MdqError) throw error;
          if (!(error instanceof FsError) && !(error instanceof TypeError)) throw error;
          const categories: Partial<Record<FsError["code"], string>> = { ENOENT: "entity not found", EACCES: "permission denied", EISDIR: "is a directory" };
          const category = error instanceof FsError ? categories[error.code] ?? "other error" : "invalid data";
          throw new MdqError(`${category} while reading ${file === "-" ? "stdin" : "file " + JSON.stringify(file)}\n`);
        }
        if (parsed.files.length) { budget.charge("retainedBytes", 66); fragments.push("\n"); sourceLength++; }
      }
      budget.charge("retainedBytes", sourceLength * 2);
      const source = fragments.join(""); fragments.length = 0;
      const doc = await parseDocument(source, budget), selectors = parseQuery(parsed.selectors, budget);
      const selected = await select(doc, selectors, budget);
      status = selected.length ? 0 : 1;
      if (!parsed.quiet) await emit(await render(doc, selected, parsed, budget));
    } catch (error) {
      controller.signal.throwIfAborted();
      if (!(error instanceof MdqError) && !(error instanceof ProgramError)) throw error;
      status = error instanceof MdqError ? error.exitCode : 1;
      const message = error instanceof MdqError ? error.message : `mdq: ${error.message}\n`;
      stderr = createOutputOperation(context, context.stderr);
      await writeBytes(stderr.output, new TextEncoder().encode(message), context.signal);
    }
    return { exitCode: status, accounting: { ...budget.counts } };
  });
  try { return (await task)!; } finally { try { await close(); } finally { context.signal.throwIfAborted(); } }
}
export function createMdqCommand(options: MdqCommandOptions = {}): CommandDefinition {
  const limits = admitLimits(options.limits);
  return { name: "mdq", runtimeIdentity: commandRuntimeIdentity, description: "Query Markdown sections and elements", execute: context => mdq(context, { limits }) };
}
export const mdqCommand = createMdqCommand();
export function createMdqCommands(options: MdqCommandsOptions = {}): readonly CommandDefinition[] {
  return [createMdqCommand(options)];
}
export function mdqCommands(options: MdqCommandsOptions = {}): VirtualShellPlugin {
  const commands = createMdqCommands(options), replace = options.replace ?? false;
  return { name: "mdq", setup(host) { for (const command of commands) host.commands.register(command, { replace }); } };
}
