import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";
import type { CellValue } from "../../workbook.js";
const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
const value = (hex: string) => byteStringValue(bytes(hex), () => {}, 1000000);
const string = (value: string): CellValue => ({ kind: "string", value });
const number = (value: number): CellValue => ({ kind: "number", value });
// Eight raw-byte SUBSTITUTE projections captured from Gnumeric1.12.61.
const native = [
  {
    "id": "expanded-9",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-119",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-141",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-152",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-174",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-196",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-240",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-273",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-284",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-317",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-328",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-493",
    "sourceHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a462c3c3a9a9c3a9",
      "c3a9c3c3a9a462c3c3a9a9c3a9",
      "c3a9c324315c6ea462c324315c6ea924315c6e",
      "24315c6ec3c3a9a462c324315c6ea924315c6e",
      "24315c6ec324315c6ea462c324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea462c324315c6ea924315c6e6124315c6ec324315c6ea462c324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "expanded-603",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c3c3a9a4c3a962c3a9c3c3a9a9c3a9",
      "c3a9c324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec3c3a9a424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      ""
    ]
  },
  {
    "id": "capture-71",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "capture-83",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "behind-220",
    "sourceHex": "58c358a4586258",
    "expectedHex": [
      "58c358a4586258",
      "58c358a4586258",
      "58c358a4586258",
      "58c358a4586258",
      "58c358a4586258",
      "58",
      "6158c358a45862586158c358a4586258",
      ""
    ]
  },
  {
    "id": "named-119",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "named-134",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "atomic-251",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec3c3a9a424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      ""
    ]
  },
  {
    "id": "atomic-269",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec3c3a9a424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      ""
    ]
  },
  {
    "id": "atomic-323",
    "sourceHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a461c3a9c3c3a9a461c3a9",
      "c3a9c3c3a9a461c3a9c3c3a9a461c3a9",
      "c3a9c324315c6ea46124315c6ec324315c6ea46124315c6e",
      "24315c6ec3c3a9a46124315c6ec324315c6ea46124315c6e",
      "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "58",
      "6124315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e6124315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      ""
    ]
  },
  {
    "id": "atomic-503",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c3c3a9a4c3a9c3a9c3c3a9a4c3a9c3a9",
      "c3a9c324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec3c3a9a424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      ""
    ]
  },
  {
    "id": "atomic-521",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "variable-behind-527",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec3a424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "escape-15",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-32",
    "sourceHex": "24315c6ea0",
    "expectedHex": [
      "c3a9a0",
      "c3a9a0",
      "c3a9a0",
      "24315c6ea0",
      "24315c6ea0",
      "58",
      "6124315c6ea06124315c6ea0",
      ""
    ]
  },
  {
    "id": "escape-48",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-65",
    "sourceHex": "24315c6e85",
    "expectedHex": [
      "c3a985",
      "c3a985",
      "c3a985",
      "24315c6e85",
      "24315c6e85",
      "58",
      "6124315c6e856124315c6e85",
      ""
    ]
  },
  {
    "id": "escape-82",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-99",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-168",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-185",
    "sourceHex": "24315c6ea0",
    "expectedHex": [
      "c3a9a0",
      "c3a9a0",
      "c3a9a0",
      "24315c6ea0",
      "24315c6ea0",
      "58",
      "6124315c6ea06124315c6ea0",
      ""
    ]
  },
  {
    "id": "escape-201",
    "sourceHex": "c224315c6e",
    "expectedHex": [
      "c2c3a9",
      "c2c3a9",
      "c2c3a9",
      "c224315c6e",
      "c224315c6e",
      "58",
      "61c224315c6e61c224315c6e",
      ""
    ]
  },
  {
    "id": "escape-218",
    "sourceHex": "24315c6e85",
    "expectedHex": [
      "c3a985",
      "c3a985",
      "c3a985",
      "24315c6e85",
      "24315c6e85",
      "58",
      "6124315c6e856124315c6e85",
      ""
    ]
  },
  {
    "id": "escape-472",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": [
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c3c3a9a4c3a961c3a9c3c3a9a4c3a961c3a9",
      "c3a9c324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec3c3a9a424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      ""
    ]
  },
  {
    "id": "escape-473",
    "sourceHex": "24315c6ec224315c6e8524315c6e",
    "expectedHex": [
      "c3a9c2c3a985c3a9",
      "c3a9c2c3a985c3a9",
      "c3a9c224315c6e8524315c6e",
      "24315c6ec2c3a98524315c6e",
      "24315c6ec224315c6e8524315c6e",
      "58",
      "6124315c6ec224315c6e8524315c6e6124315c6ec224315c6e8524315c6e",
      ""
    ]
  },
  {
    "id": "escape-474",
    "sourceHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expectedHex": [
      "c3a9c2c3a9c3a9c3a9",
      "c3a9c2c3a9c3a9c3a9",
      "c3a9c224315c6e24315c6e24315c6e",
      "24315c6ec2c3a924315c6e24315c6e",
      "24315c6ec224315c6e24315c6e24315c6e",
      "58",
      "6124315c6ec224315c6e24315c6e24315c6e6124315c6ec224315c6e24315c6e24315c6e",
      ""
    ]
  },
  {
    "id": "escape-475",
    "sourceHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expectedHex": [
      "c3a9e2c3a980c3a9a8c3a9",
      "c3a9e2c3a980c3a9a8c3a9",
      "c3a9e224315c6e8024315c6ea824315c6e",
      "24315c6ee2c3a98024315c6ea824315c6e",
      "24315c6ee224315c6e8024315c6ea824315c6e",
      "58",
      "6124315c6ee224315c6e8024315c6ea824315c6e6124315c6ee224315c6e8024315c6ea824315c6e",
      ""
    ]
  }
];
for (let projection = 0; projection < 8; projection++) {
  it.each(native)(`SUBSTITUTE native $id projection ${projection}`, ({ sourceHex, expectedHex }) => {
    const source = value(sourceHex), needle = string("$1\\n"), replacement = string("é");
    const arguments_: CellValue[][] = [
      [source, needle, replacement], [source, needle, replacement, number(0.5)],
      [source, needle, replacement, number(1)], [source, needle, replacement, number(2)],
      [source, string(""), string("X")], [source, source, string("X")],
      [string("aXaX"), string("X"), source], [value(sourceHex + sourceHex), source, string("")],
    ];
    expect(textFunctions.SUBSTITUTE!(arguments_[projection]!, host)).toEqual(value(expectedHex[projection]!));
  });
}
it("SUBSTITUTE admits the complete output before allocation, including no-match and empty search", () => {
  const bounded = { ...host, context: { ...host.context, limits: { ...host.context.limits, outputBytes: 5 } } };
  for (const args of [[value("ffffff"), value("ff"), string("é")], [value("ffffffffffff"), string("X"), string("")], [value("ffffffffffff"), string(""), string("")]])
    expect(() => textFunctions.SUBSTITUTE!(args, bounded)).toThrow("calculation text limit exceeded");
  expect(textFunctions.SUBSTITUTE!([value("ffff"), value("ff"), string("é")], bounded)).toEqual(string("éé"));
});
it("SUBSTITUTE cooperates during byte search and preserves false cancellation", () => {
  let ticks = 0;
  const cancelled = { ...host, tick() { if (++ticks === 70) throw false; } };
  let observed: unknown = "not-cancelled";
  try { textFunctions.SUBSTITUTE!([value("ff".repeat(20)), value("ffff"), string("X")], cancelled); }
  catch (reason) { observed = reason; }
  expect(observed).toBe(false);
  expect(ticks).toBe(70);
});
it("SUBSTITUTE preserves native non-overlap, selected occurrence and invalid-count semantics", () => {
  expect(textFunctions.SUBSTITUTE!([string("aaaaa"), string("aa"), value("ff"), number(2)], host)).toEqual(value("6161ff61"));
  for (const count of [0, -1]) expect(textFunctions.SUBSTITUTE!([value("ff"), value("ff"), string("X"), number(count)], host)).toEqual({ kind: "error", value: "#VALUE!" });
});
it("SUBSTITUTE clips admitted strings at NUL and refuses visible malformed host text", () => {
  expect(textFunctions.SUBSTITUTE!([string("a\0tail"), string("a"), string("é\0tail")], host)).toEqual(string("é"));
  expect(() => textFunctions.SUBSTITUTE!([string("\ud800"), string(""), string("")], host)).toThrow();
});
