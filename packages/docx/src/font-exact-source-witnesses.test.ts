import { expect, it } from "vitest";
import { Volume } from "memfs";
import { MemoryFileSystem, Shell } from "virtual-bash";
import { docxCommands } from "virtual-bash/commands/docx";
import * as api from "./index.js";
import { nativeStoryFixture } from "../tests/fixtures/native-parts.js";
import { textContext } from "../tests/fixtures/text.js";
import { readPackage, assertPackageLinks } from "../tests/assertions.js";
type Property = { tag: string; attrs: Record<string, string> };
type Case = { id: number; member: string; rPr: boolean; properties: readonly Property[]; value?: unknown; expected?: unknown; afterPr?: boolean; after?: readonly Property[] };
const cases: readonly Case[] = [
  {
    "id": 0,
    "member": "color",
    "rPr": false,
    "properties": [],
    "expected": "ColorFormat"
  },
  {
    "id": 1,
    "member": "name",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 2,
    "member": "name",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 3,
    "member": "name",
    "rPr": true,
    "properties": [
      {
        "tag": "rFonts",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 4,
    "member": "name",
    "rPr": true,
    "properties": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original Sans"
        }
      }
    ],
    "expected": "Original Sans"
  },
  {
    "id": 5,
    "member": "name",
    "rPr": false,
    "properties": [],
    "value": "Original First",
    "afterPr": true,
    "after": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original First",
          "hAnsi": "Original First"
        }
      }
    ]
  },
  {
    "id": 6,
    "member": "name",
    "rPr": true,
    "properties": [],
    "value": "Original First",
    "afterPr": true,
    "after": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original First",
          "hAnsi": "Original First"
        }
      }
    ]
  },
  {
    "id": 7,
    "member": "name",
    "rPr": true,
    "properties": [
      {
        "tag": "rFonts",
        "attrs": {
          "hAnsi": "Original First"
        }
      }
    ],
    "value": "Original Second",
    "afterPr": true,
    "after": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original Second",
          "hAnsi": "Original Second"
        }
      }
    ]
  },
  {
    "id": 8,
    "member": "name",
    "rPr": true,
    "properties": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original First",
          "hAnsi": "Original First"
        }
      }
    ],
    "value": "Original Second",
    "afterPr": true,
    "after": [
      {
        "tag": "rFonts",
        "attrs": {
          "ascii": "Original Second",
          "hAnsi": "Original Second"
        }
      }
    ]
  },
  {
    "id": 9,
    "member": "size",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 10,
    "member": "size",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 11,
    "member": "size",
    "rPr": true,
    "properties": [
      {
        "tag": "sz",
        "attrs": {
          "val": "28"
        }
      }
    ],
    "expected": {
      "value": 177800,
      "unit": "emu"
    }
  },
  {
    "id": 12,
    "member": "size",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "sz",
        "attrs": {
          "val": "24"
        }
      }
    ]
  },
  {
    "id": 13,
    "member": "size",
    "rPr": true,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "sz",
        "attrs": {
          "val": "24"
        }
      }
    ]
  },
  {
    "id": 14,
    "member": "size",
    "rPr": true,
    "properties": [
      {
        "tag": "sz",
        "attrs": {
          "val": "24"
        }
      }
    ],
    "value": {
      "value": 228600,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "sz",
        "attrs": {
          "val": "36"
        }
      }
    ]
  },
  {
    "id": 15,
    "member": "size",
    "rPr": true,
    "properties": [
      {
        "tag": "sz",
        "attrs": {
          "val": "36"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 16,
    "member": "all_caps",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 17,
    "member": "all_caps",
    "rPr": true,
    "properties": [
      {
        "tag": "caps",
        "attrs": {}
      }
    ],
    "expected": true
  },
  {
    "id": 18,
    "member": "all_caps",
    "rPr": true,
    "properties": [
      {
        "tag": "caps",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 19,
    "member": "all_caps",
    "rPr": true,
    "properties": [
      {
        "tag": "caps",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 20,
    "member": "bold",
    "rPr": true,
    "properties": [
      {
        "tag": "b",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 21,
    "member": "italic",
    "rPr": true,
    "properties": [
      {
        "tag": "i",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 22,
    "member": "complex_script",
    "rPr": true,
    "properties": [
      {
        "tag": "cs",
        "attrs": {
          "val": "true"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 23,
    "member": "cs_bold",
    "rPr": true,
    "properties": [
      {
        "tag": "bCs",
        "attrs": {
          "val": "false"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 24,
    "member": "cs_italic",
    "rPr": true,
    "properties": [
      {
        "tag": "iCs",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 25,
    "member": "double_strike",
    "rPr": true,
    "properties": [
      {
        "tag": "dstrike",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 26,
    "member": "emboss",
    "rPr": true,
    "properties": [
      {
        "tag": "emboss",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 27,
    "member": "hidden",
    "rPr": true,
    "properties": [
      {
        "tag": "vanish",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 28,
    "member": "italic",
    "rPr": true,
    "properties": [
      {
        "tag": "i",
        "attrs": {
          "val": "true"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 29,
    "member": "imprint",
    "rPr": true,
    "properties": [
      {
        "tag": "imprint",
        "attrs": {
          "val": "false"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 30,
    "member": "math",
    "rPr": true,
    "properties": [
      {
        "tag": "oMath",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 31,
    "member": "no_proof",
    "rPr": true,
    "properties": [
      {
        "tag": "noProof",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 32,
    "member": "outline",
    "rPr": true,
    "properties": [
      {
        "tag": "outline",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 33,
    "member": "rtl",
    "rPr": true,
    "properties": [
      {
        "tag": "rtl",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 34,
    "member": "shadow",
    "rPr": true,
    "properties": [
      {
        "tag": "shadow",
        "attrs": {
          "val": "true"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 35,
    "member": "small_caps",
    "rPr": true,
    "properties": [
      {
        "tag": "smallCaps",
        "attrs": {
          "val": "false"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 36,
    "member": "snap_to_grid",
    "rPr": true,
    "properties": [
      {
        "tag": "snapToGrid",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 37,
    "member": "spec_vanish",
    "rPr": true,
    "properties": [
      {
        "tag": "specVanish",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 38,
    "member": "strike",
    "rPr": true,
    "properties": [
      {
        "tag": "strike",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 39,
    "member": "web_hidden",
    "rPr": true,
    "properties": [
      {
        "tag": "webHidden",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 40,
    "member": "all_caps",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "caps",
        "attrs": {}
      }
    ]
  },
  {
    "id": 41,
    "member": "bold",
    "rPr": false,
    "properties": [],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "b",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 42,
    "member": "italic",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 43,
    "member": "complex_script",
    "rPr": true,
    "properties": [
      {
        "tag": "cs",
        "attrs": {}
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "cs",
        "attrs": {}
      }
    ]
  },
  {
    "id": 44,
    "member": "cs_bold",
    "rPr": true,
    "properties": [
      {
        "tag": "bCs",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "bCs",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 45,
    "member": "cs_italic",
    "rPr": true,
    "properties": [
      {
        "tag": "iCs",
        "attrs": {}
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 46,
    "member": "double_strike",
    "rPr": true,
    "properties": [
      {
        "tag": "dstrike",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "dstrike",
        "attrs": {}
      }
    ]
  },
  {
    "id": 47,
    "member": "emboss",
    "rPr": true,
    "properties": [
      {
        "tag": "emboss",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "emboss",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 48,
    "member": "hidden",
    "rPr": true,
    "properties": [
      {
        "tag": "vanish",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 49,
    "member": "italic",
    "rPr": true,
    "properties": [
      {
        "tag": "i",
        "attrs": {
          "val": "false"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "i",
        "attrs": {}
      }
    ]
  },
  {
    "id": 50,
    "member": "imprint",
    "rPr": true,
    "properties": [
      {
        "tag": "imprint",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "imprint",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 51,
    "member": "math",
    "rPr": true,
    "properties": [
      {
        "tag": "oMath",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 52,
    "member": "no_proof",
    "rPr": true,
    "properties": [
      {
        "tag": "noProof",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "noProof",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 53,
    "member": "outline",
    "rPr": true,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "outline",
        "attrs": {}
      }
    ]
  },
  {
    "id": 54,
    "member": "rtl",
    "rPr": true,
    "properties": [
      {
        "tag": "rtl",
        "attrs": {
          "val": "true"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "rtl",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 55,
    "member": "shadow",
    "rPr": true,
    "properties": [
      {
        "tag": "shadow",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "shadow",
        "attrs": {}
      }
    ]
  },
  {
    "id": 56,
    "member": "small_caps",
    "rPr": true,
    "properties": [
      {
        "tag": "smallCaps",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "smallCaps",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 57,
    "member": "snap_to_grid",
    "rPr": true,
    "properties": [
      {
        "tag": "snapToGrid",
        "attrs": {}
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "snapToGrid",
        "attrs": {}
      }
    ]
  },
  {
    "id": 58,
    "member": "spec_vanish",
    "rPr": true,
    "properties": [
      {
        "tag": "specVanish",
        "attrs": {}
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 59,
    "member": "strike",
    "rPr": true,
    "properties": [
      {
        "tag": "strike",
        "attrs": {
          "val": "foo"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "strike",
        "attrs": {}
      }
    ]
  },
  {
    "id": 60,
    "member": "web_hidden",
    "rPr": true,
    "properties": [
      {
        "tag": "webHidden",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "webHidden",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 61,
    "member": "subscript",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 62,
    "member": "subscript",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 63,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "baseline"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 64,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 65,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 66,
    "member": "subscript",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ]
  },
  {
    "id": 67,
    "member": "subscript",
    "rPr": false,
    "properties": [],
    "value": false,
    "afterPr": true,
    "after": []
  },
  {
    "id": 68,
    "member": "subscript",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 69,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ]
  },
  {
    "id": 70,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": []
  },
  {
    "id": 71,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 72,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ]
  },
  {
    "id": 73,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ]
  },
  {
    "id": 74,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 75,
    "member": "subscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "baseline"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ]
  },
  {
    "id": 76,
    "member": "superscript",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 77,
    "member": "superscript",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 78,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "baseline"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 79,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 80,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 81,
    "member": "superscript",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ]
  },
  {
    "id": 82,
    "member": "superscript",
    "rPr": false,
    "properties": [],
    "value": false,
    "afterPr": true,
    "after": []
  },
  {
    "id": 83,
    "member": "superscript",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 84,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ]
  },
  {
    "id": 85,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": []
  },
  {
    "id": 86,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 87,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ]
  },
  {
    "id": 88,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ]
  },
  {
    "id": 89,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "subscript"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 90,
    "member": "superscript",
    "rPr": true,
    "properties": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "baseline"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "vertAlign",
        "attrs": {
          "val": "superscript"
        }
      }
    ]
  },
  {
    "id": 91,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 92,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 93,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 94,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "none"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 95,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "double"
        }
      }
    ],
    "expected": {
      "enum": "WD_UNDERLINE",
      "name": "DOUBLE"
    }
  },
  {
    "id": 96,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "wave"
        }
      }
    ],
    "expected": {
      "enum": "WD_UNDERLINE",
      "name": "WAVY"
    }
  },
  {
    "id": 97,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ]
  },
  {
    "id": 98,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "none"
        }
      }
    ]
  },
  {
    "id": 99,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 100,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_UNDERLINE",
      "name": "SINGLE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ]
  },
  {
    "id": 101,
    "member": "underline",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_UNDERLINE",
      "name": "THICK"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "thick"
        }
      }
    ]
  },
  {
    "id": 102,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ]
  },
  {
    "id": 103,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "none"
        }
      }
    ]
  },
  {
    "id": 104,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 105,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "value": {
      "enum": "WD_UNDERLINE",
      "name": "SINGLE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ]
  },
  {
    "id": 106,
    "member": "underline",
    "rPr": true,
    "properties": [
      {
        "tag": "u",
        "attrs": {
          "val": "single"
        }
      }
    ],
    "value": {
      "enum": "WD_UNDERLINE",
      "name": "DOTTED"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "u",
        "attrs": {
          "val": "dotted"
        }
      }
    ]
  },
  {
    "id": 107,
    "member": "highlight_color",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 108,
    "member": "highlight_color",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 109,
    "member": "highlight_color",
    "rPr": true,
    "properties": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "default"
        }
      }
    ],
    "expected": {
      "enum": "WD_COLOR_INDEX",
      "name": "AUTO"
    }
  },
  {
    "id": 110,
    "member": "highlight_color",
    "rPr": true,
    "properties": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "blue"
        }
      }
    ],
    "expected": {
      "enum": "WD_COLOR_INDEX",
      "name": "BLUE"
    }
  },
  {
    "id": 111,
    "member": "highlight_color",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_COLOR_INDEX",
      "name": "AUTO"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "default"
        }
      }
    ]
  },
  {
    "id": 112,
    "member": "highlight_color",
    "rPr": true,
    "properties": [],
    "value": {
      "enum": "WD_COLOR_INDEX",
      "name": "BRIGHT_GREEN"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "green"
        }
      }
    ]
  },
  {
    "id": 113,
    "member": "highlight_color",
    "rPr": true,
    "properties": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "green"
        }
      }
    ],
    "value": {
      "enum": "WD_COLOR_INDEX",
      "name": "YELLOW"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "yellow"
        }
      }
    ]
  },
  {
    "id": 114,
    "member": "highlight_color",
    "rPr": true,
    "properties": [
      {
        "tag": "highlight",
        "attrs": {
          "val": "yellow"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 115,
    "member": "highlight_color",
    "rPr": true,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 116,
    "member": "highlight_color",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  }
];
function canonical(properties: readonly Property[]): readonly Property[] { return properties.map(p => ({ tag: p.tag, attrs: Object.fromEntries(Object.entries(p.attrs).map(([key, value]) => [key, key === "val" && !["rFonts", "sz", "vertAlign", "u", "highlight"].includes(p.tag) ? ["1", "on", "true"].includes(value) ? "1" : ["0", "off", "false"].includes(value) ? "0" : value : value])) })).map(p => !["rFonts", "sz", "vertAlign", "u", "highlight"].includes(p.tag) && !Object.hasOwn(p.attrs, "val") ? { ...p, attrs: { ...p.attrs, val: "1" } } : p); }
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact font source witness G${String(c.id).padStart(3, "0")}; strict=${strict}; kind=${kind}`, async () => {
  const props = c.properties.map(p => `<w:${p.tag}${Object.entries(p.attrs).map(([key, value]) => ` w:${key}="${value}"`).join("")}/>`).join(""), { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p><w:r w:rsidR="00ABCDEF">${c.rPr ? `<w:rPr>${props}</w:rPr>` : ""}<w:t>Original é 日本 עברית 🌊</w:t></w:r><!--retain--><?audit keep?></w:p>`), memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, edits = Object.hasOwn(c, "value"), operations = [{ operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs" }, {operation: "model.text.paragraph.Paragraph.runs.get", receiver: {resultHandle: "paragraphs", index: 0}, arguments: {}, resultHandle: "runs"}, { operation: "model.text.run.Run.font.get", receiver: { resultHandle: "runs", index: 0 }, arguments: {}, resultHandle: "font" }, { operation: `model.text.run.Font.${c.member}.${edits ? "set" : "get"}`, receiver: { resultHandle: "font" }, arguments: edits ? { value: c.value } : {} }];
  if (route === "model") { const doc = await api.Document(input, textContext), font = doc.paragraphs[0]!.runs[0]!.font; if (edits) Reflect.set(font, c.member, c.member === "size" && c.value !== null ? api.Emu((c.value as {value: number}).value) : c.value); else { const value: unknown = Reflect.get(font, c.member); expect(c.member === "size" && value !== null ? {value: (value as api.Length).emu, unit: "emu"} : c.member === "color" ? (value as api.ColorFormat).constructor.name : value).toEqual(c.expected); if (c.member === "color") expect((value as api.ColorFormat).equals(font.color)).toBe(true); } await doc.save(sink); }
  else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); if (!edits) expect(c.member === "color" ? (result.results.at(-1)!.value as {type: string}).type : result.results.at(-1)!.value).toEqual(c.expected); await result.save(sink); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --json${edits ? " --output /out" : ""}`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); if (edits) memory.writeFileSync("/out", await fs.readFile("/out")); else { const value: unknown = JSON.parse(r.stdout).data.results.at(-1).data; expect(c.member === "color" ? (value as {type: string}).type : value).toEqual(c.expected); await expect(fs.readFile("/out")).rejects.toBeDefined(); memory.writeFileSync("/out", input); } expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if (!edits || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes); const xml = new api.DocumentXmlEditor(after.get("word/document.xml")!), node = xml.root.children[0]!.children[0]!.children[0]!, rPr = node.children.find(n => n.localName === "rPr"); if (edits) { expect(Boolean(rPr)).toBe(c.afterPr); expect(canonical(rPr?.children.map(p => ({tag: p.localName, attrs: Object.fromEntries(p.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value]))})) ?? [])).toEqual(canonical(c.after!)); } const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); const text = new TextDecoder().decode(after.get("word/document.xml")); expect(text).toContain('w:rsidR="00ABCDEF"'); expect(text.split("<!--retain-->")).toHaveLength(2); expect(text.split("<?audit keep?>")).toHaveLength(2);
});
