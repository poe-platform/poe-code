import type {PagedStorage} from "@poe-code/safe-fs/storage";
import type {BackedJson} from "./backed-json.js";

/** A fixed-depth radix index in separate caller storage. The tree tape must stay
 * contiguous while containers are open. Hash collisions compare stored code
 * units, so neither correctness nor memory bounds depend on collision freedom. */
class Keys {
  private readonly root: number;
  constructor(private readonly storage: PagedStorage, private readonly tree: BackedJson, private readonly cooperate: (units?: number) => Promise<void>) {
    this.root = storage.allocate(128);
  }
  private async pointer(position: number): Promise<number> {
    const bytes = await this.storage.read(position, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  private async put(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(position, bytes);
  }
  async add(hash: number, parent: number, key: number): Promise<boolean> {
    let slot = this.root;
    for (let shift = 28; shift >= 0; shift -= 4) {
      await this.cooperate();
      slot += (hash >>> shift & 15) * 8;
      if (!shift) break;
      let next = await this.pointer(slot);
      if (!next) {next = this.storage.allocate(128); await this.put(slot, next);}
      slot = next;
    }
    const head = await this.pointer(slot);
    for (let record = head; record; record = await this.pointer(record + 16)) {
      await this.cooperate();
      if (await this.pointer(record + 8) === parent && await this.tree.equalText(await this.pointer(record), key)) return false;
    }
    const record = this.storage.allocate(24);
    await this.put(record, key); await this.put(record + 8, parent); await this.put(record + 16, head);
    await this.put(slot, record);
    return true;
  }
}

type Mode = "value" | "arrayFirst" | "keyFirst" | "key" | "colon" | "separator" | "done";
type NumberState = "start" | "minus" | "zero" | "int" | "dot" | "frac" | "exp" | "expSign" | "expDigits";

/** JSON syntax and duplicate-key validation over streamed UTF-16 fragments.
 * Numeric spellings stay on tape; format-specific range/rounding validation is
 * separate. Both nesting state and the key index live in caller storage. */
export async function parseBackedJson(
  chunks: AsyncIterable<string>, tree: BackedJson, index: PagedStorage,
  cooperate: (units?: number) => Promise<void>, error: (offset: number, message: string, tokenOffset?: number) => never,
  validateNumber?: (node: number, offset: number) => Promise<void>, allowDuplicateKeys = false, checkDepth?: (depth: number, container?: boolean) => void, node?: (kind: "object" | "array" | "key" | "scalar", complete?: boolean) => void, reference?: () => void, retained?: (bytes: number) => void
): Promise<void> {
  let depth = 0, valueAtEof = true, edgePending = false, stringUnits = 0;
  checkDepth?.(depth);
  const edge = () => {reference?.(); retained?.(16);};
  const keys = new Keys(index, tree, cooperate);
  let mode: Mode = "value", token: "string" | "number" | "keyword" | undefined;
  let position = 0, offset = 0, work = 0, buffer = "", tokenOffset = 0;
  let isKey = false, keyParent = 0, keyPosition = 0, keyOffset = 0, hash = 0;
  let escape = false, hex = 0, code = 0, keyword = "", keywordIndex = 0;
  let number: NumberState = "start", numberOffset = 0;
  const digit = (char: string) => char >= "0" && char <= "9";
  const flush = async () => {if (buffer) {await tree.text(buffer); buffer = "";}};
  const add = (char: string) => {
    if (token === "string") {retained?.(2); if (stringUnits++ % 2048 === 0) reference?.();}
    buffer += char;
    if (isKey) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return buffer.length >= 4096;
  };
  const end = async (): Promise<Mode> => {
    await flush();
    if (token === "string") retained?.(stringUnits * 2);
    if (token) node?.(isKey ? "key" : "scalar", true);
    if (!token) depth--;
    position = await tree.end();
    token = undefined; stringUnits = 0;
    return position ? "separator" : "done";
  };
  const endNumber = async (): Promise<Mode> => {
    if (!["zero", "int", "frac", "expDigits"].includes(number)) error(offset, "Incomplete JSON number", tokenOffset);
    retained?.((offset - numberOffset) * 2);
    const node = position;
    const mode = await end();
    await validateNumber?.(node, numberOffset);
    return mode;
  };
  const numeric = (char: string): boolean => {
    switch (number) {
      case "start":
        if (char === "-") {number = "minus"; return true;}
        if (digit(char)) {number = char === "0" ? "zero" : "int"; return true;}
        return false;
      case "minus":
        if (digit(char)) {number = char === "0" ? "zero" : "int"; return true;}
        return false;
      case "zero": case "int": case "frac":
        if (number !== "zero" && digit(char)) return true;
        if (number !== "frac" && char === ".") {number = "dot"; return true;}
        if (char === "e" || char === "E") {number = "exp"; return true;}
        return false;
      case "dot":
        if (digit(char)) {number = "frac"; return true;}
        return false;
      case "exp":
        if (char === "+" || char === "-") {number = "expSign"; return true;}
        if (digit(char)) {number = "expDigits"; return true;}
        return false;
      case "expSign":
        if (digit(char)) {number = "expDigits"; return true;}
        return false;
      case "expDigits": return digit(char);
    }
  };
  for await (const chunk of chunks) {
    for (let cursor = 0; cursor < chunk.length; cursor++, offset++) {
      if (++work === 256) {await cooperate(work); work = 0;}
      const char = chunk[cursor]!;
      let consumed = false;
      while (!consumed) {
        consumed = true;
        if (token === "string") {
          if (hex) {
            const value = "0123456789abcdef".indexOf(char.toLowerCase());
            if (value < 0) error(offset, "Invalid JSON Unicode escape", tokenOffset);
            code = code * 16 + value;
            if (!--hex && add(String.fromCharCode(code))) await flush();
          } else if (escape) {
            escape = false;
            if (char === "u") {hex = 4; code = 0;}
            else {
              const escapes: Readonly<Record<string, string>> = {'"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t"};
              if (!Object.hasOwn(escapes, char)) error(offset, "Invalid JSON escape", tokenOffset);
              if (add(escapes[char]!)) await flush();
            }
          } else if (char === '"') {
            mode = await end();
            if (isKey) {
              if (!allowDuplicateKeys && !await keys.add(hash, keyParent, keyPosition)) error(keyOffset, "Duplicate object key");
              mode = "colon";
              isKey = false;
            }
          } else if (char === "\\") escape = true;
          else {
            if (char.charCodeAt(0) < 32) error(offset, "Invalid JSON string control", tokenOffset);
            if (add(char)) await flush();
          }
          continue;
        }
        if (token === "number") {
          if (numeric(char)) {if (add(char)) await flush();}
          else {mode = await endNumber(); consumed = false;}
          continue;
        }
        if (token === "keyword") {
          if (char !== keyword[keywordIndex++]) error(offset, "Invalid JSON literal", tokenOffset);
          add(char);
          if (keywordIndex === keyword.length) mode = await end();
          continue;
        }
        if (edgePending) {edge(); edgePending = false;}
        if (char === " " || char === "\t" || char === "\r" || char === "\n") {if (mode === "value") valueAtEof = true; continue;}
        if (mode === "done") error(offset, "Unexpected trailing JSON");
        if (mode === "separator") {
          const parent = await tree.describe(position);
          if (char === (parent.kind === "array" ? "]" : "}")) mode = await end();
          else if (char === ",") {mode = parent.kind === "array" ? "value" : "key"; valueAtEof = false; edgePending = parent.kind === "array";}
          else error(offset, "Expected JSON comma");
          continue;
        }
        if (mode === "colon") {
          if (char !== ":") error(offset, "Expected JSON colon");
          mode = "value"; valueAtEof = true;
          edge();
          checkDepth?.(depth);
          continue;
        }
        if (mode === "arrayFirst") {
          if (char === "]") {mode = await end(); continue;}
          mode = "value"; edge();
        }
        if (mode === "keyFirst" && char === "}") {mode = await end(); continue;}
        if (mode === "keyFirst" || mode === "key") {
          if (char !== '"') error(offset, "Expected JSON property");
          keyParent = position;
          keyOffset = offset;
          hash = 2166136261;
          for (const char of String(keyParent)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
          node?.("key");
          position = keyPosition = await tree.begin("key");
          isKey = true;
          token = "string"; tokenOffset = offset;
          continue;
        }
        checkDepth?.(depth);
        node?.(char === "{" ? "object" : char === "[" ? "array" : "scalar");
        if (char === "{" || char === "[") {
          depth++;
          checkDepth?.(depth, true);
          position = await tree.begin(char === "{" ? "object" : "array");
          mode = char === "{" ? "keyFirst" : "arrayFirst";
        } else if (char === '"') {position = await tree.begin("string"); token = "string"; tokenOffset = offset;}
        else if (char === "-" || digit(char)) {
          position = await tree.begin("literal"); token = "number"; number = "start"; numberOffset = tokenOffset = offset; consumed = false;
        } else if (char === "t" || char === "f" || char === "n") {
          position = await tree.begin("literal"); token = "keyword"; tokenOffset = offset; keywordIndex = 0;
          keyword = char === "t" ? "true" : char === "f" ? "false" : "null";
          consumed = false;
        } else error(offset, "Expected JSON value");
      }
    }
  }
  if (!token && mode === "value" && valueAtEof) node?.("scalar");
  if (token === "number") mode = await endNumber();
  if (token || mode !== "done") error(offset, !token && mode === "separator" ? "Expected JSON comma" : "Incomplete JSON value", token ? tokenOffset : undefined);
  if (work) await cooperate(work);
}
