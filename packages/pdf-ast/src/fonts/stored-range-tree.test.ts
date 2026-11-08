import { expect, it } from "vitest";
import { StoredNumberRangeTree } from "./stored-range-tree.js";
import { StoredType1Encoding } from "./stored-type1-encoding.js";
import { StoredType1Token } from "./stored-type1-lexer.js";

it.each(["read", "write", "encoding"])(
  "propagates cancellation from the final %s capability call",
  async (mode) => {
    const controller = new AbortController(),
      reason = new Error("backing cancelled"),
      data = new Uint8Array(8192);
    let end = 0,
      armed = false;
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        return at;
      },
      async read(at: number, n: number) {
        if (armed && (mode === "read" || (mode === "encoding" && n === 16)))
          controller.abort(reason);
        return data.slice(at, at + n);
      },
      async write(at: number, bytes: Uint8Array) {
        data.set(bytes, at);
        if (armed && mode === "write") controller.abort(reason);
      }
    };
    const tree = new StoredNumberRangeTree(storage, controller.signal);
    const source = {
      length: 1,
      async byte() {
        return 65;
      },
      async int() {
        return 65;
      }
    };
    const encoding = new StoredType1Encoding(source, storage, controller.signal);
    if (mode === "encoding") await encoding.set(65, new StoredType1Token(source, 0, 1));
    else await tree.assign(0, 0xffffffff, 7);
    armed = true;
    await expect(
      mode === "read"
        ? tree.lookup(65)
        : mode === "write"
          ? tree.assign(0, 0xffffffff, 8)
          : encoding.get(65)
    ).rejects.toBe(reason);
  }
);
