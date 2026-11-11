import { getCommandArguments, isFsError, type CommandDefinition } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { command, compare, encode, fail, Inputs, OrderCheck, settings, type OrderMode, type RecordReader, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

function recordComparison(env: Readonly<Record<string, string>>): typeof compare {
  const locales = ["LC_CTYPE", "LC_COLLATE", "LC_MESSAGES", "LC_MONETARY", "LC_NUMERIC", "LC_TIME",
    "LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"]
    .map(category => env.LC_ALL || env[category] || env.LANG || "C");
  const byteLocales = ["C", "POSIX", "C.UTF-8", "C.utf8", "C.UTF8", "C.utf-8"];
  let collator: Intl.Collator;
  try {
    for (const locale of new Set(locales)) {
      if (byteLocales.includes(locale)) continue;
      const language = locale.split(".")[0]!.split("_").join("-");
      if (!Intl.Collator.supportedLocalesOf([language]).length || locale.includes("@")) return compare;
    }
    const locale = locales[1]!;
    if (byteLocales.includes(locale)) return compare;
    collator = new Intl.Collator(locale.split(".")[0]!.split("_").join("-"), { usage: "sort", sensitivity: "variant", caseFirst: "lower" });
  } catch {
    // GNU leaves every category in the initial C locale if setlocale(LC_ALL, "") fails.
    return compare;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  function decode(bytes: Uint8Array): string {
    try { return decoder.decode(bytes); } catch { /* Collate malformed bytes individually. */ }
    let text = "";
    for (let index = 0; index < bytes.length;) {
      const byte = bytes[index]!;
      const length = byte < 0x80 ? 1 : byte >= 0xc2 && byte <= 0xdf ? 2
        : byte >= 0xe0 && byte <= 0xef ? 3 : byte >= 0xf0 && byte <= 0xf4 ? 4 : 0;
      if (length) {
        try {
          text += decoder.decode(bytes.subarray(index, index + length));
          index += length;
          continue;
        } catch { /* This byte is not part of a valid UTF-8 sequence. */ }
      }
      // A surrogate cannot occur in valid UTF-8. Keep one weight per malformed
      // byte, distinct from a literal replacement character and from EOF.
      text += "\udcff";
      index++;
    }
    return text;
  }
  return (left, right) => {
    const first = decode(left), second = decode(right);
    // GNU xmemcoll compares NUL-separated portions, including empty ones.
    const firstParts = first.split("\0"), secondParts = second.split("\0");
    for (let index = 0; index < Math.min(firstParts.length, secondParts.length); index++) {
      const result = collator.compare(firstParts[index]!, secondParts[index]!);
      if (result !== 0) return result;
    }
    // Runtime collation can equate distinct Unicode records; keep their byte order.
    return firstParts.length - secondParts.length || (first === second ? 0 : compare(left, right));
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
      const readers: RecordReader[] = [], rows: (Uint8Array | undefined)[] = [];
      for (const file of files) {
        try {
          const reader = await inputs.open(file);
          readers.push(reader);
          rows.push(await reader.next());
        } catch (error) {
          if (isFsError(error) && error.code === "EISDIR") throw new PublicDiagnostic(`${file}: Is a directory`);
          throw error;
        }
      }
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
          parts.push(rows[column === 0 ? 0 : 1]!, terminator);
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
