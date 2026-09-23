import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";

const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Original Gnumeric1.12.61 Perl scalar outputs and CLEAN results; receipts in docs/ssconvert.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-9-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-119-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-141-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-152-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-174-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-196-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-240-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-273-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-284-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-317-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-328-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expected": "$1\\n1\\nb1\\n$1\\n"
  },
  {
    "id": "expanded-493-controls",
    "inputHex": "0724315c6ec324315c6ea462c324315c6ea924315c6e0d",
    "expected": "$1\\n1\\nb1\\n$1\\n"
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "expanded-603-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expected": "$1\\n1\\n$1\\nb$1\\n1\\n$1\\n"
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "capture-71-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "capture-83-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258",
    "expected": "XXbX"
  },
  {
    "id": "behind-220-controls",
    "inputHex": "0758c358a45862580d",
    "expected": "XXbX"
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "named-119-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "named-134-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-251-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-269-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expected": "$1\\n1\\na$1\\n1\\na$1\\n"
  },
  {
    "id": "atomic-323-controls",
    "inputHex": "0724315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e0d",
    "expected": "$1\\n1\\na$1\\n1\\na$1\\n"
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-503-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expected": "$1\\n1\\n$1\\n$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "atomic-521-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n\u00e4$1\\na$1\\n"
  },
  {
    "id": "variable-behind-527-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n\u00e4$1\\na$1\\n"
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-15-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0",
    "expected": "$1\\n"
  },
  {
    "id": "escape-32-controls",
    "inputHex": "0724315c6ea00d",
    "expected": "$1\\n"
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-48-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85",
    "expected": "$1\\n"
  },
  {
    "id": "escape-65-controls",
    "inputHex": "0724315c6e850d",
    "expected": "$1\\n"
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-82-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-99-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-168-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0",
    "expected": "$1\\n"
  },
  {
    "id": "escape-185-controls",
    "inputHex": "0724315c6ea00d",
    "expected": "$1\\n"
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e",
    "expected": "1\\n"
  },
  {
    "id": "escape-201-controls",
    "inputHex": "07c224315c6e0d",
    "expected": "1\\n"
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85",
    "expected": "$1\\n"
  },
  {
    "id": "escape-218-controls",
    "inputHex": "0724315c6e850d",
    "expected": "$1\\n"
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "escape-472-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expected": "$1\\n1\\n$1\\na$1\\n1\\n$1\\na$1\\n"
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e",
    "expected": "$1\\n1\\n$1\\n"
  },
  {
    "id": "escape-473-controls",
    "inputHex": "0724315c6ec224315c6e8524315c6e0d",
    "expected": "$1\\n1\\n$1\\n"
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expected": "$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "escape-474-controls",
    "inputHex": "0724315c6ec224315c6e24315c6e24315c6e0d",
    "expected": "$1\\n1\\n$1\\n$1\\n"
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expected": "$1\\n\\n$1\\n$1\\n"
  },
  {
    "id": "escape-475-controls",
    "inputHex": "0724315c6ee224315c6e8024315c6ea824315c6e0d",
    "expected": "$1\\n\\n$1\\n$1\\n"
  }
];
it.each(native)("CLEAN matches native raw byte cursor $id", ({ inputHex, expected }) => {
  expect(textFunctions.CLEAN!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual({ kind: "string", value: expected });
});
it("CLEAN admits output bytes and cooperates during traversal", () => {
  expect(() => textFunctions.CLEAN!([{ kind: "string", value: "é" }], { ...host, context: { ...host.context, limits: { ...host.context.limits, outputBytes: 1 } } })).toThrow("text limit");
  let work = 0;
  expect(() => textFunctions.CLEAN!([{ kind: "string", value: "a".repeat(100) }], { ...host, tick() { if (++work === 130) throw false; } })).toThrow();
  expect(work).toBe(130);
});
it("CLEAN ignores invisible host text and rejects visible malformed UTF16", () => {
  expect(textFunctions.CLEAN!([{ kind: "string", value: "a\0\ud800" }], host)).toEqual({ kind: "string", value: "a" });
  expect(() => textFunctions.CLEAN!([{ kind: "string", value: "\ud800" }], host)).toThrow("text byte representation");
});

// Unmodified native CLEAN loop with GLib2.90.0 and owned zero padding.
const raw = [
  {
    "inputHex": "",
    "expectedHex": ""
  },
  {
    "inputHex": "09",
    "expectedHex": ""
  },
  {
    "inputHex": "070d",
    "expectedHex": ""
  },
  {
    "inputHex": "202061202020622020",
    "expectedHex": "202061202020622020"
  },
  {
    "inputHex": "c0a0",
    "expectedHex": "20"
  },
  {
    "inputHex": "c0a020c0a0",
    "expectedHex": "202020"
  },
  {
    "inputHex": "c181",
    "expectedHex": "41"
  },
  {
    "inputHex": "e08080",
    "expectedHex": ""
  },
  {
    "inputHex": "e0808041",
    "expectedHex": "41"
  },
  {
    "inputHex": "eda080",
    "expectedHex": ""
  },
  {
    "inputHex": "f888808081",
    "expectedHex": ""
  },
  {
    "inputHex": "fdbfbfbfbfbf",
    "expectedHex": ""
  },
  {
    "inputHex": "80",
    "expectedHex": ""
  },
  {
    "inputHex": "c3",
    "expectedHex": ""
  },
  {
    "inputHex": "c341",
    "expectedHex": ""
  },
  {
    "inputHex": "c32041",
    "expectedHex": "41"
  },
  {
    "inputHex": "fe",
    "expectedHex": ""
  },
  {
    "inputHex": "ff",
    "expectedHex": ""
  },
  {
    "inputHex": "41c3",
    "expectedHex": "41"
  },
  {
    "inputHex": "c2a0",
    "expectedHex": "c2a0"
  },
  {
    "inputHex": "41c2a0202042",
    "expectedHex": "41c2a0202042"
  },
  {
    "inputHex": "c2ad",
    "expectedHex": ""
  },
  {
    "inputHex": "e2808b",
    "expectedHex": ""
  },
  {
    "inputHex": "e280a8",
    "expectedHex": "e280a8"
  },
  {
    "inputHex": "efbfbd",
    "expectedHex": "efbfbd"
  },
  {
    "inputHex": "efbfbf",
    "expectedHex": ""
  },
  {
    "inputHex": "f09f9880",
    "expectedHex": "f09f9880"
  },
  {
    "inputHex": "f48fbfbf",
    "expectedHex": ""
  },
  {
    "inputHex": "c2a041",
    "expectedHex": "c2a041"
  },
  {
    "inputHex": "c0af",
    "expectedHex": "2f"
  },
  {
    "inputHex": "e080af",
    "expectedHex": "2f"
  },
  {
    "inputHex": "e0808141",
    "expectedHex": "41"
  },
  {
    "inputHex": "e19ab041",
    "expectedHex": "e19ab041"
  },
  {
    "inputHex": "efbbbfff41",
    "expectedHex": "41"
  },
  {
    "inputHex": "f0908080",
    "expectedHex": "f0908080"
  }
];
it.each(raw)("CLEAN matches native historical/control chunk $inputHex", ({ inputHex, expectedHex }) => {
  expect(textFunctions.CLEAN!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual(byteStringValue(bytes(expectedHex), () => {}, 1000000));
});
