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
    "member": "alignment",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 1,
    "member": "alignment",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 2,
    "member": "alignment",
    "rPr": true,
    "properties": [
      {
        "tag": "jc",
        "attrs": {
          "val": "center"
        }
      }
    ],
    "expected": {
      "enum": "WD_PARAGRAPH_ALIGNMENT",
      "name": "CENTER"
    }
  },
  {
    "id": 3,
    "member": "alignment",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_PARAGRAPH_ALIGNMENT",
      "name": "LEFT"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "jc",
        "attrs": {
          "val": "left"
        }
      }
    ]
  },
  {
    "id": 4,
    "member": "alignment",
    "rPr": true,
    "properties": [],
    "value": {
      "enum": "WD_PARAGRAPH_ALIGNMENT",
      "name": "CENTER"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "jc",
        "attrs": {
          "val": "center"
        }
      }
    ]
  },
  {
    "id": 5,
    "member": "alignment",
    "rPr": true,
    "properties": [
      {
        "tag": "jc",
        "attrs": {
          "val": "center"
        }
      }
    ],
    "value": {
      "enum": "WD_PARAGRAPH_ALIGNMENT",
      "name": "RIGHT"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "jc",
        "attrs": {
          "val": "right"
        }
      }
    ]
  },
  {
    "id": 6,
    "member": "alignment",
    "rPr": true,
    "properties": [
      {
        "tag": "jc",
        "attrs": {
          "val": "right"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 7,
    "member": "alignment",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 8,
    "member": "space_before",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 9,
    "member": "space_before",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 10,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 11,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "420"
        }
      }
    ],
    "expected": {
      "value": 266700,
      "unit": "emu"
    }
  },
  {
    "id": 12,
    "member": "space_before",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "240"
        }
      }
    ]
  },
  {
    "id": 13,
    "member": "space_before",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 14,
    "member": "space_before",
    "rPr": true,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "240"
        }
      }
    ]
  },
  {
    "id": 15,
    "member": "space_before",
    "rPr": true,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 16,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "240"
        }
      }
    ]
  },
  {
    "id": 17,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ]
  },
  {
    "id": 18,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "240"
        }
      }
    ],
    "value": {
      "value": 533400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "840"
        }
      }
    ]
  },
  {
    "id": 19,
    "member": "space_before",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "before": "840"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ]
  },
  {
    "id": 20,
    "member": "space_after",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 21,
    "member": "space_after",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 22,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 23,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "240"
        }
      }
    ],
    "expected": {
      "value": 152400,
      "unit": "emu"
    }
  },
  {
    "id": 24,
    "member": "space_after",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "240"
        }
      }
    ]
  },
  {
    "id": 25,
    "member": "space_after",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 26,
    "member": "space_after",
    "rPr": true,
    "properties": [],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "240"
        }
      }
    ]
  },
  {
    "id": 27,
    "member": "space_after",
    "rPr": true,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 28,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "value": {
      "value": 152400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "240"
        }
      }
    ]
  },
  {
    "id": 29,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ]
  },
  {
    "id": 30,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "240"
        }
      }
    ],
    "value": {
      "value": 533400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "840"
        }
      }
    ]
  },
  {
    "id": 31,
    "member": "space_after",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "after": "840"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ]
  },
  {
    "id": 32,
    "member": "line_spacing",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 33,
    "member": "line_spacing",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 34,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 35,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "420"
        }
      }
    ],
    "expected": 1.75
  },
  {
    "id": 36,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "840",
          "lineRule": "exact"
        }
      }
    ],
    "expected": {
      "value": 533400,
      "unit": "emu"
    }
  },
  {
    "id": 37,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "840",
          "lineRule": "atLeast"
        }
      }
    ],
    "expected": {
      "value": 533400,
      "unit": "emu"
    }
  },
  {
    "id": 38,
    "member": "line_spacing",
    "rPr": false,
    "properties": [],
    "value": 1,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 39,
    "member": "line_spacing",
    "rPr": false,
    "properties": [],
    "value": 2.0,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "480",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 40,
    "member": "line_spacing",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 533400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "840",
          "lineRule": "exact"
        }
      }
    ]
  },
  {
    "id": 41,
    "member": "line_spacing",
    "rPr": true,
    "properties": [],
    "value": 2,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "480",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 42,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "360"
        }
      }
    ],
    "value": 1,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 43,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "exact"
        }
      }
    ],
    "value": 1.75,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "420",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 44,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "atLeast"
        }
      }
    ],
    "value": {
      "value": 533400,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "840",
          "lineRule": "atLeast"
        }
      }
    ]
  },
  {
    "id": 45,
    "member": "line_spacing",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "exact"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ]
  },
  {
    "id": 46,
    "member": "line_spacing",
    "rPr": true,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 47,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 48,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 49,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 50,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "SINGLE"
    }
  },
  {
    "id": 51,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "360"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "ONE_POINT_FIVE"
    }
  },
  {
    "id": 52,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "480"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "DOUBLE"
    }
  },
  {
    "id": 53,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "420"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "MULTIPLE"
    }
  },
  {
    "id": 54,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "lineRule": "auto"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "MULTIPLE"
    }
  },
  {
    "id": 55,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "lineRule": "exact"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "EXACTLY"
    }
  },
  {
    "id": 56,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "lineRule": "atLeast"
        }
      }
    ],
    "expected": {
      "enum": "WD_LINE_SPACING",
      "name": "AT_LEAST"
    }
  },
  {
    "id": 57,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "SINGLE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "240",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 58,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "ONE_POINT_FIVE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "360",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 59,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "DOUBLE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "480",
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 60,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "MULTIPLE"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "lineRule": "auto"
        }
      }
    ]
  },
  {
    "id": 61,
    "member": "line_spacing_rule",
    "rPr": false,
    "properties": [],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "EXACTLY"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "lineRule": "exact"
        }
      }
    ]
  },
  {
    "id": 62,
    "member": "line_spacing_rule",
    "rPr": true,
    "properties": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "280",
          "lineRule": "exact"
        }
      }
    ],
    "value": {
      "enum": "WD_LINE_SPACING",
      "name": "AT_LEAST"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "spacing",
        "attrs": {
          "line": "280",
          "lineRule": "atLeast"
        }
      }
    ]
  },
  {
    "id": 63,
    "member": "first_line_indent",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 64,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 65,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 66,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "firstLine": "240"
        }
      }
    ],
    "expected": {
      "value": 152400,
      "unit": "emu"
    }
  },
  {
    "id": 67,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "hanging": "240"
        }
      }
    ],
    "expected": {
      "value": -152400,
      "unit": "emu"
    }
  },
  {
    "id": 68,
    "member": "first_line_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 457200,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "firstLine": "720"
        }
      }
    ]
  },
  {
    "id": 69,
    "member": "first_line_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": -457200,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "hanging": "720"
        }
      }
    ]
  },
  {
    "id": 70,
    "member": "first_line_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 0,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "firstLine": "0"
        }
      }
    ]
  },
  {
    "id": 71,
    "member": "first_line_indent",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 72,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "firstLine": "240"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ]
  },
  {
    "id": 73,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "firstLine": "240"
        }
      }
    ],
    "value": {
      "value": -228600,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "hanging": "360"
        }
      }
    ]
  },
  {
    "id": 74,
    "member": "first_line_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "hanging": "240"
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
        "tag": "ind",
        "attrs": {
          "firstLine": "360"
        }
      }
    ]
  },
  {
    "id": 75,
    "member": "left_indent",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 76,
    "member": "left_indent",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 77,
    "member": "left_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 78,
    "member": "left_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "left": "120"
        }
      }
    ],
    "expected": {
      "value": 76200,
      "unit": "emu"
    }
  },
  {
    "id": 79,
    "member": "left_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "left": "-06.3pt"
        }
      }
    ],
    "expected": {
      "value": -80010,
      "unit": "emu"
    }
  },
  {
    "id": 80,
    "member": "left_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 457200,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "left": "720"
        }
      }
    ]
  },
  {
    "id": 81,
    "member": "left_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": -38100,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "left": "-60"
        }
      }
    ]
  },
  {
    "id": 82,
    "member": "left_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 0,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "left": "0"
        }
      }
    ]
  },
  {
    "id": 83,
    "member": "left_indent",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 84,
    "member": "left_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "left": "240"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ]
  },
  {
    "id": 85,
    "member": "right_indent",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 86,
    "member": "right_indent",
    "rPr": true,
    "properties": [],
    "expected": null
  },
  {
    "id": 87,
    "member": "right_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ],
    "expected": null
  },
  {
    "id": 88,
    "member": "right_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "right": "160"
        }
      }
    ],
    "expected": {
      "value": 101600,
      "unit": "emu"
    }
  },
  {
    "id": 89,
    "member": "right_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "right": "-4.2pt"
        }
      }
    ],
    "expected": {
      "value": -53340,
      "unit": "emu"
    }
  },
  {
    "id": 90,
    "member": "right_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 457200,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "right": "720"
        }
      }
    ]
  },
  {
    "id": 91,
    "member": "right_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": -38100,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "right": "-60"
        }
      }
    ]
  },
  {
    "id": 92,
    "member": "right_indent",
    "rPr": false,
    "properties": [],
    "value": {
      "value": 0,
      "unit": "emu"
    },
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {
          "right": "0"
        }
      }
    ]
  },
  {
    "id": 93,
    "member": "right_indent",
    "rPr": false,
    "properties": [],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 94,
    "member": "right_indent",
    "rPr": true,
    "properties": [
      {
        "tag": "ind",
        "attrs": {
          "right": "240"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": [
      {
        "tag": "ind",
        "attrs": {}
      }
    ]
  },
  {
    "id": 95,
    "member": "keep_together",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 96,
    "member": "keep_together",
    "rPr": true,
    "properties": [
      {
        "tag": "keepLines",
        "attrs": {
          "val": "on"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 97,
    "member": "keep_together",
    "rPr": true,
    "properties": [
      {
        "tag": "keepLines",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 98,
    "member": "keep_with_next",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 99,
    "member": "keep_with_next",
    "rPr": true,
    "properties": [
      {
        "tag": "keepNext",
        "attrs": {
          "val": "1"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 100,
    "member": "keep_with_next",
    "rPr": true,
    "properties": [
      {
        "tag": "keepNext",
        "attrs": {
          "val": "false"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 101,
    "member": "page_break_before",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 102,
    "member": "page_break_before",
    "rPr": true,
    "properties": [
      {
        "tag": "pageBreakBefore",
        "attrs": {}
      }
    ],
    "expected": true
  },
  {
    "id": 103,
    "member": "page_break_before",
    "rPr": true,
    "properties": [
      {
        "tag": "pageBreakBefore",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 104,
    "member": "widow_control",
    "rPr": false,
    "properties": [],
    "expected": null
  },
  {
    "id": 105,
    "member": "widow_control",
    "rPr": true,
    "properties": [
      {
        "tag": "widowControl",
        "attrs": {
          "val": "true"
        }
      }
    ],
    "expected": true
  },
  {
    "id": 106,
    "member": "widow_control",
    "rPr": true,
    "properties": [
      {
        "tag": "widowControl",
        "attrs": {
          "val": "off"
        }
      }
    ],
    "expected": false
  },
  {
    "id": 107,
    "member": "keep_together",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "keepLines",
        "attrs": {}
      }
    ]
  },
  {
    "id": 108,
    "member": "keep_with_next",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "keepNext",
        "attrs": {}
      }
    ]
  },
  {
    "id": 109,
    "member": "page_break_before",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "pageBreakBefore",
        "attrs": {}
      }
    ]
  },
  {
    "id": 110,
    "member": "widow_control",
    "rPr": false,
    "properties": [],
    "value": true,
    "afterPr": true,
    "after": [
      {
        "tag": "widowControl",
        "attrs": {}
      }
    ]
  },
  {
    "id": 111,
    "member": "keep_together",
    "rPr": true,
    "properties": [
      {
        "tag": "keepLines",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "keepLines",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 112,
    "member": "keep_with_next",
    "rPr": true,
    "properties": [
      {
        "tag": "keepNext",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "keepNext",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 113,
    "member": "page_break_before",
    "rPr": true,
    "properties": [
      {
        "tag": "pageBreakBefore",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "pageBreakBefore",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 114,
    "member": "widow_control",
    "rPr": true,
    "properties": [
      {
        "tag": "widowControl",
        "attrs": {}
      }
    ],
    "value": false,
    "afterPr": true,
    "after": [
      {
        "tag": "widowControl",
        "attrs": {
          "val": "0"
        }
      }
    ]
  },
  {
    "id": 115,
    "member": "keep_together",
    "rPr": true,
    "properties": [
      {
        "tag": "keepLines",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 116,
    "member": "keep_with_next",
    "rPr": true,
    "properties": [
      {
        "tag": "keepNext",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 117,
    "member": "page_break_before",
    "rPr": true,
    "properties": [
      {
        "tag": "pageBreakBefore",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 118,
    "member": "widow_control",
    "rPr": true,
    "properties": [
      {
        "tag": "widowControl",
        "attrs": {
          "val": "0"
        }
      }
    ],
    "value": null,
    "afterPr": true,
    "after": []
  },
  {
    "id": 119,
    "member": "tab_stops",
    "rPr": false,
    "properties": [],
    "expected": "TabStops"
  }
];
function dialectProperties(properties: readonly Property[], strict: boolean): readonly Property[] { return properties.map(p => ({...p, attrs: Object.fromEntries(Object.entries(p.attrs).map(([key, value]) => [strict && p.tag === "ind" ? key === "left" ? "start" : key === "right" ? "end" : key : key, strict && p.tag === "jc" && key === "val" ? value === "left" ? "start" : value === "right" ? "end" : value : value]))})); }
function canonical(properties: readonly Property[], strict: boolean): readonly Property[] { return dialectProperties(properties, strict).map(p => ["keepNext", "keepLines", "pageBreakBefore", "widowControl"].includes(p.tag) ? { ...p, attrs: {...p.attrs, val: ["0", "off", "false"].includes(p.attrs.val ?? "1") ? "0" : "1"} } : p); }
for (const strict of [false, true]) for (const kind of ["docx", "dotx"] as const) for (const c of cases) for (const route of ["model", "sdk", "shell"] as const)
it(`${route} independently executes exact paragraph-format source witness P${String(c.id).padStart(3, "0")}; strict=${strict}; kind=${kind}`, async () => {
  const props = dialectProperties(c.properties, strict).map(p => `<w:${p.tag}${Object.entries(p.attrs).map(([key, value]) => ` w:${key}="${value}"`).join("")}/>`).join(""), { input } = await nativeStoryFixture("document.DocumentPart", strict, kind, `<w:p w:rsidR="00ABCDEF">${c.rPr ? `<w:pPr>${props}</w:pPr>` : ""}<w:r><w:t>Original é 日本 עברית 🌊</w:t></w:r><!--retain--><?audit keep?></w:p>`), memory = Volume.fromJSON({ "/out": "" }), sink = { async write(bytes: Uint8Array) { memory.appendFileSync("/out", bytes); } }, edits = Object.hasOwn(c, "value"), operations = [{ operation: "model.document.Document.paragraphs.get", receiver: {resultHandle: "document"}, arguments: {}, resultHandle: "paragraphs" }, { operation: "model.text.paragraph.Paragraph.paragraph_format.get", receiver: { resultHandle: "paragraphs", index: 0 }, arguments: {}, resultHandle: "font" }, { operation: `model.text.parfmt.ParagraphFormat.${c.member}.${edits ? "set" : "get"}`, receiver: { resultHandle: "font" }, arguments: edits ? { value: c.value } : {} }];
  if (route === "model") { const doc = await api.Document(input, textContext), font = doc.paragraphs[0]!.paragraph_format; if (edits) Reflect.set(font, c.member, typeof c.value === "object" && c.value !== null && "unit" in c.value && "value" in c.value && typeof c.value.value === "number" ? api.Emu(c.value.value) : c.value); else { const value: unknown = Reflect.get(font, c.member); expect(typeof value === "object" && value !== null && "emu" in value ? {value: (value as api.Length).emu, unit: "emu"} : c.member === "tab_stops" ? (value as api.TabStops).constructor.name : value).toEqual(c.expected); if (c.member === "tab_stops") expect((value as api.TabStops).equals(font.tab_stops)).toBe(true); } await doc.save(sink); }
  else if (route === "sdk") { const result = await api.applyStyleModelBatch(input, {version: 1, operations}, textContext); if (!edits) expect(c.member === "tab_stops" ? (result.results.at(-1)!.value as {type: string}).type : result.results.at(-1)!.value).toEqual(c.expected); await result.save(sink); }
  else { const fs = new MemoryFileSystem(); await fs.writeFile("/input", input); const shell = new Shell({fs}).use(docxCommands({engine: api.createDocxInspectionCommandEngine({limits: textContext.limits})})); try { const r = await shell.exec(`docx batch /input --ops-json '${JSON.stringify({version: 1, operations})}' --json${edits || c.member === "tab_stops" ? " --output /out" : ""}`); expect(r.exitCode, r.stdout + r.stderr).toBe(0); if (edits || c.member === "tab_stops") memory.writeFileSync("/out", await fs.readFile("/out")); if (!edits) { const value: unknown = JSON.parse(r.stdout).data.results.at(-1).data; expect(c.member === "tab_stops" ? (value as {type: string}).type : value).toEqual(c.expected); if (c.member !== "tab_stops") { await expect(fs.readFile("/out")).rejects.toBeDefined(); memory.writeFileSync("/out", input); } } expect(await fs.readFile("/input")).toEqual(input); } finally { await shell.dispose(); } }
  const output = new Uint8Array(memory.readFileSync("/out") as Buffer), before = readPackage(input), after = readPackage(output); assertPackageLinks(after); for (const [name, bytes] of before) if ((!edits && c.member !== "tab_stops") || name !== "word/document.xml") expect(after.get(name), name).toEqual(bytes); const xml = new api.DocumentXmlEditor(after.get("word/document.xml")!), node = xml.root.children[0]!.children[0]!, rPr = node.children.find(n => n.localName === "pPr"); if (c.member === "tab_stops") expect(Boolean(rPr)).toBe(true); if (edits) { expect(Boolean(rPr)).toBe(c.afterPr); expect(canonical(rPr?.children.map(p => ({tag: p.localName, attrs: Object.fromEntries(p.attributes.filter(a => a.namespace === node.namespace).map(a => [a.localName, a.value]))})) ?? [], strict)).toEqual(canonical(c.after!, strict)); } const doc = await api.Document(output, textContext); expect(doc.paragraphs[0]!.text).toBe("Original é 日本 עברית 🌊"); const text = new TextDecoder().decode(after.get("word/document.xml")); expect(text).toContain('w:rsidR="00ABCDEF"'); expect(text.split("<!--retain-->")).toHaveLength(2); expect(text.split("<?audit keep?>")).toHaveLength(2);
});
