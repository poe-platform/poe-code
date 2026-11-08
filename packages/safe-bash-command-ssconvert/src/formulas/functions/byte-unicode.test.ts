import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";

const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Actual activated Gnumeric1.12.61/GLib2.90/Perl captured fields; source and diagnostic receipts in docs/ssconvert.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": 36
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258",
    "expected": 88
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": 36
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": 36
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expected": 36
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": 36
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0",
    "expected": 36
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85",
    "expected": 36
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0",
    "expected": 36
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e",
    "expected": -1
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85",
    "expected": 36
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": 36
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e",
    "expected": 36
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expected": 36
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expected": 36
  }
];
it.each(native)("UNICODE matches captured native byte result $id", ({ inputHex, expected }) => {
  expect(textFunctions.UNICODE!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual({ kind: "number", value: expected });
});
it.each([
  ["c3", -1], ["80", -1], ["eda080", 55296], ["e08080", 0],
  ["f888808081", 2097153], ["fdbfbfbfbfbf", 2147483647], ["fe", -1], ["ff", -1]
] as const)("UNICODE retains nonvalidating owned GLib point %s", (inputHex, expected) => {
  expect(textFunctions.UNICODE!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual({ kind: "number", value: expected });
});
it("UNICODE handles empty text and native NUL prefix", () => {
  expect(textFunctions.UNICODE!([{ kind: "string", value: "" }], host)).toEqual({ kind: "error", value: "#VALUE!" });
  expect(textFunctions.UNICODE!([{ kind: "string", value: "\0tail" }], host)).toEqual({ kind: "error", value: "#VALUE!" });
  expect(textFunctions.UNICODE!([{ kind: "string", value: "A\0\ud800" }], host)).toEqual({ kind: "number", value: 65 });
});
it("UNICODE cooperates during byte admission", () => {
  let work = 0;
  expect(() => textFunctions.UNICODE!([{ kind: "byte-string", value: "c3" + "41".repeat(100) }], { ...host, tick() { if (++work === 7) throw false; } })).toThrow();
  expect(work).toBe(7);
});
