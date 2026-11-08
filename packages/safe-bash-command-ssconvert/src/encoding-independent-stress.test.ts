import { expect, it } from "vitest";
import { encodingName } from "./encoding/names.js";
import { decodeText } from "./encoding/decode.js";
import { encodeText } from "./encoding/encode.js";
import { converterLocale, exportLocale, runtimeEnvironment } from "./locale/runtime.js";
import type { CapabilityContext } from "./contracts.js";
import { TextConverterUnavailable } from "./codecs/write-failure.js";

const context: CapabilityContext = {
  signal: new AbortController().signal,
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000, outputBytes: 1000, cells: 10, sheets: 1, operations: 10 },
  own() {}
};

it.each(["constructor", "__proto__", "toString"])("does not admit inherited encoding name %s", name => {
  expect(encodingName(name)).toBe(name.toLowerCase());
  expect(decodeText(new Uint8Array([65]), name)).toBe("A");
  expect(() => encodeText("A", name, false, context)).toThrow(TextConverterUnavailable);
});

it.each(["constructor", "__proto__", "toString"])("does not admit inherited locale name %s", name => {
  const environment = { ...context.environment, env: { LC_ALL: name } };
  expect(() => runtimeEnvironment(environment)).toThrow("uncaptured runtime locale");
  expect(() => converterLocale(environment)).toThrow("uncaptured runtime locale");
  expect(exportLocale(context.environment, name)).toBe(context.environment);
});

it("rejects UTF-16 surrogate pairs in UCS-2 overrides and tries import fallback guesses", () => {
  const bytes = new Uint8Array([0x3d, 0xd8, 0, 0xde, 10, 0]);
  expect(decodeText(bytes, "UCS-2LE")).toBe("=Ø\u0000Þ\n\u0000");
  expect(decodeText(bytes, "UTF-16LE")).toBe("😀\n");
});

it.each([
  [[0xe0], "א"],
  [[0xe0, 0xc0], "אְ"],
  [[0xc0, 0xe0], "ְא"],
  [[0xe0, 0xd1], "אׁ"],
  [[0xe0, 0xd2], "אׂ"],
  [[0xe0, 0xfd, 0xfe], "א\u200e\u200f"]
])("retains captured WINDOWS-1255 trailing/combining byte behavior %j", (bytes, expected) => {
  expect(decodeText(new Uint8Array(bytes), "WINDOWS-1255")).toBe(expected);
});

it("encodes CP864 percent characters without importing ASCII percent identity", () => {
  const utf8Context = { ...context, environment: { ...context.environment, env: { LC_ALL: "C.UTF-8" } } };
  expect(encodeText("% ٪ ‰ ‱", "CP864", false, utf8Context))
    .toEqual(new Uint8Array([92, 117, 48, 48, 50, 53, 32, 37, 32, 92, 117, 50, 48, 51, 48, 32, 92, 117, 50, 48, 51, 49]));
  expect(encodeText("% ٪ ‰ ‱", "CP864", true, utf8Context))
    .toEqual(new Uint8Array([63, 32, 37, 32, 63, 32, 63]));
});

it.each(["UTF-8", "UTF-16", "UCS-2", "UTF-32", "CP437"])("preserves cancellation identity before encoding %s", charset => {
  const controller = new AbortController();
  const reason = { cancelled: true };
  controller.abort(reason);
  expect(() => encodeText("😀", charset, true, { ...context, signal: controller.signal })).toThrow(reason);
});

it.each([
  ["UTF-8", "😀", false, 4],
  ["UTF-16", "😀", false, 6],
  ["UTF-32", "😀", false, 8],
  ["UCS-2", "😀", false, 20],
  ["UCS-2", "😀", true, 6],
  ["CP437", "😀", false, 10],
  ["CP437", "😀", true, 3]
])("admits exact encoded byte limits for %s, %s, transliterate %s", (charset, text, transliterate, length) => {
  const utf8Context = { ...context, environment: { ...context.environment, env: { LC_ALL: "C.UTF-8" } },
    limits: { ...context.limits, outputBytes: length } };
  expect(encodeText(text, charset, transliterate, utf8Context)).toHaveLength(length);
  expect(() => encodeText(text, charset, transliterate,
    { ...utf8Context, limits: { ...utf8Context.limits, outputBytes: length - 1 } })).toThrow("output bytes limit exceeded");
});

it.each(["CP437//TRANSLIT", "IBM437//TRANSLIT", "cp437//translit", "CP437//TRANSLIT//TRANSLIT"])
  ("honors measured explicit transliteration suffix after alias resolution %s", charset => {
    const utf8Context = { ...context, environment: { ...context.environment, env: { LC_ALL: "C.UTF-8" } } };
    expect(encodeText("é Ω 😀", charset, false, utf8Context))
      .toEqual(new Uint8Array([130, 32, 234, 32, 58, 45, 68]));
    expect(encodeText("é Ω 😀", charset, true, utf8Context))
      .toEqual(new Uint8Array([130, 32, 234, 32, 58, 45, 68]));
  });

it.each(["CP437//IGNORE", "CP437//garbage", "CP437//TRANSLIT//IGNORE"])
  ("rejects uncaptured export suffix capability honestly %s", charset => {
    expect(() => encodeText("é", charset, false, context)).toThrow("uncaptured export charset");
  });

it("uses measured target-specific scalar replacements and their real output lengths", () => {
  const utf8Context = { ...context, environment: { ...context.environment, env: { LC_ALL: "C.UTF-8" } } };
  expect(encodeText("Ω", "CP437", true, utf8Context)).toEqual(new Uint8Array([234]));
  expect(encodeText("Ω", "ISO-8859-7", true, utf8Context)).toEqual(new Uint8Array([217]));
  expect(encodeText("½", "MACINTOSH", true, utf8Context)).toEqual(new Uint8Array([32, 49, 218, 50, 32]));
  expect(encodeText("½", "MAC-CYRILLIC", true, utf8Context)).toEqual(new Uint8Array([32, 49, 47, 50, 32]));
  expect(encodeText("½", "MACINTOSH", true, { ...utf8Context, limits: { ...context.limits, outputBytes: 5 } }))
    .toEqual(new Uint8Array([32, 49, 218, 50, 32]));
  expect(() => encodeText("½", "MACINTOSH", true,
    { ...utf8Context, limits: { ...context.limits, outputBytes: 4 } })).toThrow("output bytes limit exceeded");
});

it.each(["UCS-2", "UCS-2LE", "UCS-2BE", "UCS-2//TRANSLIT"])
  ("uses measured UCS-2 BMP transliteration rather than ASCII loss for astral Greek %s", charset => {
    const utf8Context = { ...context, environment: { ...context.environment, env: { LC_ALL: "C.UTF-8" } },
      limits: { ...context.limits, outputBytes: 2 } };
    expect(encodeText("𝚨", charset, true, utf8Context))
      .toEqual(new Uint8Array(charset === "UCS-2BE" ? [3, 145] : [145, 3]));
    expect(() => encodeText("𝚨", charset, true,
      { ...utf8Context, limits: { ...utf8Context.limits, outputBytes: 1 } })).toThrow("output bytes limit exceeded");
  });

it.each([
  ["C", [63, 32, 63]],
  ["C.UTF-8", [195, 169, 32, 240, 159, 152, 128]]
])("uses injected locale charset for an empty converter base with TRANSLIT in %s", (locale, expected) => {
  expect(encodeText("é 😀", "//TRANSLIT", false,
    { ...context, environment: { ...context.environment, env: { LC_ALL: locale } } }))
    .toEqual(new Uint8Array(expected));
});

it("preserves native UTF-32 BOM import guessing rather than inventing UTF-32 detection", () => {
  expect(decodeText(new Uint8Array([255, 254, 0, 0, 65, 0, 0, 0, 10, 0, 0, 0])))
    .toBe("\u0000A\u0000\n\u0000");
  expect(decodeText(new Uint8Array([0, 0, 254, 255, 0, 0, 0, 65, 0, 0, 0, 10])))
    .toBe("\u0000\u0000þÿ\u0000\u0000\u0000A\u0000\u0000\u0000\n");
});

it.each([
  ["IBM850", 128, "Ç"], ["IBM852", 128, "Ç"], ["IBM855", 128, "ђ"],
  ["IBM857", 128, "Ç"], ["IBM858", 128, "Ç"], ["IBM860", 128, "Ç"],
  ["IBM861", 128, "Ç"], ["IBM862", 128, "א"], ["IBM863", 128, "Ç"],
  ["IBM864", 128, "°"], ["IBM865", 128, "Ç"], ["IBM866", 128, "А"],
  ["IBM869", 134, "Ά"], ["MAC-UK", 128, "А"]
])("admits measured native canonical converter atom %s", (charset, byte, character) => {
  expect(decodeText(new Uint8Array([byte, 10]), charset)).toBe(character + "\n");
  expect(encodeText(character + "\n", charset, false, context)).toEqual(new Uint8Array([byte, 10]));
});

it("resolves explicit empty TZ as UTC and preserves omitted injected timezone without mutation", () => {
  const configured = { ...context.environment, timezone: "America/Chicago" };
  expect(runtimeEnvironment(configured).timezone).toBe("America/Chicago");
  const emptyTimezone = { ...configured, env: { TZ: "" } };
  expect(runtimeEnvironment(emptyTimezone).timezone).toBe("UTC");
  expect(emptyTimezone.env).toEqual({ TZ: "" });
  expect(emptyTimezone.timezone).toBe("America/Chicago");
});
