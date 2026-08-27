import { Budget, copyObject, isObject, JqError, JqLimitError, object, objectKeys, put, remove as removeKey, truth, type Json } from "./limits.js";
import { isNumber, numberValue, type Numeric } from "./numbers.js";
import { JqParseError, parseJson, stringify } from "./input.js";
import type { Ast } from "./parser.js";
import { splitString } from "./split.js";
import { binary, compare, contains, describe, entries, equal, indexValue, sliceValue, stringCompare, type } from "./values.js";

type Path = (string | number)[];
const deleted = Symbol("deleted");
export class Interpreter {
  constructor(readonly budget: Budget, readonly variables: ReadonlyMap<string, Json>) {}
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
      case "identity": yield input; return;
      case "literal": yield ast.value; return;
      case "variable": yield this.variables.get(ast.name)!; return;
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
            for await (const base of this.run(ast.base, input)) { await this.budget.tick(); yield sliceValue(base, start, end); }
        return;
      case "iterate":
        for await (const base of this.run(ast.base, input)) for (const [, value] of entries(base, this.budget)) { await this.budget.tick(); yield value; }
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
            const result = binary(operator, left, right, this.budget);
            this.budget.value(result); yield result;
          }
        }
        return;
      }
      case "call": yield* this.call(ast.name, ast.args, input); return;
    }
  }
  async *field(field: { key: Ast; value: Ast }, previous: Record<string, Json>, input: Json): AsyncGenerator<Record<string, Json>> {
    for await (const key of this.run(field.key, input)) {
      if (typeof key !== "string") throw new JqError("object keys must be strings");
      for await (const value of this.run(field.value, input)) {
        const item = copyObject(previous); put(item, key, value);
        this.budget.value(item); yield item;
      }
    }
  }
  async *paths(ast: Ast, input: Json): AsyncGenerator<Path> {
    await this.budget.tick();
    if (ast.kind === "identity") { yield []; return; }
    if (ast.kind === "binary" && ast.operator === ",") { yield* this.paths(ast.left, input); yield* this.paths(ast.right, input); return; }
    if (ast.kind !== "index" && ast.kind !== "iterate") throw new JqError("unsupported assignment path");
    if (ast.kind === "index") {
      for await (const key of this.run(ast.index, input)) for await (const path of this.paths(ast.base, input)) {
        let base = input;
        for (const component of path) base = indexValue(base, component);
        if (typeof key !== "string" && (!isNumber(key) || !Number.isFinite(numberValue(key)))) throw new JqError("assignment index must be a string or finite number");
        indexValue(base, key);
        const integer = isNumber(key) ? Math.trunc(numberValue(key)) : key;
        yield [...path, typeof integer === "number" && integer < 0 && Array.isArray(base) ? base.length + integer : integer];
      }
      return;
    }
    for await (const path of this.paths(ast.base, input)) {
      let base = input;
      for (const component of path) base = indexValue(base, component);
      for (const [key] of entries(base, this.budget)) { await this.budget.tick(); yield [...path, key]; }
    }
  }
  set(input: Json, path: Path, value: Json | typeof deleted, depth = 0): Json {
    this.budget.step();
    if (depth > this.budget.limits.maxDepth) throw new JqLimitError("maxDepth");
    if (depth === path.length) return value === deleted ? null : value;
    const key = path[depth]!;
    if (value === deleted && (input === null
      || (typeof key === "string" && isObject(input) && !Object.hasOwn(input, key))
      || (typeof key === "number" && Array.isArray(input) && (key < 0 || key >= input.length)))) return input;
    const previous = indexValue(input, key);
    const remove = value === deleted && depth === path.length - 1;
    if (typeof key === "string") {
      if (input !== null && !isObject(input)) throw new JqError("object assignment requires object or null");
      const result = copyObject(input);
      if (remove) removeKey(result, key);
      else put(result, key, this.set(previous, path, value, depth + 1));
      this.budget.collection(objectKeys(result).length); return result;
    }
    if (key < 0) throw new JqError("array index out of bounds");
    if (input !== null && !Array.isArray(input)) throw new JqError("array assignment requires array or null");
    const result = input === null ? [] : [...input];
    if (remove) { if (key < result.length) result.splice(key, 1); }
    else {
      this.budget.collection(Math.max(result.length, key + 1));
      while (result.length <= key) result.push(null);
      result[key] = this.set(previous, path, value, depth + 1);
    }
    return result;
  }
  async *assign(left: Ast, right: Ast, operator: string, input: Json): AsyncGenerator<Json> {
    if (operator !== "|=") {
      for await (const value of this.run(right, input)) {
        let result = input;
        for await (const path of this.paths(left, input)) {
          let previous = result;
          for (const key of path) previous = indexValue(previous, key);
          const assigned = operator === "=" ? value : operator === "//=" ? truth(previous) ? previous : value : binary(operator.slice(0, -1), previous, value, this.budget);
          result = this.set(result, path, assigned); this.budget.value(result);
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
      let previous = result;
      for (const key of path) previous = indexValue(previous, key);
      let value: Json | typeof deleted = deleted;
      for await (const output of this.run(right, previous)) { value = output; break; }
      if (value === deleted) deletions.push(path);
      else { result = this.set(result, path, value); this.budget.value(result); }
    }
    deletions.sort((first, second) => -compare(first, second, this.budget));
    let lastDeletion: Path | undefined;
    for (const path of deletions) {
      if (!lastDeletion || compare(lastDeletion, path, this.budget) !== 0) result = this.set(result, path, deleted);
      lastDeletion = path;
    }
    this.budget.value(result); yield result;
  }
  async *call(name: string, args: Ast[], input: Json): AsyncGenerator<Json> {
    const budget = this.budget;
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
    if (name === "length") {
      if (input === null) yield 0;
      else if (isNumber(input)) yield Math.abs(numberValue(input));
      else if (typeof input === "string") yield Array.from(input).length;
      else if (Array.isArray(input)) yield input.length;
      else if (isObject(input)) yield objectKeys(input).length;
      else throw new JqError("boolean has no length");
      return;
    }
    if (name === "keys" || name === "keys_unsorted") {
      if (Array.isArray(input)) yield input.map((_, index) => index);
      else if (isObject(input)) yield name === "keys" ? objectKeys(input).sort(stringCompare) : objectKeys(input);
      else throw new JqError("keys requires an object or array");
      return;
    }
    if (name === "map" || name === "map_values") {
      const result: Json = name === "map_values" && isObject(input) ? object() : [];
      let bytes = 2;
      for (const [key, value] of entries(input, budget)) for await (const mapped of this.run(args[0]!, value)) {
        bytes += budget.value(mapped) + 1 + (Array.isArray(result) ? 0 : Buffer.byteLength(JSON.stringify(String(key))) + 1);
        if (bytes - 1 > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
        if (Array.isArray(result)) { budget.collection(result.length + 1); result.push(mapped); }
        else put(result, String(key), mapped);
        if (name === "map_values") break;
      }
      budget.value(result); yield result; return;
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
        for (const [, item] of entries(input, budget)) {
          await budget.tick();
          if (!first && separator !== null) {
            if (typeof separator !== "string") binary("+", result, separator, budget);
            if (typeof separator !== "string") throw new JqError("join separator must be a string or null when used");
            append(separator, separatorBytes);
          }
          first = false;
          if (isObject(item) || Array.isArray(item)) binary("+", result, item, budget);
          const text = item === null ? "" : typeof item === "string" ? item : stringify(item, budget);
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
    if (name === "tostring" || name === "tojson") { const result = typeof input === "string" && name === "tostring" ? input : stringify(input, budget); budget.text(result); yield result; return; }
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
    if (name === "to_entries") { yield entries(input, budget).map(([key, value]) => copyObject({ key, value })); return; }
    if (name === "from_entries" || name === "with_entries") {
      let values = input;
      if (name === "with_entries") {
        values = [];
        let bytes = 2;
        for (const [key, value] of entries(input, budget)) for await (const mapped of this.run(args[0]!, copyObject({ key, value }))) {
          budget.collection(values.length + 1); bytes += budget.value(mapped) + (values.length ? 1 : 0);
          if (bytes > budget.limits.maxValueBytes) throw new JqLimitError("maxValueBytes");
          values.push(mapped);
        }
      }
      const result = object();
      for (const [, entry] of entries(values, budget)) {
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
      if (name === "unique") entries(input, budget);
      if (name === "sort") throw new JqError(`${describe(input, budget)} cannot be sorted, as it is not an array`);
      throw new JqError(`${name} requires an array`);
    }
    if (name === "reverse") { yield [...input].reverse(); return; }
    if (name === "add") {
      let result: Json = null;
      for (const item of input) { await budget.tick(); result = binary("+", result, item, budget); budget.value(result); }
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
    keyed.sort((left, right) => compare(left.key, right.key, budget));
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
