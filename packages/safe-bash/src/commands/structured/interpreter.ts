import { Budget, copyObject, isObject, JqHalt, JqError, JqLimitError, object, objectKeyIterator, objectKeys, put, remove as removeKey, truth, type Json } from "./limits.js";
import { isNumber, numberValue, type Numeric } from "./numbers.js";
import { JqParseError, measureValue, parseJson, stringify } from "./input.js";
import type { Ast, BindingPattern } from "./parser.js";
import { formatValue } from "./formats.js";
import { scanRegex, substituteRegex } from "./regex.js";
import { splitString } from "./split.js";
import { indices } from "./indices.js";
import { fromDateIso8601, toDateIso8601 } from "./dates.js";
import { capture } from "./capture.js";
import { recurse } from "./recurse.js";
import { delpaths } from "./delpaths.js";
import { splitRegex } from "./splits.js";
import { binary, compare, contains, describe, entries, equal, indexValue, sliceValue, sortedKeys, stableSort, type } from "./values.js";

type Path = (string | number | { start: number; end: number })[];
interface Frame { readonly name: string; readonly value: Json; readonly parent: Frame | undefined; readonly depth: number }
const deleted = Symbol("deleted");
class UserError extends JqError {
  constructor(readonly value: Json, message: string) { super(message); }
}
export class Interpreter {
  private filters = new Map<Ast, { ast: Ast; scope: Interpreter }>();
  private labels = new Map<symbol, number>();
  private labelSequence = { next: 0 };
  constructor(readonly budget: Budget, readonly variables: ReadonlyMap<string, Json>, private readonly frame?: Frame) {}
  private binding(name: string, value: Json): Interpreter {
    const depth = (this.frame?.depth ?? 0) + 1;
    if (depth > this.budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
    const scope = Object.create(Interpreter.prototype) as Interpreter;
    Object.assign(scope, this, { frame: { name, value, parent: this.frame, depth } });
    return scope;
  }
  private async *matchPattern(pattern: BindingPattern, value: Json, keyScope: Interpreter): AsyncGenerator<Interpreter> {
    await this.budget.tick();
    if (pattern.kind === "variable") {
      const scope = this.binding(pattern.name, value);
      if (pattern.pattern) yield* scope.matchPattern(pattern.pattern, value, keyScope);
      else yield scope;
      return;
    }
    const fields = pattern.fields;
    const matchFields = async function* (scope: Interpreter, index: number): AsyncGenerator<Interpreter> {
      if (index === fields.length) { yield scope; return; }
      const field = fields[index]!;
      for await (const key of keyScope.run(field.key, value)) {
        for await (const matched of scope.matchPattern(field.pattern, indexValue(value, key), keyScope)) {
          yield* matchFields(matched, index + 1);
        }
      }
    };
    yield* matchFields(this, 0);
  }
  async collect(ast: Ast, input: Json): Promise<Json[]> {
    const result: Json[] = [];
    let bytes = 2;
    for await (const value of this.run(ast, input)) {
      this.budget.collection(result.length + 1);
      bytes += this.budget.value(value) + (result.length ? 1 : 0);
      if (bytes > this.budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      result.push(value);
    }
    this.budget.value(result);
    return result;
  }
  async *run(ast: Ast, input: Json): AsyncGenerator<Json> {
    await this.budget.tick();
    switch (ast.kind) {
      case "parameter": {
        const filter = this.filters.get(ast)!;
        yield* filter.scope.run(filter.ast, input); return;
      }
      case "invoke": yield* this.invocation(ast).run(ast.body, input); return;
      case "label": {
        const target = this.labelSequence.next++;
        const labels = new Map(this.labels);
        labels.set(ast.target, target);
        const scope = Object.create(Interpreter.prototype) as Interpreter;
        Object.assign(scope, this, { labels });
        try { yield* scope.run(ast.body, input); }
        catch (error) {
          // jq exposes this value to catch handlers, which may rethrow it with error(.).
          if (this.budget.signal.aborted || !(error instanceof UserError) || !equal(error.value, { __jq: target }, this.budget)) throw error;
        }
        return;
      }
      case "break": throw new UserError({ __jq: this.labels.get(ast.target)! }, "break");
      case "format": yield await formatValue(ast.name, input, this.budget); return;
      case "identity": yield input; return;
      case "literal": yield ast.value; return;
      case "variable": {
        for (let frame = this.frame; frame; frame = frame.parent) {
          await this.budget.tick();
          if (frame.name === ast.name) { yield frame.value; return; }
        }
        yield this.variables.get(ast.name)!; return;
      }
      case "bind": {
        const depth = (this.frame?.depth ?? 0) + 1;
        if (depth > this.budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
        for await (const value of this.run(ast.source, input)) {
          // Extend the lexical frame while retaining the invocation's execution context.
          const scope = Object.create(Interpreter.prototype) as Interpreter;
          Object.assign(scope, this, { frame: { name: ast.name, value, parent: this.frame, depth } });
          yield* scope.run(ast.body, input);
        }
        return;
      }
      case "destructure": {
        for await (const value of this.run(ast.source, input)) {
          for (let index = 0; index < ast.patterns.length; index++) {
            try {
              const scope = ast.names.reduce<Interpreter>((parent, name) => parent.binding(name, null), this);
              for await (const matched of scope.matchPattern(ast.patterns[index]!, value, this)) {
                yield* matched.run(ast.body, input);
              }
              break;
            } catch (error) {
              if (!(error instanceof JqError) || error instanceof JqLimitError || this.budget.signal.aborted || index === ast.patterns.length - 1) throw error;
            }
          }
        }
        return;
      }
      case "descend": yield* this.descend(input); return;
      case "try":
        try { yield* this.run(ast.body, input); }
        catch (error) {
          if (!(error instanceof JqError) || error instanceof JqLimitError || this.budget.signal.aborted) throw error;
          if (ast.handler) yield* this.run(ast.handler, error instanceof UserError ? error.value : error.message);
        }
        return;
      case "reduce":
      case "foreach": {
        const depth = (this.frame?.depth ?? 0) + 1;
        if (depth > this.budget.limits.maxAstDepth) throw new JqLimitError("maxAstDepth");
        let sourceInput = input;
        for await (const initial of this.run(ast.init, input)) {
          let accumulator = initial;
          for await (const value of this.run(ast.source, sourceInput)) {
            await this.budget.tick();
            const scope = Object.create(Interpreter.prototype) as Interpreter;
            Object.assign(scope, this, { frame: { name: ast.name, value, parent: this.frame, depth } });
            const previous = accumulator;
            accumulator = null;
            for await (const updated of scope.run(ast.update, previous)) {
              await this.budget.tick();
              accumulator = updated;
              if (ast.kind === "foreach") {
                if (ast.extract) yield* scope.run(ast.extract, updated);
                else yield updated;
              }
            }
          }
          if (ast.kind === "reduce") { sourceInput = null; yield accumulator; }
        }
        return;
      }
      case "unary":
        for await (const value of this.run(ast.operand, input)) {
          if (!isNumber(value)) throw new JqError("negation requires a number");
          yield -numberValue(value);
        }
        return;
      case "optional":
        try { yield* this.run(ast.operand, input); }
        catch (error) { if (!(error instanceof JqError) || error instanceof JqLimitError || this.budget.signal.aborted) throw error; }
        return;
      case "index":
        for await (const index of this.run(ast.index, input)) for await (const base of this.run(ast.base, input)) yield indexValue(base, index);
        return;
      case "slice":
        for await (const start of ast.start ? this.run(ast.start, input) : [null])
          for await (const end of ast.end ? this.run(ast.end, input) : [null])
            for await (const base of this.run(ast.base, input)) { await this.budget.tick(); yield await sliceValue(base, start, end, this.budget); }
        return;
      case "iterate":
        for await (const base of this.run(ast.base, input)) for await (const [, value] of entries(base, this.budget)) { await this.budget.tick(); yield value; }
        return;
      case "array": yield ast.body ? await this.collect(ast.body, input) : []; return;
      case "object": {
        if (!ast.fields.length) { yield object(); return; }
        const stack = [this.field(ast.fields[0]!, object(), input)];
        try {
          while (stack.length) {
            const next = await stack[stack.length - 1]!.next();
            if (next.done) { stack.pop(); continue; }
            if (stack.length === ast.fields.length) yield next.value;
            else stack.push(this.field(ast.fields[stack.length]!, next.value, input));
          }
        } finally { for (const iterator of stack.reverse()) await iterator.return(undefined); }
        return;
      }
      case "if":
        for await (const condition of this.run(ast.condition, input)) yield* this.run(truth(condition) ? ast.yes : ast.no, input);
        return;
      case "binary": {
        const operator = ast.operator;
        if (operator === "|") { for await (const value of this.run(ast.left, input)) yield* this.run(ast.right, value); return; }
        if (operator === ",") { yield* this.run(ast.left, input); yield* this.run(ast.right, input); return; }
        if (operator === "//") {
          let found = false;
          for await (const value of this.run(ast.left, input)) if (truth(value)) { found = true; yield value; }
          if (!found) yield* this.run(ast.right, input);
          return;
        }
        if (["=", "|=", "+=", "-=", "*=", "/=", "%=", "//="].includes(operator)) { yield* this.assign(ast.left, ast.right, operator, input); return; }
        if (operator === "and" || operator === "or") {
          for await (const left of this.run(ast.left, input)) {
            if (operator === "and" && !truth(left)) { yield false; continue; }
            if (operator === "or" && truth(left)) { yield true; continue; }
            for await (const right of this.run(ast.right, input)) yield truth(right);
          }
          return;
        }
        for await (const right of this.run(ast.right, input)) {
          for await (const left of this.run(ast.left, input)) {
            const result = await binary(operator, left, right, this.budget);
            this.budget.value(result); yield result;
          }
        }
        return;
      }
      case "call": yield* this.call(ast.name, ast.args, input); return;
    }
  }
  async *descend(input: Json, depth = 0): AsyncGenerator<Json> {
    await this.budget.tick();
    if (depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
    yield input;
    if (Array.isArray(input)) {
      if (depth + 1 > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      this.budget.collection(input.length);
      for (const value of input) yield* this.descend(value, depth + 1);
    } else if (isObject(input)) {
      if (depth + 1 > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
      const keys = objectKeys(input);
      this.budget.collection(keys.length);
      for (const key of keys) yield* this.descend(input[key]!, depth + 1);
    }
  }
  async *field(field: { key: Ast; value: Ast | undefined }, previous: Record<string, Json>, input: Json): AsyncGenerator<Record<string, Json>> {
    for await (const key of this.run(field.key, input)) {
      if (typeof key !== "string") throw new JqError("object keys must be strings");
      for await (const value of field.value ? this.run(field.value, input) : [indexValue(input, key)]) {
        const item = copyObject(previous); put(item, key, value);
        this.budget.value(item); yield item;
      }
    }
  }
  invocation(ast: Extract<Ast, { kind: "invoke" }>): Interpreter {
    const scope = Object.create(Interpreter.prototype) as Interpreter;
    const filters = new Map(this.filters);
    for (let index = 0; index < ast.parameters.length; index++) {
      this.budget.step();
      filters.set(ast.parameters[index]!, { ast: ast.args[index]!, scope: this });
    }
    Object.assign(scope, this, { filters });
    return scope;
  }
  async read(input: Json, path: Path): Promise<Json> {
    for (const key of path) {
      await this.budget.tick();
      input = typeof key === "object" ? await sliceValue(input, key.start, key.end, this.budget) : indexValue(input, key);
    }
    return input;
  }
  async *paths(ast: Ast, input: Json, depth = 0): AsyncGenerator<Path> {
    await this.budget.tick();
    if (depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
    if (ast.kind === "parameter") {
      const filter = this.filters.get(ast)!;
      yield* filter.scope.paths(filter.ast, input); return;
    }
    if (ast.kind === "invoke") { yield* this.invocation(ast).paths(ast.body, input); return; }
    if (ast.kind === "bind") {
      for await (const value of this.run(ast.source, input)) yield* this.binding(ast.name, value).paths(ast.body, input, depth);
      return;
    }
    if (ast.kind === "identity") { yield []; return; }
    if (ast.kind === "binary" && ast.operator === ",") { yield* this.paths(ast.left, input); yield* this.paths(ast.right, input); return; }
    if (ast.kind === "optional") {
      try { yield* this.paths(ast.operand, input); }
      catch (error) { if (!(error instanceof JqError) || error instanceof JqLimitError || this.budget.signal.aborted) throw error; }
      return;
    }
    if (ast.kind === "binary" && ast.operator === "|") {
      for await (const prefix of this.paths(ast.left, input))
        for await (const suffix of this.paths(ast.right, await this.read(input, prefix))) yield [...prefix, ...suffix];
      return;
    }
    if (ast.kind === "call" && ["select", "values", "strings", "numbers", "booleans", "arrays", "objects", "nulls", "scalars", "iterables", "empty"].includes(ast.name)) { for await (const value of this.run(ast, input)) { void value; yield []; } return; }
    if (ast.kind === "descend") {
      yield [];
      if (Array.isArray(input) || isObject(input)) for await (const [key, value] of entries(input, this.budget))
        for await (const suffix of this.paths(ast, value, depth + 1)) {
          this.budget.collection(suffix.length + 1);
          if (suffix.length + 1 > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
          yield [key, ...suffix];
        }
      return;
    }
    if (ast.kind === "slice") {
      for await (const start of ast.start ? this.run(ast.start, input) : [null])
        for await (const end of ast.end ? this.run(ast.end, input) : [null])
          for await (const path of this.paths(ast.base, input)) {
            const base = await this.read(input, path);
            await sliceValue(base, start, end, this.budget);
            if (base !== null && !Array.isArray(base)) throw new JqError("slice assignment requires an array");
            const length = base === null ? 0 : base.length;
            let first = start === null ? 0 : Math.floor(numberValue(start as Numeric));
            let last = end === null ? length : Math.ceil(numberValue(end as Numeric));
            first = Math.max(0, Math.min(length, first < 0 ? length + first : first));
            last = Math.max(first, Math.min(length, last < 0 ? length + last : last));
            yield [...path, { start: first, end: last }];
          }
      return;
    }
    if (ast.kind !== "index" && ast.kind !== "iterate") throw new JqError("unsupported assignment path");
    if (ast.kind === "index") {
      for await (const key of this.run(ast.index, input)) for await (const path of this.paths(ast.base, input)) {
        const base = await this.read(input, path);
        if (typeof key !== "string" && (!isNumber(key) || !Number.isFinite(numberValue(key)))) throw new JqError("assignment index must be a string or finite number");
        indexValue(base, key);
        const integer = isNumber(key) ? Math.trunc(numberValue(key)) : key;
        yield [...path, typeof integer === "number" && integer < 0 && Array.isArray(base) ? base.length + integer : integer];
      }
      return;
    }
    for await (const path of this.paths(ast.base, input)) {
      const base = await this.read(input, path);
      for await (const [key] of entries(base, this.budget)) { await this.budget.tick(); yield [...path, key]; }
    }
  }
  async set(input: Json, path: Path, value: Json | typeof deleted, depth = 0): Promise<Json> {
    this.budget.step();
    if (depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
    if (depth === path.length) return value === deleted ? null : value;
    const key = path[depth]!;
    if (value === deleted && (input === null
      || (typeof key === "string" && isObject(input) && !Object.hasOwn(input, key))
      || (typeof key === "number" && Array.isArray(input) && (key < 0 || key >= input.length)))) return input;
    if (typeof key === "object") {
      if (input !== null && !Array.isArray(input)) throw new JqError("slice assignment requires an array");
      const array = input === null ? [] : input;
      const replacement = await this.set(array.slice(key.start, key.end), path, value, depth + 1);
      if (!(value === deleted && depth === path.length - 1) && !Array.isArray(replacement)) throw new JqError("slice assignment requires an array value");
      const items = value === deleted && depth === path.length - 1 ? [] : replacement as Json[];
      this.budget.collection(array.length - (key.end - key.start) + items.length);
      return [...array.slice(0, key.start), ...items, ...array.slice(key.end)];
    }
    const previous = indexValue(input, key);
    const remove = value === deleted && depth === path.length - 1;
    if (typeof key === "string") {
      if (input !== null && !isObject(input)) throw new JqError("object assignment requires object or null");
      const result = copyObject(input);
      if (remove) removeKey(result, key);
      else put(result, key, await this.set(previous, path, value, depth + 1));
      this.budget.collection(objectKeys(result).length); return result;
    }
    if (key < 0) throw new JqError("array index out of bounds");
    if (input !== null && !Array.isArray(input)) throw new JqError("array assignment requires array or null");
    const length = input === null ? 0 : input.length;
    const size = remove ? Math.max(0, length - 1) : Math.max(length, key + 1);
    this.budget.collection(size);
    // Assignment must remain bounded even when callers omit family limits.
    if (!Number.isSafeInteger(size) || size > 1000000) throw new JqLimitError("maxCollectionSize");
    const padding = remove ? 0 : Math.max(0, key - length);
    const minimumBytes = size ? 2 * size + 1 + 3 * padding : 2;
    if (minimumBytes > Math.min(this.budget.limits.maxValueBytes, 16 * 1024 * 1024)) throw new JqLimitError("maxValueBytes");
    const result: Json[] = [];
    if (input !== null) for (const item of input) { await this.budget.tick(); result.push(item); }
    if (remove) { if (key < result.length) result.splice(key, 1); }
    else {
      while (result.length <= key) { await this.budget.tick(); result.push(null); }
      result[key] = await this.set(previous, path, value, depth + 1);
    }
    return result;
  }
  async *assign(left: Ast, right: Ast, operator: string, input: Json): AsyncGenerator<Json> {
    if (operator !== "|=") {
      for await (const value of this.run(right, input)) {
        let result = input;
        for await (const path of this.paths(left, input)) {
          const previous = await this.read(result, path);
          const assigned = operator === "=" ? value : operator === "//=" ? truth(previous) ? previous : value : await binary(operator.slice(0, -1), previous, value, this.budget);
          result = await this.set(result, path, assigned); this.budget.value(result);
        }
        yield result;
      }
      return;
    }
    const paths: Path[] = [];
    for await (const path of this.paths(left, input)) { this.budget.collection(paths.length + 1); paths.push(path); }
    let result = input;
    const deletions: Path[] = [];
    for (const path of paths) {
      const previous = await this.read(result, path);
      let value: Json | typeof deleted = deleted;
      for await (const output of this.run(right, previous)) { value = output; break; }
      if (value === deleted) deletions.push(path);
      else { result = await this.set(result, path, value); this.budget.value(result); }
    }
    await stableSort(deletions, this.budget, async (first, second) => -await compare(first, second, this.budget));
    let lastDeletion: Path | undefined;
    for (const path of deletions) {
      if (!lastDeletion || await compare(lastDeletion, path, this.budget) !== 0) result = await this.set(result, path, deleted);
      lastDeletion = path;
    }
    this.budget.value(result); yield result;
  }
  async *call(name: string, args: Ast[], input: Json): AsyncGenerator<Json> {
    const budget = this.budget;
    if (name === "walk") {
      const evaluate = (value: Json) => this.run(args[0]!, value);
      async function* visit(value: Json): AsyncGenerator<Json> {
        await budget.tick();
        let result = value;
        if (Array.isArray(value)) {
          const mapped: Json[] = [];
          for (const child of value) for await (const item of visit(child)) {
            budget.collection(mapped.length + 1);
            mapped.push(item);
          }
          result = mapped;
        } else if (isObject(value)) {
          const mapped = object();
          for (const key of objectKeyIterator(value)) for await (const item of visit(value[key]!)) {
            put(mapped, key, item);
            break;
          }
          result = mapped;
        }
        budget.value(result);
        yield* evaluate(result);
      }
      yield* visit(input);
      return;
    }
    if (name === "fromdateiso8601") { yield fromDateIso8601(input); return; }
    if (name === "todateiso8601") { yield toDateIso8601(input); return; }
    if (name === "while" || name === "until") {
      // Keep filter continuations explicitly: branching updates use depth-first
      // order, and consumers can stop before evaluating later branches.
      const step = async function* (this: Interpreter, value: Json): AsyncGenerator<{ value: Json; emit: boolean }> {
        for await (const condition of this.run(args[0]!, value)) {
          const satisfied = truth(condition);
          if (name === "until" && satisfied) yield { value, emit: true };
          else if (name === "until" || satisfied) {
            if (name === "while") yield { value, emit: true };
            for await (const next of this.run(args[1]!, value)) yield { value: next, emit: false };
          }
        }
      }.bind(this);
      const stack = [step(input)];
      try {
        while (stack.length) {
          await budget.tick();
          const next = await stack.at(-1)!.next();
          if (next.done) { stack.pop(); continue; }
          if (next.value.emit) yield next.value.value;
          else {
            budget.collection(stack.length + 1);
            stack.push(step(next.value.value));
          }
        }
      } finally {
        while (stack.length) await stack.pop()!.return(undefined);
      }
      return;
    }
    if (name === "scan") {
      for await (const source of this.run(args[0]!, input)) yield* scanRegex(input, source, budget);
      return;
    }
    if (name === "recurse") { yield* recurse(this, args, input); return; }
    if (name === "capture") {
      for await (const pattern of this.run(args[0]!, input)) {
        if (args[1]) {
          for await (const flags of this.run(args[1], input)) yield* capture(input, pattern, flags, budget);
        } else if (typeof pattern === "string") yield* capture(input, pattern, null, budget);
        else if (Array.isArray(pattern) && pattern.length) yield* capture(input, pattern[0]!, pattern[1] ?? null, budget);
        else throw new JqError(`${type(pattern)} not a string or array`);
      }
      return;
    }
    if (name === "delpaths") {
      for await (const paths of this.run(args[0]!, input)) {
        const result = await delpaths(input, paths, budget);
        budget.value(result);
        yield result;
      }
      return;
    }
    if (name === "setpath") {
      for await (const value of this.run(args[1]!, input)) {
        for await (const candidate of this.run(args[0]!, input)) {
          if (!Array.isArray(candidate)) throw new JqError("Path must be specified as an array");
          const path: Path = [];
          let base = input;
          for (const component of candidate) {
            await budget.tick();
            budget.collection(path.length + 1);
            // Read each old value before normalizing relative array indexes.
            const previous = indexValue(base, component);
            let key: string | number;
            if (typeof component === "string") key = component;
            else {
              if (!isNumber(component)) throw new JqError(`Cannot index ${type(base)} with ${type(component)}`);
              key = Math.trunc(numberValue(component));
              if (key < 0) key += Array.isArray(base) ? base.length : 0;
              if (key < 0) throw new JqError("Out of bounds negative array index");
            }
            path.push(key);
            base = previous;
          }
          const result = await this.set(input, path, value);
          budget.value(result);
          yield result;
        }
      }
      return;
    }
    if (name === "getpath") {
      for await (const path of this.run(args[0]!, input)) {
        if (!Array.isArray(path)) throw new JqError("Path must be specified as an array");
        let value = input;
        for (const key of path) {
          await budget.tick();
          if (isObject(key) && (value === null || Array.isArray(value) || typeof value === "string")) {
            if (value === null) continue;
            const start = Object.hasOwn(key, "start") ? key.start! : undefined;
            const end = Object.hasOwn(key, "end") ? key.end! : undefined;
            if ((start !== null && (!isNumber(start) || !Number.isFinite(numberValue(start))))
              || (end !== null && (!isNumber(end) || !Number.isFinite(numberValue(end))))) {
              throw new JqError("Array/string slice indices must be integers");
            }
            value = await sliceValue(value, start, end, budget);
          } else value = indexValue(value, key);
        }
        yield value;
      }
      return;
    }
    if (name === "flatten") {
      for await (const depth of args.length ? this.run(args[0]!, input) : [Infinity]) {
        if (!isNumber(depth) || numberValue(depth) < 0 || Number.isNaN(numberValue(depth))) throw new JqError("flatten depth must be nonnegative");
        const result: Json[] = [];
        const stack = [{ iterator: entries(input, budget), depth: numberValue(depth) }];
        while (stack.length) {
          await budget.tick();
          const frame = stack.at(-1)!;
          const next = await frame.iterator.next();
          if (next.done) { stack.pop(); continue; }
          const value = next.value[1];
          if (Array.isArray(value) && frame.depth !== 0) stack.push({ iterator: entries(value, budget), depth: frame.depth - 1 });
          else { budget.collection(result.length + 1); result.push(value); }
        }
        budget.value(result); yield result;
      }
      return;
    }
    if (name === "paths") {
      if (!Array.isArray(input) && !isObject(input)) return;
      const stack = [{ iterator: entries(input, budget), path: [] as Json[] }];
      while (stack.length) {
        await budget.tick();
        const frame = stack.at(-1)!;
        const next = await frame.iterator.next();
        if (next.done) { stack.pop(); continue; }
        const [key, value] = next.value;
        const depth = frame.path.length + 1;
        if (depth > budget.limits.maxDepth) throw new JqLimitError("maxDepth");
        budget.collection(depth);
        const path = [...frame.path, key];
        budget.value(path);
        if (args.length) {
          for await (const selected of this.run(args[0]!, value)) if (truth(selected)) yield path;
        } else yield path;
        if (Array.isArray(value) || isObject(value)) stack.push({ iterator: entries(value, budget), path });
      }
      return;
    }
    if (name === "del") { yield* this.assign(args[0]!, { kind: "call", name: "empty", args: [] }, "|=", input); return; }
    if (name === "halt") throw new JqHalt(0, "");
    if (name === "halt_error") {
      for await (const code of args.length ? this.run(args[0]!, input) : [5]) {
        if (!isNumber(code)) throw new JqError(`${describe(input, budget)} halt_error/1: number required`);
        const stderr = input === null ? "" : typeof input === "string" ? input
          : `${await stringify(input, budget, { indent: "", ascii: false, color: false }, budget.limits.maxOutputBytes, "maxOutputBytes")}\n`;
        if (budget.outputBytes + Buffer.byteLength(stderr) > budget.limits.maxOutputBytes) throw new JqLimitError("maxOutputBytes");
        // jq clamps negative statuses and the process exposes the low byte.
        const status = Math.max(0, Math.trunc(numberValue(code))) % 256;
        throw new JqHalt(status, stderr);
      }
      return;
    }
    if (name === "error") {
      for await (const value of args.length ? this.run(args[0]!, input) : [input]) {
        throw new UserError(value, typeof value === "string" ? value : await stringify(value, budget));
      }
      return;
    }
    if (name === "indices") {
      for await (const value of this.run(args[0]!, input)) yield await indices(input, value, budget);
      return;
    }
    if (["startswith", "endswith", "ltrimstr", "rtrimstr"].includes(name)) {
      for await (const value of this.run(args[0]!, input)) {
        if (typeof input !== "string" || typeof value !== "string") {
          if (name === "ltrimstr" || name === "rtrimstr") { yield input; continue; }
          throw new JqError(`${name} requires strings`);
        }
        await budget.tick(input.length + value.length);
        const matches = name === "startswith" || name === "ltrimstr" ? input.startsWith(value) : input.endsWith(value);
        yield name === "startswith" || name === "endswith" ? matches : !matches || !value.length ? input : name === "ltrimstr" ? input.slice(value.length) : input.slice(0, -value.length);
      }
      return;
    }
    if (name === "explode" || name === "utf8bytelength") {
      if (typeof input !== "string") throw new JqError(name === "explode" ? "explode input must be a string" : `${describe(input, budget)} only strings have UTF-8 byte length`);
      const points: number[] = [];
      let bytes = 0;
      for (let offset = 0; offset < input.length;) {
        await budget.tick();
        const point = input.codePointAt(offset)!;
        offset += point > 0xffff ? 2 : 1;
        if (name === "explode") {
          budget.collection(points.length + 1);
          bytes += String(point).length + (points.length ? 1 : 2);
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          points.push(point);
        } else bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
      }
      yield name === "explode" ? points : bytes;
      return;
    }
    if (name === "ascii_downcase" || name === "ascii_upcase") {
      if (typeof input !== "string") throw new JqError(`${name} requires a string`);
      await budget.tick(input.length);
      let result = "";
      const lower = name === "ascii_downcase";
      for (let index = 0; index < input.length; index++) {
        const code = input.charCodeAt(index);
        result += String.fromCharCode(code >= (lower ? 65 : 97) && code <= (lower ? 90 : 122) ? code + (lower ? 32 : -32) : code);
      }
      budget.value(result); yield result; return;
    }
    if (name === "empty") return;
    if (name === "select") { for await (const value of this.run(args[0]!, input)) if (truth(value)) yield input; return; }
    if (name === "values") { if (input !== null) yield input; return; }
    const filters: Readonly<Record<string, string>> = { strings: "string", numbers: "number", booleans: "boolean", arrays: "array", objects: "object", nulls: "null" };
    if (Object.hasOwn(filters, name)) { if (type(input) === filters[name]) yield input; return; }
    if (name === "scalars" || name === "iterables") {
      if ((isObject(input) || Array.isArray(input)) === (name === "iterables")) yield input; return;
    }
    if (name === "type") { yield type(input); return; }
    if (name === "nan" || name === "infinite") { yield name === "nan" ? NaN : Infinity; return; }
    if (name === "isnan" || name === "isinfinite" || name === "isfinite") {
      const value = isNumber(input) ? numberValue(input) : undefined;
      const infinite = value === Infinity || value === -Infinity;
      yield name === "isnan" ? value !== undefined && Number.isNaN(value) : name === "isinfinite" ? infinite : value !== undefined && !infinite;
      return;
    }
    if (name === "not") { yield !truth(input); return; }
    if (name === "bsearch") {
      for await (const target of this.run(args[0]!, input)) {
        for await (const length of this.run({ kind: "call", name: "length", args: [] }, input)) {
          let low = 0;
          let high = numberValue(length as Numeric);
          let found: number | undefined;
          while (low < high) {
            await budget.tick();
            const middle = Math.floor((low + high - 1) / 2);
            const order = await compare(indexValue(input, middle), target, budget);
            if (order === 0) { found = middle; break; }
            if (order < 0) low = middle + 1;
            else high = middle;
          }
          yield found ?? -low - 1;
        }
      }
      return;
    }
    if (name === "combinations") {
      for await (const length of this.run({ kind: "call", name: "length", args: [] }, input)) {
        const width = Math.ceil(numberValue(length as Numeric));
        budget.collection(width);
        if (width === 0) { yield []; return; }
        const values: Json[] = [];
        const iterators: AsyncGenerator<[string | number, Json]>[] = [];
        let depth = 0;
        try {
          while (depth >= 0) {
            await budget.tick();
            if (!iterators[depth]) iterators[depth] = entries(indexValue(input, depth), budget);
            const next = await iterators[depth]!.next();
            if (next.done) {
              iterators.pop();
              values.pop();
              depth--;
            } else {
              values[depth] = next.value[1];
              if (depth + 1 === width) {
                budget.value(values);
                yield [...values];
              } else depth++;
            }
          }
        } finally {
          for (const iterator of iterators) await iterator.return(undefined);
        }
      }
      return;
    }
    if (name === "transpose") {
      let width = 0;
      for await (const [, row] of entries(input, budget)) {
        for await (const length of this.run({ kind: "call", name: "length", args: [] }, row)) {
          width = Math.max(width, numberValue(length as number));
        }
      }
      budget.collection(Math.ceil(width));
      const result: Json[] = [];
      let bytes = 2;
      for (let column = 0; column < width; column++) {
        await budget.tick();
        const values: Json[] = [];
        bytes += 2 + (column ? 1 : 0);
        for await (const [, row] of entries(input, budget)) {
          const value = indexValue(row, column);
          bytes += budget.value(value) + (values.length ? 1 : 0);
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          budget.collection(values.length + 1);
          values.push(value);
        }
        result.push(values);
      }
      budget.value(result); yield result; return;
    }
    if (name === "length") {
      if (input === null) yield 0;
      else if (isNumber(input)) yield Math.abs(numberValue(input));
      else if (typeof input === "string") {
        await budget.tick(input.length);
        let length = 0;
        for (let offset = 0; offset < input.length; length++) {
          if (length % 32 === 0) await budget.tick(0);
          offset += input.codePointAt(offset)! > 0xffff ? 2 : 1;
        }
        yield length;
      }
      else if (Array.isArray(input)) yield input.length;
      else if (isObject(input)) {
        let length = 0;
        for (const key of objectKeyIterator(input)) { await budget.tick(); void key; length++; }
        yield length;
      }
      else throw new JqError(`${describe(input, budget)} has no length`);
      return;
    }
    if (name === "keys" || name === "keys_unsorted") {
      let result: Json[];
      if (Array.isArray(input)) {
        budget.collection(input.length);
        await budget.tick(input.length);
        result = [];
        let bytes = 2;
        if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        for (let index = 0; index < input.length; index++) {
          await budget.tick();
          bytes += String(index).length + (index ? 1 : 0);
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          result.push(index);
        }
      } else if (isObject(input)) {
        let bytes = 2;
        let count = 0;
        if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        for (const key of objectKeyIterator(input)) {
          await budget.tick();
          budget.collection(++count);
          const separator = count > 1 ? 1 : 0;
          bytes += separator + await measureValue(key, budget, 1, budget.limits.maxValueBytes - bytes - separator);
        }
        if (name === "keys") result = await sortedKeys(input, budget);
        else {
          result = [];
          for (const key of objectKeyIterator(input)) {
            await budget.tick();
            budget.collection(result.length + 1);
            result.push(key);
          }
        }
      } else throw new JqError("keys requires an object or array");
      yield result; return;
    }
    if (name === "map" || name === "map_values") {
      const result: Json = name === "map_values" && isObject(input) ? object() : [];
      let bytes = 2;
      for await (const [key, value] of entries(input, budget)) for await (const mapped of this.run(args[0]!, value)) {
        bytes += budget.value(mapped) + 1 + (Array.isArray(result) ? 0 : Buffer.byteLength(JSON.stringify(String(key))) + 1);
        if (bytes - 1 > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        if (Array.isArray(result)) { budget.collection(result.length + 1); result.push(mapped); }
        else put(result, String(key), mapped);
        if (name === "map_values") break;
      }
      budget.value(result); yield result; return;
    }
    if (name === "inside") {
      for await (const container of this.run(args[0]!, input)) {
        if (type(container) !== type(input) || (typeof input === "boolean" && container !== input)) throw new JqError(`${describe(container, budget)} and ${describe(input, budget)} cannot have their containment checked`);
        yield contains(container, input, budget);
      }
      return;
    }
    if (name === "has" || name === "contains") {
      for await (const argument of this.run(args[0]!, input)) {
        if (name === "contains") {
          if (type(input) !== type(argument)) throw new JqError("contains requires matching types");
          yield contains(input, argument, budget);
        } else if (input === null) yield false;
        else if (isObject(input) && typeof argument === "string") yield Object.hasOwn(input, argument);
        else if (Array.isArray(input) && isNumber(argument)) yield Math.trunc(numberValue(argument)) >= 0 && Math.trunc(numberValue(argument)) < input.length;
        else throw new JqError("has requires object/string or array/number");
      }
      return;
    }
    if (name === "gsub") {
      for await (const pattern of this.run(args[0]!, input)) {
        for await (const flags of args[2] ? this.run(args[2], input) : [""]) {
          yield* substituteRegex(input, pattern, flags, captures => this.run(args[1]!, captures), budget);
        }
      }
      return;
    }
    if (name === "splits") {
      for await (const separator of this.run(args[0]!, input)) {
        yield* splitRegex(input, separator, budget);
      }
      return;
    }
    if (name === "split") {
      for await (const separator of this.run(args[0]!, input)) {
        yield await splitString(input, separator, budget);
      }
      return;
    }
    if (name === "join") {
      for await (const separator of this.run(args[0]!, input)) {
        const separatorBytes = budget.value(separator);
        let result = "";
        let bytes = 2;
        let first = true;
        const append = (text: string, encodedBytes: number): void => {
          bytes += encodedBytes - 2;
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          result += text;
        };
        for await (const [, item] of entries(input, budget)) {
          await budget.tick();
          if (!first && separator !== null) {
            if (typeof separator !== "string") await binary("+", result, separator, budget);
            if (typeof separator !== "string") throw new JqError("join separator must be a string or null when used");
            append(separator, separatorBytes);
          }
          first = false;
          if (isObject(item) || Array.isArray(item)) await binary("+", result, item, budget);
          const text = item === null ? "" : typeof item === "string" ? item : await stringify(item, budget);
          append(text, budget.value(text));
        }
        budget.value(result); yield result;
      }
      return;
    }
    if (name === "first" || name === "last") {
      if (!args.length) {
        if (!Array.isArray(input) && input !== null) throw new JqError(`${name} requires an array`);
        yield input === null ? null : input[name === "first" ? 0 : input.length - 1] ?? null; return;
      }
      let last: Json | undefined;
      for await (const value of this.run(args[0]!, input)) { if (name === "first") { yield value; return; } last = value; }
      if (name === "last") yield last ?? null; return;
    }
    if (name === "limit") {
      for await (const argument of this.run(args[0]!, input)) {
        if (!isNumber(argument) || !Number.isSafeInteger(numberValue(argument)) || numberValue(argument) < 0) throw new JqError("limit requires a nonnegative integer");
        const count = numberValue(argument);
        if (count === 0) continue;
        let emitted = 0;
        for await (const value of this.run(args[1]!, input)) { yield value; if (++emitted >= count) break; }
      }
      return;
    }
    if (name === "range") {
      for await (const start of args.length === 1 ? [0] : this.run(args[0]!, input))
        for await (const end of this.run(args[args.length === 1 ? 0 : 1]!, input))
          for await (const increment of args[2] ? this.run(args[2], input) : [1]) {
            if (!isNumber(start) || !isNumber(end) || !isNumber(increment)) throw new JqError("range requires numbers");
            const step = numberValue(increment);
            const stop = numberValue(end);
            if (step === 0) continue;
            for (let value: Numeric = start; step > 0 ? numberValue(value) < stop : numberValue(value) > stop;) {
              await budget.tick(); yield value;
              const next = numberValue(value) + step;
              if (!Number.isFinite(next)) throw new JqError("nonfinite range increment");
              if (next === numberValue(value)) throw new JqError("range increment makes no progress"); value = next;
            }
          }
      return;
    }
    if (name === "tostring" || name === "tojson") {
      if (typeof input === "string" && name === "tostring") { await measureValue(input, budget); yield input; }
      else yield await stringify(input, budget, false, budget.limits.maxValueBytes, "maxValueBytes", true);
      return;
    }
    if (name === "tonumber" || name === "fromjson") {
      if (name === "tonumber" && isNumber(input)) { yield input; return; }
      if (typeof input !== "string") throw new JqError(name === "fromjson" ? `${describe(input, budget)} only strings can be parsed` : `${describe(input, budget)} cannot be parsed as a number`);
      let result: Json;
      try { result = parseJson(input, budget); }
      catch (error) {
        if (!(error instanceof JqParseError)) throw error;
        throw new JqError(`${error.diagnostic()} (while parsing '${input.split("\0", 1)[0]}')`);
      }
      if (name === "tonumber" && !isNumber(result)) throw new JqError(`${describe(input, budget)} cannot be parsed as a number`);
      yield result; return;
    }
    if (name === "to_entries") {
      if (Array.isArray(input)) await budget.tick(input.length);
      const result: Json[] = [];
      let bytes = 2;
      if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      for await (const [key, value] of entries(input, budget)) {
        budget.collection(result.length + 1);
        budget.collection(2);
        const overhead = 17 + (result.length ? 1 : 0);
        const keyBytes = await measureValue(key, budget, 2, budget.limits.maxValueBytes - bytes - overhead);
        const valueBytes = await measureValue(value, budget, 2, budget.limits.maxValueBytes - bytes - overhead - keyBytes);
        await budget.tick(4);
        bytes += overhead + keyBytes + valueBytes;
        const entry = object();
        put(entry, "key", key); put(entry, "value", value);
        result.push(entry);
      }
      yield result; return;
    }
    if (name === "from_entries" || name === "with_entries") {
      let values = input;
      if (name === "with_entries") {
        values = [];
        let bytes = 2;
        for await (const [key, value] of entries(input, budget)) for await (const mapped of this.run(args[0]!, copyObject({ key, value }))) {
          budget.collection(values.length + 1); bytes += budget.value(mapped) + (values.length ? 1 : 0);
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          values.push(mapped);
        }
      }
      const result = object();
      for await (const [, entry] of entries(values, budget)) {
        await budget.tick();
        if (!isObject(entry)) throw new JqError(`Cannot index ${type(entry)} with string "key"`);
        const key = ["key", "Key", "name", "Name"].find(candidate => Object.hasOwn(entry, candidate) && truth(entry[candidate]!));
        const value = ["value", "Value"].find(candidate => Object.hasOwn(entry, candidate));
        if (key === undefined || typeof entry[key] !== "string") throw new JqError("from_entries requires string keys");
        put(result, entry[key] as string, value === undefined ? null : entry[value]!);
      }
      budget.value(result); yield result; return;
    }
    if (name === "any" || name === "all") {
      const generator: Ast = args.length === 2 ? args[0]! : { kind: "iterate", base: { kind: "identity" } };
      const condition: Ast = args[args.length === 2 ? 1 : 0] ?? { kind: "identity" };
      for await (const item of this.run(generator, input)) {
        for await (const value of this.run(condition, item)) {
          await budget.tick();
          if (truth(value) === (name === "any")) { yield name === "any"; return; }
        }
      }
      yield name === "all"; return;
    }
    if (!Array.isArray(input)) {
      if (name === "unique" && !isObject(input)) throw new JqError(`Cannot iterate over ${describe(input, budget)}`);
      if (name === "sort") throw new JqError(`${describe(input, budget)} cannot be sorted, as it is not an array`);
      throw new JqError(`${name} requires an array`);
    }
    if (name === "reverse") {
      await budget.tick(input.length);
      await measureValue(input, budget);
      const result: Json[] = [];
      for (let index = input.length - 1; index >= 0; index--) { await budget.tick(0); result.push(input[index]!); }
      yield result; return;
    }
    if (name === "add") {
      let result: Json = null;
      for (const item of input) { await budget.tick(); result = await binary("+", result, item, budget); budget.value(result); }
      yield result; return;
    }
    const keyed: { key: Json; value: Json }[] = [];
    let keyBytes = 0;
    for (const value of input) {
      await budget.tick(); const key = args[0] ? await this.collect(args[0], value) : value;
      keyBytes += budget.value(key);
      if (keyBytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
      keyed.push({ value, key });
    }
    await stableSort(keyed, budget, (left, right) => compare(left.key, right.key, budget));
    if (name === "min" || name === "min_by" || name === "max" || name === "max_by") { yield keyed[name.startsWith("min") ? 0 : keyed.length - 1]?.value ?? null; return; }
    if (name === "sort" || name === "sort_by") { yield keyed.map(item => item.value); return; }
    if (name === "unique" || name === "unique_by") { yield keyed.filter((item, index) => index === 0 || !equal(item.key, keyed[index - 1]!.key, budget)).map(item => item.value); return; }
    if (name === "group_by") {
      const groups: Json[][] = [];
      let previous: Json | undefined;
      for (const item of keyed) {
        if (previous === undefined || !equal(previous, item.key, budget)) groups.push([]);
        groups[groups.length - 1]!.push(item.value); previous = item.key;
      }
      budget.value(groups); yield groups; return;
    }
    throw new JqError(`unsupported function ${name}`);
  }
}
