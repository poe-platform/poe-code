import { expect, it } from "vitest";
import { STANDARD_FONT_CFF_BASE64 } from "./standard-font-data.js";
import { parseEmbeddedCffFont } from "./cff.js";
import { parseStoredCffFont } from "./stored-cff.js";

it.each([false,true])("matches native encoded glyph outlines with asynchronous remapping=%s", async remap => {
  for (const [name, encoded] of Object.entries(STANDARD_FONT_CFF_BASE64)) {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0)),
      data = new Uint8Array(16 * 1024 * 1024);
    data.set(bytes);
    let end = bytes.length;
    const storage = {
      allocate(n: number) {
        const at = end;
        end += n;
        if (end > data.length) throw Error("fixture capacity");
        return at;
      },
      async read(at: number, n: number) {
        expect(n).toBeLessThanOrEqual(4096);
        return data.slice(at, at + n);
      },
      async write(at: number, value: Uint8Array) {
        expect(value.length).toBeLessThanOrEqual(4096);
        data.set(value, at);
      }
    };
    const differences = new Map<number,string>(remap ? [[65,"B"],[66,"fi"]] : []);
    const native = parseEmbeddedCffFont(bytes, "WinAnsiEncoding", differences);
    const backed = await parseStoredCffFont(
      { storage, position: 0, byteLength: bytes.length },
      "WinAnsiEncoding",
      {async get(code){return differences.get(code);}}
    );
    expect(backed.unicodeByCode, name).toEqual(native.unicodeByCode);
    for (const code of [0, 32, 65, 66, 97, 198, 233]) {
      const actual = [];
      for await (const segment of backed.glyphSegments(code)) actual.push(segment);
      expect(actual, `${name}:${code}`).toEqual(native.getGlyphOutline(code));
    }
  }
});

it("preserves source-read failures and timer cancellation during long header scans", async () => {
  const reason = new Error("cancelled font"),
    controller = new AbortController();
  const bytes = new Uint8Array(131072);
  let end = 32768;
  const storage = {
    allocate(n: number) {
      const at = end;
      end += n;
      return at;
    },
    async read(at: number, n: number) {
      return bytes.slice(at, at + n);
    },
    async write(at: number, data: Uint8Array) {
      bytes.set(data, at);
    }
  };
  const timer = setTimeout(() => controller.abort(reason), 0);
  try {
    await expect(
      parseStoredCffFont({ storage, position: 0, byteLength: 32768 }, undefined, new Map(), {
        signal: controller.signal
      })
    ).rejects.toBe(reason);
  } finally {
    clearTimeout(timer);
  }
  await expect(
    parseStoredCffFont(
      {
        storage: {
          ...storage,
          async read() {
            throw reason;
          }
        },
        position: 0,
        byteLength: 100
      },
      undefined,
      new Map()
    )
  ).rejects.toBe(reason);
});
