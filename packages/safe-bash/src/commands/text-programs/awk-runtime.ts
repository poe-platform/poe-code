import { FsError, writeBytes, type CommandContext } from "../../contracts/index.js";
import { writeFileOutput } from "../../contracts/filesystem-output.js";
import type { AwkProgram, Expression, Statement } from "./awk-syntax.js";
import { decodeString } from "./awk-syntax.js";
import { AwkArray, compare, formatted, inputValue, inputValueFromSlice, number, numeric, scalar, string, text, truth, unset, type Scalar, type Value } from "./awk-values.js";
import { Pattern, substitute } from "./regex.js";
import { Budget, ProgramError, byteString, bytes, input, virtualPath, write } from "./shared.js";
import { AwkRetention } from "./awk-retention.js";
import { Reader } from "./awk-reader.js";
import type { AwkInspection } from "./awk-inspection.js";

function textSize(value: Value | undefined): number {
  return value && !(value instanceof AwkArray) && (value.kind === "string" || value.kind === "numeric") ? value.text.length : 0;
}

function ownScalar(value: Scalar): Scalar {
  if (value.kind === "string" || value.kind === "numeric") {
    const ownedText = value.text.length >= 13 ? Buffer.from(value.text, "latin1").toString("latin1") : value.text;
    return value.kind === "numeric"
      ? { kind: "numeric", text: ownedText, number: value.number }
      : { kind: "string", text: ownedText };
  }
  if (value.kind === "number" && !Object.isFrozen(value)) {
    return { kind: "number", number: value.number };
  }
  return value;
}

const DEFAULT_VARIABLES: readonly (readonly [string, Scalar])[] = [
  ["FS", Object.freeze({ kind: "string", text: " " })],
  ["RS", Object.freeze({ kind: "string", text: "\n" })],
  ["OFS", Object.freeze({ kind: "string", text: " " })],
  ["ORS", Object.freeze({ kind: "string", text: "\n" })],
  ["OFMT", Object.freeze({ kind: "string", text: "%.6g" })],
  ["CONVFMT", Object.freeze({ kind: "string", text: "%.6g" })],
  ["SUBSEP", Object.freeze({ kind: "string", text: "\x1c" })],
  ["NR", numeric(0)],
  ["FNR", numeric(0)],
  ["NF", numeric(0)],
  ["FILENAME", string("")],
  ["RSTART", numeric(0)],
  ["RLENGTH", numeric(0)],
];
const AWK_ARGV0: Scalar = Object.freeze({ kind: "string", text: "awk" });

function hasMainGetline(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if ((node as { kind?: string; file?: unknown }).kind === "getline" && !(node as { file?: unknown }).file) return true;
  return Object.values(node).some(child => Array.isArray(child) ? child.some(hasMainGetline) : hasMainGetline(child));
}

interface PooledFieldBuffers {
  fieldStarts: number[];
  fieldEnds: number[];
  lazyFieldGen: number[];
  lazyFields: Scalar[];
  fieldGeneration: number;
}
let sharedFieldBuffers: PooledFieldBuffers | undefined = {
  fieldStarts: new Array<number>(64).fill(0),
  fieldEnds: new Array<number>(64).fill(0),
  lazyFieldGen: new Array<number>(64).fill(0),
  lazyFields: new Array(64),
  fieldGeneration: 1,
};
const FAST_AWK_MATCH_OFFSETS = new Int32Array(20);
const RELEASED_AWK_SIGNAL = new AbortController().signal;
const RELEASED_AWK_CONTEXT = Object.freeze({ signal: RELEASED_AWK_SIGNAL }) as unknown as CommandContext;
const runtimeAnchor: { current?: AwkRuntime } = {};
const _lastAwkArrayAnchor = new AwkArray();
void _lastAwkArrayAnchor;

class Flow {
  constructor(readonly kind: string, readonly value: Scalar = unset) {}
}

interface Reference { get(): Value; set(value: Scalar): void | Promise<void> }

export class AwkRuntime {
  private readonly variables = new Map<string, Value>();
  private readonly frames: Map<string, Value>[] = [];
  private readonly arrays = new Map<AwkArray, { bytes: number; references: number }>();
  private regexes: Map<string, Pattern> | undefined;
  private outputs: Set<string> | undefined;
  private inputs: Map<string, Reader> | undefined;
  private environInitialized = false;
  private pooledBuffers: PooledFieldBuffers | undefined;
  private mainReader: Reader | undefined;
  private argument = 1;
  private sawFile = false;
  private defaultUsed = false;
  private rawFields: Scalar[] = [];
  private get fields(): Scalar[] { return this.ensureFields(); }
  private set fields(v: Scalar[]) { this.rawFields = v; }
  private fieldStarts: number[];
  private fieldEnds: number[];
  private fieldCount = 0;
  private deferredFieldSeparator = " ";
  private fieldsMaterialized = true;
  private fieldGeneration: number;
  private lazyFieldGen: number[];
  private lazyFields: Scalar[];
  private fieldBytes = 0;
  private rawRecord: string | undefined = "";
  private recordSource = "";
  private recordStart = 0;
  private recordEnd = 0;
  private get record(): string {
    return this.rawRecord ??= this.recordSource.slice(this.recordStart, this.recordEnd);
  }
  private set record(v: string) {
    this.rawRecord = v;
    this.recordSource = v;
    this.recordStart = 0;
    this.recordEnd = v.length;
  }
  private get recordLength(): number {
    return this.rawRecord !== undefined ? this.rawRecord.length : this.recordEnd - this.recordStart;
  }
  private readonly sliceBox = { source: "", start: 0, end: 0 };
  private recordValue: Scalar | undefined = string("");
  private entries = 0;
  private fsText = " ";
  private rsText = "\n";
  private convfmtText = "%.6g";
  private nrNum = 0;
  private nrDirty = false;
  private fnrNum = 0;
  private fnrDirty = false;
  private nfNum = 0;
  private nfDirty = false;
  private phase = "BEGIN";
  private status = 0;
  private randomSeed = 1;
  private randomState = 1;
  constructor(private readonly program: AwkProgram, readonly context: CommandContext, readonly budget: Budget, readonly retention: AwkRetention, args: readonly string[], assignments: readonly string[], separator?: string, private readonly operandAssignments = true, private readonly ordchr = false, private readonly inspection?: AwkInspection) {
    const pooled = sharedFieldBuffers;
    if (pooled) {
      sharedFieldBuffers = undefined;
      this.pooledBuffers = pooled;
      this.fieldStarts = pooled.fieldStarts;
      this.fieldEnds = pooled.fieldEnds;
      this.lazyFieldGen = pooled.lazyFieldGen;
      this.lazyFields = pooled.lazyFields;
      this.fieldGeneration = pooled.fieldGeneration;
    } else {
      this.fieldStarts = new Array<number>(64).fill(0);
      this.fieldEnds = new Array<number>(64).fill(0);
      this.lazyFieldGen = new Array<number>(64).fill(0);
      this.lazyFields = new Array(64);
      this.fieldGeneration = 1;
    }
    try {
      for (let i = 0; i < DEFAULT_VARIABLES.length; i++) {
        const pair = DEFAULT_VARIABLES[i]!;
        this.storeScalar(this.variables, pair[0], pair[1]);
      }
      this.storeScalar(this.variables, "ARGC", numeric(args.length + 1));
      if (inspection !== undefined || retention.capacity <= 65536 || budget.options.maxArrayEntries !== undefined || budget.options.maxBufferBytes !== undefined || budget.options.maxRetainedBytes !== undefined) {
        this.ensureEnviron();
      }
      const argv = this.array("ARGV"); this.arraySet(argv, "0", AWK_ARGV0);
      for (let index = 0; index < args.length; index++) {
        this.arraySet(argv, String(index + 1), inputValue(byteString(args[index]!)));
      }
      if (separator !== undefined) this.set("FS", string(separator));
      for (const assignment of assignments) this.assignment(assignment);
    } catch (error) { this.releaseStore(this.variables); throw error; }
  }
  private ensureEnviron(): void {
    if (this.environInitialized) return;
    this.environInitialized = true;
    const environment = new AwkArray();
    this.bindArray(this.variables, "ENVIRON", environment);
    for (const [name, value] of Object.entries(this.context.env)) {
      this.arraySet(environment, byteString(name), inputValue(byteString(value)));
    }
  }
  private store(name: string): Map<string, Value> { return this.frames.at(-1)?.has(name) ? this.frames.at(-1)! : this.variables; }
  private syncSpecialVars(): void {
    if (this.nrDirty) { this.nrDirty = false; this.storeScalar(this.variables, "NR", numeric(this.nrNum)); }
    if (this.fnrDirty) { this.fnrDirty = false; this.storeScalar(this.variables, "FNR", numeric(this.fnrNum)); }
    if (this.nfDirty) {
      if (this.fieldCount < 0) this.ensureSliceFieldsSplit();
      this.nfDirty = false;
      this.storeScalar(this.variables, "NF", numeric(this.nfNum));
    }
  }
  private get(name: string): Value {
    if (this.frames.length === 0 || !this.frames.at(-1)!.has(name)) {
      if (name === "NR" && this.nrDirty) { this.nrDirty = false; this.storeScalar(this.variables, "NR", numeric(this.nrNum)); }
      else if (name === "FNR" && this.fnrDirty) { this.fnrDirty = false; this.storeScalar(this.variables, "FNR", numeric(this.fnrNum)); }
      else if (name === "NF" && this.nfDirty) {
        if (this.fieldCount < 0) this.ensureSliceFieldsSplit();
        this.nfDirty = false;
        this.storeScalar(this.variables, "NF", numeric(this.nfNum));
      }
      else if (name === "ENVIRON" && !this.environInitialized) this.ensureEnviron();
    }
    return this.store(name).get(name) ?? unset;
  }
  private getScalar(name: string): Scalar { return scalar(this.get(name)); }
  private asText(value: Scalar): string {
    if (value.kind === "string" || value.kind === "numeric") return value.text;
    if (value.kind === "unset") return "";
    return text(value, text(this.getScalar("CONVFMT"), undefined, this.budget), this.budget);
  }
  private varText(name: string): string {
    if (this.frames.length === 0) {
      if (name === "FS") return this.fsText;
      if (name === "RS") return this.rsText;
      if (name === "CONVFMT") return this.convfmtText;
    }
    return this.asText(this.getScalar(name));
  }
  private retainName(path: string): string {
    this.context.signal.throwIfAborted();
    return this.retention.replace(0, Buffer.byteLength(path, "utf8"), () => Buffer.from(path, "utf16le").toString("utf16le"));
  }
  private storeScalar(store: Map<string, Value>, name: string, value: Scalar): void {
    if (value.kind === "string" || value.kind === "numeric") this.budget.check(value.text);
    this.retention.admit(textSize(store.get(name)), textSize(value));
    const owned = ownScalar(value);
    store.set(name, owned);
    if (store === this.variables) {
      if (name === "FS") this.fsText = this.asText(owned);
      else if (name === "RS") this.rsText = this.asText(owned);
      else if (name === "CONVFMT") this.convfmtText = this.asText(owned);
      else if (name === "NR") { this.nrNum = number(owned); this.nrDirty = false; }
      else if (name === "FNR") { this.fnrNum = number(owned); this.fnrDirty = false; }
      else if (name === "NF") { this.nfNum = number(owned); this.nfDirty = false; }
    }
  }
  private bindArray(store: Map<string, Value>, name: string, array: AwkArray): void {
    let allocation = this.arrays.get(array);
    if (!allocation) { allocation = { bytes: 0, references: 0 }; this.arrays.set(array, allocation); }
    allocation.references++;
    store.set(name, array);
  }
  private releaseStore(store: Map<string, Value>): void {
    for (const value of store.values()) {
      if (value instanceof AwkArray) {
        const allocation = this.arrays.get(value)!;
        if (--allocation.references === 0) {
          this.retention.release(allocation.bytes);
          this.entries -= value.entries.size;
          this.arrays.delete(value);
        }
      } else this.retention.release(textSize(value));
    }
    store.clear();
  }
  private set(name: string, value: Scalar): void {
    if (this.get(name) instanceof AwkArray) throw new ProgramError(`cannot assign a scalar to array '${name}'`);
    if (name === "NF" && this.store(name) === this.variables) {
      const length = Math.trunc(number(value));
      if (!Number.isSafeInteger(length) || length < 0 || length > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("invalid or excessive NF");
      const fields = this.ensureFields().slice(0, length);
      while (fields.length < length) fields.push(string(""));
      this.rebuild(fields); return;
    }
    this.storeScalar(this.store(name), name, value);
  }
  private setNumber(name: string, n: number): Scalar {
    const store = this.store(name);
    if (name === "NF" && store === this.variables) {
      const val = numeric(n);
      this.set(name, val);
      return val;
    }
    const existing = store.get(name);
    if (existing instanceof AwkArray) throw new ProgramError(`cannot assign a scalar to array '${name}'`);
    if (existing !== undefined && existing.kind === "number" && !Object.isFrozen(existing)) {
      if (this.budget.context.signal.aborted) this.budget.context.signal.throwIfAborted();
      (existing as { number: number }).number = n;
      if (store === this.variables) {
        if (name === "NR") { this.nrNum = n; this.nrDirty = false; }
        else if (name === "FNR") { this.fnrNum = n; this.fnrDirty = false; }
      }
      return existing;
    }
    this.retention.admit(textSize(existing), 0);
    const box: Scalar = { kind: "number", number: n };
    store.set(name, box);
    if (store === this.variables) {
      if (name === "FS") this.fsText = this.asText(box);
      else if (name === "RS") this.rsText = this.asText(box);
      else if (name === "CONVFMT") this.convfmtText = this.asText(box);
      else if (name === "NR") { this.nrNum = n; this.nrDirty = false; }
      else if (name === "FNR") { this.fnrNum = n; this.fnrDirty = false; }
    }
    return box;
  }
  private array(name: string): AwkArray {
    const value = this.get(name);
    if (value instanceof AwkArray) return value;
    if (value.kind !== "unset") throw new ProgramError(`scalar '${name}' used as an array`);
    const array = new AwkArray(); this.bindArray(this.store(name), name, array); return array;
  }
  private arraySet(array: AwkArray, key: string, value: Scalar): void {
    this.budget.check(key);
    if (value.kind === "string" || value.kind === "numeric") this.budget.check(value.text);
    const existingValue = array.entries.get(key);
    if (existingValue !== undefined && existingValue.kind === "number" && value.kind === "number") {
      if (this.budget.context.signal.aborted) this.budget.context.signal.throwIfAborted();
      array.entries.set(key, ownScalar(value));
      return;
    }
    const existing = existingValue !== undefined || array.entries.has(key);
    if (!existing && this.entries >= (this.budget.options.maxArrayEntries ?? Infinity)) throw new ProgramError("array entry limit exceeded");
    const previous = textSize(existingValue), next = textSize(value) + (existing ? 0 : key.length);
    this.retention.admit(previous, next);
    const ownedKey = existing || key.length < 13 ? key : Buffer.from(key, "latin1").toString("latin1");
    array.entries.set(ownedKey, ownScalar(value));
    if (next !== previous) this.arrays.get(array)!.bytes += next - previous;
    if (!existing) this.entries++;
  }
  private pattern(source: string): Pattern {
    const map = this.regexes ??= new Map<string, Pattern>();
    let pattern = map.get(source);
    if (!pattern) {
      pattern = new Pattern(source, true, false, "awk");
      if (map.size >= 256) map.delete(map.keys().next().value!);
      map.set(source, pattern);
    }
    return pattern;
  }
  private async regex(expression: Expression): Promise<Pattern> { return expression.kind === "regex" ? expression.pattern : this.pattern(this.asText(await this.scalarExpression(expression))); }
  private splitSync(value: string, separator: string, paragraph: boolean): Scalar[] | Promise<Scalar[]> {
    if (!paragraph && value.length < 256 && (separator === " " || separator.length === 1)) {
      this.budget.step(value.length);
      const maxFields = this.budget.options.maxFields ?? Infinity;
      const parts: Scalar[] = [];
      if (separator === " ") {
        let start = -1;
        for (let index = 0; index < value.length; index++) {
          const ch = value.charCodeAt(index);
          if (ch === 32 || ch === 9 || ch === 10) {
            if (start >= 0) {
              if (parts.length >= maxFields) throw new ProgramError("field count limit exceeded");
              parts.push(inputValue(value.slice(start, index)));
              start = -1;
            }
          } else if (start < 0) start = index;
        }
        if (start >= 0) {
          if (parts.length >= maxFields) throw new ProgramError("field count limit exceeded");
          parts.push(inputValue(value.slice(start, value.length)));
        }
        return parts;
      }
      if (value !== "") {
        let start = 0;
        let idx: number;
        while ((idx = value.indexOf(separator, start)) >= 0) {
          if (parts.length >= maxFields) throw new ProgramError("field count limit exceeded");
          parts.push(inputValue(value.slice(start, idx)));
          start = idx + 1;
        }
        if (parts.length >= maxFields) throw new ProgramError("field count limit exceeded");
        parts.push(inputValue(value.slice(start, value.length)));
      }
      return parts;
    }
    return this.split(value, separator, paragraph);
  }
  private async split(value: string, separator: string | Pattern, paragraph = false): Promise<Scalar[]> {
    // Admit the byte scan/copy before building fields; regex matching charges its own work.
    this.budget.step(value.length);
    const parts: Scalar[] = [];
    const append = (start: number, end: number): void => {
      if (parts.length >= (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("field count limit exceeded");
      parts.push(inputValue(value.slice(start, end)));
    };
    if (separator === " ") {
      let start = -1;
      for (let index = 0; index < value.length; index++) {
        if (index % 256 === 0) await this.budget.checkpointSync();
        if (" \t\n".includes(value[index]!)) {
          if (start >= 0) { append(start, index); start = -1; }
        } else if (start < 0) start = index;
      }
      if (start >= 0) append(start, value.length);
    } else if (separator === "") {
      if (value.length > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("field count limit exceeded");
      for (let index = 0; index < value.length; index++) {
        if (index % 256 === 0) await this.budget.checkpointSync();
        append(index, index + 1);
      }
    } else if (typeof separator === "string" && separator.length === 1) {
      if (!paragraph && value.length < 256) {
        if (value !== "") {
          let start = 0;
          let idx: number;
          while ((idx = value.indexOf(separator, start)) >= 0) {
            append(start, idx);
            start = idx + 1;
          }
          append(start, value.length);
        }
        return parts;
      }
      let start = 0;
      for (let index = 0; index < value.length; index++) {
        if (index > 0 && index % 256 === 0) {
          const p = this.budget.checkpointSync();
          if (p) await p;
        }
        if (value[index] === separator || paragraph && value[index] === "\n") {
          append(start, index); start = index + 1;
        }
      }
      if (value !== "") append(start, value.length);
    } else {
      const matcher = typeof separator === "string" ? this.pattern(separator) : separator;
      const segment = async (start: number, end: number): Promise<void> => {
        if (paragraph) for (let index = start; index < end; index++) {
          if (index % 256 === 0) await this.budget.checkpointSync();
          if (value[index] === "\n") { append(start, index); start = index + 1; }
        }
        append(start, end);
      };
      let consumed = 0;
      let search = 0;
      while (search <= value.length) {
        await this.budget.checkpointSync();
        const match = await matcher.find(value, this.budget, search);
        if (!match) break;
        if (match.start === match.end) { search = match.end + 1; continue; }
        await segment(consumed, match.start); consumed = match.end; search = match.end;
      }
      if (value !== "") await segment(consumed, value.length);
    }
    return parts;
  }
  private parseSliceNumber(record: string, start: number, end: number): number {
    const len = end - start;
    if (len <= 0) return 0;
    const first = record.charCodeAt(start);
    if (first >= 48 && first <= 57 && len <= 15) {
      let num = first - 48;
      for (let i = start + 1; i < end; i++) {
        const c = record.charCodeAt(i);
        if (c < 48 || c > 57) {
          return number(inputValueFromSlice(record, start, end));
        }
        num = num * 10 + (c - 48);
      }
      return num;
    }
    return number(inputValueFromSlice(record, start, end));
  }
  private getFieldNumber(index: number): number {
    if (index === 0) return number(this.getField(0));
    const slot = index - 1;
    if (this.fieldsMaterialized) {
      const f = this.rawFields[slot];
      return f ? number(f) : 0;
    }
    if (this.fieldCount < 0) {
      const sep = this.deferredFieldSeparator;
      if (sep.length === 1 && sep !== " ") {
        const source = this.recordSource;
        const recEnd = this.recordEnd;
        let start = this.recordStart;
        if (start >= recEnd) return 0;
        for (let s = 0; s < slot; s++) {
          const idx = source.indexOf(sep, start);
          if (idx < 0 || idx >= recEnd) return 0;
          start = idx + 1;
        }
        const nextIdx = source.indexOf(sep, start);
        const end = nextIdx >= 0 && nextIdx < recEnd ? nextIdx : recEnd;
        return this.parseSliceNumber(source, start, end);
      }
      this.ensureSliceFieldsSplit();
    }
    if (slot < 0 || slot >= this.fieldCount) return 0;
    if (this.lazyFieldGen[slot] === this.fieldGeneration) {
      return number(this.lazyFields[slot]!);
    }
    return this.parseSliceNumber(this.recordSource, this.fieldStarts[slot]!, this.fieldEnds[slot]!);
  }
  private getField(index: number): Scalar {
    if (index === 0) {
      return this.recordValue ??= inputValue(this.record);
    }
    if (this.fieldCount < 0) this.ensureSliceFieldsSplit();
    const slot = index - 1;
    if (this.fieldsMaterialized) {
      return this.rawFields[slot] ?? string("");
    }
    if (slot < 0 || slot >= this.fieldCount) return string("");
    if (this.lazyFieldGen[slot] === this.fieldGeneration) {
      return this.lazyFields[slot]!;
    }
    const val = inputValueFromSlice(this.recordSource, this.fieldStarts[slot]!, this.fieldEnds[slot]!);
    this.lazyFieldGen[slot] = this.fieldGeneration;
    this.lazyFields[slot] = val;
    return val;
  }
  private ensureFields(): Scalar[] {
    if (this.fieldCount < 0) this.ensureSliceFieldsSplit();
    if (!this.fieldsMaterialized) {
      const out: Scalar[] = new Array(this.fieldCount);
      for (let i = 0; i < this.fieldCount; i++) {
        out[i] = this.lazyFieldGen[i] === this.fieldGeneration
          ? this.lazyFields[i]!
          : inputValueFromSlice(this.recordSource, this.fieldStarts[i]!, this.fieldEnds[i]!);
      }
      this.rawFields = out;
      this.fieldsMaterialized = true;
    }
    return this.rawFields;
  }
  private ensureSliceFieldsSplit(): void {
    if (this.fieldCount >= 0) return;
    const source = this.recordSource;
    const recStart = this.recordStart;
    const recEnd = this.recordEnd;
    const recLen = recEnd - recStart;
    const separator = this.deferredFieldSeparator;
    let count = 0;
    let fieldBytes = 0;
    const starts = this.fieldStarts;
    const ends = this.fieldEnds;
    if (separator === " ") {
      let start = -1;
      for (let index = recStart; index < recEnd; index++) {
        const ch = source.charCodeAt(index);
        if (ch === 32 || ch === 9 || ch === 10) {
          if (start >= 0) {
            starts[count] = start; ends[count] = index; fieldBytes += index - start; count++;
            start = -1;
          }
        } else if (start < 0) start = index;
      }
      if (start >= 0) {
        starts[count] = start; ends[count] = recEnd; fieldBytes += recEnd - start; count++;
      }
    } else if (recLen > 0) {
      let start = recStart;
      let idx: number;
      while ((idx = source.indexOf(separator, start)) >= 0 && idx < recEnd) {
        starts[count] = start; ends[count] = idx; fieldBytes += idx - start; count++;
        start = idx + 1;
      }
      starts[count] = start; ends[count] = recEnd; fieldBytes += recEnd - start; count++;
    }
    this.retention.admit(0, fieldBytes);
    this.fieldBytes = fieldBytes;
    this.fieldCount = count;
    this.nfNum = count;
  }
  private setRecordSliceSync(source: string, recStart: number, recEnd: number): void | Promise<void> {
    const recLen = recEnd - recStart;
    if (recLen > this.budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
    const separator = this.varText("FS");
    const paragraph = this.varText("RS") === "";
    const maxFields = this.budget.options.maxFields ?? Infinity;
    if (!paragraph && recLen < 256 && (separator === " " || separator.length === 1) && maxFields >= 64) {
      this.budget.step(recLen);
      if (recLen < 64 && this.retention.capacity === Infinity) {
        this.retention.admit(this.recordLength + this.fieldBytes, recLen);
        this.rawRecord = undefined;
        this.recordSource = source;
        this.recordStart = recStart;
        this.recordEnd = recEnd;
        this.fieldBytes = 0;
        this.fieldCount = -1;
        this.deferredFieldSeparator = separator;
        this.fieldsMaterialized = false;
        this.fieldGeneration = (this.fieldGeneration + 1) | 0 || 1;
        this.recordValue = undefined;
        this.nfDirty = true;
        return;
      }
      let count = 0;
      let fieldBytes = 0;
      const starts = this.fieldStarts;
      const ends = this.fieldEnds;
      if (separator === " ") {
        let start = -1;
        for (let index = recStart; index < recEnd; index++) {
          const ch = source.charCodeAt(index);
          if (ch === 32 || ch === 9 || ch === 10) {
            if (start >= 0) {
              if (count >= maxFields || count >= 64) return this.setRecordSlow(source.slice(recStart, recEnd), separator, paragraph);
              starts[count] = start; ends[count] = index; fieldBytes += index - start; count++;
              start = -1;
            }
          } else if (start < 0) start = index;
        }
        if (start >= 0) {
          if (count >= maxFields || count >= 64) return this.setRecordSlow(source.slice(recStart, recEnd), separator, paragraph);
          starts[count] = start; ends[count] = recEnd; fieldBytes += recEnd - start; count++;
        }
      } else if (recLen > 0) {
        let start = recStart;
        let idx: number;
        while ((idx = source.indexOf(separator, start)) >= 0 && idx < recEnd) {
          if (count >= maxFields || count >= 64) return this.setRecordSlow(source.slice(recStart, recEnd), separator, paragraph);
          starts[count] = start; ends[count] = idx; fieldBytes += idx - start; count++;
          start = idx + 1;
        }
        if (count >= maxFields || count >= 64) return this.setRecordSlow(source.slice(recStart, recEnd), separator, paragraph);
        starts[count] = start; ends[count] = recEnd; fieldBytes += recEnd - start; count++;
      }
      this.retention.admit(this.recordLength + this.fieldBytes, recLen + fieldBytes);
      this.rawRecord = undefined;
      this.recordSource = source;
      this.recordStart = recStart;
      this.recordEnd = recEnd;
      this.fieldBytes = fieldBytes;
      this.fieldCount = count;
      this.fieldsMaterialized = false;
      this.fieldGeneration = (this.fieldGeneration + 1) | 0 || 1;
      this.recordValue = undefined;
      this.nfNum = count;
      this.nfDirty = true;
      return;
    }
    return this.setRecordSlow(source.slice(recStart, recEnd), separator, paragraph);
  }
  private setRecordSync(record: string, value?: Scalar): void | Promise<void> {
    if (value === undefined) return this.setRecordSliceSync(record, 0, record.length);
    this.budget.check(record);
    const separator = this.varText("FS");
    const paragraph = this.varText("RS") === "";
    const maxFields = this.budget.options.maxFields ?? Infinity;
    if (value === undefined && !paragraph && record.length < 256 && (separator === " " || separator.length === 1) && maxFields >= 64) {
      this.budget.step(record.length);
      let count = 0;
      let fieldBytes = 0;
      const starts = this.fieldStarts;
      const ends = this.fieldEnds;
      if (separator === " ") {
        let start = -1;
        for (let index = 0; index < record.length; index++) {
          const ch = record.charCodeAt(index);
          if (ch === 32 || ch === 9 || ch === 10) {
            if (start >= 0) {
              if (count >= maxFields || count >= 64) return this.setRecordSlow(record, separator, paragraph, value);
              starts[count] = start; ends[count] = index; fieldBytes += index - start; count++;
              start = -1;
            }
          } else if (start < 0) start = index;
        }
        if (start >= 0) {
          if (count >= maxFields || count >= 64) return this.setRecordSlow(record, separator, paragraph, value);
          starts[count] = start; ends[count] = record.length; fieldBytes += record.length - start; count++;
        }
      } else if (record !== "") {
        let start = 0;
        let idx: number;
        while ((idx = record.indexOf(separator, start)) >= 0) {
          if (count >= maxFields || count >= 64) return this.setRecordSlow(record, separator, paragraph, value);
          starts[count] = start; ends[count] = idx; fieldBytes += idx - start; count++;
          start = idx + 1;
        }
        if (count >= maxFields || count >= 64) return this.setRecordSlow(record, separator, paragraph, value);
        starts[count] = start; ends[count] = record.length; fieldBytes += record.length - start; count++;
      }
      this.retention.admit(this.record.length + this.fieldBytes, record.length + fieldBytes);
      this.record = record;
      this.fieldBytes = fieldBytes;
      this.fieldCount = count;
      this.fieldsMaterialized = false;
      this.fieldGeneration = (this.fieldGeneration + 1) | 0 || 1;
      this.recordValue = undefined;
      this.variables.set("NF", numeric(count));
      return;
    }
    return this.setRecordSlow(record, separator, paragraph, value);
  }
  private setRecordSlow(record: string, separator: string, paragraph: boolean, value?: Scalar): void | Promise<void> {
    const resolvedVal = value ?? inputValue(record);
    const fields = this.splitSync(record, separator, paragraph);
    if (!(fields instanceof Promise)) {
      this.replaceRecord(record, fields, resolvedVal);
      return;
    }
    return fields.then(resolved => { this.replaceRecord(record, resolved, resolvedVal); });
  }
  private async setRecord(record: string, value?: Scalar): Promise<void> {
    await this.setRecordSync(record, value);
  }
  private replaceRecord(record: string, fields: Scalar[], value: Scalar = string(record)): void {
    let fieldBytes = 0;
    for (const field of fields) {
      if (field.kind === "string" || field.kind === "numeric") this.budget.check(field.text);
      fieldBytes += textSize(field);
    }
    this.retention.admit(this.recordLength + this.fieldBytes, record.length + fieldBytes);
    this.record = record; this.fields = fields; this.fieldCount = fields.length; this.fieldsMaterialized = true; this.fieldBytes = fieldBytes;
    this.recordValue = value.kind === "string" || value.kind === "numeric" ? { ...value, text: this.record } : value;
    this.nfNum = fields.length;
    this.nfDirty = true;
  }
  private join(parts: readonly string[], separator: string, suffix = ""): string {
    this.budget.step(parts.length + 1);
    let used = 0;
    for (let index = 0; index < parts.length; index++) {
      if (index > 0) {
        if (separator.length > this.budget.maxBufferBytes - used) throw new ProgramError("text buffer limit exceeded");
        used += separator.length;
      }
      if (parts[index]!.length > this.budget.maxBufferBytes - used) throw new ProgramError("text buffer limit exceeded");
      used += parts[index]!.length;
    }
    if (suffix.length > this.budget.maxBufferBytes - used) throw new ProgramError("text buffer limit exceeded");
    used += suffix.length;
    this.budget.step(used);
    return parts.join(separator) + suffix;
  }
  private rebuild(fields: Scalar[]): void {
    const record = this.join(fields.map(value => this.asText(value)), this.varText("OFS"));
    this.replaceRecord(record, fields);
  }
  private key(items: readonly Expression[]): string | Promise<string> {
    if (items.length === 1) {
      const first = this.scalarExpression(items[0]!);
      if (!(first instanceof Promise)) {
        const k = this.asText(first);
        this.budget.step(2);
        if (k.length > this.budget.maxBufferBytes) throw new ProgramError("text buffer limit exceeded");
        this.budget.step(k.length);
        return k;
      }
    }
    return this.keySlow(items);
  }
  private async keySlow(items: readonly Expression[]): Promise<string> {
    const pieces: string[] = [];
    for (const item of items) pieces.push(this.asText(await this.scalarExpression(item)));
    return this.join(pieces, this.varText("SUBSEP"));
  }
  private async reference(expression: Expression): Promise<Reference> {
    if (expression.kind === "variable") return { get: () => this.get(expression.name), set: value => this.set(expression.name, value) };
    if (expression.kind === "field") {
      const index = Math.trunc(number(await this.scalarExpression(expression.index)));
      if (!Number.isSafeInteger(index) || index < 0 || index > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("invalid or excessive field index");
      return {
        get: () => this.getField(index),
        set: value => {
          if (index === 0) return this.setRecord(this.asText(value), value);
          const fields = this.ensureFields().slice();
          while (fields.length < index) fields.push(string(""));
          fields[index - 1] = value; this.rebuild(fields);
        },
      };
    }
    if (expression.kind === "array") {
      const array = this.array(expression.name);
      const key = await this.key(expression.indexes);
      return { get: () => { if (!array.entries.has(key)) this.arraySet(array, key, unset); return array.entries.get(key)!; }, set: value => this.arraySet(array, key, value) };
    }
    throw new ProgramError("expression is not assignable");
  }
  private arithmetic(operator: string, left: number, right: number): number {
    if ((operator === "/" || operator === "%") && right === 0) throw new ProgramError("division by zero");
    const result = operator === "+" ? left + right : operator === "-" ? left - right : operator === "*" ? left * right : operator === "/" ? left / right : operator === "%" ? left % right : left ** right;
    if (!Number.isFinite(result)) throw new ProgramError("non-finite arithmetic result");
    return result;
  }
  private scalarExpression(expression: Expression): Scalar | Promise<Scalar> {
    const val = this.evaluate(expression);
    return val instanceof Promise ? val.then(scalar) : scalar(val);
  }

  private evaluate(expression: Expression): Value | Promise<Value> {
    this.budget.step();
    switch (expression.kind) {
      case "number": return numeric(expression.value);
      case "string": return string(expression.value);
      case "regex": return this.evaluateRegexMatch(expression.pattern);
      case "variable": return this.get(expression.name);
      case "field": {
        if (expression.index.kind === "number") {
          this.budget.step();
          const index = Math.trunc(expression.index.value);
          if (!Number.isSafeInteger(index) || index < 0 || index > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("invalid or excessive field index");
          return this.getField(index);
        }
        const idxVal = this.scalarExpression(expression.index);
        if (!(idxVal instanceof Promise)) {
          const index = Math.trunc(number(idxVal));
          if (!Number.isSafeInteger(index) || index < 0 || index > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("invalid or excessive field index");
          return this.getField(index);
        }
        return this.evaluateFieldAsync(idxVal);
      }
      case "array": {
        const array = this.array(expression.name);
        const k = this.key(expression.indexes);
        if (!(k instanceof Promise)) {
          let existing = array.entries.get(k);
          if (existing === undefined && !array.entries.has(k)) {
            this.arraySet(array, k, unset);
            existing = unset;
          }
          return existing!;
        }
        return this.evaluateArrayAsync(array, k);
      }
      case "getline": return this.getline(expression);
      case "tuple": throw new ProgramError("tuple is only valid as an array membership key");
      case "conditional": {
        const cond = this.scalarExpression(expression.condition);
        return cond instanceof Promise ? this.evaluateConditionalAsync(expression, cond) : this.evaluate(truth(cond) ? expression.yes : expression.no);
      }
      case "unary": {
        if (expression.operator === "++" || expression.operator === "--") {
          if (expression.operand.kind === "variable") {
            const name = expression.operand.name;
            const previous = number(scalar(this.get(name)));
            const next = previous + (expression.operator === "++" ? 1 : -1);
            const updated = this.setNumber(name, next);
            return expression.postfix ? numeric(previous) : updated;
          }
          if (expression.operand.kind === "array") {
            const array = this.array(expression.operand.name);
            const k = this.key(expression.operand.indexes);
            if (!(k instanceof Promise)) {
              let current = array.entries.get(k);
              if (current === undefined && !array.entries.has(k)) {
                this.arraySet(array, k, unset);
                current = unset;
              }
              const previous = number(scalar(current!));
              const next = previous + (expression.operator === "++" ? 1 : -1);
              this.arraySet(array, k, numeric(next));
              return numeric(expression.postfix ? previous : next);
            }
            return this.evaluateUnaryArrayAsync(expression, array, k);
          }
          return this.evaluateUnarySlow(expression);
        }
        const operand = this.scalarExpression(expression.operand);
        if (!(operand instanceof Promise)) {
          return numeric(expression.operator === "!" ? truth(operand) ? 0 : 1 : expression.operator === "-" ? -number(operand) : number(operand));
        }
        return this.evaluateUnaryValueAsync(expression.operator, operand);
      }
      case "binary": {
        const operator = expression.operator;
        if (operator === "=" || operator === "+=" || operator === "-=" || operator === "*=" || operator === "/=" || operator === "%=" || operator === "^=") {
          if (expression.left.kind === "variable") {
            const name = expression.left.name;
            if (operator !== "=" && expression.right.kind === "field" && expression.right.index.kind === "number") {
              this.budget.step(2);
              const idx = Math.trunc(expression.right.index.value);
              if (Number.isSafeInteger(idx) && idx > 0 && idx <= (this.budget.options.maxFields ?? Infinity)) {
                const prevNum = number(scalar(this.get(name)));
                const rightNum = this.getFieldNumber(idx);
                const nextNum = this.arithmetic(operator[0]!, prevNum, rightNum);
                return this.setNumber(name, nextNum);
              }
            }
            const previous = operator === "=" ? unset : scalar(this.get(name));
            const rightVal = this.scalarExpression(expression.right);
            if (!(rightVal instanceof Promise)) {
              if (operator !== "=") {
                return this.setNumber(name, this.arithmetic(operator[0]!, number(previous), number(rightVal)));
              }
              this.set(name, rightVal);
              return rightVal;
            }
            return this.evaluateAssignVarAsync(operator, name, previous, rightVal);
          } else if (expression.left.kind === "array") {
            const array = this.array(expression.left.name);
            const k = this.key(expression.left.indexes);
            if (!(k instanceof Promise)) {
              let current = operator === "=" ? unset : array.entries.get(k);
              if (operator !== "=" && current === undefined && !array.entries.has(k)) {
                this.arraySet(array, k, unset);
                current = unset;
              }
              const previous = scalar(current!);
              const rightVal = this.scalarExpression(expression.right);
              if (!(rightVal instanceof Promise)) {
                const value = operator === "=" ? rightVal : numeric(this.arithmetic(operator[0]!, number(previous), number(rightVal)));
                this.arraySet(array, k, value);
                return value;
              }
              return this.evaluateAssignArrayRightAsync(operator, array, k, previous, rightVal);
            }
            return this.evaluateAssignArrayKeyAsync(expression, operator, array, k);
          }
          return this.evaluateBinarySlow(expression);
        }
        if (operator === "~" || operator === "!~") {
          if (expression.right.kind === "regex") {
            const left = this.scalarExpression(expression.left);
            if (!(left instanceof Promise)) {
              const matched = expression.right.pattern.tryTestSync(this.asText(left), this.budget);
              if (!(matched instanceof Promise)) {
                return numeric((operator === "~" ? matched : !matched) ? 1 : 0);
              }
            }
          }
          return this.evaluateBinarySlow(expression);
        }
        if (operator === "in") {
          return this.evaluateBinarySlow(expression);
        }
        const left = this.scalarExpression(expression.left);
        if (left instanceof Promise) return this.evaluateBinaryWithLeftPromise(expression, left);
        if (operator === "&&" && !truth(left)) return numeric(0);
        if (operator === "||" && truth(left)) return numeric(1);
        const right = this.scalarExpression(expression.right);
        if (right instanceof Promise) return this.evaluateBinaryWithRightPromise(operator, left, right);
        return this.evaluateBinarySyncOperands(operator, left, right);
      }
      case "call": return this.call(expression.name, expression.args);
    }
  }

  private evaluateRegexMatch(pattern: Pattern): Scalar | Promise<Scalar> {
    if (pattern.canFindSync() && this.recordLength < 256) {
      const count = ++this.recordChecks;
      if (count > 2 && (count & 31) !== 0) {
        const fastMatched = this.rawRecord !== undefined
          ? pattern.findSyncFastInto(this.rawRecord, this.budget, 0, FAST_AWK_MATCH_OFFSETS, this.rawRecord.length, 0)
          : pattern.findSyncFastInto(this.recordSource, this.budget, this.recordStart, FAST_AWK_MATCH_OFFSETS, this.recordEnd, this.recordStart);
        return numeric(fastMatched ? 1 : 0);
      }
    }
    const matched = this.rawRecord !== undefined
      ? pattern.tryTestSync(this.rawRecord, this.budget, 0, this.rawRecord.length)
      : pattern.tryTestSync(this.recordSource, this.budget, this.recordStart, this.recordEnd);
    if (matched instanceof Promise) return matched.then(m => numeric(m ? 1 : 0));
    return numeric(matched ? 1 : 0);
  }

  private async evaluateFieldAsync(idxPromise: Promise<Scalar>): Promise<Scalar> {
    const resolved = await idxPromise;
    const index = Math.trunc(number(resolved));
    if (!Number.isSafeInteger(index) || index < 0 || index > (this.budget.options.maxFields ?? Infinity)) throw new ProgramError("invalid or excessive field index");
    return this.getField(index);
  }

  private async evaluateArrayAsync(array: AwkArray, keyPromise: Promise<string>): Promise<Scalar> {
    const resolvedKey = await keyPromise;
    let existing = array.entries.get(resolvedKey);
    if (existing === undefined && !array.entries.has(resolvedKey)) {
      this.arraySet(array, resolvedKey, unset);
      existing = unset;
    }
    return existing!;
  }

  private async evaluateConditionalAsync(expression: Extract<Expression, { kind: "conditional" }>, condPromise: Promise<Scalar>): Promise<Value> {
    const c = await condPromise;
    return this.evaluate(truth(c) ? expression.yes : expression.no);
  }

  private async evaluateUnaryArrayAsync(expression: Extract<Expression, { kind: "unary" }>, array: AwkArray, keyPromise: Promise<string>): Promise<Scalar> {
    const resolvedKey = await keyPromise;
    let current = array.entries.get(resolvedKey);
    if (current === undefined && !array.entries.has(resolvedKey)) {
      this.arraySet(array, resolvedKey, unset);
      current = unset;
    }
    const previous = number(scalar(current!));
    const next = previous + (expression.operator === "++" ? 1 : -1);
    this.arraySet(array, resolvedKey, numeric(next));
    return numeric(expression.postfix ? previous : next);
  }

  private async evaluateUnaryValueAsync(operator: string, operandPromise: Promise<Scalar>): Promise<Scalar> {
    const op = await operandPromise;
    return numeric(operator === "!" ? truth(op) ? 0 : 1 : operator === "-" ? -number(op) : number(op));
  }

  private async evaluateAssignVarAsync(operator: string, name: string, previous: Scalar, rightPromise: Promise<Scalar>): Promise<Scalar> {
    const resolved = await rightPromise;
    const value = operator === "=" ? resolved : numeric(this.arithmetic(operator[0]!, number(previous), number(resolved)));
    this.set(name, value);
    return value;
  }

  private async evaluateAssignArrayRightAsync(operator: string, array: AwkArray, k: string, previous: Scalar, rightPromise: Promise<Scalar>): Promise<Scalar> {
    const resolved = await rightPromise;
    const value = operator === "=" ? resolved : numeric(this.arithmetic(operator[0]!, number(previous), number(resolved)));
    this.arraySet(array, k, value);
    return value;
  }

  private async evaluateAssignArrayKeyAsync(expression: Extract<Expression, { kind: "binary" }>, operator: string, array: AwkArray, keyPromise: Promise<string>): Promise<Scalar> {
    const resolvedKey = await keyPromise;
    let current = operator === "=" ? unset : array.entries.get(resolvedKey);
    if (operator !== "=" && current === undefined && !array.entries.has(resolvedKey)) {
      this.arraySet(array, resolvedKey, unset);
      current = unset;
    }
    const previous = scalar(current!);
    const resolved = await this.scalarExpression(expression.right);
    const value = operator === "=" ? resolved : numeric(this.arithmetic(operator[0]!, number(previous), number(resolved)));
    this.arraySet(array, resolvedKey, value);
    return value;
  }

  private async evaluateBinaryWithRightPromise(operator: string, left: Scalar, rightPromise: Promise<Scalar>): Promise<Scalar> {
    const r = await rightPromise;
    return this.evaluateBinarySyncOperands(operator, left, r);
  }

  private evaluateBinarySyncOperands(operator: string, left: Scalar, right: Scalar): Scalar {
    if (operator === "&&" || operator === "||") return numeric(truth(right) ? 1 : 0);
    if (operator === "concat") {
      const leftText = this.asText(left);
      const rightText = this.asText(right);
      this.budget.step(0);
      if (rightText.length > this.budget.maxBufferBytes - leftText.length) throw new ProgramError("text buffer limit exceeded");
      this.budget.step(leftText.length + rightText.length);
      return string(leftText + rightText);
    }
    if (operator === "==" || operator === "!=" || operator === "<" || operator === "<=" || operator === ">" || operator === ">=") {
      let order: number;
      if (left.kind !== "string" && right.kind !== "string") {
        const first = number(left);
        const second = number(right);
        order = first < second ? -1 : first > second ? 1 : 0;
      } else {
        order = compare(left, right, this.varText("CONVFMT"), this.budget);
      }
      return numeric((operator === "==" ? order === 0 : operator === "!=" ? order !== 0 : operator === "<" ? order < 0 : operator === "<=" ? order <= 0 : operator === ">" ? order > 0 : order >= 0) ? 1 : 0);
    }
    return numeric(this.arithmetic(operator, number(left), number(right)));
  }

  private async evaluateBinaryWithLeftPromise(expression: Extract<Expression, { kind: "binary" }>, leftPromise: Promise<Scalar>): Promise<Scalar> {
    const operator = expression.operator;
    const left = await leftPromise;
    if (operator === "&&" && !truth(left)) return numeric(0);
    if (operator === "||" && truth(left)) return numeric(1);
    const right = await this.scalarExpression(expression.right);
    return this.evaluateBinarySyncOperands(operator, left, right);
  }

  private async evaluateUnarySlow(expression: Extract<Expression, { kind: "unary" }>): Promise<Scalar> {
    if (expression.operator === "++" || expression.operator === "--") {
          const reference = await this.reference(expression.operand);
          const previous = number(scalar(reference.get()));
          const next = previous + (expression.operator === "++" ? 1 : -1);
          await reference.set(numeric(next)); return numeric(expression.postfix ? previous : next);
        }
        const operand = await this.scalarExpression(expression.operand);
        return numeric(expression.operator === "!" ? truth(operand) ? 0 : 1 : expression.operator === "-" ? -number(operand) : number(operand));
  }

  private async evaluateBinarySlow(expression: Extract<Expression, { kind: "binary" }>): Promise<Scalar> {
        const operator = expression.operator;
        if (["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(operator)) {
          const reference = await this.reference(expression.left);
          const previous = operator === "=" ? unset : scalar(reference.get());
          let value = await this.scalarExpression(expression.right);
          if (operator !== "=") value = numeric(this.arithmetic(operator[0]!, number(previous), number(value)));
          await reference.set(value); return value;
        }
        if (operator === "in") {
          const array = this.array((expression.right as Extract<Expression, { kind: "variable" }>).name);
          const key = expression.left.kind === "tuple" ? await this.key(expression.left.items) : this.asText(await this.scalarExpression(expression.left));
          return numeric(array.entries.has(key) ? 1 : 0);
        }
        const left = await this.scalarExpression(expression.left);
        if (operator === "~" || operator === "!~") {
          const matched = (await (await this.regex(expression.right)).find(this.asText(left), this.budget)) !== undefined;
          return numeric((operator === "~" ? matched : !matched) ? 1 : 0);
        }
        const right = await this.scalarExpression(expression.right);
        return this.evaluateBinarySyncOperands(operator, left, right);
  }

  private async getline(expression: Extract<Expression, { kind: "getline" }>): Promise<Scalar> {
    if (!expression.file) {
      const record = await this.readMainRecord();
      if (record === undefined) return numeric(0);
      const target = expression.target ? await this.reference(expression.target) : undefined;
      if (target) await target.set(inputValue(record));
      else await this.setRecord(record);
      return numeric(1);
    }
    const target = expression.target ? await this.reference(expression.target) : undefined;
    const file = Buffer.from(this.asText(await this.scalarExpression(expression.file)), "latin1").toString("utf8");
    if (!file) throw new ProgramError("getline requires a nonempty filename");
    let path: string;
    try { path = virtualPath(this.context, file); }
    catch (error) {
      if (!(error instanceof FsError)) throw error;
      this.set("ERRNO", string(byteString(error.message)));
      return numeric(-1);
    }
    const inputs = this.inputs ??= new Map<string, Reader>();
    let reader = inputs.get(path);
    if (!reader) {
      if (inputs.size >= (this.budget.options.maxGetlineFiles ?? Infinity)) throw new ProgramError("getline open-file limit exceeded");
      const { context, budget } = this;
      const name = this.retainName(path);
      const useStdin = file === "-" || file === "/dev/stdin";
      const source = (async function* () {
        if (useStdin) yield* context.stdin;
        else {
          budget.step();
          await budget.checkpointSync();
          const capabilities = await context.fs.capabilitiesFor?.(name, { signal: context.signal }) ?? context.fs.capabilities;
          context.signal.throwIfAborted();
          if (context.fs.readStream && capabilities.streamingRead !== false) yield* context.fs.readStream(name, { signal: context.signal });
          else yield await context.fs.readFile(name, { signal: context.signal, ...(Number.isFinite(budget.maxBufferBytes) ? { maxBytes: budget.maxBufferBytes } : {}) });
        }
      })();
      try {
        reader = new Reader(source, budget, this.retention);
        inputs.set(name, reader);
      } catch (error) { this.retention.release(Buffer.byteLength(name, "utf8")); throw error; }
    }
    let record: string | undefined;
    try { record = await reader.read(this.varText("RS")); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if (!(error instanceof FsError)) throw error;
      inputs.delete(path);
      this.retention.release(Buffer.byteLength(path, "utf8"));
      await reader.close();
      this.set("ERRNO", string(byteString(error.message)));
      return numeric(-1);
    }
    if (record === undefined) return numeric(0);
    if (target) await target.set(inputValue(record));
    else await this.setRecord(record);
    return numeric(1);
  }

  private async call(name: string, args: readonly Expression[]): Promise<Value> {
    const definition = this.program.functions.get(name);
    if (definition) {
      if (this.frames.length >= (this.budget.options.maxRecursionDepth ?? Infinity)) throw new ProgramError("function recursion limit exceeded");
      const frame = new Map<string, Value>();
      try {
        for (let index = 0; index < definition.parameters.length; index++) {
          const parameter = definition.parameters[index]!;
          const argument = args[index];
          if (definition.arrays.has(parameter)) {
            if (argument !== undefined && argument.kind !== "variable") throw new ProgramError("array parameter requires an array variable");
            this.bindArray(frame, parameter, argument ? this.array(argument.name) : new AwkArray());
          } else {
            const value = argument ? await this.evaluate(argument) : unset;
            if (value instanceof AwkArray) this.bindArray(frame, parameter, value);
            else this.storeScalar(frame, parameter, value);
          }
        }
      } catch (error) { this.releaseStore(frame); throw error; }
      this.frames.push(frame);
      try { await this.execute(definition.body); return unset; }
      catch (error) { if (error instanceof Flow && error.kind === "return") return error.value; throw error; }
      finally { this.frames.pop(); this.releaseStore(frame); }
    }
    if (name === "length") {
      const value = args[0] ? await this.evaluate(args[0]) : string(this.record);
      return numeric(value instanceof AwkArray ? value.entries.size : this.asText(value).length);
    }
    if (name === "sub" || name === "gsub") {
      const pattern = await this.regex(args[0]!);
      const replacement = this.asText(await this.scalarExpression(args[1]!));
      const target = await this.reference(args[2] ?? { kind: "field", index: { kind: "number", value: 0 } });
      const result = await substitute(this.asText(scalar(target.get())), pattern, replacement, this.budget, name === "gsub", 1, "awk");
      if (result.count) await target.set(string(result.text));
      return numeric(result.count);
    }
    if (name === "split") {
      const value = this.asText(await this.scalarExpression(args[0]!));
      const target = this.array((args[1] as Extract<Expression, { kind: "variable" }>).name);
      const separator = args[2]?.kind === "regex" ? args[2].pattern : args[2] ? this.asText(await this.scalarExpression(args[2])) : this.varText("FS");
      const parts = await this.split(value, separator);
      if (this.entries - target.entries.size + parts.length > (this.budget.options.maxArrayEntries ?? Infinity)) throw new ProgramError("array entry limit exceeded");
      let size = 0;
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index]!;
        if (part.kind === "string" || part.kind === "numeric") this.budget.check(part.text);
        const key = String(index + 1); this.budget.check(key);
        size += key.length + textSize(part);
      }
      const allocation = this.arrays.get(target)!;
      const entries = this.retention.replace(allocation.bytes, size, () => parts.map((part, index) => [String(index + 1), ownScalar(part)] as const));
      this.entries += entries.length - target.entries.size;
      target.entries.clear();
      for (const [key, part] of entries) target.entries.set(key, part);
      allocation.bytes = size;
      return numeric(parts.length);
    }
    if (name === "match") {
      const value = this.asText(await this.scalarExpression(args[0]!));
      const matched = await (await this.regex(args[1]!)).find(value, this.budget);
      this.set("RSTART", numeric(matched ? matched.start + 1 : 0));
      this.set("RLENGTH", numeric(matched ? matched.end - matched.start : -1));
      return this.get("RSTART");
    }
    const values: Scalar[] = [];
    for (const argument of args) values.push(await this.scalarExpression(argument));
    const first = values[0] ?? unset;
    if (name === "srand") {
      const previous = this.randomSeed;
      this.randomSeed = values.length ? Math.trunc(number(first)) : Math.floor(Date.now() / 1000);
      this.randomState = this.randomSeed >>> 0;
      return numeric(previous);
    }
    if (name === "rand") {
      // A full-period 32-bit generator; keep state local to this invocation.
      this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
      return numeric(this.randomState / 0x100000000);
    }
    if (this.ordchr && name === "ord") return numeric(this.asText(first).charCodeAt(0) || 0);
    if (this.ordchr && name === "chr") {
      const value = number(first);
      if (!Number.isFinite(value)) throw new ProgramError("invalid numeric argument in 'chr'");
      return string(String.fromCharCode(Math.trunc(value) & 255));
    }
    if (name === "sprintf") return string(this.budget.check(formatted(this.asText(first), values.slice(1), value => this.asText(value), this.budget)));
    if (name === "substr") {
      const start = Math.max(0, Math.trunc(number(values[1]!)) - 1);
      const length = values[2] === undefined ? undefined : Math.max(0, Math.trunc(number(values[2])));
      return string(this.asText(first).slice(start, length === undefined ? undefined : start + length));
    }
    if (name === "index") return numeric(this.asText(first).indexOf(this.asText(values[1]!)) + 1);
    if (name === "tolower") return string(this.asText(first).replace(/[A-Z]/gu, character => character.toLowerCase()));
    if (name === "toupper") return string(this.asText(first).replace(/[a-z]/gu, character => character.toUpperCase()));
    if (name === "close") {
      const path = virtualPath(this.context, Buffer.from(this.asText(first), "latin1").toString("utf8"));
      const reader = this.inputs?.get(path);
      this.inputs?.delete(path);
      if (reader) this.retention.release(Buffer.byteLength(path, "utf8"));
      await reader?.close();
      const output = this.outputs?.delete(path) ?? false;
      if (output) this.retention.release(Buffer.byteLength(path, "utf8"));
      return numeric(output || reader !== undefined ? 0 : -1);
    }
    const amount = number(first);
    const result = name === "int" ? Math.trunc(amount) : name === "sqrt" ? Math.sqrt(amount) : name === "exp" ? Math.exp(amount) : name === "log" ? Math.log(amount) : name === "sin" ? Math.sin(amount) : name === "cos" ? Math.cos(amount) : name === "atan2" ? Math.atan2(amount, number(values[1]!)) : NaN;
    if (!Number.isFinite(result)) throw new ProgramError(`invalid mathematical result in '${name}'`);
    return numeric(result);
  }

  private recordChecks = 0;
  private stdoutBuffer = "";

  private flushStdout(): void | Promise<void> {
    if (this.stdoutBuffer.length === 0) return undefined;
    const chunk = this.stdoutBuffer;
    this.stdoutBuffer = "";
    return write(this.context, chunk);
  }

  private executeSync(statement: Statement): void | Promise<void> {
    if (!this.inspection) {
      const count = ++this.recordChecks;
      const p = (count <= 2 || (count & 31) === 0)
        ? this.budget.checkpointSync()
        : undefined;
      if (!p) {
        return this.executeSyncBody(statement);
      } else return this.executeAfterCheckpoint(p, statement);
    }
    return this.execute(statement);
  }

  private tryFastExpressionStatement(expr: Expression): boolean {
    if (this.frames.length !== 0) return false;
    if (expr.kind === "unary" && (expr.operator === "++" || expr.operator === "--") && expr.operand.kind === "variable") {
      const name = expr.operand.name;
      if (name !== "NF" && name !== "NR" && name !== "FNR" && name !== "FS" && name !== "RS" && name !== "CONVFMT") {
        this.budget.step();
        const existing = this.variables.get(name);
        if (existing === undefined || !(existing instanceof AwkArray)) {
          const next = (existing !== undefined ? number(existing) : 0) + (expr.operator === "++" ? 1 : -1);
          if (existing !== undefined && existing.kind === "number" && !Object.isFrozen(existing)) {
            (existing as { number: number }).number = next;
            return true;
          }
          const prevBytes = textSize(existing);
          if (prevBytes > 0) this.retention.admit(prevBytes, 0);
          this.variables.set(name, { kind: "number", number: next });
          return true;
        }
      }
      return false;
    }
    if (
      expr.kind === "binary" &&
      (expr.operator === "+=" || expr.operator === "-=" || expr.operator === "*=" || expr.operator === "/=") &&
      expr.left.kind === "variable"
    ) {
      const name = expr.left.name;
      if (name !== "NF" && name !== "NR" && name !== "FNR" && name !== "FS" && name !== "RS" && name !== "CONVFMT") {
        const right = expr.right;
        let rightNum: number | undefined;
        if (right.kind === "field" && right.index.kind === "number") {
          this.budget.step(3);
          const idx = Math.trunc(right.index.value);
          if (idx > 0 && idx <= (this.budget.options.maxFields ?? Infinity)) {
            rightNum = this.getFieldNumber(idx);
          }
        } else if (right.kind === "number") {
          this.budget.step(2);
          rightNum = right.value;
        }
        if (rightNum !== undefined) {
          const existing = this.variables.get(name);
          if (existing === undefined || !(existing instanceof AwkArray)) {
            const prevNum = existing !== undefined ? number(existing) : 0;
            const next = this.arithmetic(expr.operator[0]!, prevNum, rightNum);
            if (existing !== undefined && existing.kind === "number" && !Object.isFrozen(existing)) {
              (existing as { number: number }).number = next;
              return true;
            }
            const prevBytes = textSize(existing);
            if (prevBytes > 0) this.retention.admit(prevBytes, 0);
            this.variables.set(name, { kind: "number", number: next });
            return true;
          }
        }
      }
    }
    return false;
  }

  private executeSyncBody(statement: Statement): void | Promise<void> {
    if (statement.kind === "expression") {
      this.budget.step();
      if (!this.inspection && this.tryFastExpressionStatement(statement.expression)) return undefined;
      const val = this.evaluate(statement.expression);
      return val instanceof Promise ? this.ignorePromiseValue(val) : undefined;
    }
    if (statement.kind === "block") {
      this.budget.step();
      for (let i = 0; i < statement.body.length; i++) {
        const child = statement.body[i]!;
        let res: void | Promise<void>;
        if (child.kind === "expression" && !this.inspection) {
          this.budget.step();
          if (this.tryFastExpressionStatement(child.expression)) continue;
          const val = this.evaluate(child.expression);
          res = val instanceof Promise ? this.ignorePromiseValue(val) : undefined;
        } else {
          res = this.executeSync(child);
        }
        if (res instanceof Promise) {
          return this.executeBlockRemainder(statement.body, i + 1, res);
        }
      }
      return undefined;
    }
    if (statement.kind === "if") {
      this.budget.step();
      const cond = this.scalarExpression(statement.condition);
      if (!(cond instanceof Promise)) {
        const branch = truth(cond) ? statement.yes : statement.no;
        return branch ? this.executeSync(branch) : undefined;
      }
      return this.executeIfAsync(statement, cond);
    }
    if (statement.kind === "print" && !statement.redirect && !statement.formatted) {
      this.budget.step();
      const args = statement.args;
      const ofs = args.length ? this.varText("OFS") : "";
      const ors = this.varText("ORS");
      if (args.length === 0) {
        const output = this.budget.check(this.record + ors);
        this.stdoutBuffer += output;
        if (this.stdoutBuffer.length >= 16384) return this.flushStdout();
        return undefined;
      }
      const ofmt = this.varText("OFMT");
      let acc = "";
      for (let i = 0; i < args.length; i++) {
        const v = this.scalarExpression(args[i]!);
        if (v instanceof Promise) return this.executePrintRemainder(args, i, v, acc, ofs, ors, ofmt);
        const t = text(v, ofmt, this.budget);
        acc = i === 0 ? t : acc + ofs + t;
      }
      const output = this.budget.check(acc + ors);
      this.stdoutBuffer += output;
      if (this.stdoutBuffer.length >= 16384) return this.flushStdout();
      return undefined;
    }
    return this.execute(statement);
  }

  private async executePrintRemainder(args: readonly Expression[], index: number, pending: Promise<Scalar>, acc: string, ofs: string, ors: string, ofmt: string): Promise<void> {
    const first = text(await pending, ofmt, this.budget);
    acc = index === 0 ? first : acc + ofs + first;
    for (let i = index + 1; i < args.length; i++) {
      acc += ofs + text(await this.scalarExpression(args[i]!), ofmt, this.budget);
    }
    this.stdoutBuffer += this.budget.check(acc + ors);
    if (this.stdoutBuffer.length >= 16384) await this.flushStdout();
  }

  private async ignorePromiseValue(promise: Promise<unknown>): Promise<void> {
    await promise;
  }

  private async executeIfAsync(statement: Extract<Statement, { kind: "if" }>, condPromise: Promise<Scalar>): Promise<void> {
    const resolved = await condPromise;
    const branch = truth(resolved) ? statement.yes : statement.no;
    if (branch) {
      const res = this.executeSync(branch);
      if (res instanceof Promise) await res;
    }
  }

  private async executeAfterCheckpoint(checkpoint: Promise<void>, statement: Statement): Promise<void> {
    await checkpoint;
    const res = this.executeSyncBody(statement);
    if (res instanceof Promise) await res;
  }

  private async executeBlockRemainder(body: readonly Statement[], startIndex: number, current: Promise<void>): Promise<void> {
    await current;
    for (let i = startIndex; i < body.length; i++) {
      const res = this.executeSync(body[i]!);
      if (res instanceof Promise) await res;
    }
  }

  private async execute(statement: Statement): Promise<void> {
    this.budget.step();
    if (this.inspection) await this.inspection.observe(statement, this.phase);
    const p = this.budget.checkpointSync();
    if (p) await p;
    switch (statement.kind) {
      case "block": for (const child of statement.body) await this.execute(child); return;
      case "expression": await this.evaluate(statement.expression); return;
      case "print": {
        const values: Scalar[] = [];
        for (const argument of statement.args) values.push(await this.scalarExpression(argument));
        const output = statement.formatted
          ? this.budget.check(formatted(this.asText(values[0]!), values.slice(1), value => this.asText(value), this.budget))
          : this.join(values.length ? values.map(value => text(value, this.varText("OFMT"), this.budget)) : [this.record], values.length ? this.varText("OFS") : "", this.varText("ORS"));
        if (!statement.redirect) {
          this.stdoutBuffer += output;
          if (this.stdoutBuffer.length >= 16384) await this.flushStdout();
          return;
        }
        const destination = Buffer.from(this.asText(await this.scalarExpression(statement.redirect.destination)), "latin1").toString("utf8");
        if (destination === "/dev/stdout") {
          this.stdoutBuffer += output;
          if (this.stdoutBuffer.length >= 16384) await this.flushStdout();
          return;
        }
        if (this.stdoutBuffer.length > 0) await this.flushStdout();
        if (destination === "/dev/stderr") { this.context.signal.throwIfAborted(); await writeBytes(this.context.stderr, bytes(output), this.context.signal); return; }
        const path = virtualPath(this.context, destination);
        const outputs = this.outputs ??= new Set<string>();
        if (outputs.has(path)) await writeFileOutput(this.context, bytes(output), chunk => this.context.fs.appendFile(path, chunk, { signal: this.context.signal }));
        else {
          const name = this.retainName(path);
          try {
            const flag = statement.redirect.append ? "a" : "w";
            await writeFileOutput(this.context, bytes(output), chunk => this.context.fs.writeFile(name, chunk, { flag, signal: this.context.signal }));
            this.context.signal.throwIfAborted();
            outputs.add(name);
          } catch (error) { this.retention.release(Buffer.byteLength(name, "utf8")); throw error; }
        }
        return;
      }
      case "if": {
        const branch = truth(await this.scalarExpression(statement.condition)) ? statement.yes : statement.no;
        if (branch) await this.execute(branch); return;
      }
      case "flow": {
        if ((statement.flow === "next" || statement.flow === "nextfile") && this.phase !== "record") throw new ProgramError(`${statement.flow} is only valid while processing records`);
        throw new Flow(statement.flow, statement.value ? await this.scalarExpression(statement.value) : unset);
      }
      case "delete": {
        const array = this.array(statement.target.name);
        const allocation = this.arrays.get(array)!;
        if (statement.target.kind === "variable") {
          this.retention.release(allocation.bytes); allocation.bytes = 0;
          this.entries -= array.entries.size; array.entries.clear();
        } else {
          const key = await this.key(statement.target.indexes);
          const value = array.entries.get(key);
          if (array.entries.delete(key)) {
            const size = key.length + textSize(value);
            this.retention.release(size); allocation.bytes -= size; this.entries--;
          }
        }
        return;
      }
      case "foreach": {
        const array = this.array(statement.array);
        for (const key of [...array.entries.keys()]) {
          this.budget.step(); if (!array.entries.has(key)) continue;
          this.set(statement.variable, string(key));
          try {
            const res = this.executeSync(statement.body);
            if (res instanceof Promise) await res;
          }
          catch (error) { if (error instanceof Flow && error.kind === "break") break; if (!(error instanceof Flow && error.kind === "continue")) throw error; }
        }
        return;
      }
      case "while": case "do": case "for": {
        if (statement.kind === "for" && statement.initial) {
          const initial = this.evaluate(statement.initial);
          if (initial instanceof Promise) await initial;
        }
        let first = true;
        while (true) {
          this.budget.step();
          if (!(statement.kind === "do" && first) && statement.condition) {
            const condition = this.scalarExpression(statement.condition);
            if (!truth(condition instanceof Promise ? await condition : condition)) break;
          }
          first = false;
          try {
            const body = this.executeSync(statement.body);
            if (body instanceof Promise) await body;
          }
          catch (error) { if (error instanceof Flow && error.kind === "break") break; if (!(error instanceof Flow && error.kind === "continue")) throw error; }
          if (statement.kind === "for" && statement.update) {
            const update = this.evaluate(statement.update);
            if (update instanceof Promise) await update;
          }
        }
        return;
      }
    }
  }

  private assignment(assignment: string): void {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/u.exec(assignment);
    if (!match) throw new ProgramError(`invalid assignment '${assignment}'`);
    this.set(match[1]!, inputValue(decodeString(match[2]!)));
  }
  private exit(flow: Flow): void {
    if (flow.value.kind !== "unset") {
      const status = Math.trunc(number(flow.value));
      if (!Number.isFinite(status)) throw new ProgramError("invalid exit status");
      this.status = (status % 256 + 256) % 256;
    }
  }

  async run(): Promise<number> {
    let status = 0, failed = false;
    let failure: unknown;
    try {
      status = await this.runProgram();
      if (this.stdoutBuffer.length > 0) await this.flushStdout();
      this.syncSpecialVars();
      await this.inspection?.publish(this.variables);
    }
    catch (error) { failed = true; failure = error; }
    if (this.stdoutBuffer.length > 0) {
      try { await this.flushStdout(); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
    let cleanup: PromiseSettledResult<void>[] | undefined;
    if (this.mainReader || (this.inputs && this.inputs.size > 0)) {
      const readers = [...this.mainReader ? [this.mainReader] : [], ...this.inputs ? this.inputs.values() : []];
      this.mainReader = undefined;
      if (this.inputs) {
        for (const name of this.inputs.keys()) this.retention.release(Buffer.byteLength(name, "utf8"));
        this.inputs.clear();
      }
      cleanup = await Promise.allSettled(readers.map(async reader => { await reader.close(); }));
    }
    if (this.outputs && this.outputs.size > 0) {
      for (const name of this.outputs) this.retention.release(Buffer.byteLength(name, "utf8"));
      this.outputs.clear();
    }
    this.releaseStore(this.variables);
    this.retention.release(this.recordLength + this.fieldBytes);
    this.record = ""; this.fields = []; this.fieldCount = 0; this.fieldsMaterialized = true; this.fieldBytes = 0;
    this.sliceBox.source = "";
    this.recordValue = unset;
    if (this.pooledBuffers && !sharedFieldBuffers) {
      this.pooledBuffers.fieldStarts = this.fieldStarts;
      this.pooledBuffers.fieldEnds = this.fieldEnds;
      this.pooledBuffers.lazyFieldGen = this.lazyFieldGen;
      this.pooledBuffers.lazyFields = this.lazyFields;
      this.pooledBuffers.fieldGeneration = this.fieldGeneration + 1;
      this.lazyFields.fill(unset, 0, Math.min(64, this.lazyFields.length));
      sharedFieldBuffers = this.pooledBuffers;
      this.pooledBuffers = undefined;
    }
    this.context.signal.throwIfAborted();
    (this as unknown as { context: CommandContext }).context = RELEASED_AWK_CONTEXT;
    (this.budget as unknown as { context: CommandContext; signal: AbortSignal }).context = RELEASED_AWK_CONTEXT;
    (this.budget as unknown as { context: CommandContext; signal: AbortSignal }).signal = RELEASED_AWK_SIGNAL;
    runtimeAnchor.current = this;
    if (failed) throw failure;
    if (cleanup) for (const result of cleanup) if (result.status === "rejected") throw result.reason;
    return status;
  }

  private async readMainRecord(): Promise<string | undefined> {
    const syncRes = this.readMainRecordSync();
    return syncRes instanceof Promise ? await syncRes : syncRes;
  }

  private incrementCounter(name: string): void {
    if (this.frames.length === 0 || !this.frames.at(-1)!.has(name)) {
      const nrVal = name === "NR" && !this.nrDirty ? this.variables.get("NR") : undefined;
      if (nrVal && !("entries" in nrVal) && nrVal.kind === "number") {
        this.nrNum++;
        this.nrDirty = true;
        return;
      }
      if (name === "NR" && this.nrDirty) {
        this.nrNum++;
        return;
      }
      const fnrVal = name === "FNR" && !this.fnrDirty ? this.variables.get("FNR") : undefined;
      if (fnrVal && !("entries" in fnrVal) && fnrVal.kind === "number") {
        this.fnrNum++;
        this.fnrDirty = true;
        return;
      }
      if (name === "FNR" && this.fnrDirty) {
        this.fnrNum++;
        return;
      }
    }
    this.set(name, numeric(number(this.getScalar(name)) + 1));
  }

  private readMainRecordSync(): string | undefined | Promise<string | undefined> {
    if (this.mainReader) {
      this.budget.step();
      const record = this.mainReader.readSync(this.varText("RS"));
      if (typeof record === "string") {
        this.incrementCounter("NR");
        this.incrementCounter("FNR");
        return record;
      }
      if (record instanceof Promise) {
        return this.readMainRecordAfterPromise(record);
      }
      return this.readMainRecordSlowAfterEof();
    }
    return this.readMainRecordSlow();
  }

  private async readMainRecordAfterPromise(recordPromise: Promise<string | undefined>): Promise<string | undefined> {
    const resolved = await recordPromise;
    if (resolved !== undefined) {
      this.incrementCounter("NR");
      this.incrementCounter("FNR");
      return resolved;
    }
    return this.readMainRecordSlowAfterEof();
  }

  private async readMainRecordSlowAfterEof(): Promise<string | undefined> {
    await this.mainReader?.close();
    this.mainReader = undefined;
    return this.readMainRecordSlow();
  }

  private async readMainRecordSlow(): Promise<string | undefined> {
    while (true) {
      this.budget.step();
      if (!this.mainReader) {
        let file: string | undefined;
        while (this.argument < number(this.getScalar("ARGC"))) {
          this.budget.step();
          const argumentOptions = (this.budget as Budget & { readonly options?: { readonly maxArguments?: number } }).options;
          if (this.argument > (argumentOptions?.maxArguments ?? Infinity)) throw new ProgramError("argument count limit exceeded");
          const p = this.budget.checkpointSync();
          if (p) await p;
          const next = this.asText(this.array("ARGV").entries.get(String(this.argument++)) ?? unset);
          if (!next) continue;
          if (this.operandAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(next)) { this.assignment(next); continue; }
          file = next; this.sawFile = true; break;
        }
        if (file === undefined && !this.sawFile && !this.defaultUsed) { file = "-"; this.defaultUsed = true; }
        if (file === undefined) return undefined;
        this.set("FILENAME", string(file)); this.set("FNR", numeric(0));
        this.mainReader = new Reader(input(this.context, Buffer.from(file, "latin1").toString("utf8")), this.budget, this.retention);
      }
      const record = await this.mainReader.read(this.varText("RS"));
      if (record === undefined) { await this.mainReader.close(); this.mainReader = undefined; continue; }
      this.incrementCounter("NR");
      this.incrementCounter("FNR");
      return record;
    }
  }

  private tryOpenNextMainReaderSync(): boolean {
    const argc = number(this.getScalar("ARGC"));
    const argumentOptions = (this.budget as Budget & { readonly options?: { readonly maxArguments?: number } }).options;
    const maxArgs = argumentOptions?.maxArguments ?? Infinity;
    while (this.argument < argc) {
      this.budget.step();
      if (this.argument > maxArgs) throw new ProgramError("argument count limit exceeded");
      if (this.budget.checkpointSync()) return false;
      const next = this.asText(this.array("ARGV").entries.get(String(this.argument++)) ?? unset);
      if (!next) continue;
      if (this.operandAssignments && /^[A-Za-z_][A-Za-z0-9_]*=/u.test(next)) {
        this.assignment(next);
        continue;
      }
      this.sawFile = true;
      this.set("FILENAME", string(next));
      this.set("FNR", numeric(0));
      const utf8File = /^[\x00-\x7f]*$/u.test(next) ? next : Buffer.from(next, "latin1").toString("utf8");
      this.mainReader = new Reader(input(this.context, utf8File), this.budget, this.retention);
      return true;
    }
    if (!this.sawFile && !this.defaultUsed) {
      this.defaultUsed = true;
      this.set("FILENAME", string("-"));
      this.set("FNR", numeric(0));
      this.mainReader = new Reader(input(this.context, "-"), this.budget, this.retention);
      return true;
    }
    return false;
  }

  private async runProgram(): Promise<number> {
    let stopped = false;
    try { for (const statement of this.program.begin) await this.execute(statement); }
    catch (error) { if (error instanceof Flow && error.kind === "exit") { this.exit(error); stopped = true; } else throw error; }
    this.phase = "record";
    let ranges: Set<number> | undefined;
    if (!stopped && (this.program.rules.length || this.program.end.length)) {
      if (!this.mainReader) {
        this.tryOpenNextMainReaderSync();
      }
      while (true) {
      this.budget.step();
      if (this.mainReader && this.mainReader.readSliceSync(this.varText("RS"), this.sliceBox)) {
        this.incrementCounter("NR");
        this.incrementCounter("FNR");
        const setRecPromise = this.setRecordSliceSync(this.sliceBox.source, this.sliceBox.start, this.sliceBox.end);
        if (setRecPromise instanceof Promise) await setRecPromise;
      } else if (this.mainReader && this.mainReader.isEnded && this.argument >= number(this.getScalar("ARGC"))) {
        void this.mainReader.close();
        this.mainReader = undefined;
        break;
      } else {
        const recOrPromise = this.readMainRecordSync();
        const record = recOrPromise instanceof Promise ? await recOrPromise : recOrPromise;
        if (record === undefined) break;
        const setRecPromise = this.setRecordSync(record);
        if (setRecPromise instanceof Promise) await setRecPromise;
      }
      try {
        for (let index = 0; index < this.program.rules.length; index++) {
          const rule = this.program.rules[index]!;
          let selected = !rule.pattern || (ranges !== undefined && ranges.has(index));
          if (!selected) {
            const patVal = this.scalarExpression(rule.pattern!);
            selected = truth(patVal instanceof Promise ? await patVal : patVal);
          }
          if (!selected) continue;
          if (rule.end) {
            const endVal = this.scalarExpression(rule.end);
            if (truth(endVal instanceof Promise ? await endVal : endVal)) ranges?.delete(index);
            else (ranges ??= new Set<number>()).add(index);
          }
          const execRes = this.executeSync(rule.action);
          if (execRes instanceof Promise) await execRes;
        }
      } catch (error) {
        if (!(error instanceof Flow)) throw error;
        if (error.kind === "exit") { this.exit(error); break; }
        if (error.kind === "nextfile") { await this.mainReader?.close(); this.mainReader = undefined; }
        else if (error.kind !== "next") throw error;
      }
      }
    }
    if (this.mainReader && !hasMainGetline(this.program.end) && ![...this.program.functions.values()].some(hasMainGetline)) {
      void this.mainReader.close().catch(() => undefined);
    }
    this.phase = "END";
    try { for (const statement of this.program.end) await this.execute(statement); }
    catch (error) { if (error instanceof Flow && error.kind === "exit") this.exit(error); else throw error; }
    return this.status;
  }
}
