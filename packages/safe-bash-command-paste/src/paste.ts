import { FsError, getCommandArguments, shellValueBytes, type ShellValue, type CommandDefinition } from "safe-bash-contracts";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { quoteShellOperand } from "safe-bash-contracts/escaping";
import { diagnostic } from "safe-bash-io-engine/internal";
import { command, empty, encode, fail, Inputs, settings, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

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
      if (escaped === undefined) {
        // GNU quotes the entire list only for colons, quotes, or nonprintable characters.
        let quoted = bytes.includes(34) || bytes.includes(58);
        const escapes: Record<number, string> = { 7: "\\a", 8: "\\b", 9: "\\t", 10: "\\n", 11: "\\v", 12: "\\f", 13: "\\r", 34: '\\"', 92: "\\\\" };
        let list = "";
        for (let index = 0; index < bytes.length; index++) {
          const byte = bytes[index]!;
          if (decoder?.encoding === "utf-8" && byte >= 0xc2 && byte <= 0xf4) {
            const width = byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
            try {
              const text = decoder.decode(bytes.subarray(index, index + width));
              if (!/[\p{Cc}\p{Cn}\p{Zl}\p{Zp}]/u.test(text)) {
                list += text;
                index += width - 1;
                continue;
              }
            } catch { /* Invalid UTF-8 retains bytewise octal escapes. */ }
          }
          const nonprintable = byte < 32 || byte >= 127;
          quoted ||= nonprintable;
          list += escapes[byte] ?? (nonprintable ? `\\${byte.toString(8).padStart(3, "0")}` : String.fromCharCode(byte));
        }
        const value = quoted ? `"${list}"` : new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
        throw new PublicDiagnostic(`delimiter list ends with an unescaped backslash: ${value}`);
      }
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

function usageError(message: string): never {
  throw new PublicDiagnostic(`${message}\nTry 'paste --help' for more information.`);
}

function operandName(value: ShellValue): string {
  if (typeof value === "string") return value;
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(shellValueBytes(value));
  } catch {
    fail("filename is not valid UTF-8");
  }
}

function fileError(error: unknown, file: ShellValue, locale: string): unknown {
  if (!(error instanceof FsError)) return error;
  const reasons: Partial<Record<FsError["code"], string>> = {
    ENOENT: "No such file or directory", ENOTDIR: "Not a directory", EISDIR: "Is a directory",
    EACCES: "Permission denied", EPERM: "Operation not permitted", ELOOP: "Too many levels of symbolic links",
    EIO: "Input/output error", ENAMETOOLONG: "File name too long",
  };
  const reason = reasons[error.code];
  if (!reason) return error;
  const name = operandName(file);
  const encoding = locale.split("@")[0]!.split(".")[1]?.toLowerCase();
  const utf8 = encoding === "utf-8" || encoding === "utf8";
  const quoted = !name || "#~".includes(name[0]!) || name === "{" || name === "}"
    || [...name].some(character => character <= " " || (character >= "\x7f" && (!utf8 || /[\p{Cc}\p{Cn}\p{Zl}\p{Zp}]/u.test(character))) || "\"'`$&*():;<=>?[\\^|!".includes(character));
  return new PublicDiagnostic(`${quoted ? quoteShellOperand(name, utf8) : name}: ${reason}`);
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
        if (name === "--") usageError(`option '${token}' is ambiguous; possibilities: '--serial' '--delimiters' '--zero-terminated' '--help' '--version'`);
        if (equal >= 0) {
          const option = ["--serial", "--zero-terminated", "--help", "--version"].find(option => option.startsWith(name));
          if (option) usageError(`option '${option}' doesn't allow an argument`);
        }
        if (name.length > 2 && "--delimiters".startsWith(name)) {
          if (equal < 0 && context.args[++index] === undefined) usageError("option '--delimiters' requires an argument");
          delimiterList = getCommandArguments(context).bytes(index)!.subarray(equal < 0 ? 0 : equal + 1); continue;
        }
        usageError(`unrecognized option '${token}'`);
      }
      for (let offset = 1; offset < token.length; offset++) {
        const flag = token[offset];
        if (flag === "s") serial = true;
        else if (flag === "z") separator = 0;
        else if (flag === "d") {
          if (offset + 1 === token.length && context.args[++index] === undefined) usageError("option requires an argument -- 'd'");
          delimiterList = getCommandArguments(context).bytes(index)!.subarray(token.length > offset + 1 ? offset + 1 : 0); break;
        } else {
          // All preceding flags are ASCII; GNU reports the first offending byte verbatim.
          await context.stderr.write(encode("paste: invalid option -- '"));
          await context.stderr.write(getCommandArguments(context).bytes(index)!.subarray(offset, offset + 1));
          await context.stderr.write(encode("'\nTry 'paste --help' for more information.\n"));
          return { exitCode: 1 };
        }
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
            await diagnostic(context, fileError(error, file, locale)); status = 1;
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
      const directoryErrors: unknown[] = [];
      for (const file of files) {
        try { readers.push(await inputs.open(operandName(file))); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "EISDIR") throw fileError(error, file, locale);
          directoryErrors.push(fileError(error, file, locale));
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
