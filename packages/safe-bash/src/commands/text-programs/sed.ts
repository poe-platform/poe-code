import { FsError, writeBytes, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { Pattern, substitute } from "./regex.js";
import { Budget, ProgramError, byteString, bytes, command, lineRecords, readProgram, virtualPath, write, type RecordLine, type TextProgramOptions } from "./shared.js";
import { assertPathRequirements, requiredFileInput, sedRequirements } from "../search/requirements.js";

type Address = { kind: "number"; number: number } | { kind: "last" } | { kind: "regex"; pattern: Pattern | undefined };
interface Instruction {
  kind: string;
  first?: Address;
  second?: Address;
  negate: boolean;
  jump?: number;
  text?: string;
  file?: string;
  pattern?: Pattern;
  replacement?: string;
  global?: boolean;
  occurrence?: number;
  print?: boolean;
  status?: number;
  translation?: Map<string, string>;
}

function parse(source: string, extended: boolean): Instruction[] {
  if (source.length > 1024 * 1024) throw new ProgramError("sed program exceeds 1 MiB");
  const result: Instruction[] = [];
  const groups: number[] = [];
  const labels = new Map<string, number>();
  let offset = 0;
  const horizontal = () => { while (source[offset] === " " || source[offset] === "\t" || source[offset] === "\r") offset++; };
  const delimited = (delimiter: string): string => {
    let text = "";
    while (offset < source.length) {
      const character = source[offset++]!;
      if (character === delimiter) return text;
      if (character === "\\") {
        const next = source[offset++];
        if (next === undefined) break;
        text += next === "\n" ? "\n" : `\\${next}`;
      } else {
        if (character === "\n") throw new ProgramError("unterminated delimited expression");
        text += character;
      }
    }
    throw new ProgramError("unterminated delimited expression");
  };
  const address = (): Address | undefined => {
    horizontal();
    const number = /^[0-9]+/u.exec(source.slice(offset));
    if (number) {
      offset += number[0].length;
      const value = Number(number[0]);
      if (!Number.isSafeInteger(value) || value < 1) throw new ProgramError("sed line addresses must be positive integers");
      return { kind: "number", number: value };
    }
    if (source[offset] === "$") { offset++; return { kind: "last" }; }
    let delimiter: string | undefined;
    if (source[offset] === "/") delimiter = source[offset++];
    else if (source[offset] === "\\" && source[offset + 1] && source[offset + 1] !== "\n") { offset++; delimiter = source[offset++]; }
    if (delimiter !== undefined) {
      const pattern = delimited(delimiter);
      const ignoreCase = source[offset] === "I";
      if (ignoreCase) offset++;
      if (!pattern && ignoreCase) throw new ProgramError("flags on an empty regex are not supported");
      return { kind: "regex", pattern: pattern ? new Pattern(pattern, extended, ignoreCase) : undefined };
    }
    return undefined;
  };
  const label = (): string => {
    horizontal();
    const start = offset;
    while (offset < source.length && ![";", "\n", "}"].includes(source[offset]!)) offset++;
    const text = source.slice(start, offset).trim();
    if (text && !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(text)) throw new ProgramError(`invalid branch label '${text}'`);
    return text;
  };
  const textArgument = (): string => {
    horizontal();
    if (source[offset] === "\\") {
      offset++;
      if (source[offset++] !== "\n") throw new ProgramError("text backslash must be followed by newline");
    }
    let text = "";
    while (offset < source.length && source[offset] !== "\n") {
      const character = source[offset++]!;
      if (character === "\\" && offset < source.length) {
        const next = source[offset++]!;
        text += next === "n" ? "\n" : next === "t" ? "\t" : next;
      } else text += character;
    }
    return text + "\n";
  };
  const fileArgument = (): string => {
    horizontal();
    const start = offset;
    while (offset < source.length && source[offset] !== "\n") offset++;
    const file = Buffer.from(source.slice(start, offset), "latin1").toString("utf8");
    if (!file || file.includes("\0")) throw new ProgramError("file command requires a nonempty filename without NUL");
    return file;
  };
  while (offset < source.length) {
    horizontal();
    if (source[offset] === ";" || source[offset] === "\n") { offset++; continue; }
    if (source[offset] === "#") { while (offset < source.length && source[offset] !== "\n") offset++; continue; }
    if (offset === source.length) break;
    const first = address();
    horizontal();
    let second: Address | undefined;
    if (source[offset] === ",") { offset++; second = address(); if (!first || !second) throw new ProgramError("invalid address range"); }
    horizontal();
    const negate = source[offset] === "!";
    if (negate) { offset++; horizontal(); }
    const kind = source[offset++];
    if (kind === undefined) throw new ProgramError("missing sed command");
    const instruction: Instruction = { kind, negate, ...(first ? { first } : {}), ...(second ? { second } : {}) };
    if (kind === "{") { groups.push(result.length); result.push(instruction); continue; }
    if (kind === "}") {
      if (first || negate) throw new ProgramError("closing group cannot have an address");
      const start = groups.pop();
      if (start === undefined) throw new ProgramError("unmatched '}'");
      result[start]!.jump = result.length + 1;
    } else if (kind === "s") {
      const delimiter = source[offset++];
      if (!delimiter || delimiter === "\\" || delimiter === "\n") throw new ProgramError("invalid substitution delimiter");
      const pattern = delimited(delimiter);
      instruction.replacement = delimited(delimiter);
      let ignoreCase = false;
      while (offset < source.length && ![";", "\n", "}", " ", "\t"].includes(source[offset]!)) {
        const flag = source[offset++]!;
        if (flag === "g" && !instruction.global) instruction.global = true;
        else if (flag === "p" && !instruction.print) instruction.print = true;
        else if ((flag === "i" || flag === "I") && !ignoreCase) ignoreCase = true;
        else if (flag === "w" && instruction.file === undefined) { instruction.file = fileArgument(); break; }
        else if (/^[1-9]$/u.test(flag) && instruction.occurrence === undefined) {
          const rest = /^[0-9]*/u.exec(source.slice(offset))![0]; offset += rest.length;
          instruction.occurrence = Number(flag + rest);
          if (!Number.isSafeInteger(instruction.occurrence)) throw new ProgramError("invalid substitution occurrence");
        } else throw new ProgramError(`unsupported substitution flag '${flag}'`);
      }
      if (!pattern && ignoreCase) throw new ProgramError("flags on an empty regex are not supported");
      if (pattern) {
        instruction.pattern = new Pattern(pattern, extended, ignoreCase);
        for (const reference of instruction.replacement.matchAll(/\\([1-9])/gu)) {
          if (Number(reference[1]) > instruction.pattern.groupCount) throw new ProgramError("replacement references an undefined capture group");
        }
      }
    } else if (kind === "r" || kind === "w") {
      if (kind === "r" && second) throw new ProgramError("read accepts at most one address");
      instruction.file = fileArgument();
    } else if (kind === "a" || kind === "i" || kind === "c") instruction.text = textArgument();
    else if (kind === "b" || kind === "t" || kind === "T" || kind === ":") {
      instruction.text = label();
      if (first && kind === ":") throw new ProgramError("labels cannot have addresses");
      if (kind === ":") {
        if (!instruction.text || labels.has(instruction.text)) throw new ProgramError("empty or duplicate branch label");
        labels.set(instruction.text, result.length);
      }
    } else if (kind === "q") {
      if (second) throw new ProgramError("quit accepts at most one address");
      horizontal();
      const status = /^[0-9]+/u.exec(source.slice(offset));
      if (status) { offset += status[0].length; instruction.status = Number(status[0]); if (instruction.status > 255) throw new ProgramError("quit status exceeds 255"); }
    } else if (kind === "y") {
      const delimiter = source[offset++];
      if (!delimiter || delimiter === "\\" || delimiter === "\n") throw new ProgramError("invalid translation delimiter");
      const decode = (text: string) => text.replace(/\\(.)/gsu, (_whole, escaped: string) => escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped);
      const from = decode(delimited(delimiter));
      const to = decode(delimited(delimiter));
      if (from.length !== to.length) throw new ProgramError("translation sets have different lengths");
      instruction.translation = new Map([...from].map((character, index) => [character, to[index]!]));
    } else if (!"pdDPhHgGxnN=l".includes(kind)) throw new ProgramError(`unsupported sed command '${kind}'`);
    result.push(instruction);
    horizontal();
    if (offset < source.length && ![";", "\n", "}"].includes(source[offset]!)) throw new ProgramError(`unexpected text after '${kind}' command`);
  }
  if (groups.length) throw new ProgramError("unclosed sed group");
  for (const instruction of result) if (["b", "t", "T"].includes(instruction.kind)) {
    const target = instruction.text ? labels.get(instruction.text) : result.length;
    if (target === undefined) throw new ProgramError(`undefined branch label '${instruction.text}'`);
    instruction.jump = target;
  }
  return result;
}

async function execute(program: readonly Instruction[], context: CommandContext, files: readonly string[], quiet: boolean, budget: Budget): Promise<{ status: number; quit: boolean }> {
  const source = lineRecords(context, files, budget);
  let current = await source.next();
  let following: IteratorResult<RecordLine, void> | undefined;
  const peekNext = async (): Promise<IteratorResult<RecordLine, void>> => following ??= await source.next();
  const readNext = async (): Promise<IteratorResult<RecordLine, void>> => {
    const next = await peekNext();
    following = undefined;
    return next;
  };
  const prepareRecord = async (record: RecordLine): Promise<RecordLine> => {
    if (record.terminated || files.length < 2) return record;
    const next = await peekNext();
    return !next.done && next.value.fileIndex !== record.fileIndex ? { ...record, terminated: true } : record;
  };
  let number = 0;
  let hold = "";
  let lastPattern: Pattern | undefined;
  const active = new Set<number>();
  const getPattern = (pattern: Pattern | undefined) => {
    if (pattern) lastPattern = pattern;
    if (!lastPattern) throw new ProgramError("no previous regular expression");
    return lastPattern;
  };
  try {
    while (!current.done) {
      budget.step(); number++;
      let record = await prepareRecord(current.value);
      let pattern = record.text;
      const appended: { text?: string; file?: string }[] = [];
      let appendedSize = 0;
      const append = (item: { text?: string; file?: string }): void => {
        appendedSize += (item.text ?? item.file ?? "").length + 32;
        if (appendedSize > budget.maxBufferBytes) throw new ProgramError("append queue buffer limit exceeded");
        appended.push(item);
      };
      let substituted = false;
      let deleted = false;
      let quit = false;
      let status = 0;
      const print = () => write(context, pattern + (record.terminated ? "\n" : ""));
      const flush = async () => {
        await assertPathRequirements(context, sedRequirements, ["script-read"], appended.flatMap(item => item.file === undefined ? [] : [item.file]));
        if (!quiet && !deleted) await print();
        for (const item of appended) {
          if (item.text !== undefined) { await write(context, item.text); continue; }
          const path = virtualPath(context, item.file!);
          try {
            for await (const chunk of requiredFileInput(context, sedRequirements, "script-read", path, budget.maxBufferBytes)) {
              budget.step(); await budget.checkpoint();
              if (chunk.byteLength > budget.maxBufferBytes) throw new ProgramError("read buffer limit exceeded");
              await writeBytes(context.stdout, chunk, context.signal);
            }
          } catch (error) {
            context.signal.throwIfAborted();
            if (!(error instanceof FsError) || !["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(error.code)) throw error;
          }
        }
        appended.length = 0; appendedSize = 0;
      };
      const writeFile = async (file: string): Promise<void> => {
        await context.fs.appendFile(virtualPath(context, file), bytes(pattern + "\n"), { signal: context.signal });
      };
      const matches = async (address: Address): Promise<boolean> => address.kind === "number" ? number === address.number : address.kind === "last" ? (await peekNext()).done === true : getPattern(address.pattern).find(pattern, budget) !== undefined;
      for (let pc = 0; pc < program.length;) {
        budget.step(); await budget.checkpoint();
        const instruction = program[pc]!;
        let selected = true;
        let ending = false;
        if (instruction.first) {
          if (instruction.second) {
            if (active.has(pc)) {
              if (instruction.second.kind === "number" && number > instruction.second.number) selected = false;
              ending = instruction.second.kind === "number" ? number >= instruction.second.number : await matches(instruction.second);
              if (ending) active.delete(pc);
            } else {
              selected = await matches(instruction.first);
              if (selected) {
                ending = instruction.second.kind === "number" && number >= instruction.second.number || instruction.second.kind === "last" && (await peekNext()).done === true;
                if (!ending) active.add(pc);
              }
            }
          } else selected = await matches(instruction.first);
        }
        if (instruction.negate) selected = !selected;
        if (!selected) { pc = instruction.kind === "{" ? instruction.jump! : pc + 1; continue; }
        switch (instruction.kind) {
          case "p": await print(); break;
          case "P": {
            const end = pattern.indexOf("\n");
            await write(context, end < 0 ? pattern + (record.terminated ? "\n" : "") : pattern.slice(0, end + 1)); break;
          }
          case "=": await write(context, `${number}\n`); break;
          case "l": {
            const escapes: Record<string, string> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\\": "\\\\" };
            let line = "";
            for (let offset = 0; offset <= pattern.length; offset++) {
              budget.step(); await budget.checkpoint();
              const character = pattern[offset];
              const token = character === undefined || character === "\n" ? "$" : escapes[character] ?? (character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127 ? `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}` : character);
              if (line.length + token.length >= 60) { await write(context, line + "\\\n"); line = ""; }
              line = budget.check(line + token);
              if (character === "\n") { await write(context, line + "\n"); line = ""; }
            }
            await write(context, line + "\n");
            break;
          }
          case "d": deleted = true; pc = program.length; continue;
          case "D": {
            const end = pattern.indexOf("\n");
            if (end < 0) { deleted = true; pc = program.length; }
            else { pattern = pattern.slice(end + 1); pc = 0; }
            continue;
          }
          case "q": quit = true; status = instruction.status ?? 0; pc = program.length; continue;
          case "a": append({ text: instruction.text! }); break;
          case "r": append({ file: instruction.file! }); break;
          case "w": await writeFile(instruction.file!); break;
          case "i": await write(context, instruction.text!); break;
          case "c":
            if (!instruction.second || ending || instruction.negate || (await peekNext()).done) await write(context, instruction.text!);
            deleted = true; pc = program.length; continue;
          case "h": hold = pattern; break;
          case "H": hold = budget.check(hold + "\n" + pattern); break;
          case "g": pattern = hold; break;
          case "G": pattern = budget.check(pattern + "\n" + hold); break;
          case "x": [pattern, hold] = [hold, pattern]; break;
          case "s": {
            const changed = substitute(pattern, getPattern(instruction.pattern), instruction.replacement!, budget, instruction.global ?? false, instruction.occurrence ?? 1);
            pattern = changed.text;
            if (changed.count) { substituted = true; if (instruction.print) await print(); if (instruction.file) await writeFile(instruction.file); }
            break;
          }
          case "y": pattern = [...pattern].map(character => instruction.translation!.get(character) ?? character).join(""); break;
          case "b": pc = instruction.jump!; continue;
          case "t": case "T": {
            const branch = instruction.kind === "t" ? substituted : !substituted;
            substituted = false;
            if (branch) { pc = instruction.jump!; continue; }
            break;
          }
          case "n": case "N": {
            if (instruction.kind === "n") await flush();
            const next = await readNext();
            if (next.done) { if (instruction.kind === "N") await flush(); return { status: 0, quit: false }; }
            record = await prepareRecord(next.value); number++;
            pattern = instruction.kind === "N" ? budget.check(pattern + "\n" + record.text) : record.text;
            substituted = false;
            break;
          }
        }
        pc++;
      }
      await flush();
      if (quit) return { status, quit: true };
      current = await readNext();
    }
    return { status: 0, quit: false };
  } finally { await source.return(undefined); }
}

export function sedCommand(options: TextProgramOptions = {}): CommandDefinition {
  const definition = command("sed", async context => {
    const budget = new Budget(context, options);
    const sources: string[] = [];
    const files: string[] = [];
    let quiet = false;
    let extended = false;
    let separate = false;
    let inPlace: string | undefined;
    let ended = false;
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) { files.push(argument); continue; }
      if (argument === "--") { ended = true; continue; }
      if (argument.startsWith("--")) throw new ProgramError(`unsupported option '${argument}'`);
      for (let position = 1; position < argument.length; position++) {
        const flag = argument[position]!;
        if (flag === "n") quiet = true;
        else if (flag === "E" || flag === "r") extended = true;
        else if (flag === "s") separate = true;
        else if (flag === "i") {
          inPlace = argument.slice(position + 1);
          if (!inPlace && context.args[index + 1] === "") index++;
          position = argument.length;
        } else if (flag === "e" || flag === "f") {
          const source = argument.slice(position + 1) || context.args[++index];
          if (source === undefined) throw new ProgramError(`-${flag} requires an argument`);
          if (flag === "f") await assertPathRequirements(context, sedRequirements, ["script-file"], [source]);
          sources.push(flag === "f" ? await readProgram(context, source) : byteString(source));
          position = argument.length;
        } else throw new ProgramError(`unsupported option '-${flag}'`);
      }
    }
    if (!sources.length) {
      if (!files.length) throw new ProgramError("missing program");
      sources.push(byteString(files.shift()!));
    }
    if (sources[0]?.startsWith("#n")) quiet = true;
    const program = parse(sources.join("\n"), extended);
    const outputFiles = program.flatMap(instruction => instruction.kind !== "r" && instruction.file !== undefined ? [instruction.file] : []);
    await assertPathRequirements(context, sedRequirements, ["script-output"], outputFiles);
    if (inPlace !== undefined || outputFiles.length) {
      await assertPathRequirements(context, sedRequirements, ["file"], files.filter(file => file !== "-"));
      await assertPathRequirements(context, sedRequirements, ["script-read"],
        program.flatMap(instruction => instruction.kind === "r" && instruction.file !== undefined ? [instruction.file] : []));
    }
    const prepareOutputs = async (): Promise<void> => {
      const paths = new Set(outputFiles.map(file => virtualPath(context, file)));
      for (const path of paths) await context.fs.writeFile(path, new Uint8Array(), { signal: context.signal });
    };
    if (inPlace !== undefined) {
      if (!files.length || files.includes("-")) throw new ProgramError("in-place editing requires named files");
      if (inPlace.includes("/") || inPlace.includes("\0")) throw new ProgramError("backup suffix cannot contain '/' or NUL");
      await assertPathRequirements(context, sedRequirements, ["in-place"], files);
      if (inPlace) await assertPathRequirements(context, sedRequirements, ["backup"], files.flatMap(file => [file, file + inPlace]));
      for (const file of files) {
        const path = virtualPath(context, file);
        if ((await context.fs.lstat(path, { signal: context.signal })).type !== "file") throw new FsError("ENOTSUP", { path, message: "in-place editing requires regular files, not links or directories" });
      }
      await prepareOutputs();
      for (const file of files) {
        let rewritten = "";
        const child = { ...context, stdout: { async write(chunk: Uint8Array) { rewritten = budget.check(rewritten + Buffer.from(chunk).toString("latin1")); } } };
        const result = await execute(program, child, [file], quiet, budget);
        const path = virtualPath(context, file);
        if (inPlace) await context.fs.copyFile(path, path + inPlace, { signal: context.signal });
        await context.fs.writeFile(path, bytes(rewritten), { signal: context.signal });
        if (result.quit || result.status) return result.status;
      }
      return 0;
    }
    await prepareOutputs();
    if (separate) {
      for (const file of files.length ? files : ["-"]) { const result = await execute(program, context, [file], quiet, budget); if (result.quit || result.status) return result.status; }
      return 0;
    }
    return (await execute(program, context, files, quiet, budget)).status;
  });
  return { ...definition, filesystemRequirements: sedRequirements };
}
