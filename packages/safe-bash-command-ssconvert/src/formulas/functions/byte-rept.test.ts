import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";

const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Captured Gnumeric1.12.61 Perl scalar bytes; native REPT receipts retained in docs/ssconvert.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e"
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e"
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258"
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e"
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e"
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e"
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e"
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e"
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0"
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85"
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0"
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e"
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85"
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e"
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e"
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e"
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e"
  }
];
for (const count of [0, 1, 2, 3, 1.5, -1]) {
  it.each(native)(`REPT matches native raw bytes $id at count ${count}`, ({ inputHex }) => {
    expect(textFunctions.REPT!([byteStringValue(bytes(inputHex), () => {}, 1000000), { kind: "number", value: count }], host))
      .toEqual(count < 0 ? { kind: "error", value: "#VALUE!" } : byteStringValue(bytes(inputHex.repeat(Math.trunc(count))), () => {}, 1000000));
  });
}
it("REPT rejects before allocating an over-budget byte result", () => {
  const bounded = { ...host, context: { ...host.context, limits: { ...host.context.limits, outputBytes: 5 } } };
  expect(() => textFunctions.REPT!([{ kind: "byte-string", value: "fffe" }, { kind: "number", value: 3 }], bounded)).toThrow("calculation text limit exceeded");
  expect(textFunctions.REPT!([{ kind: "byte-string", value: "fffe" }, { kind: "number", value: 2 }], bounded))
    .toEqual({ kind: "byte-string", value: "fffefffe" });
});
it("REPT cooperates during raw result copying and preserves false cancellation", () => {
  let ticks = 0;
  const cancelled = { ...host, tick() { if (++ticks === 5) throw false; } };
  let observed: unknown = "not-cancelled";
  try { textFunctions.REPT!([{ kind: "byte-string", value: "ff" }, { kind: "number", value: 100 }], cancelled); }
  catch (reason) { observed = reason; }
  expect(observed).toBe(false);
  expect(ticks).toBe(5);
});
it("REPT uses native integer byte overflow division before output admission", () => {
  expect(textFunctions.REPT!([{ kind: "string", value: "abc" }, { kind: "number", value: Math.trunc(2147483647 / 3) }], host))
    .toEqual({ kind: "error", value: "#VALUE!" });
});
it("REPT keeps empty huge counts, fractional truncation, NUL and host-text refusal", () => {
  expect(textFunctions.REPT!([{ kind: "string", value: "" }, { kind: "number", value: 2 ** 40 }], host)).toEqual({ kind: "string", value: "" });
  expect(textFunctions.REPT!([{ kind: "string", value: "é\0tail" }, { kind: "number", value: 2.5 }], host)).toEqual({ kind: "string", value: "éé" });
  expect(() => textFunctions.REPT!([{ kind: "string", value: "\ud800" }, { kind: "number", value: 1 }], host)).toThrow();
});
