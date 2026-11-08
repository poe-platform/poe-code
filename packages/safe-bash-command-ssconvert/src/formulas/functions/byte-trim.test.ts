import { expect, it } from "vitest";
import { textFunctions } from "./text.js";
import { trimByteText } from "./byte-trim.js";
import type { FunctionHost } from "./types.js";
import { byteStringValue } from "../../encoding/byte-value.js";
const host = { scalar(value: unknown) { return value; }, tick() {}, context: {
  limits: { inputBytes: 1000000, outputBytes: 1000000 }, environment: { locale: "C", timezone: "UTC", env: {} }
} } as unknown as FunctionHost;
const bytes = (hex: string) => Uint8Array.from({ length: hex.length / 2 }, (_, index) => parseInt(hex.slice(index * 2, index * 2 + 2), 16));
// Authenticated unmodified Gnumeric TRIM loop with installed GLib and owned zero padding; source/profile receipts in docs/ssconvert.
const native = [
  {
    "id": "expanded-9",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-9-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-119-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-141",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-141-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-152",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-152-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-174",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-174-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-196",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-196-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-240",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-240-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-273",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-273-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-284",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-284-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-317",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-317-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-328",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-328-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-493",
    "inputHex": "24315c6ec324315c6ea462c324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf62ffbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-493-spaces",
    "inputHex": "202024315c6ec324315c6ea462c324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf62ffbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-603",
    "inputHex": "24315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "expanded-603-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6224315c6ec324315c6ea924315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6224315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "capture-71",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "capture-71-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "capture-83",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "capture-83-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "behind-220",
    "inputHex": "58c358a4586258",
    "expectedHex": "58ffbfbfbfbfbfffbfbfbfbfbf586258"
  },
  {
    "id": "behind-220-spaces",
    "inputHex": "202058c358a45862582020",
    "expectedHex": "58ffbfbfbfbfbfffbfbfbfbfbf586258"
  },
  {
    "id": "named-119",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "named-119-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "named-134",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "named-134-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "atomic-251",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-251-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-269",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-269-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-323",
    "inputHex": "24315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf6124315c6e"
  },
  {
    "id": "atomic-323-spaces",
    "inputHex": "202024315c6ec324315c6ea46124315c6ec324315c6ea46124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf6124315c6e"
  },
  {
    "id": "atomic-503",
    "inputHex": "24315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-503-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e24315c6ec324315c6ea424315c6e24315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e24315c6e"
  },
  {
    "id": "atomic-521",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "atomic-521-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "variable-behind-527",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6ec3a424315c6e6124315c6e"
  },
  {
    "id": "variable-behind-527-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec3a424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6ec3a424315c6e6124315c6e"
  },
  {
    "id": "escape-15",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-15-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-32",
    "inputHex": "24315c6ea0",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-32-spaces",
    "inputHex": "202024315c6ea02020",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-48",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-48-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-65",
    "inputHex": "24315c6e85",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-65-spaces",
    "inputHex": "202024315c6e852020",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-82",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-82-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-99",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-99-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-168",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-168-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-185",
    "inputHex": "24315c6ea0",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-185-spaces",
    "inputHex": "202024315c6ea02020",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-201",
    "inputHex": "c224315c6e",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-201-spaces",
    "inputHex": "2020c224315c6e2020",
    "expectedHex": "ffbfbfbfbfbf315c6e"
  },
  {
    "id": "escape-218",
    "inputHex": "24315c6e85",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-218-spaces",
    "inputHex": "202024315c6e852020",
    "expectedHex": "24315c6effbfbfbfbfbf"
  },
  {
    "id": "escape-472",
    "inputHex": "24315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "escape-472-spaces",
    "inputHex": "202024315c6ec324315c6ea424315c6e6124315c6ec324315c6ea424315c6e6124315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e6124315c6e"
  },
  {
    "id": "escape-473",
    "inputHex": "24315c6ec224315c6e8524315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "escape-473-spaces",
    "inputHex": "202024315c6ec224315c6e8524315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "escape-474",
    "inputHex": "24315c6ec224315c6e24315c6e24315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf315c6e24315c6e24315c6e"
  },
  {
    "id": "escape-474-spaces",
    "inputHex": "202024315c6ec224315c6e24315c6e24315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf315c6e24315c6e24315c6e"
  },
  {
    "id": "escape-475",
    "inputHex": "24315c6ee224315c6e8024315c6ea824315c6e",
    "expectedHex": "24315c6effbfbfbfbfbf5c6effbfbfbfbfbf24315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "escape-475-spaces",
    "inputHex": "202024315c6ee224315c6e8024315c6ea824315c6e2020",
    "expectedHex": "24315c6effbfbfbfbfbf5c6effbfbfbfbfbf24315c6effbfbfbfbfbf24315c6e"
  },
  {
    "id": "target-0",
    "inputHex": "",
    "expectedHex": ""
  },
  {
    "id": "target-1",
    "inputHex": "20",
    "expectedHex": ""
  },
  {
    "id": "target-2",
    "inputHex": "202020",
    "expectedHex": ""
  },
  {
    "id": "target-3",
    "inputHex": "202061202020622020",
    "expectedHex": "612062"
  },
  {
    "id": "target-4",
    "inputHex": "09",
    "expectedHex": "09"
  },
  {
    "id": "target-5",
    "inputHex": "c0a0",
    "expectedHex": "20"
  },
  {
    "id": "target-6",
    "inputHex": "c0a020c0a0",
    "expectedHex": "202020"
  },
  {
    "id": "target-7",
    "inputHex": "c181",
    "expectedHex": "41"
  },
  {
    "id": "target-8",
    "inputHex": "e08080",
    "expectedHex": ""
  },
  {
    "id": "target-9",
    "inputHex": "e0808041",
    "expectedHex": ""
  },
  {
    "id": "target-10",
    "inputHex": "eda080",
    "expectedHex": "eda080"
  },
  {
    "id": "target-11",
    "inputHex": "f888808081",
    "expectedHex": "f888808081"
  },
  {
    "id": "target-12",
    "inputHex": "fdbfbfbfbfbf",
    "expectedHex": "fdbfbfbfbfbf"
  },
  {
    "id": "target-13",
    "inputHex": "80",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "id": "target-14",
    "inputHex": "c3",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "id": "target-15",
    "inputHex": "c341",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "id": "target-16",
    "inputHex": "c32041",
    "expectedHex": "ffbfbfbfbfbf41"
  },
  {
    "id": "target-17",
    "inputHex": "fe",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "id": "target-18",
    "inputHex": "ff",
    "expectedHex": "ffbfbfbfbfbf"
  },
  {
    "id": "target-19",
    "inputHex": "41c3",
    "expectedHex": "41ffbfbfbfbfbf"
  },
  {
    "id": "target-20",
    "inputHex": "c2a0",
    "expectedHex": "c2a0"
  },
  {
    "id": "target-21",
    "inputHex": "41c2a0202042",
    "expectedHex": "41c2a02042"
  }
];
it.each(native)("TRIM matches captured raw byte result $id", ({ inputHex, expectedHex }) => {
  expect(textFunctions.TRIM!([byteStringValue(bytes(inputHex), () => {}, 1000000)], host)).toEqual(byteStringValue(bytes(expectedHex), () => {}, 1000000));
});
it("TRIM cooperates after source admission", () => {
  let work = 0;
  expect(() => textFunctions.TRIM!([{ kind: "string", value: "a".repeat(100) }], { ...host, tick() { if (++work === 120) throw false; } })).toThrow();
  expect(work).toBe(120);
});
it("TRIM bounds historical point expansion before publishing", () => {
  expect(() => textFunctions.TRIM!([{ kind: "byte-string", value: "c3" }], { ...host, context: { ...host.context, limits: { ...host.context.limits, outputBytes: 5 } } })).toThrow("text limit");
});
it("TRIM preserves native NUL visibility and rejects malformed visible UTF16", () => {
  expect(textFunctions.TRIM!([{ kind: "string", value: " a \0\ud800" }], host)).toEqual({ kind: "string", value: "a" });
  expect(() => textFunctions.TRIM!([{ kind: "string", value: "\ud800" }], host)).toThrow("text byte representation");
});

it("TRIM owns its result and clips the source before decoding", () => {
  const source = Uint8Array.of(65, 0, 0xc3), result = trimByteText(source, 1, () => {});
  source[0] = 66;
  expect(result).toEqual(Uint8Array.of(65));
  expect(trimByteText(bytes("e080804141"), 0, () => {})).toEqual(new Uint8Array());
});
