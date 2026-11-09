import { FsError, type CommandDefinition } from "safe-bash-contracts";
import { diagnostic } from "safe-bash-io-engine/internal";
import { argument, command, empty, encode, fail, Inputs, settings, type TableTextCommandsOptions } from "safe-bash-table-text-engine/table-text/internal";

function delimiters(text: string, locale: string): readonly Uint8Array[] {
  const characters = Array.from(text), result: Uint8Array[] = [];
  const escapes: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" };
  for (let offset = 0; offset < characters.length; offset++) {
    let character = characters[offset]!;
    if (character === "\\") {
      const escaped = characters[++offset];
      if (escaped === undefined) fail("delimiter list ends in an unescaped backslash");
      if (escaped === "0") { result.push(empty); continue; }
      character = escapes[escaped] ?? escaped;
    }
    const bytes = encode(character);
    if (locale === "C" || locale === "POSIX") {
      for (const byte of bytes) result.push(Uint8Array.of(byte));
    } else result.push(bytes);
  }
  return result.length ? result : [empty];
}

export function createPasteCommand(options: TableTextCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return command("paste", limits, async (context, budget) => {
    const files: string[] = [];
    const locale = context.env.LC_ALL || context.env.LC_CTYPE || context.env.LANG || "C.UTF-8";
    let serial = false, separator = 10, list = [Uint8Array.of(9)] as readonly Uint8Array[], literal = false;
    for (let index = 0; index < context.args.length; index++) {
      const token = context.args[index]!;
      if (literal || token === "-" || !token.startsWith("-")) { files.push(token); continue; }
      if (token === "--") { literal = true; continue; }
      if (token.startsWith("--")) {
        if ("--serial".startsWith(token)) { serial = true; continue; }
        if ("--zero-terminated".startsWith(token)) { separator = 0; continue; }
        const equal = token.indexOf("="), name = equal < 0 ? token : token.slice(0, equal);
        if (name.length > 2 && "--delimiters".startsWith(name)) {
          let value: string;
          [value, index] = argument(context.args, index, equal < 0 ? undefined : token.slice(equal + 1), token);
          list = delimiters(value, locale); continue;
        }
        fail(`unsupported option ${token}`);
      }
      for (let offset = 1; offset < token.length; offset++) {
        const flag = token[offset];
        if (flag === "s") serial = true;
        else if (flag === "z") separator = 0;
        else if (flag === "d") {
          let value: string;
          [value, index] = argument(context.args, index, token.slice(offset + 1) || undefined, "-d");
          list = delimiters(value, locale); break;
        } else fail(`unsupported option -${flag}`);
      }
    }
    if (!files.length) files.push("-");
    budget.check(files.length, limits.maxFiles, "file");
    const inputs = new Inputs(context, budget, separator), terminator = Uint8Array.of(separator);
    try {
      if (serial) {
        let status = 0;
        for (const file of files) {
          let reader;
          try { reader = await inputs.open(file); }
          catch (error) {
            context.signal.throwIfAborted();
            if (budget.hasPendingOutput()) await budget.flushOutput();
            await diagnostic(context, error); status = 1; continue;
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
      let status = 0;
      for (const file of files) {
        try { readers.push(await inputs.open(file)); }
        catch (error) {
          context.signal.throwIfAborted();
          if (!(error instanceof FsError) || error.code !== "EISDIR") throw error;
          await diagnostic(context, error); status = 1;
          readers.push(undefined);
        }
      }
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
      return { exitCode: status };
    } finally { await inputs.close(); }
  });
}
