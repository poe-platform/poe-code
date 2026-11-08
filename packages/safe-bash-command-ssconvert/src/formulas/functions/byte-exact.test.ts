import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";

const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const value = (hex: string) => byteStringValue(Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16)), () => {}, 1000000);
// Captured actual Gnumeric1.12.61/GLib2.90/Perl C-locale EXACT fields.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      true,
      false,
      false,
      false,
      false,
      false
    ]
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expected": [
      true,
      false,
      true,
      false,
      false,
      true
    ]
  }
];
const first = native[0]!.inputHex;
const contexts = [
  (s: string) => [s, s], (s: string) => [s, "58"], (s: string) => [s, first],
  (s: string) => [s, s + "78"], (s: string) => ["61" + s, "62" + s],
  (s: string) => ["61" + s, "61" + first]
];
it.each(native.flatMap(row => contexts.map((context, index) => ({ ...row, index, operands: context(row.inputHex), result: row.expected[index] }))))("EXACT matches captured native $id context $index", ({ operands, result }) => {
  expect(textFunctions.EXACT!(operands.map(hex => value(hex!)), host)).toEqual({ kind: "boolean", value: result });
});
it.each([
  ["c3", "80", true], ["41c3", "42c3", false], ["41c3", "4180", true],
  ["c3", "c341", false], ["c3", "41", false], ["c380", "c3", false],
  ["eda080", "e08080", false], ["c3", "c3", true], ["c181", "41", true], ["eda080", "c3", false], ["e08080", "c3", false], ["f888808081", "c3", false], ["fdbfbfbfbfbf", "c3", false], ["c385", "41cc8a", true],
  ["e284ab", "41cc8a", true], ["efac80", "6666", false], ["", "c3", false]
] as const)("EXACT retains native prefix/normalization behavior %s/%s", (left, right, expected) => {
  expect(textFunctions.EXACT!([value(left), value(right)], host)).toEqual({ kind: "boolean", value: expected });
});
it("EXACT cooperates after admitting both source operands", () => {
  let work = 0;
  expect(() => textFunctions.EXACT!([{ kind: "string", value: "A".repeat(100) }, { kind: "string", value: "A".repeat(100) }], { ...host, tick() { if (++work === 220) throw false; } })).toThrow();
  expect(work).toBe(220);
});
it("EXACT ignores native NUL tails and rejects malformed visible host text", () => {
  expect(textFunctions.EXACT!([{ kind: "string", value: "a\0\ud800" }, { kind: "string", value: "a" }], host)).toEqual({ kind: "boolean", value: true });
  expect(() => textFunctions.EXACT!([{ kind: "string", value: "\ud800" }, { kind: "string", value: "" }], host)).toThrow("text byte representation");
});
