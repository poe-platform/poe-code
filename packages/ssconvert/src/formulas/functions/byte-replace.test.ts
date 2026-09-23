import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";

const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Actual Gnumeric1.12.61 byte-string REPLACE captures; native receipts retained in docs/ssconvert.
const native = [
  {
    "id": "row1",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row2",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row3",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row4",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row5",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row6",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row7",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row8",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row9",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row10",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row11",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row12",
    "sourceHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea462c324315c6ea924315c6e",
      "24586ec324315c6ea462c324315c6ea924315c6e",
      "2431c3a96ec324315c6ea462c324315c6ea924315c6e",
      "24315c6ec324315c6ea462c324315c6ea924315c6e58",
      "6124315c6ec324315c6ea462c324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row13",
    "sourceHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24586ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "2431c3a96ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
      "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e58",
      "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e6364",
      ""
    ]
  },
  {
    "id": "row14",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row15",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row16",
    "sourceHex": "58c358a4586258",
    "expected": [
      "c3a9c358a4586258",
      "5858586258",
      "58c358c3a9586258",
      "58c358a458625858",
      "6158c358a45862586364",
      ""
    ]
  },
  {
    "id": "row17",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row18",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row19",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24586ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "2431c3a96ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6364",
      ""
    ]
  },
  {
    "id": "row20",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24586ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "2431c3a96ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6364",
      ""
    ]
  },
  {
    "id": "row21",
    "sourceHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "24586ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "2431c3a96ec324315c6ea46124315c6ec324315c6ea46124315c6e",
      "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e58",
      "6124315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e6364",
      ""
    ]
  },
  {
    "id": "row22",
    "sourceHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24586ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "2431c3a96ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
      "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e58",
      "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e6364",
      ""
    ]
  },
  {
    "id": "row23",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row24",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row25",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row26",
    "sourceHex": "24315c6ea0",
    "expected": [
      "c3a9315c6ea0",
      "24586ea0",
      "2431c3a96ea0",
      "24315c6ea058",
      "6124315c6ea06364",
      ""
    ]
  },
  {
    "id": "row27",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row28",
    "sourceHex": "24315c6e85",
    "expected": [
      "c3a9315c6e85",
      "24586e85",
      "2431c3a96e85",
      "24315c6e8558",
      "6124315c6e856364",
      ""
    ]
  },
  {
    "id": "row29",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row30",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row31",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row32",
    "sourceHex": "24315c6ea0",
    "expected": [
      "c3a9315c6ea0",
      "24586ea0",
      "2431c3a96ea0",
      "24315c6ea058",
      "6124315c6ea06364",
      ""
    ]
  },
  {
    "id": "row33",
    "sourceHex": "c224315c6e",
    "expected": [
      "c3a9315c6e",
      "c224586e",
      "c22431c3a96e",
      "c224315c6e58",
      "61c224315c6e6364",
      ""
    ]
  },
  {
    "id": "row34",
    "sourceHex": "24315c6e85",
    "expected": [
      "c3a9315c6e85",
      "24586e85",
      "2431c3a96e85",
      "24315c6e8558",
      "6124315c6e856364",
      ""
    ]
  },
  {
    "id": "row35",
    "sourceHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expected": [
      "c3a9315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24586ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "2431c3a96ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
      "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e58",
      "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e6364",
      ""
    ]
  },
  {
    "id": "row36",
    "sourceHex": "24315c6ec224315c6e8524315c6e",
    "expected": [
      "c3a9315c6ec224315c6e8524315c6e",
      "24586ec224315c6e8524315c6e",
      "2431c3a96ec224315c6e8524315c6e",
      "24315c6ec224315c6e8524315c6e58",
      "6124315c6ec224315c6e8524315c6e6364",
      ""
    ]
  },
  {
    "id": "row37",
    "sourceHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expected": [
      "c3a9315c6ec224315c6e24315c6e24315c6e",
      "24586ec224315c6e24315c6e24315c6e",
      "2431c3a96ec224315c6e24315c6e24315c6e",
      "24315c6ec224315c6e24315c6e24315c6e58",
      "6124315c6ec224315c6e24315c6e24315c6e6364",
      ""
    ]
  },
  {
    "id": "row38",
    "sourceHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expected": [
      "c3a9315c6ee224315c6e8024315c6ea824315c6e",
      "24586ee224315c6e8024315c6ea824315c6e",
      "2431c3a96ee224315c6e8024315c6ea824315c6e",
      "24315c6ee224315c6e8024315c6ea824315c6e58",
      "6124315c6ee224315c6e8024315c6ea824315c6e6364",
      ""
    ]
  }
];
for (const [index, start, count, replacement] of [
  [0, 1, 1, "c3a9"], [1, 2, 2, "58"], [2, 3.5, 1.5, "c3a9"], [3, 1000, 1000, "58"],
  [4, 2, 1, "source"], [5, 1, 1000, ""],
] as const) it.each(native)(`REPLACE matches native $id variant ${index}`, ({ sourceHex, expected }) => {
  const source = byteStringValue(bytes(index === 4 ? "61626364" : sourceHex), () => {}, 1000000);
  const next = byteStringValue(bytes(replacement === "source" ? sourceHex : replacement), () => {}, 1000000);
  expect(textFunctions.REPLACE!([source, { kind: "number", value: start }, { kind: "number", value: count }, next], host))
    .toEqual(byteStringValue(bytes(expected[index]!), () => {}, 1000000));
});

it("REPLACE admits complete raw output before copying", () => {
  const bounded = { ...host, context: { ...host.context, limits: { ...host.context.limits, outputBytes: 4 } } };
  const args = [{ kind: "byte-string", value: "fffe" }, { kind: "number", value: 2 }, { kind: "number", value: 0 }, { kind: "byte-string", value: "fdfcfb" }] as const;
  expect(() => textFunctions.REPLACE!(args, bounded)).toThrow("calculation text limit exceeded");
  expect(textFunctions.REPLACE!([args[0], args[1], { kind: "number", value: 1 }, args[3]], bounded))
    .toEqual({ kind: "byte-string", value: "fffdfcfb" });
});
it("REPLACE cooperates in cursor traversal with exact falsey cancellation", () => {
  for (const reason of [null, false, 0, "", Number.NaN]) {
    let ticks = 0, observed: unknown = "not-cancelled";
    const cancelled = { ...host, tick() { if (++ticks === 350) throw reason; } };
    try { textFunctions.REPLACE!([{ kind: "string", value: "a".repeat(100) }, { kind: "number", value: 80 }, { kind: "number", value: 1 }, { kind: "byte-string", value: "ff" }], cancelled); }
    catch (error) { observed = error; }
    expect(Object.is(observed, reason)).toBe(true);
    expect(ticks).toBe(350);
  }
});
it("REPLACE clips NUL and refuses visible malformed host UTF-16", () => {
  expect(textFunctions.REPLACE!([{ kind: "string", value: "ab\u0000tail" }, { kind: "number", value: 2 }, { kind: "number", value: 1 }, { kind: "string", value: "X\u0000hidden" }], host))
    .toEqual({ kind: "string", value: "aX" });
  expect(() => textFunctions.REPLACE!([{ kind: "string", value: "\ud800" }, { kind: "number", value: 1 }, { kind: "number", value: 1 }, { kind: "string", value: "" }], host)).toThrow();
});
it("REPLACE preserves ordinary multibyte positions and invalid numeric bounds", () => {
  expect(textFunctions.REPLACE!([{ kind: "string", value: "aé😊z" }, { kind: "number", value: 2 }, { kind: "number", value: 2 }, { kind: "string", value: "X" }], host)).toEqual({ kind: "string", value: "aXz" });
  for (const [start, count] of [[0, 1], [1, -1]]) expect(textFunctions.REPLACE!([{ kind: "string", value: "abc" }, { kind: "number", value: start! }, { kind: "number", value: count! }, { kind: "string", value: "X" }], host)).toEqual({ kind: "error", value: "#VALUE!" });
});

