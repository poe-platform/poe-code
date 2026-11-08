import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { decodeText } from "./encoding/decode.js";
import { converterLocale, localeCategory, runtimeEnvironment } from "./locale/runtime.js";

// Independent negative controls: ASCII payloads must not accidentally promote
// native-only converters into supported capabilities.
it.each(["WINDOWS-31J", "CP932", "CSISO2022JP", "GB18030", "EUC-KR", "JOHAB",
  "BIG5-HKSCS", "SHIFT_JISX0213", "IBM-930", "UTF-7-IMAP"])(
  "refuses native-only import %s before guessing the ASCII payload", charset => {
    expect(() => decodeText(new Uint8Array([65, 10]), charset))
      .toThrow("uncaptured import charset");
  }
);

it.each(["no-such-charset", " shift_jis", "SHIFT_JIS ", "x-shift-jis"])(
  "preserves native unknown-override guessing rather than normalizing %s", charset => {
    expect(decodeText(new Uint8Array([0xc3, 0xa9, 10]), charset)).toBe("é\n");
  }
);

it.each(["UTF-8//IGNORE", "UTF-16LE//TRANSLIT", "CP1252//garbage", "BIG5//IGNORE"])(
  "does not admit unmeasured import modifier %s", charset => {
    expect(() => decodeText(new Uint8Array([65, 10]), charset))
      .toThrow("uncaptured import charset");
  }
);

it.each([
  ["UTF-32LE", [65, 0, 0, 0, 0xff], "A"],
  ["UTF-32BE", [0, 0, 0, 65, 0xff], "A"],
  ["UTF-16LE", [65, 0, 0xff], "A"],
  ["UTF-16BE", [0, 65, 0xff], "A"],
  ["UTF-8", [65, 0xf0, 0x9f], "A"]
])("keeps truncated-tail consumed-prefix behavior in sliced %s views", (charset, payload, expected) => {
  const backing = new Uint8Array([255, ...payload, 255]);
  const view = backing.subarray(1, backing.length - 1);
  expect(decodeText(view, charset)).toBe(expected);
  expect(backing[0]).toBe(255);
  expect(backing[backing.length - 1]).toBe(255);
});

it("decodes a foreign-realm offset UTF-32 view without host-instance admission", () => {
  const bytes: Uint8Array = runInNewContext("new Uint8Array([255, 65, 0, 0, 0, 255]).subarray(1, 5)");
  expect(bytes instanceof Uint8Array).toBe(false);
  expect(decodeText(bytes, "UTF-32LE")).toBe("A");
});

it("uses nonempty LC_ALL to mask unsupported lower-precedence locale requests", () => {
  const environment = { env: { LC_ALL: "C", LC_CTYPE: "de_DE.UTF-8", LC_NUMERIC: "missing",
    LC_TIME: "missing", LANG: "missing" }, locale: "missing", timezone: "UTC" };
  expect(runtimeEnvironment(environment).locale).toBe("C");
  expect(converterLocale(environment)).toBe("C");
});

it("resolves each category independently when LC_ALL is explicitly empty", () => {
  const environment = { env: { LC_ALL: "", LC_CTYPE: "C.utf8", LC_NUMERIC: "POSIX", LC_TIME: "C",
    LANG: "missing" }, locale: "missing", timezone: "UTC" };
  expect(localeCategory(environment, "LC_NUMERIC")).toBe("C");
  expect(localeCategory(environment, "LC_TIME")).toBe("C");
  expect(converterLocale(environment)).toBe("C.UTF-8");
  expect(runtimeEnvironment(environment).locale).toBe("C");
  expect(environment.env.LC_ALL).toBe("");
});

it.each(["LC_CTYPE", "LC_NUMERIC", "LC_TIME"] as const)(
  "does not hide an unsupported %s behind an available LANG", category => {
    const environment = { env: { [category]: "missing", LANG: "C.UTF-8" }, locale: "C", timezone: "UTC" };
    expect(() => runtimeEnvironment(environment)).toThrow("uncaptured runtime locale missing");
  }
);
