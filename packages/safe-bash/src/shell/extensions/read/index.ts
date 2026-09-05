import { commandRuntimeIdentity } from "../../../contracts/command.js";
import { FsError } from "../../../contracts/errors.js";
import { concatShellValues, shellValueBytes, shellValueFromBytes, shellValueText } from "../../../contracts/value.js";
import type { ShellValue } from "../../../contracts/value.js";
import type { ReadLine } from "../../input.js";
import type { ShellExtension, ShellExtensionContext, ShellIndexedWriter, ShellInputBorrow, ShellInputObserver } from "../../extensions.js";

export interface ReadExtensionOptions {
  readonly nonTerminalInput?: boolean;
}

interface ReadOptions {
  raw: boolean;
  exact: boolean;
  descriptor: number;
  count?: number;
  delimiter?: number;
  array?: ShellValue;
  timeout?: number;
  terminal?: string;
  names: ShellValue[];
}

const usage = "read: usage: read [-Eers] [-a array] [-d delim] [-i text] [-n nchars] [-N nchars] [-p prompt] [-t timeout] [-u fd] [name ...]\n";

function identifier(name: string): boolean {
  if (!name.length) return false;
  for (let index = 0; index < name.length; index++) {
    const character = name[index]!;
    if (character !== "_" && !(character >= "a" && character <= "z") && !(character >= "A" && character <= "Z") && !(index > 0 && character >= "0" && character <= "9")) return false;
  }
  return true;
}

function decimal(value: string): number | undefined {
  let left = 0;
  let right = value.length;
  while (left < right && " \t\n\r\v\f".includes(value[left]!)) left++;
  while (right > left && " \t\n\r\v\f".includes(value[right - 1]!)) right--;
  const digits = value.slice(left, right);
  let start = 0;
  if (digits[0] === "+" || digits[0] === "-") start++;
  if (digits.length === start) return undefined;
  for (let index = start; index < digits.length; index++) if (digits[index]! < "0" || digits[index]! > "9") return undefined;
  const number = Number(digits);
  return Number.isInteger(number) && number >= 0 && number <= 2147483647 ? number : undefined;
}

function timeout(value: string): number | undefined {
  let offset = value.startsWith("+") || value.startsWith("-") ? 1 : 0;
  let seconds = 0n;
  while (offset < value.length && value[offset] !== ".") {
    const character = value[offset++]!;
    if (character < "0" || character > "9") return undefined;
    seconds = seconds * 10n + BigInt(character);
    if (seconds > 9223372036854775807n) return undefined;
  }
  if (value[offset] === ".") offset++;
  let fraction = 0;
  let digits = 0;
  while (offset < value.length && digits < 6) {
    const character = value[offset++]!;
    if (character < "0" || character > "9") return undefined;
    fraction = fraction * 10 + Number(character);
    digits++;
  }
  fraction *= 10 ** (6 - digits);
  if (digits === 6 && value[offset] !== undefined && value[offset]! >= "5" && value[offset]! <= "9") fraction++;
  if (value.startsWith("-") && (seconds > 0n || fraction > 0)) return undefined;
  return Number(seconds & 4294967295n) * 1000 + fraction / 1000;
}

async function parse(context: ShellExtensionContext, validate: (descriptor: number) => Promise<void>): Promise<ReadOptions | number> {
  const options: ReadOptions = { raw: false, exact: false, descriptor: 0, names: [] };
  const args = context.argumentValues;
  let offset = 0;
  while (offset < args.length) {
    const argument = args[offset]!;
    const bytes = shellValueBytes(argument);
    const text = shellValueText(argument);
    if (text === "--") { offset++; break; }
    if (bytes[0] !== 45 || bytes.length === 1) break;
    offset++;
    for (let index = 1; index < bytes.length; index++) {
      const flag = String.fromCharCode(bytes[index]!);
      if (flag === "r") { options.raw = true; continue; }
      if (flag === "e" || flag === "E" || flag === "s") { options.terminal = flag; continue; }
      if (!"adnNptui".includes(flag)) {
        await context.diagnostic(concatShellValues(["read: -", bytes[index]! < 128 ? flag : shellValueFromBytes(bytes.subarray(index, index + 1)), ": invalid option"]));
        await context.stderr.write(new TextEncoder().encode(usage));
        return 2;
      }
      let value: ShellValue;
      if (index + 1 < bytes.length) value = typeof argument === "string" ? argument.slice(index + 1) : shellValueFromBytes(bytes.subarray(index + 1));
      else if (offset < args.length) value = args[offset++]!;
      else {
        await context.diagnostic(`read: -${flag}: option requires an argument`);
        await context.stderr.write(new TextEncoder().encode(usage));
        return 2;
      }
      const valueText = shellValueText(value);
      if (flag === "a") options.array = value;
      else if (flag === "d") options.delimiter = (index + 1 < bytes.length ? bytes[index + 1] : shellValueBytes(value)[0]) ?? 0;
      else if (flag === "p" || flag === "i") options.terminal = flag;
      else if (flag === "t") {
        const milliseconds = timeout(valueText);
        if (milliseconds === undefined) { await context.diagnostic(concatShellValues(["read: ", value, ": invalid timeout specification"])); return 1; }
        options.timeout = milliseconds;
      } else {
        const number = decimal(valueText);
        if (number === undefined) {
          const detail = flag === "u" ? "file descriptor specification" : `${valueText.startsWith("0x") || valueText.startsWith("0X") ? "hex " : ""}number`;
          await context.diagnostic(concatShellValues(["read: ", value, `: invalid ${detail}`]));
          return 1;
        }
        if (flag === "u") { options.descriptor = number; await validate(number); }
        else { options.count = number; if (flag === "N") options.exact = true; }
      }
      break;
    }
  }
  options.names = args.slice(offset);
  return options;
}

async function execute(nonTerminalInput: boolean, context: ShellExtensionContext): Promise<number> {
  const diagnosedDescriptorFailure = Symbol("diagnosed read descriptor failure");
  const inputs: ShellInputBorrow[] = [];
  let input: ShellInputBorrow | undefined;
  let observer: ShellInputObserver | undefined;
  let record: ReadLine | undefined;
  let writer: ShellIndexedWriter | undefined;
  const operation: { work?: Promise<number> } = {};
  let completion: Promise<void> | undefined;
  let closed = false;
  const check = (): void => { context.signal.throwIfAborted(); if (closed) throw new Error("Read invocation is closed"); };
  const close = (): Promise<void> => {
    closed = true;
    return completion ??= (async () => {
      await Promise.allSettled([operation.work]);
      let failure: { reason: unknown } | undefined;
      for (const release of [() => writer?.close(), () => record?.release(), ...inputs.map(lease => () => lease.release()), () => observer?.release()]) {
        try { await release(); } catch (reason) { failure ??= { reason }; }
      }
      if (failure) throw failure.reason;
    })();
  };
  context.registerCleanup(close);
  const validate = async (descriptor: number): Promise<void> => {
    check();
    try { context.input.validateOpen(descriptor); }
    catch (error) {
      context.signal.throwIfAborted();
      if (error instanceof FsError && error.code === "EBADF") {
        await context.diagnostic(`read: ${descriptor}: invalid file descriptor: Bad file descriptor`);
        throw diagnosedDescriptorFailure;
      }
      throw error;
    }
  };
  const select = (descriptor: number): void => {
    check();
    try { input = context.input.borrow(descriptor); inputs.push(input); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!(error instanceof FsError && error.code === "EBADF")) throw error;
    }
  };
  const observe = (descriptor: number): void => {
    check();
    try { observer = context.input.observe(descriptor); }
    catch (error) {
      context.signal.throwIfAborted();
      if (!(error instanceof FsError && error.code === "EBADF")) throw error;
    }
  };
  const work = Promise.resolve().then(async () => {
    check();
    const options = await parse(context, validate);
    check();
    if (typeof options === "number") return options;
    if (options.timeout === 0) {
      observe(options.descriptor);
      check();
      if (!observer) return 1;
      const { readiness } = await observer.probeRead();
      check();
      if (readiness === "ready") return 0;
      if (readiness === "blocked") return 1;
      if (readiness !== "unknown") throw new TypeError("Invalid input readiness");
      await context.diagnostic(observer.readable ? "read: input readiness is unknown for this cursor" : "read: descriptor readiness unavailable through this extension API");
      return 1;
    }
    if (options.terminal !== undefined && !nonTerminalInput) {
      await context.diagnostic(`read: -${options.terminal}: terminal input capabilities unavailable through this extension API`);
      return 1;
    }
    const invalidName = async (name: ShellValue): Promise<number> => { await context.diagnostic(concatShellValues(["read: `", name, "': not a valid identifier"])); return 1; };
    if (options.names[0] !== undefined && !identifier(shellValueText(options.names[0]))) return invalidName(options.names[0]);
    if (options.array !== undefined && typeof context.bindings.openIndexed !== "function") {
      await context.diagnostic("read: indexed writer unavailable through this extension API");
      return 1;
    }
    select(options.descriptor);
    check();
    const inherited = options.timeout === undefined && options.count !== 0 ? context.bindings.get("TMOUT") : undefined;
    const milliseconds = options.timeout ?? (inherited === undefined ? undefined : timeout(shellValueText(inherited)));
    let timedOut = false;
    if (!input && options.count !== 0) {
      if (milliseconds !== undefined && milliseconds > 0) {
        observe(options.descriptor);
        check();
        if (observer) {
          const probe = await observer.probeRead();
          check();
          const readyUnreadable = observer.readable === false && probe.readiness === "ready";
          if (probe.timeout !== "ignore" && !(readyUnreadable && probe.timeout === "unknown")) {
            if (probe.readiness === "unknown" || probe.timeout !== "honor") {
              await context.diagnostic("read: descriptor timeout observation unavailable through this extension API");
              return 1;
            }
            if (probe.readiness === "blocked") {
              const outcome = await observer.waitRead({ timeoutMs: milliseconds, signal: context.signal });
              check();
              if (outcome === "unknown") {
                await context.diagnostic("read: descriptor timeout observation unavailable through this extension API");
                return 1;
              }
              if (outcome !== "ready" && outcome !== "timeout") throw new TypeError("Invalid descriptor wait result");
              timedOut = outcome === "timeout";
            } else if (probe.readiness !== "ready") throw new TypeError("Invalid descriptor readiness");
          }
        }
      }
      if (!timedOut) {
        await context.diagnostic(`read: ${options.descriptor}: read error: Bad file descriptor`);
        return 1;
      }
    }
    record = await input?.read(options.raw, {
      ...(options.count === undefined ? {} : { count: options.count }),
      ...(options.delimiter === undefined ? {} : { delimiter: options.delimiter }),
      exact: options.exact,
      ...(options.count !== 0 && milliseconds !== undefined && milliseconds > 0 ? { timeoutMs: milliseconds } : {}),
    });
    check();
    const status = timedOut || record?.reason === "timeout" ? 142 : record?.terminated ? 0 : 1;
    const ifs = options.exact ? "" : context.bindings.get("IFS") ?? " \t\n";
    if (options.array !== undefined) {
      const name = shellValueText(options.array);
      if (!identifier(name)) return invalidName(options.array);
      if (context.bindings.describe(name).readonly) { await context.diagnostic(`${name}: readonly variable`); return 1; }
      writer = await context.bindings.openIndexed(name, { clear: true });
      check();
      const fields = await record?.fields(ifs) ?? [];
      for (let index = 0; index < fields.length; index++) { check(); await writer.set(index, fields[index]!.value); }
    } else {
      const names = options.names.length ? options.names : ["REPLY"];
      const fields = options.names.length ? await record?.fields(ifs, names.length) ?? [] : undefined;
      for (let index = 0; index < names.length; index++) {
        check();
        const original = names[index]!;
        const name = shellValueText(original);
        if (!identifier(name)) return invalidName(original);
        if (context.bindings.describe(name).readonly) {
          await context.diagnostic(`${name}: readonly variable`);
          return options.names.length === 0 || index < names.length - 1 ? 2 : 1;
        }
        await context.bindings.assign(name, fields ? fields[index]?.value ?? "" : record?.shellValue ?? "");
      }
    }
    return status;
  });
  operation.work = work;
  let result = 1;
  let failure: { reason: unknown } | undefined;
  try { result = await work; }
  catch (reason) {
    if (reason === diagnosedDescriptorFailure) result = 1;
    else failure = { reason };
  }
  try { await close(); } catch (reason) { failure ??= { reason }; }
  context.signal.throwIfAborted();
  if (failure) throw failure.reason;
  return result;
}

export function readExtension(options: ReadExtensionOptions = {}): ShellExtension {
  const nonTerminalInput = options.nonTerminalInput === true;
  return { name: "extended-read", runtimeIdentity: commandRuntimeIdentity, create: () => ({
    builtins: [{ name: "read", replace: true, execute: execute.bind(undefined, nonTerminalInput) }],
  }) };
}
