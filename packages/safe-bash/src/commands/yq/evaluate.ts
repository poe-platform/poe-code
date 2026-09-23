import type { Node, Pair, YAMLMap, YAMLSeq } from "yaml";
import type { Expression } from "./expression.js";
import { cloneNode, decodeDocuments, dereference, nodeTag, replace, scalar, truth, type Candidate, type YamlModule } from "./nodes.js";
import { MikeError, type NativeWork } from "./native-work.js";
import { EreLedger } from "../regex-execution/ere/limits.js";
import { EreSyntaxError, EreUnsupportedError, EreProfileLimitError } from "../regex-execution/ere/errors.js";
import { compileEre } from "../regex-execution/ere/syntax.js";
import { prepareUtf8EreSubject } from "../regex-execution/ere/matcher.js";

function value(node: Node, yaml: YamlModule): string | number | bigint | boolean | null {
  if (!yaml.isScalar(node)) throw new MikeError("expected a scalar value");
  const result: unknown = node.value;
  if (result == null) return null;
  if (typeof result === "string" && node.tag && !node.tag.startsWith("tag:yaml.org,2002:")) {
    if (/^[+-]?[0-9]+$/u.test(result)) return BigInt(result);
    if (/^[+-]?0[xX][0-9a-fA-F]+$/u.test(result)) {
      if (result[0] === "+" || result[0] === "-") throw new MikeError(`strconv.ParseInt: parsing ${JSON.stringify(result)}: invalid syntax`);
      return BigInt(result);
    }
    if (/^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/u.test(result)) return Number(result);
  }
  if (typeof result === "string" && node.tag === "tag:yaml.org,2002:int") {
    try { return BigInt(result); }
    catch { throw new MikeError(`invalid integer value ${JSON.stringify(result)}`); }
  }
  if (typeof result === "string" && node.tag === "tag:yaml.org,2002:float") return Number(result);
  if (typeof result === "string" && node.tag === "tag:yaml.org,2002:bool") return result.toLowerCase() === "true";
  if (["string", "number", "bigint", "boolean"].includes(typeof result)) return result as string | number | bigint | boolean;
  throw new MikeError("unsupported scalar value");
}

function scalarText(node: Node, yaml: YamlModule): string {
  if (!yaml.isScalar(node)) throw new MikeError("expected a scalar value");
  return node.source ?? String(node.value);
}

export class Evaluator {
  #warnedMerge = false;
  #regex: EreLedger | undefined;
  constructor(readonly yaml: YamlModule, readonly work: NativeWork, readonly mergeSpec = false) {}

  async match(first: string, pattern: string): Promise<boolean> {
    await this.work.tick(first.length + pattern.length);
    const name = Buffer.from(first);
    const glob = Buffer.from(pattern);
    let nameIndex = 0;
    let patternIndex = 0;
    let restartPattern = 0;
    let restartName = 0;
    while (patternIndex < glob.length || nameIndex < name.length) {
      await this.work.tick();
      if (patternIndex < glob.length) {
        const character = glob[patternIndex];
        if (character === 42) { restartPattern = patternIndex; restartName = nameIndex + 1; patternIndex++; continue; }
        if (nameIndex < name.length && (character === 63 || character === name[nameIndex])) { patternIndex++; nameIndex++; continue; }
      }
      if (restartName > 0 && restartName <= name.length) { patternIndex = restartPattern; nameIndex = restartName; continue; }
      return false;
    }
    return true;
  }

  child(node: Node, parent: Candidate, collection?: YAMLMap | YAMLSeq, slot?: number): Candidate {
    this.work.node();
    return { node, document: parent.document, isDerived: collection === undefined || parent.isDerived === true,
      ...(collection === undefined ? {} : { parent: collection, slot: slot! }),
      ...(collection === undefined ? parent.ancestry ? { ancestry: parent.ancestry } : {} : {
        ancestry: { parent, key: this.yaml.isMap(collection) ? collection.items[slot!]!.key as Node : slot! },
      }),
    };
  }

  async toEntries(input: Candidate): Promise<YAMLSeq> {
    const yaml = this.yaml;
    const base = dereference(input, yaml, this.work);
    if (!yaml.isCollection(base.node)) throw new MikeError(`to_entries only supports maps and arrays, got ${nodeTag(base.node, yaml)}`);
    this.work.node();
    const result = new yaml.YAMLSeq();
    if (base.node.commentBefore !== undefined) result.commentBefore = base.node.commentBefore;
    if (base.node.comment !== undefined) result.comment = base.node.comment;
    for (let index = 0; index < base.node.items.length; index++) {
      await this.work.tick();
      const item = base.node.items[index]!;
      const key = yaml.isMap(base.node) ? (item as Pair).key as Node : scalar(yaml, this.work, BigInt(index));
      const member = yaml.isMap(base.node) ? (item as Pair).value as Node : item as Node;
      this.work.node();
      const entry = new yaml.YAMLMap();
      const copiedKey = await cloneNode(key, yaml, this.work);
      if (index === 0 && yaml.isMap(base.node) && copiedKey.commentBefore !== undefined) {
        result.commentBefore = copiedKey.commentBefore;
        delete copiedKey.commentBefore;
      }
      entry.items.push(new yaml.Pair(scalar(yaml, this.work, "key"), copiedKey));
      entry.items.push(new yaml.Pair(scalar(yaml, this.work, "value"), await cloneNode(member, yaml, this.work)));
      result.items.push(entry);
    }
    return result;
  }

  async fromEntries(input: Candidate): Promise<YAMLMap> {
    const yaml = this.yaml;
    const base = dereference(input, yaml, this.work);
    if (!yaml.isSeq(base.node)) throw new MikeError("from_entries only supports arrays");
    this.work.node();
    const result = new yaml.YAMLMap();
    if (base.node.flow !== undefined) result.flow = base.node.flow;
    if (base.node.commentBefore !== undefined) result.commentBefore = base.node.commentBefore;
    if (base.node.comment !== undefined) result.comment = base.node.comment;
    for (const item of base.node.items) {
      await this.work.tick();
      if (!yaml.isNode(item)) throw new MikeError("from_entries expects key/value entries");
      const entry = dereference(this.child(item, base), yaml, this.work);
      const fields = await this.entries(entry);
      const key = fields.get("key");
      const member = fields.get("value");
      if (!key || !member) throw new MikeError("from_entries expects key/value entries");
      result.items.push(new yaml.Pair(await cloneNode(key.node, yaml, this.work), await cloneNode(member.node, yaml, this.work)));
    }
    return result;
  }

  async sort(input: Candidate, expression: Expression, depth: number): Promise<YAMLSeq | YAMLMap> {
    const yaml = this.yaml;
    const base = dereference(input, yaml, this.work);
    if (!yaml.isCollection(base.node)) throw new MikeError(`cannot sort ${nodeTag(base.node, yaml)}, can only sort arrays or maps`);
    const result = await cloneNode(base.node, yaml, this.work) as YAMLSeq | YAMLMap;
    const members: { item: Node | Pair; keys: Node[] }[] = [];
    for (const item of result.items) {
      await this.work.tick();
      const candidate = this.child(yaml.isMap(result) ? (item as Pair).value as Node : item as Node, base);
      const keys = await this.run(expression, [candidate], false, depth + 1);
      this.work.node(keys.length);
      members.push({ item: item as Node | Pair, keys: keys.map(key => dereference(key, yaml, this.work).node) });
    }
    const compare = async (first: typeof members[number], second: typeof members[number]): Promise<number> => {
      for (let index = 0; index < Math.min(first.keys.length, second.keys.length); index++) {
        await this.work.tick();
        const leftNode = first.keys[index]!;
        const rightNode = second.keys[index]!;
        const left = yaml.isScalar(leftNode) ? value(leftNode, yaml) : "";
        const right = yaml.isScalar(rightNode) ? value(rightNode, yaml) : "";
        if (left === null && right === null) continue;
        if (left === null) return -1;
        if (right === null) return 1;
        if (typeof left === "boolean" && typeof right !== "boolean") return -1;
        if (typeof left !== "boolean" && typeof right === "boolean") return 1;
        if (typeof left === "boolean" && typeof right === "boolean" ||
          (typeof left === "number" || typeof left === "bigint") && (typeof right === "number" || typeof right === "bigint")) {
          if (left < right) return -1;
          if (left > right) return 1;
        } else {
          const leftText = yaml.isScalar(leftNode) ? scalarText(leftNode, yaml) : "";
          const rightText = yaml.isScalar(rightNode) ? scalarText(rightNode, yaml) : "";
          await this.work.tick(leftText.length + rightText.length);
          const compared = Buffer.compare(Buffer.from(leftText), Buffer.from(rightText));
          if (compared) return compared;
        }
      }
      return first.keys.length - second.keys.length;
    };
    // A cooperative stable merge sort charges every comparison and move.
    for (let width = 1; width < members.length; width *= 2) {
      for (let start = 0; start < members.length; start += width * 2) {
        const end = Math.min(start + width * 2, members.length);
        const middle = Math.min(start + width, end);
        this.work.node(end - start);
        const merged: typeof members = [];
        let left = start;
        let right = middle;
        while (left < middle || right < end) {
          await this.work.tick();
          merged.push(right >= end || left < middle && await compare(members[left]!, members[right]!) <= 0 ? members[left++]! : members[right++]!);
        }
        for (let index = 0; index < merged.length; index++) { await this.work.tick(); members[start + index] = merged[index]!; }
      }
    }
    if (yaml.isMap(result)) result.items = members.map(member => member.item as Pair);
    else result.items = members.map(member => member.item as Node);
    return result;
  }

  async entries(input: Candidate, depth = 0): Promise<Map<string, Candidate>> {
    this.work.depth(depth);
    await this.work.tick();
    const base = dereference(input, this.yaml, this.work);
    const entries = new Map<string, Candidate>();
    if (!this.yaml.isMap(base.node)) return entries;
    const node = base.node;
    const isMerge = (key: unknown) => this.yaml.isScalar(key) && (key.tag === "tag:yaml.org,2002:merge" || key.value === "<<" && key.type === "PLAIN");
    const merge = async (incoming: Node) => {
      const source = dereference({ ...base, node: incoming }, this.yaml, this.work);
      const values = this.yaml.isSeq(source.node) ? source.node.items : [source.node];
      for (let index = 0; index < values.length; index++) {
        const selected = values[this.mergeSpec ? values.length - 1 - index : index];
        if (!this.yaml.isNode(selected)) continue;
        for (const [key, child] of await this.entries({ ...source, node: selected }, depth + 1)) { await this.work.tick(); entries.set(key, child); }
      }
    };
    if (this.mergeSpec) for (let index = node.items.length - 1; index >= 0; index--) {
      const pair = node.items[index]!;
      await this.work.tick();
      if (isMerge(pair.key) && this.yaml.isNode(pair.value)) await merge(pair.value);
    }
    for (const [slot, pair] of node.items.entries()) {
      await this.work.tick();
      if (isMerge(pair.key)) {
        if (!this.mergeSpec) {
          if (!this.#warnedMerge) {
            this.#warnedMerge = true;
            const now = new Date();
            const offset = now.getTimezoneOffset();
            const local = new Date(now.getTime() - offset * 60_000).toISOString().slice(0, -1);
            const zone = offset === 0 ? "Z" : `${offset < 0 ? "+" : "-"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
            await this.work.write(Buffer.from(`time=${local}${zone} level=WARN msg="--yaml-fix-merge-anchor-to-spec is false; causing merge anchors to override the existing values which isn't to the yaml spec. This flag will default to true in late 2025. See https://mikefarah.gitbook.io/yq/operators/traverse-read for more details."\n`), true);
          }
          if (this.yaml.isNode(pair.value)) await merge(pair.value);
        }
      } else if (this.yaml.isScalar(pair.key) && this.yaml.isNode(pair.value)) entries.set(String(pair.key.value), this.child(pair.value, base, node, slot));
    }
    return entries;
  }

  async field(input: Candidate, key: string | number | bigint | boolean | null, create: boolean, omitMissing = false): Promise<Candidate[]> {
    let base = dereference(input, this.yaml, this.work);
    if (this.yaml.isScalar(base.node) && base.node.value == null && create) {
      const collection = typeof key === "string" ? new this.yaml.YAMLMap() : new this.yaml.YAMLSeq();
      await replace(base, collection, this.yaml, this.work);
    }
    base = dereference(base, this.yaml, this.work);
    const node = base.node;
    if (this.yaml.isMap(node)) {
      if (key === "<<") for (let slot = node.items.length - 1; slot >= 0; slot--) {
        await this.work.tick();
        const pair = node.items[slot]!;
        if (this.yaml.isScalar(pair.key) && String(pair.key.value) === String(key)) return [this.child(pair.value as Node, base, node, slot)];
      }
      const existing = (await this.entries(base)).get(String(key));
      if (existing) return [existing];
      if (create) {
        this.work.node(2);
        if (!node.items.length) node.flow = false;
        node.items.push(new this.yaml.Pair(new this.yaml.Scalar(key), new this.yaml.Scalar(null)));
        return [this.child(node.items.at(-1)!.value as Node, base, node, node.items.length - 1)];
      }
      return omitMissing ? [] : [this.child(scalar(this.yaml, this.work, null), base)];
    }
    if (this.yaml.isSeq(node)) {
      const text = typeof key === "number" && Number.isInteger(key) ? `${key}.0` : String(key);
      const digits = text[0] === "+" || text[0] === "-" ? text.slice(1) : text;
      const integer = (typeof key === "bigint" || typeof key === "string") && digits.length > 0
        && [...digits].every(character => character >= "0" && character <= "9");
      if (!integer) throw new MikeError(`cannot index array with '${text}' (strconv.ParseInt: parsing ${JSON.stringify(text)}: invalid syntax)`);
      let index = Number(key);
      if (!Number.isSafeInteger(index)) throw new MikeError(`cannot index array with '${String(key)}' (strconv.ParseInt: parsing ${JSON.stringify(String(key))}: invalid syntax)`);
      if (index < 0) index += node.items.length;
      if (index < 0) throw new MikeError(`index [${String(key)}] out of range, array size is ${node.items.length}`);
      if (index >= node.items.length) {
        if (index >= this.work.limits.maxNodes) throw new MikeError("yq limit exceeded: maxNodes");
        if (!node.items.length) node.flow = false;
        while (node.items.length <= index) { node.items.push(scalar(this.yaml, this.work, null)); await this.work.tick(); }
      }
      return [index < node.items.length ? this.child(node.items[index] as Node, base, node, index) : this.child(scalar(this.yaml, this.work, null), base)];
    }
    if (this.yaml.isScalar(node) && node.value == null && (typeof key === "number" || typeof key === "bigint") && key < 0) {
      throw new MikeError(`index [${String(key)}] out of range, array size is 0`);
    }
    return !omitMissing && this.yaml.isScalar(node) && node.value == null ? [this.child(scalar(this.yaml, this.work, null), base)] : [];
  }

  async binary(operator: string, left: Node, right: Node): Promise<Node> {
    await this.work.tick();
    const yaml = this.yaml;
    if (operator === "+" && nodeTag(left, yaml) === "!!null") return cloneNode(right, yaml, this.work);
    if ((operator === "*" || operator === "+") && yaml.isMap(left) && yaml.isMap(right)) {
      const output = await cloneNode(left, yaml, this.work) as YAMLMap;
      for (const pair of right.items) {
        const key = yaml.isScalar(pair.key) ? String(pair.key.value) : "";
        const existing = output.items.find(item => yaml.isScalar(item.key) && String(item.key.value) === key);
        if (existing) existing.value = operator === "*" && yaml.isMap(existing.value) && yaml.isMap(pair.value)
          ? await this.binary("*", existing.value, pair.value) : await cloneNode(pair.value as Node, yaml, this.work);
        else output.items.push(new yaml.Pair(await cloneNode(pair.key as Node, yaml, this.work), await cloneNode(pair.value as Node, yaml, this.work)));
      }
      return output;
    }
    if (operator === "+" && yaml.isSeq(left)) {
      const result = await cloneNode(left, yaml, this.work) as YAMLSeq;
      if (!result.items.length) result.flow = false;
      const members = yaml.isSeq(right) ? right.items : nodeTag(right, yaml) === "!!null" ? [] : [right];
      for (const node of members) result.items.push(await cloneNode(node as Node, yaml, this.work));
      return result;
    }
    if (operator === "==" || operator === "!=") {
      let equal = false;
      if (nodeTag(left, yaml) === "!!null") equal = nodeTag(right, yaml) === "!!null";
      else if (yaml.isScalar(left) && yaml.isScalar(right)) {
        const first = scalarText(left, yaml);
        const second = scalarText(right, yaml);
        equal = await this.match(first, second);
      }
      return scalar(yaml, this.work, operator === "==" ? equal : !equal);
    }
    const first = value(left, yaml);
    const second = value(right, yaml);
    if (operator === "+" && (typeof first === "string" || typeof second === "string")) {
      const text = scalarText(left, yaml) + (typeof first === "string" && second === null ? "" : scalarText(right, yaml));
      const result = scalar(yaml, this.work, text);
      if (yaml.isScalar(result) && yaml.isScalar(left) && left.type !== undefined) result.type = left.type;
      return result;
    }
    if ([">", "<", ">=", "<="].includes(operator)) {
      if (first === null || second === null) return scalar(yaml, this.work, false);
      return scalar(yaml, this.work, operator === ">" ? first > second : operator === "<" ? first < second : operator === ">=" ? first >= second : first <= second);
    }
    if ((typeof first !== "number" && typeof first !== "bigint") || (typeof second !== "number" && typeof second !== "bigint")) throw new MikeError(`cannot ${operator} ${nodeTag(left, yaml)} with ${nodeTag(right, yaml)}`);
    if (typeof first === "bigint" && typeof second === "bigint" && operator !== "/") {
      if (first !== BigInt.asIntN(64, first) || second !== BigInt.asIntN(64, second)) throw new MikeError("integer arithmetic operand is outside int64 range");
      if (operator === "+") {
        const sum = BigInt.asIntN(64, first + second);
        const result = await cloneNode(left, yaml, this.work);
        if (yaml.isScalar(result)) {
          result.value = sum;
          result.source = sum.toString();
          const spelling = scalarText(left, yaml);
          if (spelling.startsWith("0x") || spelling.startsWith("0X")) { result.format = "HEX"; result.source = `0x${sum.toString(16).toUpperCase()}`; }
        }
        return result;
      }
      if (operator === "-") return scalar(yaml, this.work, BigInt.asIntN(64, first - second));
      if (operator === "*") return scalar(yaml, this.work, BigInt.asIntN(64, first * second));
      if (operator === "%" && second !== 0n) return scalar(yaml, this.work, first % second);
    }
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    return scalar(yaml, this.work, operator === "+" ? firstNumber + secondNumber : operator === "-" ? firstNumber - secondNumber : operator === "*" ? firstNumber * secondNumber : operator === "/" ? firstNumber / secondNumber : firstNumber % secondNumber, nodeTag(left, yaml) === "!!float" || nodeTag(right, yaml) === "!!float");
  }

  async run(expression: Expression, inputs: Candidate[], create = false, depth = 0, omitMissing = false): Promise<Candidate[]> {
    this.work.depth(depth);
    await this.work.tick();
    const next = (body: Expression, values = inputs, writable = create, readOnly = omitMissing) => this.run(body, values, writable, depth + 1, readOnly);
    const yaml = this.yaml;
    if (expression.kind === "identity") return inputs;
    if (expression.kind === "group") return next(expression.body);
    if (expression.kind === "literal") return inputs.map(input => this.child(scalar(yaml, this.work, expression.value, typeof expression.value === "number"), input));
    if (expression.kind === "field") {
      const output: Candidate[] = [];
      for (const base of await next(expression.base)) for (const key of await next(expression.key, [base], false)) output.push(...await this.field(base, value(key.node, yaml), create, omitMissing));
      return output;
    }
    if (expression.kind === "slice") {
      const output: Candidate[] = [];
      for (const input of await next(expression.base)) {
        const base = dereference(input, yaml, this.work);
        const index = async (bound: Expression): Promise<bigint> => {
          const matches = await next(bound, [base], false);
          if (matches.length !== 1) throw new MikeError(`expected to find 1 number, got ${matches.length} instead`);
          const text = String(value(matches[0]!.node, yaml));
          if (!/^[+-]?[0-9]+$/u.test(text)) throw new MikeError(`strconv.ParseInt: parsing ${JSON.stringify(text)}: invalid syntax`);
          const result = BigInt(text);
          if (result !== BigInt.asIntN(64, result)) throw new MikeError(`strconv.ParseInt: parsing ${JSON.stringify(text)}: value out of range`);
          return result;
        };
        const start = await index(expression.start);
        const end = await index(expression.end);
        const clamp = (offset: bigint, length: number) => {
          const relative = offset < 0n ? offset + BigInt(length) : offset;
          return relative < 0n ? 0 : relative > BigInt(length) ? length : Number(relative);
        };
        if (yaml.isScalar(base.node) && typeof base.node.value === "string") {
          let length = 0;
          for (const character of base.node.value) { await this.work.tick(character.length); length++; }
          const first = clamp(start, length);
          const last = clamp(end, length);
          const selected: string[] = [];
          let position = 0;
          for (const character of base.node.value) {
            await this.work.tick(character.length);
            if (position >= first && position < last) selected.push(character);
            position++;
          }
          const node = await cloneNode(base.node, yaml, this.work);
          if (yaml.isScalar(node)) { node.value = selected.join(""); node.source = node.value as string; }
          output.push(this.child(node, base));
        } else {
          const members: Node[] = [];
          if (yaml.isSeq(base.node)) for (const member of base.node.items) { await this.work.tick(); members.push(member as Node); }
          else if (yaml.isMap(base.node)) for (const pair of base.node.items) { await this.work.tick(); members.push(pair.key as Node, pair.value as Node); }
          this.work.node();
          const node = new yaml.YAMLSeq();
          if (base.node.tag || !yaml.isSeq(base.node)) node.tag = base.node.tag ?? `tag:yaml.org,2002:${nodeTag(base.node, yaml).slice(2)}`;
          for (let position = clamp(start, members.length); position < clamp(end, members.length); position++) node.items.push(await cloneNode(members[position]!, yaml, this.work));
          output.push(this.child(node, base));
        }
      }
      return output;
    }
    if (expression.kind === "iterate" || expression.kind === "recursive") {
      const output: Candidate[] = [];
      for (const input of inputs) {
        if (expression.kind === "recursive") {
          output.push(input);
          if (yaml.isAlias(input.node)) continue;
        }
        const base = dereference(input, yaml, this.work);
        const children: Candidate[] = [];
        if (yaml.isMap(base.node)) {
          if (expression.kind === "recursive") base.node.items.forEach((pair, slot) => {
            if (expression.includeKeys) children.push(this.child(pair.key as Node, base));
            children.push(this.child(pair.value as Node, base, base.node as YAMLMap, slot));
          });
          else children.push(...(await this.entries(base)).values());
        }
        else if (yaml.isSeq(base.node)) base.node.items.forEach((node, slot) => children.push(this.child(node as Node, base, base.node as YAMLSeq, slot)));
        if (expression.kind === "recursive") for (const child of children) output.push(...await next(expression, [child]));
        else output.push(...children);
      }
      this.work.node(output.length);
      return output;
    }
    if (expression.kind === "pipe") return next(expression.right, await next(expression.left));
    if (expression.kind === "array") {
      if (!inputs.length) return [];
      this.work.node();
      const node = new yaml.YAMLSeq();
      if (expression.body) for (const candidate of await next(expression.body, inputs, false)) node.items.push(await cloneNode(candidate.node, yaml, this.work));
      return [this.child(node, inputs[0]!)];
    }
    if (expression.kind === "object") {
      const output: Candidate[] = [];
      for (const input of inputs) {
        this.work.node();
        const node = new yaml.YAMLMap();
        for (const field of expression.fields) {
          const key = (await next(field.key, [input], false))[0];
          const candidate = (await next(field.value, [input], false))[0];
          if (key && candidate) node.items.push(new yaml.Pair(await cloneNode(key.node, yaml, this.work), await cloneNode(candidate.node, yaml, this.work)));
        }
        if (node.items.length || !expression.fields.length) output.push(this.child(node, input));
      }
      return output;
    }
    if (expression.kind === "binary") {
      const operator = expression.operator;
      if (operator === ",") {
        const left = await next(expression.left);
        const right = await next(expression.right);
        this.work.node(left.length + right.length);
        return [...left, ...right];
      }
      if (["=", "=c", "|=", "+=", "-=", "*=", "/="].includes(operator)) {
        const attribute = expression.left.kind === "pipe" && expression.left.right.kind === "call" && ["tag", "style"].includes(expression.left.right.name) ? expression.left.right.name : undefined;
        const lhs = attribute && expression.left.kind === "pipe" ? expression.left.left : expression.left;
        const targets = await next(lhs, inputs, true);
        const updates = operator === "|=" ? undefined : await next(expression.right, inputs, false, true);
        for (const target of targets) {
          const candidates = updates ?? (await next(expression.right, [target], false)).slice(0, 1);
          for (const candidate of candidates) {
            if (attribute) {
              const text = String(value(candidate.node, yaml));
              if (attribute === "tag") {
                if (!target.node.tag || this.work.implicitTags.has(target.node)) this.work.implicitTags.add(target.node);
                target.node.tag = text.startsWith("!!") ? `tag:yaml.org,2002:${text.slice(2)}` : text;
                if (yaml.isScalar(target.node) && text === "!!str") target.node.value = scalarText(target.node, yaml);
              } else {
                if (!["", "single", "double", "literal", "folded", "flow", "tagged"].includes(text)) throw new MikeError(`unknown style ${text}`);
                if (yaml.isScalar(target.node)) target.node.type = text === "single" ? "QUOTE_SINGLE" : text === "double" ? "QUOTE_DOUBLE" : text === "literal" ? "BLOCK_LITERAL" : text === "folded" ? "BLOCK_FOLDED" : "PLAIN";
                else if (yaml.isCollection(target.node)) target.node.flow = text === "flow";
              }
            } else {
              const updated = operator.length === 2 && operator !== "|=" && operator !== "=c" ? await this.binary(operator[0]!, target.node, candidate.node) : candidate.node;
              await replace(target, updated, yaml, this.work, operator === "=c");
              if (operator === "=c") target.node.tag = `tag:yaml.org,2002:${nodeTag(target.node, yaml).slice(2)}`;
            }
          }
        }
        return inputs.map(input => input.isDocumentRoot ? { ...input, node: input.document.doc.contents! } : input);
      }
      const readOnly = omitMissing || ["+", "==", "!="].includes(operator);
      const left = await next(expression.left, inputs, false, readOnly);
      if (operator === "//") { const matches = left.filter(candidate => truth(candidate.node, yaml)); return matches.length ? matches : next(expression.right, inputs, false); }
      const right = await next(expression.right, inputs, false, readOnly);
      const output: Candidate[] = [];
      if (operator === "+" && (!left.length || !right.length)) return left.length ? left : right;
      if ((operator === "==" || operator === "!=") && inputs.length && (!left.length || !right.length)) {
        const candidates = left.length ? left : right.length ? right : [inputs[0]!];
        for (const candidate of candidates) {
          const equal = !left.length && !right.length || nodeTag(candidate.node, yaml) === "!!null";
          output.push(this.child(scalar(yaml, this.work, operator === "==" ? equal : !equal), candidate));
        }
        return output;
      }
      for (const first of left) for (const second of right) {
        const node = operator === "and" || operator === "or" ? scalar(yaml, this.work, operator === "and" ? truth(first.node, yaml) && truth(second.node, yaml) : truth(first.node, yaml) || truth(second.node, yaml)) : await this.binary(operator, first.node, second.node);
        output.push(this.child(node, first));
      }
      return output;
    }
    if (expression.kind !== "call") throw new MikeError("bad expression, please check expression syntax");
    const output: Candidate[] = [];
    for (const input of inputs) {
      const name = expression.name;
      if (name === "path") {
        this.work.node();
        const node = new yaml.YAMLSeq();
        let candidate = input;
        while (candidate.ancestry) {
          await this.work.tick();
          const { parent, key } = candidate.ancestry;
          node.items.push(typeof key === "number" ? scalar(yaml, this.work, BigInt(key)) : await cloneNode(key, yaml, this.work));
          candidate = parent;
        }
        node.items.reverse();
        output.push(this.child(node, input));
        continue;
      }
      if (name === "head_comment" || name === "anchor" || name === "alias") {
        const node = input.node;
        const text = name === "head_comment" ? this.work.headComments.get(node) ?? ""
          : name === "anchor" ? "anchor" in node ? node.anchor ?? "" : ""
          : yaml.isAlias(node) ? node.source : yaml.isScalar(node) ? scalarText(node, yaml) : "";
        output.push(this.child(scalar(yaml, this.work, text), input));
        continue;
      }
      const base = dereference(input, yaml, this.work);
      if (name === "sort" || name === "sort_by") {
        output.push(this.child(await this.sort(base, expression.args[0] ?? { kind: "identity" }, depth), input)); continue;
      }
      if (name === "reverse") {
        if (!yaml.isSeq(base.node)) throw new MikeError(`cannot reverse ${nodeTag(base.node, yaml)}, can only reverse arrays`);
        const node = await cloneNode(base.node, yaml, this.work) as YAMLSeq;
        await this.work.tick(node.items.length);
        node.items.reverse();
        output.push(this.child(node, input)); continue;
      }
      if (name === "to_entries" || name === "from_entries") {
        if (name === "to_entries" && nodeTag(base.node, yaml) === "!!null") continue;
        output.push(this.child(name === "to_entries" ? await this.toEntries(base) : await this.fromEntries(base), input)); continue;
      }
      if (name === "with_entries") {
        if (nodeTag(base.node, yaml) === "!!null") continue;
        const entries = this.child(await this.toEntries(base), input);
        const transformed = new yaml.YAMLSeq(); this.work.node();
        if (entries.node.commentBefore !== undefined) transformed.commentBefore = entries.node.commentBefore;
        if (entries.node.comment !== undefined) transformed.comment = entries.node.comment;
        for (const entry of await next({ kind: "iterate" }, [entries], false)) {
          for (const candidate of await next(expression.args[0]!, [entry], false)) transformed.items.push(await cloneNode(candidate.node, yaml, this.work));
        }
        const node = await this.fromEntries(this.child(transformed, input));
        output.push(this.child(node, input));
        continue;
      }
      if (name === "pick") {
        if (!yaml.isCollection(base.node)) throw new MikeError("pick only supports maps and arrays");
        for (const selected of await next(expression.args[0]!, [input], false)) {
          const keys = dereference(selected, yaml, this.work);
          if (!yaml.isSeq(keys.node)) throw new MikeError("pick expects an array of keys");
          const node = await cloneNode(base.node, yaml, this.work) as YAMLMap | YAMLSeq;
          node.items = [];
          for (const key of keys.node.items) {
            await this.work.tick();
            const requested = value(key as Node, yaml);
            if (yaml.isMap(base.node) && yaml.isMap(node)) {
              for (const pair of base.node.items) {
                await this.work.tick();
                if (yaml.isScalar(pair.key) && value(pair.key, yaml) === requested) node.items.push(new yaml.Pair(await cloneNode(pair.key, yaml, this.work), await cloneNode(pair.value as Node, yaml, this.work)));
              }
            } else if (yaml.isSeq(base.node) && yaml.isSeq(node)) {
              const index = Number(requested);
              if (Number.isSafeInteger(index) && index >= 0 && index < base.node.items.length) node.items.push(await cloneNode(base.node.items[index] as Node, yaml, this.work));
            }
          }
          output.push(this.child(node, input));
        }
        continue;
      }
      if (name === "upcase" || name === "downcase") {
        const text = value(base.node, yaml);
        if (typeof text !== "string") throw new MikeError(`${name} only supports strings`);
        await this.work.tick(text.length);
        const characters: string[] = [];
        for (const character of text) {
          await this.work.tick(character.length);
          const converted = name === "upcase" ? character.toUpperCase() : character === "İ" ? "i" : character.toLowerCase();
          characters.push([...converted].length === 1 ? converted : character);
        }
        const upper = characters.join("");
        const node = await cloneNode(base.node, yaml, this.work);
        if (Buffer.byteLength(upper) > this.work.limits.maxScalarBytes) throw new MikeError("yq limit exceeded: maxScalarBytes");
        if (yaml.isScalar(node)) { node.value = upper; node.source = upper; }
        output.push(this.child(node, input)); continue;
      }
      if (name === "select") { if (!expression.args[0]) throw new MikeError("bad expression, please check expression syntax"); if ((await next(expression.args[0], [input], false)).some(candidate => truth(candidate.node, yaml))) output.push(input); continue; }
      if (name === "map") {
        const members = await next({ kind: "iterate" }, [input], false);
        const node = new yaml.YAMLSeq(); this.work.node();
        for (const member of members) for (const result of await next(expression.args[0]!, [member], false)) node.items.push(await cloneNode(result.node, yaml, this.work));
        output.push(this.child(node, input)); continue;
      }
      if (name === "del") {
        for (const candidate of (await next(expression.args[0]!, [input], false)).reverse()) if (candidate.parent && candidate.slot !== undefined) candidate.parent.items.splice(candidate.slot, 1);
        output.push(input); continue;
      }
      if (name === "env" || name === "strenv") {
        const key = expression.args[0];
        if (key?.kind !== "literal") throw new MikeError("bad expression, please check expression syntax");
        const text = this.work.context.env[String(key.value)] ?? "";
        if (name === "strenv") output.push(this.child(scalar(yaml, this.work, text), input));
        else { if (!text) throw new MikeError(`value for env variable '${String(key.value)}' not provided in env()`); const docs = await decodeDocuments(text, "<env>", 0, "yaml", yaml, this.work); output.push(this.child(docs[0]!.doc.contents!, input)); }
        continue;
      }
      let result: unknown;
      if (name === "test" || name === "split") {
        if (nodeTag(base.node, yaml) !== "!!str") throw new MikeError(`cannot ${name} ${nodeTag(base.node, yaml)}, can only ${name} strings`);
        const text = String(value(base.node, yaml));
        await this.work.tick(text.length);
        {
          for (const argument of await next(expression.args[0]!, [input], false)) {
            if (nodeTag(argument.node, yaml) !== "!!str") throw new MikeError(`${name} requires a string argument`);
            const pattern = String(value(argument.node, yaml));
            await this.work.tick(pattern.length);
            if (name === "split") {
              const node = new yaml.YAMLSeq(); this.work.node();
              if (!pattern) {
                for (const part of text) { await this.work.tick(); node.items.push(scalar(yaml, this.work, part)); }
              } else {
                let start = 0;
                while (true) {
                  await this.work.tick();
                  const end = text.indexOf(pattern, start);
                  node.items.push(scalar(yaml, this.work, text.slice(start, end < 0 ? text.length : end)));
                  if (end < 0) break;
                  start = end + pattern.length;
                }
              }
              output.push(this.child(node, input));
            } else {
              // The bounded grammar shares Go's ASCII ERE subset. Bracket
              // escapes have different meanings in POSIX and Go; conservatively
              // refuse patterns combining brackets and escapes.
              if (pattern.includes("[") && pattern.includes("\\")) throw new MikeError("unsupported yq regex: brackets combined with escapes");
              const ledger = this.#regex ??= new EreLedger({ maxExpansionBytes: this.work.limits.maxScalarBytes, maxExpansionFields: this.work.limits.maxNodes });
              const before = ledger.usage.work;
              try {
                const program = await compileEre(pattern, ledger, this.work.signal);
                const subject = await prepareUtf8EreSubject(Buffer.from(text), ledger, this.work.signal, true);
                const matched = await subject(program)(0);
                output.push(this.child(scalar(yaml, this.work, matched !== undefined), input));
              } catch (error) {
                this.work.assertOpen();
                if (error instanceof EreSyntaxError || error instanceof EreUnsupportedError || error instanceof EreProfileLimitError) throw new MikeError(error.message);
                throw error;
              } finally { await this.work.tick(ledger.usage.work - before); }
            }
          }
          continue;
        }
      }
      else if (name === "tag" || name === "type") result = nodeTag(base.node, yaml);
      else if (name === "kind") result = yaml.isMap(base.node) ? "map" : yaml.isSeq(base.node) ? "seq" : "scalar";
      else if (name === "documentIndex" || name === "document_index" || name === "di") result = BigInt(input.document.documentIndex);
      else if (name === "fileIndex" || name === "file_index" || name === "fi") result = BigInt(input.document.fileIndex);
      else if (name === "filename") result = input.document.filename;
      else if (name === "not") result = !truth(base.node, yaml);
      else if (name === "length") {
        let length = yaml.isCollection(base.node) ? base.node.items.length : 0;
        if (yaml.isScalar(base.node) && nodeTag(base.node, yaml) !== "!!null") {
          const text = scalarText(base.node, yaml);
          await this.work.tick(text.length);
          length = Buffer.byteLength(text);
        }
        result = BigInt(length);
      }
      else if (name === "has") {
        const key = (await next(expression.args[0]!, [input], false))[0]!;
        const keyNode = dereference(key, yaml, this.work).node;
        result = yaml.isMap(base.node) ? base.node.items.some(pair => yaml.isScalar(pair.key) && String(pair.key.value) === String(value(key.node, yaml))) : yaml.isSeq(base.node) && nodeTag(keyNode, yaml) === "!!int" && Number(value(keyNode, yaml)) < base.node.items.length;
      } else if (name === "keys") {
        const node = new yaml.YAMLSeq(); this.work.node();
        if (yaml.isMap(base.node)) for (const pair of base.node.items) {
          const key = await cloneNode(pair.key as Node, yaml, this.work);
          delete key.commentBefore;
          node.items.push(key);
        }
        else if (yaml.isSeq(base.node)) base.node.items.forEach((_, index) => node.items.push(scalar(yaml, this.work, BigInt(index))));
        output.push(this.child(node, input)); continue;
      } else if (name === "style") result = yaml.isScalar(base.node) ? base.node.type === "QUOTE_SINGLE" ? "single" : base.node.type === "QUOTE_DOUBLE" ? "double" : base.node.type === "BLOCK_FOLDED" ? "folded" : base.node.type === "BLOCK_LITERAL" ? "literal" : "" : yaml.isCollection(base.node) && base.node.flow ? "flow" : "";
      output.push(this.child(scalar(yaml, this.work, result), input));
    }
    return output;
  }
}
