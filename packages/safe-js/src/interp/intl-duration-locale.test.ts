import { expect, it } from "vitest";
import { resolveDurationLocale } from "./intl-duration-locale.js";

it.each([["en", ":"], ["fi", "."], ["da", "."], ["id", "."]])("resolves %s digital separators", (locale, separator) => {
  expect(resolveDurationLocale([locale], {})).toMatchObject({ locale, separator });
});

it("falls back for well-formed unsupported numbering systems", () => {
  expect(resolveDurationLocale(["en"], { numberingSystem: "foobar" })).toMatchObject({ locale: "en", numberingSystem: "latn" });
});

it("respects numbering-system extensions and explicit overrides", () => {
  expect(resolveDurationLocale(["en-u-nu-arab"], {})).toMatchObject({ numberingSystem: "arab" });
  expect(resolveDurationLocale(["en-u-nu-arab"], { numberingSystem: "latn" })).toMatchObject({ numberingSystem: "latn" });
});

it("rejects malformed numbering-system identifiers", () => {
  expect(() => resolveDurationLocale(["en"], { numberingSystem: "a" })).toThrow(RangeError);
});
