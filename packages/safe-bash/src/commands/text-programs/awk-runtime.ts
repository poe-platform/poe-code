import { FsError, readBytes, type ByteSource, type CommandContext } from "../../contracts/index.js";
import type { AwkProgram, Expression, Statement } from "./awk-syntax.js";
import { decodeString } from "./awk-syntax.js";
import { AwkArray, compare, formatted, inputValue, number, numeric, scalar, string, text, truth, unset, type Scalar, type Value } from "./awk-values.js";
import { Pattern, substitute } from "./regex.js";
import { Budget, ProgramError, byteString, bytes, input, virtualPath, write } from "./shared.js";

class Flow {
  constructor(readonly kind: string, readonly value: Scalar = unset) {}
}

class Reader {
  private readonly iterator: AsyncIterator<Uint8Array>;
  private buffer = "";
  private ended = false;
  constructor(source: ByteSource, private readonly budget: Budget) { this.iterator = source[Symbol.asyncIterator](); }
  private async fill(): Promise<void> {
    this.budget.step();
    const next = await this.iterator.next();
    if (next.done) this.ended = true;
    else {
      if (next.value.byteLength > this.budget.maxBufferBytes - this.buffer.length) throw new ProgramError("text buffer limit exceeded");
      this.buffer = this.budget.check(this.buffer + Buffer.from(next.value).toString("latin1"));
    }
  }
  async read(separator: string): Promise<string | undefined> {
    if (separator.length > 1) throw new ProgramError("RS must be one byte or empty for paragraph records");
    while (true) {
      this.budget.step();
      if (separator === "") {
        this.buffer = this.buffer.replace(/^\n+/u, "");
        const start = this.buffer.indexOf("\n\n");
        if (start >= 0) {
          let end = start + 2;
          while (this.buffer[end] === "\n") end++;
          if (end === this.buffer.length && !this.ended) { await this.fill(); continue; }
          const record = this.buffer.slice(0, start); this.buffer = this.buffer.slice(end); return record;
        }
      } else {
        const end = this.buffer.indexOf(separator);
        if (end >= 0) { const record = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1); return record; }
      }
      if (this.ended) {
        if (!this.buffer) return undefined;
        const record = separator === "" ? this.buffer.replace(/\n+$/u, "") : this.buffer;
        this.buffer = ""; return record;
      }
      await this.fill();
    }
  }
  async close(): Promise<void> { await this.iterator.return?.(); this.buffer = ""; this.ended = true; }
}

interface Reference { get(): Value; set(value: Scalar): void }

export class AwkRuntime {
  private readonly variables = new Map<string, Value>();
  private readonly frames: Map<string, Value>[] = [];
  private readonly regexes = new Map<string, Pattern>();
  private readonly outputs = new Set<string>();
  private readonly inputs = new Map<string, Reader>();
  private fields: Scalar[] = [];
  private record = "";
  private entries = 0;
  private phase = "BEGIN";
  private status = 0;
  constructor(private readonly program: AwkProgram, readonly context: CommandContext, readonly budget: Budget, args: readonly string[], assignments: readonly string[], separator?: string) {
    const defaults: Record<string, Scalar> = { FS: string(" "), RS: string("\n"), OFS: string(" "), ORS: string("\n"), OFMT: string("%.6g"), CONVFMT: string("%.6g"), SUBSEP: string("\x1c"), NR: numeric(0), FNR: numeric(0), NF: numeric(0), FILENAME: string(""), RSTART: numeric(0), RLENGTH: numeric(0), ARGC: numeric(args.length + 1) };
    for (const [name, value] of Object.entries(defaults)) this.variables.set(name, value);
    const environment = new AwkArray();
    for (const [name, value] of Object.entries(context.env)) this.arraySet(environment, byteString(name), inputValue(byteString(value)));
    this.variables.set("ENVIRON", environment);
    const argv = new AwkArray(); this.arraySet(argv, "0", string("awk"));
    args.forEach((argument, index) => this.arraySet(argv, String(index + 1), inputValue(byteString(argument))));
    this.variables.set("ARGV", argv);
    if (separator !== undefined) this.set("FS", string(separator));
    for (const assignment of assignments) this.assignment(assignment);
  }
  private store(name: string): Map<string, Value> { return this.frames.at(-1)?.has(name) ? this.frames.at(-1)! : this.variables; }
  private get(name: string): Value { return this.store(name).get(name) ?? unset; }
  private getScalar(name: string): Scalar { return scalar(this.get(name)); }
  private asText(value: Scalar): string { return text(value, text(this.getScalar("CONVFMT"))); }
  private varText(name: string): string { return this.asText(this.getScalar(name)); }
  private set(name: string, value: Scalar): void {
    if (this.get(name) instanceof AwkArray) throw new ProgramError(`cannot assign a scalar to array '${name}'`);
    if (name === "NF" && this.store(name) === this.variables) {
      const length = Math.trunc(number(value));
      if (!Number.isSafeInteger(length) || length < 0 || length > 100000) throw new ProgramError("invalid or excessive NF");
      this.fields.length = Math.min(this.fields.length, length);
      while (this.fields.length < length) this.fields.push(unset);
      this.rebuild(); return;
    }
    if (value.kind === "string" || value.kind === "numeric") this.budget.check(value.text);
    this.store(name).set(name, value);
  }
  private array(name: string): AwkArray {
    const value = this.get(name);
    if (value instanceof AwkArray) return value;
    if (value.kind !== "unset") throw new ProgramError(`scalar '${name}' used as an array`);
    const array = new AwkArray(); this.store(name).set(name, array); return array;
  }
  private arraySet(array: AwkArray, key: string, value: Scalar): void {
    this.budget.check(key);
    if (!array.entries.has(key) && ++this.entries > 100000) throw new ProgramError("array entry limit exceeded");
    array.entries.set(key, value);
  }
  private pattern(source: string): Pattern {
    let pattern = this.regexes.get(source);
    if (!pattern) {
      pattern = new Pattern(source);
      if (this.regexes.size >= 256) this.regexes.delete(this.regexes.keys().next().value!);
      this.regexes.set(source, pattern);
    }
    return pattern;
  }
  private async regex(expression: Expression): Promise<Pattern> { return expression.kind === "regex" ? expression.pattern : this.pattern(this.asText(await this.scalarExpression(expression))); }
  private split(value: string, separator: string | Pattern, paragraph = false): Scalar[] {
    let parts: string[];
    if (separator === " ") parts = value.split(/[ \t\n\r\v\f]+/u).filter(part => part !== "");
    else if (separator === "") parts = [...value];
    else if (typeof separator === "string" && separator.length === 1) parts = value === "" ? [] : value.split(separator).flatMap(part => paragraph ? part.split("\n") : [part]);
    else {
      const matcher = typeof separator === "string" ? this.pattern(separator) : separator;
      parts = [];
      let consumed = 0;
      let search = 0;
      while (search <= value.length) {
        const match = matcher.find(value, this.budget, search);
        if (!match) break;
        if (match.start === match.end) { search = match.end + 1; continue; }
        parts.push(value.slice(consumed, match.start)); consumed = match.end; search = match.end;
      }
      if (value !== "") parts.push(value.slice(consumed));
      if (paragraph) parts = parts.flatMap(part => part.split("\n"));
    }
    if (parts.length > 100000) throw new ProgramError("field count limit exceeded");
    return parts.map(inputValue);
  }
  private setRecord(record: string): void {
    this.record = this.budget.check(record);
    this.fields = this.split(record, this.varText("FS"), this.varText("RS") === "");
    this.variables.set("NF", numeric(this.fields.length));
  }
  private rebuild(): void {
    this.record = this.budget.check(this.fields.map(value => this.asText(value)).join(this.varText("OFS")));
    this.variables.set("NF", numeric(this.fields.length));
  }
  private async key(items: readonly Expression[]): Promise<string> {
    const pieces: string[] = [];
    for (const item of items) pieces.push(this.asText(await this.scalarExpression(item)));
    return this.budget.check(pieces.join(this.varText("SUBSEP")));
  }
  private async reference(expression: Expression): Promise<Reference> {
    if (expression.kind === "variable") return { get: () => this.get(expression.name), set: value => this.set(expression.name, value) };
    if (expression.kind === "field") {
      const index = Math.trunc(number(await this.scalarExpression(expression.index)));
      if (!Number.isSafeInteger(index) || index < 0 || index > 100000) throw new ProgramError("invalid or excessive field index");
      return {
        get: () => index === 0 ? inputValue(this.record) : this.fields[index - 1] ?? unset,
        set: value => {
          if (index === 0) { this.setRecord(this.asText(value)); return; }
          while (this.fields.length < index) this.fields.push(unset);
          this.fields[index - 1] = value; this.rebuild();
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
  private async scalarExpression(expression: Expression): Promise<Scalar> { return scalar(await this.evaluate(expression)); }

  private async evaluate(expression: Expression): Promise<Value> {
    this.budget.step();
    switch (expression.kind) {
      case "number": return numeric(expression.value);
      case "string": return string(expression.value);
      case "regex": return numeric(expression.pattern.find(this.record, this.budget) ? 1 : 0);
      case "variable": return this.get(expression.name);
      case "field": case "array": return (await this.reference(expression)).get();
      case "getline": return this.getline(expression);
      case "tuple": throw new ProgramError("tuple is only valid as an array membership key");
      case "conditional": return this.evaluate(truth(await this.scalarExpression(expression.condition)) ? expression.yes : expression.no);
      case "unary": {
        if (expression.operator === "++" || expression.operator === "--") {
          const reference = await this.reference(expression.operand);
          const previous = number(scalar(reference.get()));
          const next = previous + (expression.operator === "++" ? 1 : -1);
          reference.set(numeric(next)); return numeric(expression.postfix ? previous : next);
        }
        const operand = await this.scalarExpression(expression.operand);
        return numeric(expression.operator === "!" ? truth(operand) ? 0 : 1 : expression.operator === "-" ? -number(operand) : number(operand));
      }
      case "binary": {
        const operator = expression.operator;
        if (["=", "+=", "-=", "*=", "/=", "%=", "^="].includes(operator)) {
          const reference = await this.reference(expression.left);
          const previous = operator === "=" ? unset : scalar(reference.get());
          let value = await this.scalarExpression(expression.right);
          if (operator !== "=") value = numeric(this.arithmetic(operator[0]!, number(previous), number(value)));
          reference.set(value); return value;
        }
        if (operator === "in") {
          const array = this.array((expression.right as Extract<Expression, { kind: "variable" }>).name);
          const key = expression.left.kind === "tuple" ? await this.key(expression.left.items) : this.asText(await this.scalarExpression(expression.left));
          return numeric(array.entries.has(key) ? 1 : 0);
        }
        const left = await this.scalarExpression(expression.left);
        if (operator === "&&" && !truth(left)) return numeric(0);
        if (operator === "||" && truth(left)) return numeric(1);
        if (operator === "~" || operator === "!~") {
          const matched = (await this.regex(expression.right)).find(this.asText(left), this.budget) !== undefined;
          return numeric((operator === "~" ? matched : !matched) ? 1 : 0);
        }
        const right = await this.scalarExpression(expression.right);
        if (operator === "&&" || operator === "||") return numeric(truth(right) ? 1 : 0);
        if (operator === "concat") return string(this.budget.check(this.asText(left) + this.asText(right)));
        if (["==", "!=", "<", "<=", ">", ">="].includes(operator)) {
          const order = compare(left, right, this.varText("CONVFMT"));
          return numeric((operator === "==" ? order === 0 : operator === "!=" ? order !== 0 : operator === "<" ? order < 0 : operator === "<=" ? order <= 0 : operator === ">" ? order > 0 : order >= 0) ? 1 : 0);
        }
        return numeric(this.arithmetic(operator, number(left), number(right)));
      }
      case "call": return this.call(expression.name, expression.args);
    }
  }

  private async getline(expression: Extract<Expression, { kind: "getline" }>): Promise<Scalar> {
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
    let reader = this.inputs.get(path);
    if (!reader) {
      if (this.inputs.size >= 256) throw new ProgramError("getline open-file limit exceeded");
      const { context, budget } = this;
      const source = (async function* () {
        if (file === "-") yield* context.stdin;
        else if (context.fs.readStream) yield* context.fs.readStream(path, { signal: context.signal });
        else yield await context.fs.readFile(path, { signal: context.signal, maxBytes: budget.maxBufferBytes });
      })();
      reader = new Reader(readBytes(source, context.signal), budget);
      this.inputs.set(path, reader);
    }
    let record: string | undefined;
    try { record = await reader.read(this.varText("RS")); }
    catch (error) {
      this.context.signal.throwIfAborted();
      if (!(error instanceof FsError)) throw error;
      this.inputs.delete(path);
      await reader.close();
      this.set("ERRNO", string(byteString(error.message)));
      return numeric(-1);
    }
    if (record === undefined) return numeric(0);
    if (target) target.set(inputValue(record));
    else this.setRecord(record);
    return numeric(1);
  }

  private async call(name: string, args: readonly Expression[]): Promise<Value> {
    const definition = this.program.functions.get(name);
    if (definition) {
      if (this.frames.length >= 64) throw new ProgramError("function recursion limit exceeded");
      const frame = new Map<string, Value>();
      for (let index = 0; index < definition.parameters.length; index++) {
        const parameter = definition.parameters[index]!;
        const argument = args[index];
        if (definition.arrays.has(parameter)) {
          if (argument !== undefined && argument.kind !== "variable") throw new ProgramError("array parameter requires an array variable");
          frame.set(parameter, argument ? this.array(argument.name) : new AwkArray());
        } else frame.set(parameter, argument ? await this.evaluate(argument) : unset);
      }
      this.frames.push(frame);
      try { await this.execute(definition.body); return unset; }
      catch (error) { if (error instanceof Flow && error.kind === "return") return error.value; throw error; }
      finally { this.frames.pop(); }
    }
    if (name === "length") {
      const value = args[0] ? await this.evaluate(args[0]) : string(this.record);
      return numeric(value instanceof AwkArray ? value.entries.size : this.asText(value).length);
    }
    if (name === "sub" || name === "gsub") {
      const pattern = await this.regex(args[0]!);
      const replacement = this.asText(await this.scalarExpression(args[1]!));
      if (/\\[1-9]/u.test(replacement)) throw new ProgramError("awk replacement backreference escapes are not supported");
      const target = await this.reference(args[2] ?? { kind: "field", index: { kind: "number", value: 0 } });
      const result = substitute(this.asText(scalar(target.get())), pattern, replacement, this.budget, name === "gsub");
      if (result.count) target.set(string(result.text));
      return numeric(result.count);
    }
    if (name === "split") {
      const value = this.asText(await this.scalarExpression(args[0]!));
      const target = this.array((args[1] as Extract<Expression, { kind: "variable" }>).name);
      const separator = args[2]?.kind === "regex" ? args[2].pattern : args[2] ? this.asText(await this.scalarExpression(args[2])) : this.varText("FS");
      const parts = this.split(value, separator);
      this.entries -= target.entries.size; target.entries.clear();
      parts.forEach((part, index) => this.arraySet(target, String(index + 1), part));
      return numeric(parts.length);
    }
    if (name === "match") {
      const value = this.asText(await this.scalarExpression(args[0]!));
      const matched = (await this.regex(args[1]!)).find(value, this.budget);
      this.set("RSTART", numeric(matched ? matched.start + 1 : 0));
      this.set("RLENGTH", numeric(matched ? matched.end - matched.start : -1));
      return this.get("RSTART");
    }
    const values: Scalar[] = [];
    for (const argument of args) values.push(await this.scalarExpression(argument));
    const first = values[0] ?? unset;
    if (name === "sprintf") return string(this.budget.check(formatted(this.asText(first), values.slice(1), value => this.asText(value))));
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
      const reader = this.inputs.get(path);
      this.inputs.delete(path);
      await reader?.close();
      return numeric(this.outputs.delete(path) || reader !== undefined ? 0 : -1);
    }
    const amount = number(first);
    const result = name === "int" ? Math.trunc(amount) : name === "sqrt" ? Math.sqrt(amount) : name === "exp" ? Math.exp(amount) : name === "log" ? Math.log(amount) : name === "sin" ? Math.sin(amount) : name === "cos" ? Math.cos(amount) : name === "atan2" ? Math.atan2(amount, number(values[1]!)) : NaN;
    if (!Number.isFinite(result)) throw new ProgramError(`invalid mathematical result in '${name}'`);
    return numeric(result);
  }

  private async execute(statement: Statement): Promise<void> {
    this.budget.step();
    await this.budget.checkpoint();
    switch (statement.kind) {
      case "block": for (const child of statement.body) await this.execute(child); return;
      case "expression": await this.evaluate(statement.expression); return;
      case "print": {
        const values: Scalar[] = [];
        for (const argument of statement.args) values.push(await this.scalarExpression(argument));
        const output = this.budget.check(statement.formatted ? formatted(this.asText(values[0]!), values.slice(1), value => this.asText(value))
          : (values.length ? values.map(value => text(value, this.varText("OFMT"))).join(this.varText("OFS")) : this.record) + this.varText("ORS"));
        if (!statement.redirect) { await write(this.context, output); return; }
        const destination = Buffer.from(this.asText(await this.scalarExpression(statement.redirect.destination)), "latin1").toString("utf8");
        const path = virtualPath(this.context, destination);
        if (this.outputs.has(path)) await this.context.fs.appendFile(path, bytes(output), { signal: this.context.signal });
        else {
          await this.context.fs.writeFile(path, bytes(output), { flag: statement.redirect.append ? "a" : "w", signal: this.context.signal });
          this.outputs.add(path);
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
        if (statement.target.kind === "variable") { this.entries -= array.entries.size; array.entries.clear(); }
        else if (array.entries.delete(await this.key(statement.target.indexes))) this.entries--;
        return;
      }
      case "foreach": {
        const array = this.array(statement.array);
        for (const key of [...array.entries.keys()]) {
          this.budget.step(); if (!array.entries.has(key)) continue;
          this.set(statement.variable, inputValue(key));
          try { await this.execute(statement.body); }
          catch (error) { if (error instanceof Flow && error.kind === "break") break; if (!(error instanceof Flow && error.kind === "continue")) throw error; }
        }
        return;
      }
      case "while": case "do": case "for": {
        if (statement.kind === "for" && statement.initial) await this.evaluate(statement.initial);
        let first = true;
        while (true) {
          this.budget.step();
          if (!(statement.kind === "do" && first) && statement.condition && !truth(await this.scalarExpression(statement.condition))) break;
          first = false;
          try { await this.execute(statement.body); }
          catch (error) { if (error instanceof Flow && error.kind === "break") break; if (!(error instanceof Flow && error.kind === "continue")) throw error; }
          if (statement.kind === "for" && statement.update) await this.evaluate(statement.update);
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
    try { return await this.runProgram(); }
    finally {
      const readers = [...this.inputs.values()];
      this.inputs.clear();
      await Promise.all(readers.map(reader => reader.close()));
    }
  }

  private async runProgram(): Promise<number> {
    let stopped = false;
    try { for (const statement of this.program.begin) await this.execute(statement); }
    catch (error) { if (error instanceof Flow && error.kind === "exit") { this.exit(error); stopped = true; } else throw error; }
    this.phase = "record";
    let reader: Reader | undefined;
    let argument = 1;
    let sawFile = false;
    let defaultUsed = false;
    const ranges = new Set<number>();
    try {
      if (!stopped && (this.program.rules.length || this.program.end.length)) while (true) {
        this.budget.step();
        if (!reader) {
          let file: string | undefined;
          while (argument < number(this.getScalar("ARGC"))) {
            this.budget.step();
            if (argument > 100000) throw new ProgramError("argument count limit exceeded");
            const next = this.asText(this.array("ARGV").entries.get(String(argument++)) ?? unset);
            if (!next) continue;
            if (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(next)) { this.assignment(next); continue; }
            file = next; sawFile = true; break;
          }
          if (file === undefined && !sawFile && !defaultUsed) { file = "-"; defaultUsed = true; }
          if (file === undefined) break;
          this.set("FILENAME", string(file)); this.set("FNR", numeric(0));
          reader = new Reader(input(this.context, Buffer.from(file, "latin1").toString("utf8")), this.budget);
        }
        const record = await reader.read(this.varText("RS"));
        if (record === undefined) { await reader.close(); reader = undefined; continue; }
        this.set("NR", numeric(number(this.getScalar("NR")) + 1));
        this.set("FNR", numeric(number(this.getScalar("FNR")) + 1));
        this.setRecord(record);
        try {
          for (let index = 0; index < this.program.rules.length; index++) {
            const rule = this.program.rules[index]!;
            const selected = !rule.pattern || ranges.has(index) || truth(await this.scalarExpression(rule.pattern));
            if (!selected) continue;
            if (rule.end) {
              if (truth(await this.scalarExpression(rule.end))) ranges.delete(index);
              else ranges.add(index);
            }
            await this.execute(rule.action);
          }
        } catch (error) {
          if (!(error instanceof Flow)) throw error;
          if (error.kind === "exit") { this.exit(error); break; }
          if (error.kind === "nextfile") { await reader.close(); reader = undefined; }
          else if (error.kind !== "next") throw error;
        }
      }
    } finally { await reader?.close(); }
    this.phase = "END";
    try { for (const statement of this.program.end) await this.execute(statement); }
    catch (error) { if (error instanceof Flow && error.kind === "exit") this.exit(error); else throw error; }
    return this.status;
  }
}
