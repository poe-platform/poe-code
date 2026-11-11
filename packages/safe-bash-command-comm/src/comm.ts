import { getCommandArguments, type CommandDefinition } from "safe-bash-contracts";
import { command, compare, encode, fail, Inputs, OrderCheck, settings, type OrderMode, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

function recordComparison(env: Readonly<Record<string, string>>): typeof compare {
  const locale = env.LC_ALL || env.LC_COLLATE || env.LANG || "C";
  if (["C", "POSIX", "C.UTF-8", "C.utf8", "C.UTF8", "C.utf-8"].includes(locale)) return compare;
  const language = locale.split(".")[0]!.split("_").join("-");
  let collator: Intl.Collator;
  try {
    if (!Intl.Collator.supportedLocalesOf([language]).length || locale.includes("@")) throw new RangeError();
    collator = new Intl.Collator(language, { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  } catch {
    fail(`unsupported collation locale '${locale}'`);
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  return (left, right) => {
    let first: string | undefined, second: string | undefined;
    try { first = decoder.decode(left); } catch { /* Invalid bytes follow valid text. */ }
    try { second = decoder.decode(right); } catch { /* Preserve byte ordering for invalid text. */ }
    if (first === undefined) return second === undefined ? compare(left, right) : 1;
    // Runtime collation can equate distinct Unicode records; keep their byte order.
    return second === undefined ? -1 : collator.compare(first, second) || compare(left, right);
  };
}

export function createCommCommand(options: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return command("comm", limits, async (context, budget) => {
    const files: string[] = [], suppressed = new Set<number>();
    let separator = 10, delimiter: Uint8Array = Uint8Array.of(9), literal = false, total = false, mode: OrderMode = "default";
    let delimiterSet = false;
    for (let index = 0; index < context.args.length; index++) {
      const token = context.args[index]!;
      if (literal || token === "-" || !token.startsWith("-")) {
        files.push(token);
        literal ||= context.env.POSIXLY_CORRECT !== undefined;
        continue;
      }
      if (token === "--") { literal = true; continue; }
      if ("--check-order".startsWith(token)) { mode = "check"; continue; }
      if ("--nocheck-order".startsWith(token)) { mode = "none"; continue; }
      if ("--total".startsWith(token)) { total = true; continue; }
      if ("--zero-terminated".startsWith(token)) { separator = 0; continue; }
      const equal = token.indexOf("="), name = equal < 0 ? token : token.slice(0, equal);
      if (name.length > 2 && "--output-delimiter".startsWith(name)) {
        const args = getCommandArguments(context);
        const value = equal >= 0 ? args.bytes(index)!.subarray(equal + 1) : args.bytes(++index);
        if (value === undefined) fail(`option ${token} requires an argument`);
        const candidate = value.length ? value : Uint8Array.of(0);
        if (delimiterSet && compare(candidate, delimiter) !== 0) fail("multiple conflicting output delimiters");
        delimiter = candidate; delimiterSet = true; continue;
      }
      if (/^-[123z]+$/u.test(token)) {
        for (const flag of token.slice(1)) if (flag === "z") separator = 0; else suppressed.add(Number(flag) - 1);
      } else fail(`unsupported option ${token}`);
    }
    if (files.length !== 2) fail("comm requires exactly two files");
    const compareRecords = recordComparison(context.env);
    const input = context.stdinInput;
    const stdin = input ? (async function* () {
      while (true) {
        const chunk = input.readAvailable
          ? await input.readAvailable(Math.min(65536, limits.maxChunkBytes), context.signal, separator)
          : await input.read(1, context.signal);
        if (chunk.done) return;
        yield chunk.value;
      }
    })() : context.stdin;
    const inputs = new Inputs({ ...context, stdin }, budget, separator), order = new OrderCheck(mode, context, budget, compareRecords), terminator = Uint8Array.of(separator);
    try {
      const readers = [await inputs.open(files[0]!)];
      const rows = [await readers[0]!.next()];
      readers.push(await inputs.open(files[1]!));
      rows.push(await readers[1]!.next());
      const totals = [0n, 0n, 0n];
      while (rows[0] !== undefined || rows[1] !== undefined) {
        const step = budget.step(); if (step) await step;
        const comparison = rows[0] === undefined ? 1 : rows[1] === undefined ? -1 : compareRecords(rows[0], rows[1]);
        const column = comparison < 0 ? 0 : comparison > 0 ? 1 : 2;
        totals[column] = totals[column]! + 1n;
        if (column !== 2) await order.markUnpaired();
        if (!suppressed.has(column)) {
          const parts: Uint8Array[] = [];
          for (let index = 0; index < column; index++) if (!suppressed.has(index)) parts.push(delimiter);
          parts.push(rows[column === 1 ? 1 : 0]!, terminator);
          await budget.output(parts);
        }
        for (let index = 0; index < 2; index++) {
          if ((index === 0 && comparison > 0) || (index === 1 && comparison < 0)) continue;
          const next = await readers[index]!.next();
          const oc = order.check(rows[index], next, index + 1); if (oc) await oc;
          rows[index] = next;
        }
      }
      for (const [index, reader] of readers.entries()) await reader.closeOperand(files[index]!);
      if (total) await budget.output([encode(totals[0]!.toString()), delimiter, encode(totals[1]!.toString()), delimiter, encode(totals[2]!.toString()), delimiter, encode("total"), terminator]);
      await order.finish();
      return { exitCode: order.failed ? 1 : 0 };
    } finally { await inputs.close(); }
  });
}
