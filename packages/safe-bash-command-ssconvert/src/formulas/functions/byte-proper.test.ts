import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";
const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Actual Gnumeric1.12.61 Perl scalar outputs and PROPER results; receipts in docs/ssconvert.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-9-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-9-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-9-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-119-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-119-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-119-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-141-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-141-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-141-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-152-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-152-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-152-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-174-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-174-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-174-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-196-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-196-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-196-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-240-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-240-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-240-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-273-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-273-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-273-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-284-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-284-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-284-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-317-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-317-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-317-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-328-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-328-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-328-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf42ffbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-493-word",
    "inputHex": "612024315c6ec324315c6ea462c324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf42ffbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-493-joined",
    "inputHex": "6124315c6ec324315c6ea462c324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf42ffbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-493-controls",
    "inputHex": "0724315c6ec324315c6ea462c324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf42ffbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "expanded-603-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "expanded-603-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "expanded-603-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6224315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "capture-71-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "capture-71-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "capture-71-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "capture-83-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "capture-83-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "capture-83-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258",
    "expectedHex": "58ffbfbfbfbfbfffbfbfbfbfbf586278"
  },
  {
    "id": "behind-220-word",
    "inputHex": "612058c358a4586258207a",
    "expectedHex": "412058ffbfbfbfbfbfffbfbfbfbfbf586278205a"
  },
  {
    "id": "behind-220-joined",
    "inputHex": "6158c358a45862585a",
    "expectedHex": "4178ffbfbfbfbfbfffbfbfbfbfbf5862787a"
  },
  {
    "id": "behind-220-controls",
    "inputHex": "0758c358a45862580d",
    "expectedHex": "0758ffbfbfbfbfbfffbfbfbfbfbf5862780d"
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "named-119-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "named-119-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "named-119-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "named-134-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "named-134-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "named-134-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e"
  },
  {
    "id": "atomic-251-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e205a"
  },
  {
    "id": "atomic-251-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e7a"
  },
  {
    "id": "atomic-251-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e0d"
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e"
  },
  {
    "id": "atomic-269-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e205a"
  },
  {
    "id": "atomic-269-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e7a"
  },
  {
    "id": "atomic-269-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e0d"
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4e"
  },
  {
    "id": "atomic-323-word",
    "inputHex": "612024315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4e205a"
  },
  {
    "id": "atomic-323-joined",
    "inputHex": "6124315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4e7a"
  },
  {
    "id": "atomic-323-controls",
    "inputHex": "0724315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf4124315c4e0d"
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e"
  },
  {
    "id": "atomic-503-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e205a"
  },
  {
    "id": "atomic-503-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e7a"
  },
  {
    "id": "atomic-503-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e24315c4e0d"
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "atomic-521-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "atomic-521-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "atomic-521-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4ec3a424315c4e6124315c4e"
  },
  {
    "id": "variable-behind-527-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4ec3a424315c4e6124315c4e205a"
  },
  {
    "id": "variable-behind-527-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4ec3a424315c4e6124315c4e7a"
  },
  {
    "id": "variable-behind-527-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4ec3a424315c4e6124315c4e0d"
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-15-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-15-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-15-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0",
    "expectedHex": "24315c4effbfbfbfbfbf"
  },
  {
    "id": "escape-32-word",
    "inputHex": "612024315c6ea0207a",
    "expectedHex": "412024315c4effbfbfbfbfbf205a"
  },
  {
    "id": "escape-32-joined",
    "inputHex": "6124315c6ea05a",
    "expectedHex": "4124315c4effbfbfbfbfbf5a"
  },
  {
    "id": "escape-32-controls",
    "inputHex": "0724315c6ea00d",
    "expectedHex": "0724315c4effbfbfbfbfbf0d"
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-48-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-48-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-48-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85",
    "expectedHex": "24315c4effbfbfbfbfbf"
  },
  {
    "id": "escape-65-word",
    "inputHex": "612024315c6e85207a",
    "expectedHex": "412024315c4effbfbfbfbfbf205a"
  },
  {
    "id": "escape-65-joined",
    "inputHex": "6124315c6e855a",
    "expectedHex": "4124315c4effbfbfbfbfbf5a"
  },
  {
    "id": "escape-65-controls",
    "inputHex": "0724315c6e850d",
    "expectedHex": "0724315c4effbfbfbfbfbf0d"
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-82-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-82-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-82-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-99-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-99-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-99-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-168-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-168-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-168-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0",
    "expectedHex": "24315c4effbfbfbfbfbf"
  },
  {
    "id": "escape-185-word",
    "inputHex": "612024315c6ea0207a",
    "expectedHex": "412024315c4effbfbfbfbfbf205a"
  },
  {
    "id": "escape-185-joined",
    "inputHex": "6124315c6ea05a",
    "expectedHex": "4124315c4effbfbfbfbfbf5a"
  },
  {
    "id": "escape-185-controls",
    "inputHex": "0724315c6ea00d",
    "expectedHex": "0724315c4effbfbfbfbfbf0d"
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c4e"
  },
  {
    "id": "escape-201-word",
    "inputHex": "6120c224315c6e207a",
    "expectedHex": "4120ffbfbfbfbfbf315c4e205a"
  },
  {
    "id": "escape-201-joined",
    "inputHex": "61c224315c6e5a",
    "expectedHex": "41ffbfbfbfbfbf315c4e7a"
  },
  {
    "id": "escape-201-controls",
    "inputHex": "07c224315c6e0d",
    "expectedHex": "07ffbfbfbfbfbf315c4e0d"
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85",
    "expectedHex": "24315c4effbfbfbfbfbf"
  },
  {
    "id": "escape-218-word",
    "inputHex": "612024315c6e85207a",
    "expectedHex": "412024315c4effbfbfbfbfbf205a"
  },
  {
    "id": "escape-218-joined",
    "inputHex": "6124315c6e855a",
    "expectedHex": "4124315c4effbfbfbfbfbf5a"
  },
  {
    "id": "escape-218-controls",
    "inputHex": "0724315c6e850d",
    "expectedHex": "0724315c4effbfbfbfbfbf0d"
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e"
  },
  {
    "id": "escape-472-word",
    "inputHex": "612024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e205a"
  },
  {
    "id": "escape-472-joined",
    "inputHex": "6124315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e7a"
  },
  {
    "id": "escape-472-controls",
    "inputHex": "0724315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e6124315c4e0d"
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "escape-473-word",
    "inputHex": "612024315c6ec224315c6e8524315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "escape-473-joined",
    "inputHex": "6124315c6ec224315c6e8524315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "escape-473-controls",
    "inputHex": "0724315c6ec224315c6e8524315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4effbfbfbfbfbf24315c4e0d"
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf315c4e24315c4e24315c4e"
  },
  {
    "id": "escape-474-word",
    "inputHex": "612024315c6ec224315c6e24315c6e24315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf315c4e24315c4e24315c4e205a"
  },
  {
    "id": "escape-474-joined",
    "inputHex": "6124315c6ec224315c6e24315c6e24315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf315c4e24315c4e24315c4e7a"
  },
  {
    "id": "escape-474-controls",
    "inputHex": "0724315c6ec224315c6e24315c6e24315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf315c4e24315c4e24315c4e0d"
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expectedHex": "24315c4effbfbfbfbfbf5c4effbfbfbfbfbf24315c4effbfbfbfbfbf24315c4e"
  },
  {
    "id": "escape-475-word",
    "inputHex": "612024315c6ee224315c6e8024315c6ea824315c6e207a",
    "expectedHex": "412024315c4effbfbfbfbfbf5c4effbfbfbfbfbf24315c4effbfbfbfbfbf24315c4e205a"
  },
  {
    "id": "escape-475-joined",
    "inputHex": "6124315c6ee224315c6e8024315c6ea824315c6e5a",
    "expectedHex": "4124315c4effbfbfbfbfbf5c4effbfbfbfbfbf24315c4effbfbfbfbfbf24315c4e7a"
  },
  {
    "id": "escape-475-controls",
    "inputHex": "0724315c6ee224315c6e8024315c6ea824315c6e0d",
    "expectedHex": "0724315c4effbfbfbfbfbf5c4effbfbfbfbfbf24315c4effbfbfbfbfbf24315c4e0d"
  }
];
it.each(native)("PROPER matches native byte and word state $id", ({ inputHex, expectedHex }) => {
 expect(textFunctions.PROPER!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual(byteStringValue(bytes(expectedHex), () => {}, 1000000));
});
// Unmodified native source loop with GLib2.90.0 and owned zero padding.
const raw = [
  {
    "inputHex": "",
    "expectedHex": ""
  },
  {
    "inputHex": "09",
    "expectedHex": "09"
  },
  {
    "inputHex": "070d",
    "expectedHex": "070d"
  },
  {
    "inputHex": "202061202020622020",
    "expectedHex": "202041202020422020"
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
    "expectedHex": ""
  },
  {
    "inputHex": "eda080",
    "expectedHex": "eda080"
  },
  {
    "inputHex": "f888808081",
    "expectedHex": "f888808081"
  },
  {
    "inputHex": "fdbfbfbfbfbf",
    "expectedHex": "fdbfbfbfbfbf"
  },
  {
    "inputHex": "80",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "inputHex": "c3",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "inputHex": "c341",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "inputHex": "c32041",
    "expectedHex": "ffbfbfbfbfbf41"
  },
  {
    "inputHex": "fe",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "inputHex": "ff",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "inputHex": "41c3",
    "expectedHex": "41ffbfbfbfbfbf"
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
    "expectedHex": "c2ad"
  },
  {
    "inputHex": "e2808b",
    "expectedHex": "e2808b"
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
    "expectedHex": "efbfbf"
  },
  {
    "inputHex": "f09f9880",
    "expectedHex": "f09f9880"
  },
  {
    "inputHex": "f48fbfbf",
    "expectedHex": "f48fbfbf"
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
    "expectedHex": "0141"
  },
  {
    "inputHex": "e19ab041",
    "expectedHex": "e19ab061"
  },
  {
    "inputHex": "efbbbfff41",
    "expectedHex": "efbbbfffbfbfbfbfbf41"
  },
  {
    "inputHex": "f0908080",
    "expectedHex": "f0908080"
  },
  {
    "inputHex": "61c3415a",
    "expectedHex": "41ffbfbfbfbfbf5a"
  },
  {
    "inputHex": "61c3205a",
    "expectedHex": "41ffbfbfbfbfbf5a"
  },
  {
    "inputHex": "c1814243",
    "expectedHex": "416263"
  },
  {
    "inputHex": "e0808041",
    "expectedHex": ""
  },
  {
    "inputHex": "61e08080425a",
    "expectedHex": "41"
  },
  {
    "inputHex": "c39f455441",
    "expectedHex": "c39f657461"
  },
  {
    "inputHex": "c4b06142",
    "expectedHex": "c4b06162"
  },
  {
    "inputHex": "ce9fcea3",
    "expectedHex": "ce9fcf83"
  },
  {
    "inputHex": "61cc815a",
    "expectedHex": "41cc815a"
  },
  {
    "inputHex": "6162e2808b6364",
    "expectedHex": "4162e2808b4364"
  },
  {
    "inputHex": "f09090a841",
    "expectedHex": "f090908061"
  }
];
it.each(raw)("PROPER matches native historical/control chunk $inputHex", ({ inputHex, expectedHex }) => {
 expect(textFunctions.PROPER!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual(byteStringValue(bytes(expectedHex), () => {}, 1000000));
});
it("PROPER bounds historical invalid point expansion", () => {
 expect(() => textFunctions.PROPER!([{kind:"byte-string",value:"c3"}], {...host,context:{...host.context,limits:{...host.context.limits,outputBytes:5}}})).toThrow("text limit");
 expect(textFunctions.PROPER!([{kind:"byte-string",value:"c3"}], {...host,context:{...host.context,limits:{...host.context.limits,outputBytes:6}}})).toEqual({kind:"byte-string",value:"ffbfbfbfbfbf"});
});
it("PROPER cooperates during point admission without further work", () => {
 let work=0;expect(()=>textFunctions.PROPER!([{kind:"string",value:"a".repeat(100)}],{...host,tick(){if(++work===130)throw false;}})).toThrow();expect(work).toBe(130);
});
it("PROPER clips host NUL tails and refuses visible malformed UTF16", () => {
 expect(textFunctions.PROPER!([{kind:"string",value:"a\0\ud800"}],host)).toEqual({kind:"string",value:"A"});
 expect(()=>textFunctions.PROPER!([{kind:"string",value:"\ud800"}],host)).toThrow("text byte representation");
});
