import {PandocError} from "./errors.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

/** Streaming operations over retained Lua binary strings. */
export class LuaStrings {
  constructor(private readonly heap: LuaStorage) {}

  async concat(values: AsyncIterable<StoredLuaValue>): Promise<LuaReference> {
    const heap = this.heap;
    return heap.string((async function* () {
      const encoder = new TextEncoder();
      for await (const value of values) {
        if (typeof value === "object" && value.kind === "string") yield* heap.bytes(value);
        else if (typeof value === "object" && value.kind === "integer") yield encoder.encode(String(value.value));
        else if (typeof value === "number") {
          // Match Fengari's 14-significant-digit float formatting, including
          // the .0 suffix that distinguishes integral floats from integers.
          let text = String(Number(value.toPrecision(14))), integerText = true;
          for (const char of text) if (char !== "-" && (char < "0" || char > "9")) integerText = false;
          if (integerText) text += ".0";
          yield encoder.encode(text);
        } else throw new PandocError("E_AST", "convert", "Expected Lua string or number for concatenation");
      }
    })());
  }
  private async *collation(value: LuaReference): AsyncGenerator<Uint8Array> {
    // Preserve the existing engine's unpadded hexadecimal collation, including
    // control bytes. Materializing its hash string would scale with the input.
    for await (const bytes of this.heap.bytes(value)) {
      const digits = new Uint8Array(bytes.length * 2);
      let length = 0;
      for (const byte of bytes) {
        if (byte >= 16) digits[length++] = byte >>> 4;
        digits[length++] = byte & 15;
      }
      yield digits.subarray(0, length);
    }
  }
  async compare(left: LuaReference, right: LuaReference): Promise<number> {
    const first = this.collation(left), second = this.collation(right);
    try {
      let a = await first.next(), b = await second.next(), x = 0, y = 0;
      while (!a.done && !b.done) {
        const count = Math.min(a.value.length - x, b.value.length - y);
        for (let i = 0; i < count; i++) {
          const difference = a.value[x + i]! - b.value[y + i]!;
          if (difference) return Math.sign(difference);
        }
        x += count; y += count;
        if (x === a.value.length) {a = await first.next(); x = 0;}
        if (y === b.value.length) {b = await second.next(); y = 0;}
      }
      return a.done ? b.done ? 0 : -1 : 1;
    } finally {await first.return(undefined); await second.return(undefined);}
  }
}
