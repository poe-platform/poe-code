import { FsError, getCommandArguments, shellValueBytes, type ShellValue, type CommandDefinition } from "safe-bash-contracts";
import { diagnostic } from "safe-bash-io-engine/internal";
import { argument, command, empty, encode, fail, Inputs, settings, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

function delimiters(bytes: Uint8Array, locale: string): readonly Uint8Array[] {
  const name = locale.split("@")[0]!;
  const codeset = name.slice(name.indexOf(".") + 1).toLowerCase();
  let decoder: TextDecoder | undefined;
  try { decoder = new TextDecoder(codeset === "eucjp" ? "euc-jp" : codeset, { fatal: true, ignoreBOM: true }); }
  catch { /* C/POSIX and unknown encodings cycle original bytes. */ }
  const result: Uint8Array[] = [];
  const escapes: Record<number, number> = { 98: 8, 102: 12, 110: 10, 114: 13, 116: 9, 118: 11 };
  for (let offset = 0; offset < bytes.length;) {
    if (bytes[offset] === 92) {
      const escaped = bytes[++offset];
      if (escaped === undefined) fail("delimiter list ends in an unescaped backslash");
      if (escaped === 48) { result.push(empty); offset++; continue; }
      if (escapes[escaped] !== undefined) { result.push(Uint8Array.of(escapes[escaped]!)); offset++; continue; }
    }
    const first = bytes[offset]!;
    let length = 1;
    if (decoder && first >= 0x80) {
      // Supported locale encodings need at most four bytes per character.
      for (let width = 1; width <= 4 && offset + width <= bytes.length; width++) {
        try {
          decoder.decode(bytes.subarray(offset, offset + width));
          length = width;
          break;
        } catch { /* Try a longer character; invalid input retains one byte. */ }
      }
    }
    result.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return result.length ? result : [empty];
}

function validLocale(locale: string): boolean {
  if (locale === "C" || locale === "POSIX") return true;
  const [name, codeset] = locale.split("@")[0]!.split(".");
  const encoding = codeset?.toLowerCase();
  if (!encoding) return false;
  if (name === "C" && encoding !== "utf-8" && encoding !== "utf8") return false;
  try {
    if (name !== "C" && !Intl.Collator.supportedLocalesOf([name!.split("_").join("-")]).length) return false;
    new TextDecoder(encoding === "eucjp" ? "euc-jp" : encoding);
    return true;
  } catch { return false; }
}

function operandName(value: ShellValue): string {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(shellValueBytes(value));
  } catch {
    fail("filename is not valid UTF-8");
  }
}

export function createPasteCommand(options: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return command("paste", limits, async (context, budget) => {
    const files: ShellValue[] = [];
    // GNU initializes all locale categories together; any failure leaves C active.
    const locales = ["LC_CTYPE", "LC_NUMERIC", "LC_TIME", "LC_COLLATE", "LC_MONETARY", "LC_MESSAGES",
      "LC_PAPER", "LC_NAME", "LC_ADDRESS", "LC_TELEPHONE", "LC_MEASUREMENT", "LC_IDENTIFICATION"]
      .map(category => context.env.LC_ALL || context.env[category] || context.env.LANG || "C");
    const locale = locales.every(validLocale) ? locales[0]! : "C";
    let serial = false, separator = 10, delimiterList = encode("\t"), literal = false;
    for (let index = 0; index < context.args.length; index++) {
      const token = context.args[index]!;
      if (literal || token === "-" || !token.startsWith("-")) {
        files.push(getCommandArguments(context).values[index]!);
        literal ||= context.env.POSIXLY_CORRECT !== undefined;
        continue;
      }
      if (token === "--") { literal = true; continue; }
      if (token.startsWith("--")) {
        if ("--serial".startsWith(token)) { serial = true; continue; }
        if ("--zero-terminated".startsWith(token)) { separator = 0; continue; }
        const equal = token.indexOf("="), name = equal < 0 ? token : token.slice(0, equal);
        if (name.length > 2 && "--delimiters".startsWith(name)) {
          [, index] = argument(context.args, index, equal < 0 ? undefined : token.slice(equal + 1), token);
          delimiterList = getCommandArguments(context).bytes(index)!.subarray(equal < 0 ? 0 : equal + 1); continue;
        }
        fail(`unsupported option ${token}`);
      }
      for (let offset = 1; offset < token.length; offset++) {
        const flag = token[offset];
        if (flag === "s") serial = true;
        else if (flag === "z") separator = 0;
        else if (flag === "d") {
          [, index] = argument(context.args, index, token.slice(offset + 1) || undefined, "-d");
          delimiterList = getCommandArguments(context).bytes(index)!.subarray(token.length > offset + 1 ? offset + 1 : 0); break;
        } else fail(`unsupported option -${flag}`);
      }
    }
    const list = delimiters(delimiterList, locale);
    if (!files.length) files.push("-");
    budget.check(files.length, limits.maxFiles, "file");
    let status = 0;
    const readErrors: unknown[] = [];
    const inputs = new Inputs(context, budget, separator, error => {
      readErrors.push(error);
      status = 1;
    }), terminator = Uint8Array.of(separator);
    try {
      if (serial) {
        for (const file of files) {
          let reader;
          try { reader = await inputs.open(operandName(file)); }
          catch (error) {
            context.signal.throwIfAborted();
            if (budget.hasPendingOutput()) await budget.flushOutput();
            await diagnostic(context, error); status = 1;
            if (error instanceof FsError && error.code === "EISDIR") await budget.output([terminator]);
            continue;
          }
          let record = await reader.next(), count = 0;
          while (record !== undefined) {
            if (count) await budget.output([list[(count - 1) % list.length]!, record]);
            else await budget.output([record]);
            count++; record = await reader.next();
          }
          await budget.output([terminator]);
        }
        return { exitCode: status };
      }
      const readers = [];
      const directoryErrors: FsError[] = [];
      for (const file of files) {
        try { readers.push(await inputs.open(operandName(file))); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "EISDIR") throw error;
          directoryErrors.push(error);
          readers.push(undefined);
        }
      }
      for (const error of directoryErrors) await diagnostic(context, error);
      while (true) {
        const row: Uint8Array[] = [];
        let present = false;
        for (let index = 0; index < readers.length; index++) {
          const record = await readers[index]?.next();
          present ||= record !== undefined;
          if (index) row.push(list[(index - 1) % list.length]!);
          row.push(record ?? empty);
        }
        if (!present) break;
        row.push(terminator); await budget.output(row);
      }
      return { exitCode: directoryErrors.length ? 1 : status };
    } finally {
      await inputs.close();
      for (const error of readErrors) await diagnostic(context, error);
    }
  });
}
