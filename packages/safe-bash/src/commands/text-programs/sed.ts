import type { FileSystem } from "@poe-code/safe-fs";
import { tryReadMemoryFileViewSync } from "@poe-code/safe-fs/core";
import { FsError, writeBytes, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import { Pattern, substitute, trySubstituteSync, trySubstitutePairSync, trySubstitutePairToBufferSync } from "./regex.js";
import { Budget, ProgramError, byteString, bytes, command, getCachedLatin1Batch, input, lineRecordBatches, readProgram, virtualPath, write, type LineRecordBatch, type RecordLine, type TextProgramOptions } from "./shared.js";
import { assertPathRequirements, requiredFileInput, sedRequirements } from "../search/requirements.js";
import { pathOf } from "../internal.js";
import { editInPlace, prepareInPlace } from "./inplace.js";

type Address = { kind: "number"; number: number } | { kind: "step"; first: number; step: number } | { kind: "plus"; count: number } | { kind: "tilde"; count: number } | { kind: "last" } | { kind: "regex"; pattern: Pattern | undefined };
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
  replacementGroupCount?: number;
  global?: boolean;
  occurrence?: number;
  print?: boolean;
  status?: number;
  translation?: Map<string, string>;
}

interface OutputState {
  stdoutUnterminated: boolean;
  readonly unterminatedFiles: Set<string>;
}

interface CachedSedProgram {
  readonly program: readonly Instruction[];
  readonly steps: number;
  readonly outputFiles: readonly string[];
  readonly readFiles: readonly string[];
}
const sedProgramCache = new Map<string, CachedSedProgram>();
const EMPTY_STRINGS: readonly string[] = Object.freeze([]);
const EMPTY_SET: Set<string> = new Set();

async function parse(source: string, extended: boolean, separator: string, maxProgramInstructions: number, budget: Budget): Promise<Instruction[]> {
  const result: Instruction[] = [];
  const groups: number[] = [];
  const labels = new Map<string, number>();
  let offset = 0;
  const horizontal = () => { while (source[offset] === " " || source[offset] === "\t" || source[offset] === "\r") offset++; };
  const delimited = (delimiter: string, regex = false): string => {
    let text = "";
    let bracket = false;
    let first = 0;
    let special = "";
    while (offset < source.length) {
      const character = source[offset++]!;
      if (character === delimiter && !bracket) return text;
      if (character === "\\") {
        if (bracket && source[offset] !== delimiter && source[offset] !== "\n") {
          text += "\\";
          first = 0;
          continue;
        }
        const next = source[offset++];
        if (next === undefined) break;
        text += next === "\n"
          || (!bracket && next === delimiter && (regex ? (!extended && "()|+?{}".includes(next)) || "ntrfva".includes(next) : (next === "n" || next === "t" || (next >= "0" && next <= "9"))))
          ? next : `\\${next}`;
        if (bracket) first = 0;
      } else {
        if (character === "\n") throw new ProgramError("unterminated delimited expression");
        if (regex) {
          if (!bracket && character === "[") { bracket = true; first = 2; }
          else if (bracket) {
            if (special) {
              if (character === special && source[offset] === "]") {
                text += character + source[offset++]!;
                special = "";
                continue;
              }
            } else if (character === "[" && [":", ".", "="].includes(source[offset] ?? "")) {
              special = source[offset++]!;
              text += character + special;
              first = 0;
              continue;
            } else if (character === "]" && !first) bracket = false;
            first = first === 2 && character === "^" ? 1 : 0;
          }
        }
        text += character;
      }
    }
    throw new ProgramError(bracket ? "unterminated bracket expression" : "unterminated delimited expression");
  };
  const address = async (): Promise<Address | undefined> => {
    horizontal();
    const number = /^[0-9]+/u.exec(source.slice(offset));
    if (number) {
      offset += number[0].length;
      const value = Number(number[0]);
      if (!Number.isSafeInteger(value)) throw new ProgramError("sed line address exceeds safe integer range");
      if (source[offset] === "~") {
        offset++;
        const stepMatch = /^[0-9]+/u.exec(source.slice(offset));
        if (!stepMatch) throw new ProgramError("invalid step address");
        offset += stepMatch[0].length;
        const step = Number(stepMatch[0]);
        if (!Number.isSafeInteger(step)) throw new ProgramError("sed line address exceeds safe integer range");
        return { kind: "step", first: value, step };
      }
      return { kind: "number", number: value };
    }
    if (source[offset] === "$") { offset++; return { kind: "last" }; }
    let delimiter: string | undefined;
    if (source[offset] === "/") delimiter = source[offset++];
    else if (source[offset] === "\\" && source[offset + 1] && source[offset + 1] !== "\n") { offset++; delimiter = source[offset++]; }
    if (delimiter !== undefined) {
      const pattern = delimited(delimiter, true);
      const ignoreCase = source[offset] === "I";
      if (ignoreCase) offset++;
      if (!pattern && ignoreCase) throw new ProgramError("flags on an empty regex are not supported");
      const compiled = pattern ? new Pattern(pattern, extended, ignoreCase) : undefined;
      if (compiled) await compiled.prepare(budget);
      return { kind: "regex", pattern: compiled };
    }
    return undefined;
  };
  const label = (): string => {
    horizontal();
    const start = offset;
    while (offset < source.length && ![";", "\n", "}"].includes(source[offset]!)) offset++;
    const text = source.slice(start, offset).trim();
    return text;
  };
  const textArgument = (terminator: string): string => {
    horizontal();
    if (source[offset] === "\\") {
      offset++;
      if (source[offset] === "\n") offset++;
    }
    let text = "";
    while (offset < source.length && source[offset] !== "\n") {
      const character = source[offset++]!;
      if (character === "\\" && offset < source.length) {
        const next = source[offset++]!;
        text += next === "n" ? "\n" : next === "t" ? "\t" : next;
      } else text += character;
    }
    return text + terminator;
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
    if (result.length >= maxProgramInstructions) throw new ProgramError("program instruction limit exceeded");
    const first = await address();
    horizontal();
    let second: Address | undefined;
    if (source[offset] === ",") {
      offset++;
      horizontal();
      if (source[offset] === "+" || source[offset] === "~") {
        const relKind = source[offset]!;
        const relMatch = /^[0-9]+/u.exec(source.slice(offset + 1));
        if (relMatch) {
          offset += 1 + relMatch[0].length;
          const count = Number(relMatch[0]);
          if (!Number.isSafeInteger(count)) throw new ProgramError("sed line address exceeds safe integer range");
          second = { kind: relKind === "+" ? "plus" : "tilde", count };
        }
      }
      if (!second) second = await address();
      if (!first || !second) throw new ProgramError("invalid address range");
    }
    if (first?.kind === "number" && first.number === 0 && second?.kind !== "regex" || second?.kind === "number" && second.number === 0) throw new ProgramError("zero address requires a 0,/regex/ range");
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
      const pattern = delimited(delimiter, true);
      instruction.replacement = delimited(delimiter);
      instruction.replacementGroupCount = 0;
      for (let index = 0; index < instruction.replacement.length; index++) {
        if (instruction.replacement[index] !== "\\") continue;
        const escaped = instruction.replacement[++index];
        if (escaped !== undefined && escaped >= "1" && escaped <= "9") {
          instruction.replacementGroupCount = Math.max(instruction.replacementGroupCount, Number(escaped));
        }
      }
      let ignoreCase = false;
      while (offset < source.length && ![";", "\n", "}", " ", "\t", "#"].includes(source[offset]!)) {
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
        if (instruction.replacementGroupCount > instruction.pattern.groupCount) throw new ProgramError("replacement references an undefined capture group");
        await instruction.pattern.prepare(budget);
      }
    } else if (kind === "r" || kind === "w") {
      if (kind === "r" && second) throw new ProgramError("read accepts at most one address");
      instruction.file = fileArgument();
    } else if (kind === "a" || kind === "i" || kind === "c") instruction.text = textArgument(kind === "a" ? "\n" : separator);
    else if (kind === "b" || kind === "t" || kind === "T" || kind === ":") {
      instruction.text = label();
      if (first && kind === ":") throw new ProgramError("labels cannot have addresses");
      if (kind === ":") {
        if (!instruction.text || labels.has(instruction.text)) throw new ProgramError("empty or duplicate branch label");
        labels.set(instruction.text, result.length);
      }
    } else if (kind === "q" || kind === "Q") {
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
    } else if (!"pdDPhHgGxnN=lzF".includes(kind)) throw new ProgramError(`unsupported sed command '${kind}'`);
    result.push(instruction);
    horizontal();
    if (offset < source.length && ![";", "\n", "}", "#"].includes(source[offset]!)) throw new ProgramError(`unexpected text after '${kind}' command`);
  }
  if (groups.length) throw new ProgramError("unclosed sed group");
  for (const instruction of result) if (["b", "t", "T"].includes(instruction.kind)) {
    const target = instruction.text ? labels.get(instruction.text) : result.length;
    if (target === undefined) throw new ProgramError(`undefined branch label '${instruction.text}'`);
    instruction.jump = target;
  }
  return result;
}

async function* nullRecords(context: CommandContext, files: readonly string[], budget: Budget): AsyncGenerator<RecordLine> {
  const names = files.length ? files : ["-"];
  for (let fileIndex = 0; fileIndex < names.length; fileIndex++) {
    const file = names[fileIndex]!;
    let pending = "";
    for await (const chunk of input(context, file)) {
      budget.step();
      let start = 0;
      while (start < chunk.byteLength) {
        const end = chunk.indexOf(0, start);
        const stop = end < 0 ? chunk.byteLength : end;
        if (pending.length + stop - start > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        pending += Buffer.from(chunk.subarray(start, stop)).toString("latin1");
        if (end < 0) break;
        yield { text: pending, terminated: true, file, fileIndex };
        pending = "";
        start = end + 1;
      }
    }
    if (pending) yield { text: pending, terminated: false, file, fileIndex };
  }
}

const STDOUT_CAP = 65536;
const STDOUT_FLUSH = 60000;
let sharedSedStdoutBuf: Buffer | undefined;
let sharedSedStdoutBufInUse = false;

async function execute(program: readonly Instruction[], context: CommandContext, files: readonly string[], quiet: boolean, budget: Budget, separator: string, outputState: OutputState, lineLength: number): Promise<{ status: number; quit: boolean }> {
  const useBatches = separator !== "\0";
  const batchSource = useBatches ? lineRecordBatches(context, files, budget) : undefined;
  const singleSource = useBatches ? undefined : nullRecords(context, files, budget);
  let currentBatch: LineRecordBatch | undefined;
  let currentBatchLen = 0;
  let batchIndex = 0;
  const sharedBatchRecord: { text: string; terminated: boolean; file: string; fileIndex: number } = {
    text: "",
    terminated: true,
    file: "",
    fileIndex: 0,
  };
  const fillFromBatch = (
    batch: LineRecordBatch,
    idx: number,
    target: { text: string; terminated: boolean; file: string; fileIndex: number },
  ): RecordLine => {
    if (idx < batch.ends.length) {
      const start = idx === 0 ? 0 : batch.ends[idx - 1]! + 1;
      const end = batch.ends[idx]!;
      const slice = batch.text.slice(start, end);
      target.text = idx === 0 && batch.firstLinePrefix ? batch.firstLinePrefix + slice : slice;
      target.terminated = true;
    } else {
      target.text = batch.trailingText!;
      target.terminated = false;
    }
    target.file = batch.file;
    target.fileIndex = batch.fileIndex;
    return target;
  };
  let currentRecord: RecordLine | undefined;
  let followingRecord: RecordLine | null | undefined;
  if (batchSource) {
    const firstBatch = await batchSource.next();
    if (!firstBatch.done) {
      currentBatch = firstBatch.value;
      currentBatchLen = currentBatch.ends.length + (currentBatch.trailingText !== undefined ? 1 : 0);
      if (currentBatchLen > 0) {
        currentRecord = fillFromBatch(currentBatch, 0, sharedBatchRecord);
        batchIndex = 1;
      }
    }
  } else {
    const first = await singleSource!.next();
    if (!first.done) currentRecord = first.value;
  }
  const peekNextRecord = async (): Promise<RecordLine | undefined> => {
    if (followingRecord !== undefined) return followingRecord ?? undefined;
    if (batchSource) {
      if (currentBatch && batchIndex < currentBatchLen) {
        followingRecord = fillFromBatch(currentBatch, batchIndex, { text: "", terminated: true, file: "", fileIndex: 0 });
        return followingRecord;
      }
      const nextBatch = await batchSource.next();
      if (nextBatch.done) {
        followingRecord = null;
        return undefined;
      }
      currentBatch = nextBatch.value;
      currentBatchLen = currentBatch.ends.length + (currentBatch.trailingText !== undefined ? 1 : 0);
      if (currentBatchLen === 0) {
        followingRecord = null;
        return undefined;
      }
      batchIndex = 0;
      followingRecord = fillFromBatch(currentBatch, 0, { text: "", terminated: true, file: "", fileIndex: 0 });
      return followingRecord;
    }
    const next = await singleSource!.next();
    followingRecord = next.done ? null : next.value;
    return followingRecord ?? undefined;
  };
  const readNextRecord = async (): Promise<RecordLine | undefined> => {
    if (followingRecord !== undefined) {
      const next = followingRecord ?? undefined;
      followingRecord = undefined;
      if (batchSource && next !== undefined && currentBatch && batchIndex < currentBatchLen) {
        batchIndex++;
      }
      return next;
    }
    if (batchSource) {
      if (currentBatch && batchIndex < currentBatchLen) {
        return fillFromBatch(currentBatch, batchIndex++, sharedBatchRecord);
      }
      const nextBatch = await batchSource.next();
      if (nextBatch.done) return undefined;
      currentBatch = nextBatch.value;
      currentBatchLen = currentBatch.ends.length + (currentBatch.trailingText !== undefined ? 1 : 0);
      if (currentBatchLen === 0) return undefined;
      batchIndex = 1;
      return fillFromBatch(currentBatch, 0, sharedBatchRecord);
    }
    const next = await singleSource!.next();
    return next.done ? undefined : next.value;
  };
  const prepareRecord = async (record: RecordLine): Promise<RecordLine> => {
    if (record.terminated || files.length < 2) return record;
    const next = await peekNextRecord();
    return next !== undefined && next.fileIndex !== record.fileIndex ? { ...record, terminated: true } : record;
  };
  let number = 0;
  let hold = "";
  let holdTerminated = true;
  const STDOUT_CAP = 65536;
  const STDOUT_FLUSH = 60000;
  const stdoutSync = typeof (context.stdout as { writeSync?: unknown }).writeSync === "function"
    ? (context.stdout as unknown as { writeSync(chunk: Uint8Array): void })
    : undefined;
  const canReuseStdoutBuf = !(context.stdout as { isPipeStage?: boolean }).isPipeStage;
  let usingSharedStdoutBuf = false;
  let stdoutBuf: Buffer | undefined;
  if (canReuseStdoutBuf && !sharedSedStdoutBufInUse) {
    sharedSedStdoutBufInUse = true;
    usingSharedStdoutBuf = true;
    if (!sharedSedStdoutBuf) {
      sharedSedStdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
    }
    stdoutBuf = sharedSedStdoutBuf;
  }
  let stdoutLen = 0;
  const sepCode = separator.charCodeAt(0) & 0xff;
  const appendStdout = (text: string): void => {
    const tLen = text.length;
    if (tLen === 0) return;
    if (!stdoutBuf) {
      stdoutBuf = Buffer.allocUnsafe(Math.max(STDOUT_CAP, tLen + 1));
    } else if (stdoutLen + tLen > stdoutBuf.length) {
      const grown = Buffer.allocUnsafe(Math.max(stdoutBuf.length * 2, stdoutLen + tLen + 1));
      stdoutBuf.copy(grown, 0, 0, stdoutLen);
      stdoutBuf = grown;
    }
    stdoutBuf.write(text, stdoutLen, tLen, "latin1");
    stdoutLen += tLen;
  };
  const appendStdoutSep = (): void => {
    if (!stdoutBuf) {
      stdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
    } else if (stdoutLen + 1 > stdoutBuf.length) {
      const grown = Buffer.allocUnsafe(stdoutBuf.length * 2);
      stdoutBuf.copy(grown, 0, 0, stdoutLen);
      stdoutBuf = grown;
    }
    stdoutBuf[stdoutLen++] = sepCode;
  };
  const flushStdout = (): Promise<void> | undefined => {
    if (stdoutLen > 0 && stdoutBuf) {
      const flushedLen = stdoutLen;
      const chunk = new Uint8Array(stdoutBuf.buffer, stdoutBuf.byteOffset, flushedLen);
      stdoutLen = 0;
      context.signal.throwIfAborted();
      if (stdoutSync) {
        stdoutSync.writeSync(chunk);
        return undefined;
      }
      return writeBytes(context.stdout, Buffer.from(chunk), context.signal);
    }
    return undefined;
  };
  const joinSpace = (left: string, right: string): string => {
    if (left.length + separator.length + right.length > budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    return left + separator + right;
  };
  const emit = (text: string, terminated = true): Promise<void> | undefined => {
    if (outputState.stdoutUnterminated) appendStdoutSep();
    appendStdout(text);
    outputState.stdoutUnterminated = !terminated;
    if (!useBatches || stdoutLen >= STDOUT_FLUSH) return flushStdout();
    return undefined;
  };
  let lastPattern: Pattern | undefined;
  const active = new Map<number, number>();
  for (let pc = 0; pc < program.length; pc++) {
    const first = program[pc]!.first;
    if (first?.kind === "number" && first.number === 0) active.set(pc, 0);
  }
  const getPattern = (pattern: Pattern | undefined) => {
    if (pattern) lastPattern = pattern;
    if (!lastPattern) throw new ProgramError("no previous regular expression");
    return lastPattern;
  };
  const appended: { text?: string; file?: string }[] = [];
  let appendedSize = 0;
  const append = (item: { text?: string; file?: string }): void => {
    appendedSize += (item.text ?? item.file ?? "").length + 32;
    if (appendedSize > budget.maxBufferBytes) throw new ProgramError("append queue buffer limit exceeded");
    appended.push(item);
  };
  let record!: RecordLine;
  let pattern = "";
  let substituted = false;
  let deleted = false;
  let quit = false;
  let status = 0;
  const print = (): Promise<void> | undefined => {
    if (outputState.stdoutUnterminated) appendStdoutSep();
    appendStdout(pattern);
    if (record.terminated) appendStdoutSep();
    outputState.stdoutUnterminated = !record.terminated;
    if (!useBatches || stdoutLen >= STDOUT_FLUSH) return flushStdout();
    return undefined;
  };
  const flushSlow = async (printPattern: boolean): Promise<void> => {
    if (appended.length > 0) {
      await assertPathRequirements(context, sedRequirements, ["script-read"], appended.flatMap(item => item.file === undefined ? [] : [item.file]));
    }
    if (printPattern && !quiet && !deleted) {
      const p = print();
      if (p) await p;
    }
    if (outputState.stdoutUnterminated && (appended.length || quit)) {
      appendStdoutSep();
      if (stdoutLen >= STDOUT_FLUSH) await flushStdout();
      outputState.stdoutUnterminated = false;
    }
    for (const item of appended) {
      if (item.text !== undefined) {
        appendStdout(item.text);
        if (stdoutLen >= STDOUT_FLUSH) await flushStdout();
        continue;
      }
      await flushStdout();
      const path = virtualPath(context, item.file!);
      try {
        for await (const chunk of requiredFileInput(context, sedRequirements, "script-read", path, budget.maxBufferBytes)) {
          budget.step();
          const pendingCheck = budget.checkpointSync();
          if (pendingCheck) await pendingCheck;
          if (chunk.byteLength > budget.maxBufferBytes) throw new ProgramError("read buffer limit exceeded");
          await writeBytes(context.stdout, chunk, context.signal);
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (!(error instanceof FsError) || !["ENOENT", "EACCES", "EPERM", "EISDIR", "ENOTDIR"].includes(error.code)) throw error;
      }
    }
    appended.length = 0;
    appendedSize = 0;
  };
  const flush = (printPattern = true): Promise<void> | undefined => {
    if (appended.length === 0 && !quit) {
      if (printPattern && !quiet && !deleted) return print();
      return undefined;
    }
    return flushSlow(printPattern);
  };
  const writeFile = async (file: string): Promise<void> => {
    if (stdoutLen > 0) await flushStdout();
    const path = virtualPath(context, file);
    const terminated = record.terminated || separator === "\n";
    const text = (outputState.unterminatedFiles.has(path) ? separator : "") + pattern + (terminated ? separator : "");
    await writeFileOutput(context, bytes(text), chunk => context.fs.appendFile(path, chunk, { signal: context.signal }));
    if (terminated) outputState.unterminatedFiles.delete(path);
    else outputState.unterminatedFiles.add(path);
  };
  const matches = (address: Address): boolean | Promise<boolean> => {
    if (address.kind === "number") return number === address.number;
    if (address.kind === "step") return address.step === 0 ? number === address.first : number >= address.first && (number - address.first) % address.step === 0;
    if (address.kind === "plus" || address.kind === "tilde") return false;
    if (address.kind === "last") {
      if (batchSource && batchIndex < currentBatchLen) return false;
      return peekNextRecord().then(next => next === undefined);
    }
    return getPattern(address.pattern).tryTestSync(pattern, budget);
  };
  try {
    while (currentRecord !== undefined) {
      budget.step(); number++;
      record = currentRecord.terminated || files.length < 2 ? currentRecord : await prepareRecord(currentRecord);
      pattern = record.text;
      substituted = false;
      deleted = false;
      quit = false;
      status = 0;
      for (let pc = 0; pc < program.length;) {
        budget.step();
        const instruction = program[pc]!;
        if (number === 1 || (number & 31) === 0 || instruction.kind === "b" || instruction.kind === "t" || instruction.kind === "T" || instruction.kind === "D") {
          const pendingCheck = budget.checkpointSync();
          if (pendingCheck) await pendingCheck;
        }
        let selected = true;
        let ending = false;
        if (instruction.first) {
          if (instruction.second) {
            if (active.has(pc)) {
              const startLine = active.get(pc)!;
              if (instruction.second.kind === "number" && number > instruction.second.number) selected = false;
              const endMatch = instruction.second.kind === "number" ? number >= instruction.second.number
                : instruction.second.kind === "plus" ? number >= startLine + instruction.second.count
                : instruction.second.kind === "tilde" ? (instruction.second.count === 0 || (number > startLine && number % instruction.second.count === 0))
                : matches(instruction.second);
              ending = endMatch instanceof Promise ? await endMatch : endMatch;
              if (ending) active.delete(pc);
            } else {
              const firstMatch = matches(instruction.first);
              selected = firstMatch instanceof Promise ? await firstMatch : firstMatch;
              if (selected) {
                ending = instruction.second.kind === "number" && number >= instruction.second.number
                  || (instruction.second.kind === "plus" || instruction.second.kind === "tilde") && instruction.second.count === 0
                  || instruction.second.kind === "last" && (await peekNextRecord()) === undefined;
                if (!ending) active.set(pc, number);
              }
            }
          } else {
            const firstMatch = matches(instruction.first);
            selected = firstMatch instanceof Promise ? await firstMatch : firstMatch;
          }
        }
        if (instruction.negate) selected = !selected;
        if (!selected) { pc = instruction.kind === "{" ? instruction.jump! : pc + 1; continue; }
        switch (instruction.kind) {
          case "p": { const p = print(); if (p) await p; break; }
          case "P": {
            const end = pattern.indexOf(separator);
            const p = emit(end < 0 ? pattern + (record.terminated ? separator : "") : pattern.slice(0, end + 1), end >= 0 || record.terminated);
            if (p) await p;
            break;
          }
          case "=": { const p = emit(`${number}${separator}`); if (p) await p; break; }
          case "l": {
            const escapes: Record<string, string> = { "\x07": "\\a", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t", "\v": "\\v", "\\": "\\\\" };
            let line = "";
            for (let offset = 0; offset <= pattern.length; offset++) {
              budget.step(); await budget.checkpointSync();
              const character = pattern[offset];
              const lineEnd = character === "\n" && separator === "\n";
              const token = character === undefined || lineEnd ? "$" : escapes[character] ?? (character.charCodeAt(0) < 32 || character.charCodeAt(0) >= 127 ? `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}` : character);
              // GNU sed reserves a column for continuation but appends the end marker without wrapping.
              if (lineLength > 0 && character !== undefined && !lineEnd && line.length + token.length >= lineLength) { await emit(line + "\\" + separator); line = ""; }
              line = budget.check(line + token);
              if (lineEnd) { await emit(line + separator); line = ""; }
            }
            await emit(line + separator);
            break;
          }
          case "d": deleted = true; pc = program.length; continue;
          case "D": {
            const end = pattern.indexOf(separator);
            if (end < 0) { deleted = true; pc = program.length; }
            else { pattern = pattern.slice(end + 1); pc = 0; }
            continue;
          }
          case "q": quit = true; status = instruction.status ?? 0; pc = program.length; continue;
          case "Q": deleted = true; quit = true; status = instruction.status ?? 0; pc = program.length; continue;
          case "z": pattern = ""; break;
          case "F": { const p = emit(`${record.file}${separator}`); if (p) await p; break; }
          case "a": append({ text: instruction.text! }); break;
          case "r": append({ file: instruction.file! }); break;
          case "w": await writeFile(instruction.file!); break;
          case "i": await emit(instruction.text!); break;
          case "c":
            if (!instruction.second || ending || instruction.negate || (await peekNextRecord()) === undefined) await emit(instruction.text!);
            deleted = true; pc = program.length; continue;
          case "h": hold = pattern; holdTerminated = record.terminated; break;
          case "H": hold = joinSpace(hold, pattern); holdTerminated = record.terminated; break;
          case "g":
            pattern = hold;
            record = { ...record, terminated: holdTerminated };
            break;
          case "G":
            pattern = joinSpace(pattern, hold);
            record = { ...record, terminated: holdTerminated };
            break;
          case "x": {
            [pattern, hold] = [hold, pattern];
            const terminated = record.terminated;
            record = { ...record, terminated: holdTerminated };
            holdTerminated = terminated;
            break;
          }
          case "s": {
            const expression = getPattern(instruction.pattern);
            if (instruction.replacementGroupCount! > expression.groupCount) throw new ProgramError("replacement references an undefined capture group");
            if (!instruction.print && !instruction.file && pc + 1 < program.length) {
              const nextInst = program[pc + 1]!;
              if (nextInst.kind === "s" && !nextInst.first && !nextInst.second && !nextInst.negate && !nextInst.print && !nextInst.file && nextInst.pattern) {
                const nextExpr = nextInst.pattern;
                if (nextInst.replacementGroupCount! <= nextExpr.groupCount) {
                  if (
                    pc === 0 &&
                    program.length === 2 &&
                    !quiet &&
                    !deleted &&
                    appended.length === 0 &&
                    record.terminated &&
                    !outputState.stdoutUnterminated
                  ) {
                    if (!stdoutBuf) stdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
                    const newPosOrPromise = trySubstitutePairToBufferSync(
                      pattern,
                      expression,
                      instruction.replacement!,
                      instruction.global ?? false,
                      instruction.occurrence ?? 1,
                      nextExpr,
                      nextInst.replacement!,
                      nextInst.global ?? false,
                      nextInst.occurrence ?? 1,
                      budget,
                      stdoutBuf,
                      stdoutLen,
                      sepCode,
                    );
                    const newPos = typeof newPosOrPromise === "number" ? newPosOrPromise : await newPosOrPromise;
                    if (newPos >= 0) {
                      lastPattern = nextExpr;
                      stdoutLen = newPos;
                      budget.step();
                      if (!useBatches || stdoutLen >= STDOUT_FLUSH) {
                        const p = flushStdout();
                        if (p) await p;
                      }
                      if (batchSource && currentBatch && followingRecord === undefined) {
                        const batchText = currentBatch.text;
                        const batchEnds = currentBatch.ends;
                        const endsLen = batchEnds.length;
                        const g1 = instruction.global ?? false;
                        const o1 = instruction.occurrence ?? 1;
                        const r1 = instruction.replacement!;
                        const g2 = nextInst.global ?? false;
                        const o2 = nextInst.occurrence ?? 1;
                        const r2 = nextInst.replacement!;
                        while (batchIndex < endsLen) {
                          if (batchIndex === 0 && currentBatch.firstLinePrefix) break;
                          const lStart = batchIndex === 0 ? 0 : batchEnds[batchIndex - 1]! + 1;
                          const lEnd = batchEnds[batchIndex]!;
                          if (!stdoutBuf) stdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
                          const nextPosOrPromise = trySubstitutePairToBufferSync(
                            batchText,
                            expression,
                            r1,
                            g1,
                            o1,
                            nextExpr,
                            r2,
                            g2,
                            o2,
                            budget,
                            stdoutBuf,
                            stdoutLen,
                            sepCode,
                            lStart,
                            lEnd,
                          );
                          const nextPos = typeof nextPosOrPromise === "number" ? nextPosOrPromise : await nextPosOrPromise;
                          if (nextPos < 0) break;
                          batchIndex++;
                          number++;
                          budget.step(3);
                          if ((number & 31) === 0) {
                            const pendingCheck = budget.checkpointSync();
                            if (pendingCheck) await pendingCheck;
                          }
                          stdoutLen = nextPos;
                          if (stdoutLen >= STDOUT_FLUSH) {
                            const p = flushStdout();
                            if (p) await p;
                          }
                        }
                      }
                      deleted = true;
                      pc += 2;
                      continue;
                    }
                  }
                  const pairedOrPromise = trySubstitutePairSync(
                    pattern,
                    expression,
                    instruction.replacement!,
                    instruction.global ?? false,
                    instruction.occurrence ?? 1,
                    nextExpr,
                    nextInst.replacement!,
                    nextInst.global ?? false,
                    nextInst.occurrence ?? 1,
                    budget,
                  );
                  const paired = pairedOrPromise instanceof Promise ? await pairedOrPromise : pairedOrPromise;
                  if (paired !== undefined) {
                    lastPattern = nextExpr;
                    pattern = paired.text;
                    if (paired.substituted) substituted = true;
                    budget.step();
                    pc += 2;
                    continue;
                  }
                }
              }
            }
            const changedOrPromise = trySubstituteSync(pattern, expression, instruction.replacement!, budget, instruction.global ?? false, instruction.occurrence ?? 1);
            const changed = changedOrPromise instanceof Promise ? await changedOrPromise : changedOrPromise;
            pattern = changed.text;
            if (changed.count) { substituted = true; if (instruction.print) { const p = print(); if (p) await p; } if (instruction.file) await writeFile(instruction.file); }
            break;
          }
          case "y": {
            // Interpreter strings contain one Latin-1 code unit per input byte.
            budget.step(pattern.length);
            const translated = Buffer.allocUnsafe(pattern.length);
            for (let index = 0; index < pattern.length; index++) {
              if (index % 256 === 0) await budget.checkpointSync();
              translated[index] = (instruction.translation!.get(pattern[index]!) ?? pattern[index]!).charCodeAt(0);
            }
            pattern = translated.toString("latin1");
            break;
          }
          case "b": pc = instruction.jump!; continue;
          case "t": case "T": {
            const branch = instruction.kind === "t" ? substituted : !substituted;
            substituted = false;
            if (branch) { pc = instruction.jump!; continue; }
            break;
          }
          case "n": case "N": {
            if (instruction.kind === "n") { const p = flush(); if (p) await p; }
            else if ((await peekNextRecord()) !== undefined) { const p = flush(false); if (p) await p; }
            const next = await readNextRecord();
            if (next === undefined) { if (instruction.kind === "N") { const p = flush(); if (p) await p; } return { status: 0, quit: false }; }
            record = next.terminated || files.length < 2 ? next : await prepareRecord(next); number++;
            pattern = instruction.kind === "N" ? joinSpace(pattern, record.text) : record.text;
            substituted = false;
            break;
          }
        }
        pc++;
      }
      const flushPending = flush();
      if (flushPending) await flushPending;
      if (quit) return { status, quit: true };
      currentRecord = followingRecord === undefined && batchSource && currentBatch && batchIndex < currentBatchLen
        ? fillFromBatch(currentBatch, batchIndex++, sharedBatchRecord)
        : await readNextRecord();
    }
    return { status: 0, quit: false };
  } finally {
    try {
      if (stdoutLen > 0) await flushStdout();
      if (batchSource) await batchSource.return(undefined);
      else if (singleSource) await singleSource.return(undefined);
    } finally {
      if (usingSharedStdoutBuf) sharedSedStdoutBufInUse = false;
    }
  }
}

function runSedPairBatchLoopSync(
  batchText: string,
  batchEnds: Int32Array,
  endsLen: number,
  expr0: Pattern,
  r1: string,
  g1: boolean,
  o1: number,
  expr1: Pattern,
  r2: string,
  g2: boolean,
  o2: number,
  budget: Budget,
  stdoutBuf: Buffer,
): number {
  let stdoutLen = 0;
  for (let idx = 0; idx < endsLen; idx++) {
    const lStart = idx === 0 ? 0 : batchEnds[idx - 1]! + 1;
    const lEnd = batchEnds[idx]!;
    const nextPos = trySubstitutePairToBufferSync(
      batchText, expr0, r1, g1, o1, expr1, r2, g2, o2, budget, stdoutBuf, stdoutLen, 10, lStart, lEnd,
    );
    if (typeof nextPos !== "number" || nextPos < 0) return -1;
    budget.step(3);
    if (((idx + 1) & 31) === 0 && budget.checkpointSync()) return -1;
    stdoutLen = nextPos;
    if (stdoutLen >= STDOUT_FLUSH) return -2;
  }
  return stdoutLen;
}

function tryExecutePairFastSync(
  program: readonly Instruction[],
  context: CommandContext,
  file: string,
  quiet: boolean,
  budget: Budget,
  separator: string,
): number | undefined {
  if (program.length !== 2 || quiet || separator !== "\n" || file === "-") return undefined;
  const inst0 = program[0]!;
  const inst1 = program[1]!;
  if (
    inst0.kind !== "s" || inst0.first || inst0.second || inst0.negate || inst0.print || inst0.file || !inst0.pattern ||
    inst1.kind !== "s" || inst1.first || inst1.second || inst1.negate || inst1.print || inst1.file || !inst1.pattern
  ) {
    return undefined;
  }
  const expr0 = inst0.pattern;
  const expr1 = inst1.pattern;
  if (inst0.replacementGroupCount! > expr0.groupCount || inst1.replacementGroupCount! > expr1.groupCount) return undefined;
  const stdoutSync = typeof (context.stdout as { writeSync?: unknown }).writeSync === "function"
    ? (context.stdout as unknown as { writeSync(chunk: Uint8Array): boolean; writeRangeSync?(src: Uint8Array, len: number): boolean })
    : undefined;
  if (!stdoutSync) return undefined;
  const fastMem = (context as {
    _fastMemoryBackingFs?: FileSystem;
    _chargeFastFsOp?: () => void;
    _cachedInputBudget?: unknown;
  })._fastMemoryBackingFs;
  if (
    !fastMem ||
    fastMem.capabilitiesFor !== undefined ||
    (context as { _cachedInputBudget?: unknown })._cachedInputBudget !== undefined ||
    Object.prototype.hasOwnProperty.call(fastMem, "readStream") ||
    Object.prototype.hasOwnProperty.call(fastMem, "readFile")
  ) {
    return undefined;
  }
  const path = pathOf(context, file);
  if (path === "/dev" || path.startsWith("/dev/")) return undefined;
  let rawBytes: Uint8Array | undefined;
  try {
    rawBytes = tryReadMemoryFileViewSync(fastMem, path, undefined, context.signal);
  } catch {
    return undefined;
  }
  if (!rawBytes || rawBytes.byteLength < 256) return undefined;
  const cachedBatch = getCachedLatin1Batch(rawBytes);
  if (!cachedBatch || cachedBatch.lastLineStart !== cachedBatch.text.length || cachedBatch.maxLineLen > budget.maxBufferBytes) {
    return undefined;
  }
  if (budget.checkpointSync()) return undefined;
  (context as { _chargeFastFsOp?: () => void })._chargeFastFsOp?.();
  budget.step();
  let usingSharedStdoutBuf = false;
  let stdoutBuf: Buffer;
  if (!sharedSedStdoutBufInUse) {
    sharedSedStdoutBufInUse = true;
    usingSharedStdoutBuf = true;
    if (!sharedSedStdoutBuf) sharedSedStdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
    stdoutBuf = sharedSedStdoutBuf;
  } else {
    stdoutBuf = Buffer.allocUnsafe(STDOUT_CAP);
  }
  let stdoutLen = 0;
  const batchText = cachedBatch.text;
  const batchEnds = cachedBatch.ends;
  const endsLen = batchEnds.length;
  const g1 = inst0.global ?? false;
  const o1 = inst0.occurrence ?? 1;
  const r1 = inst0.replacement!;
  const g2 = inst1.global ?? false;
  const o2 = inst1.occurrence ?? 1;
  const r2 = inst1.replacement!;
  try {
    if (endsLen * 64 < STDOUT_FLUSH) {
      const fastLen = runSedPairBatchLoopSync(
        batchText, batchEnds, endsLen, expr0, r1, g1, o1, expr1, r2, g2, o2, budget, stdoutBuf,
      );
      if (fastLen >= 0) {
        if (fastLen > 0) {
          context.signal.throwIfAborted();
          if (typeof stdoutSync.writeRangeSync === "function") {
            stdoutSync.writeRangeSync(stdoutBuf, fastLen);
          } else {
            stdoutSync.writeSync(new Uint8Array(stdoutBuf.buffer, stdoutBuf.byteOffset, fastLen));
          }
        }
        return 0;
      }
      if (fastLen === -1) return undefined;
    }
    for (let idx = 0; idx < endsLen; idx++) {
      const lStart = idx === 0 ? 0 : batchEnds[idx - 1]! + 1;
      const lEnd = batchEnds[idx]!;
      const nextPos = trySubstitutePairToBufferSync(
        batchText, expr0, r1, g1, o1, expr1, r2, g2, o2, budget, stdoutBuf, stdoutLen, 10, lStart, lEnd,
      );
      if (typeof nextPos !== "number" || nextPos < 0) return undefined;
      budget.step(3);
      if (((idx + 1) & 31) === 0 && budget.checkpointSync()) return undefined;
      stdoutLen = nextPos;
      if (stdoutLen >= STDOUT_FLUSH) {
        context.signal.throwIfAborted();
        if (typeof stdoutSync.writeRangeSync === "function") {
          stdoutSync.writeRangeSync(stdoutBuf, stdoutLen);
        } else {
          stdoutSync.writeSync(new Uint8Array(stdoutBuf.buffer, stdoutBuf.byteOffset, stdoutLen));
        }
        stdoutLen = 0;
      }
    }
    if (stdoutLen > 0) {
      context.signal.throwIfAborted();
      if (typeof stdoutSync.writeRangeSync === "function") {
        stdoutSync.writeRangeSync(stdoutBuf, stdoutLen);
      } else {
        stdoutSync.writeSync(new Uint8Array(stdoutBuf.buffer, stdoutBuf.byteOffset, stdoutLen));
      }
      stdoutLen = 0;
    }
    return 0;
  } finally {
    if (usingSharedStdoutBuf) sharedSedStdoutBufInUse = false;
  }
}

export function sedCommand(options: TextProgramOptions = {}): CommandDefinition {
  const definition = command("sed", context => {
    const maxProgramInstructions = options.maxProgramInstructions === undefined ? Infinity : options.maxProgramInstructions;
    if (
      maxProgramInstructions === Infinity &&
      context.args.length === 2 &&
      !context.args[0]!.startsWith("-") &&
      context.args[0] !== "-" &&
      !context.args[1]!.startsWith("-") &&
      context.args[1] !== "-"
    ) {
      const rawProg = context.args[0]!;
      const sourceText = byteString(rawProg);
      const quiet = sourceText.startsWith("#n");
      const cacheKey = sourceText.length <= 8192 ? `0:\n:Infinity:${sourceText}` : "";
      const cached = cacheKey ? sedProgramCache.get(cacheKey) : undefined;
      if (cached && cached.outputFiles.length === 0 && cached.readFiles.length === 0) {
        const budget = Budget.acquire(context, options);
        try {
          if (cached.steps > 0) budget.step(cached.steps);
          const syncStatus = tryExecutePairFastSync(cached.program, context, context.args[1]!, quiet, budget, "\n");
          if (syncStatus !== undefined) return syncStatus;
        } finally {
          Budget.release(budget);
        }
      }
    }
    return (async () => {
    if ((maxProgramInstructions !== Infinity && !Number.isSafeInteger(maxProgramInstructions)) || maxProgramInstructions < 1) throw new ProgramError("maxProgramInstructions must be a positive safe integer");
    const budget = new Budget(context, options);
    const sources: string[] = [];
    const files: string[] = [];
    let quiet = false;
    let extended = false;
    let separate = false;
    let lineLength = 70;
    const setLineLength = (value: string | undefined): void => {
      if (value === undefined || !value.length || [...value].some(character => character < "0" || character > "9") || !Number.isSafeInteger(Number(value))) {
        throw new ProgramError("line length must be a nonnegative safe integer");
      }
      lineLength = Number(value);
    };
    let separator = "\n";
    let inPlace: string | undefined;
    let ended = false;
    for (let index = 0; index < context.args.length; index++) {
      const argument = context.args[index]!;
      if (ended || argument === "-" || !argument.startsWith("-")) { files.push(argument); continue; }
      if (argument === "--") { ended = true; continue; }
      if (argument === "--null-data") { separator = "\0"; continue; }
      if (argument === "--quiet" || argument === "--silent") { quiet = true; continue; }
      if (argument === "--unbuffered" || argument === "--posix") continue;
      if (argument === "--regexp-extended") { extended = true; continue; }
      if (argument === "--in-place" || argument.startsWith("--in-place=")) {
        inPlace = argument === "--in-place" ? "" : argument.slice("--in-place=".length);
        continue;
      }
      if (argument === "--separate") { separate = true; continue; }
      if (argument === "--line-length" || argument.startsWith("--line-length=")) {
        setLineLength(argument === "--line-length" ? context.args[++index] : argument.slice("--line-length=".length));
        continue;
      }
      if (argument.startsWith("--")) throw new ProgramError(`unsupported option '${argument}'`);
      for (let position = 1; position < argument.length; position++) {
        const flag = argument[position]!;
        if (flag === "n") quiet = true;
        else if (flag === "u") { /* unbuffered */ }
        else if (flag === "z") separator = "\0";
        else if (flag === "E" || flag === "r") extended = true;
        else if (flag === "s") separate = true;
        else if (flag === "l") {
          setLineLength(argument.slice(position + 1) || context.args[++index]);
          position = argument.length;
        }
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
    const sourceText = sources.length === 1 ? sources[0]! : sources.join("\n");
    const canCache = sourceText.length <= 8192;
    const cacheKey = canCache ? `${extended ? 1 : 0}:${separator}:${maxProgramInstructions}:${sourceText}` : "";
    let cached = canCache ? sedProgramCache.get(cacheKey) : undefined;
    if (cached) {
      if (cached.steps > 0) budget.step(cached.steps);
    } else {
      const stepsBefore = budget.stepsUsed;
      const parsedProgram = await parse(sourceText, extended, separator, maxProgramInstructions, budget);
      const steps = budget.stepsUsed - stepsBefore;
      let outFiles: string[] | undefined;
      let rdFiles: string[] | undefined;
      for (let i = 0; i < parsedProgram.length; i++) {
        const inst = parsedProgram[i]!;
        if (inst.file !== undefined) {
          if (inst.kind === "r") (rdFiles ??= []).push(inst.file);
          else (outFiles ??= []).push(inst.file);
        }
      }
      cached = {
        program: parsedProgram,
        steps,
        outputFiles: outFiles ?? EMPTY_STRINGS,
        readFiles: rdFiles ?? EMPTY_STRINGS,
      };
      if (canCache) {
        if (sedProgramCache.size >= 64) sedProgramCache.delete(sedProgramCache.keys().next().value!);
        sedProgramCache.set(cacheKey, cached);
      }
    }
    const { program, outputFiles, readFiles } = cached;
    if (outputFiles.length > 0) {
      await assertPathRequirements(context, sedRequirements, ["script-output"], outputFiles);
    }
    if (inPlace !== undefined || outputFiles.length > 0) {
      await assertPathRequirements(context, sedRequirements, ["file"], files.filter(file => file !== "-"));
      if (readFiles.length > 0) {
        await assertPathRequirements(context, sedRequirements, ["script-read"], readFiles);
      }
    }
    const prepareOutputs = async (): Promise<void> => {
      if (outputFiles.length === 0) return;
      const paths = new Set(outputFiles.map(file => virtualPath(context, file)));
      for (const path of paths) await writeFileOutput(context, new Uint8Array(), chunk => context.fs.writeFile(path, chunk, { signal: context.signal }));
    };
    const outputState: OutputState = { stdoutUnterminated: false, unterminatedFiles: outputFiles.length > 0 ? new Set() : EMPTY_SET };
    if (inPlace !== undefined) {
      if (!files.length || files.includes("-")) throw new ProgramError("in-place editing requires named files");
      if (inPlace.includes("/") || inPlace.includes("\0")) throw new ProgramError("backup suffix cannot contain '/' or NUL");
      await assertPathRequirements(context, sedRequirements, ["in-place"], files);
      if (inPlace) await assertPathRequirements(context, sedRequirements, ["backup"], files.flatMap(file => [file, file + inPlace]));
      const targets = await prepareInPlace(context, files, inPlace);
      if (outputFiles.length > 0) await prepareOutputs();
      for (const target of targets) {
        const result = await editInPlace(context, target, inPlace, budget, async stdin => {
          let rewritten = "";
          const child = Object.assign(Object.create(Object.getPrototypeOf(context)), context, { stdin, stdout: { async write(chunk: Uint8Array) { rewritten = budget.check(rewritten + Buffer.from(chunk).toString("latin1")); } } }) as CommandContext;
          outputState.stdoutUnterminated = false;
          const result = await execute(program, child, ["-"], quiet, budget, separator, outputState, lineLength);
          return { result, data: bytes(rewritten) };
        });
        if (result.quit || result.status) return result.status;
      }
      return 0;
    }
    if (outputFiles.length > 0) await prepareOutputs();
    if (separate) {
      for (const file of files.length ? files : ["-"]) { const result = await execute(program, context, [file], quiet, budget, separator, outputState, lineLength); if (result.quit || result.status) return result.status; }
      return 0;
    }
    return (await execute(program, context, files, quiet, budget, separator, outputState, lineLength)).status;
    })();
  });
  return { ...definition, filesystemRequirements: sedRequirements };
}
