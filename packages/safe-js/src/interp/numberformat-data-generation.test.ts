import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { BigDecimal } from "@formatjs/bigdecimal";
import { extractNumberFormatData, numberFormatDataModule, extractPluralRulesData, isolateNumberFormatEngine, isolatePluralRulesEngine, mergeSubsecondUnitData } from "../../scripts/numberformat-data.mjs";

it("merges only required subsecond patterns without mutating existing locale data", () => {
  const existing = { locale: "en", data: { units: { compound: { keep: true }, simple: { meter: { long: { other: "{0} meters" } } } } } };
  const units = Object.fromEntries(["long", "short", "narrow"].map(style => [style, Object.fromEntries(["microsecond", "nanosecond"].map(unit => [`duration-${unit}`, { displayName: "unused", "unitPattern-count-other": `{0} ${unit}`, perUnitPattern: `{0} per ${unit}` }]))]));
  const merged = mergeSubsecondUnitData(existing, { main: { en: { units } } });
  expect(merged.data.units.simple.microsecond).toEqual({ long: { other: "{0} microsecond" }, short: { other: "{0} microsecond" }, narrow: { other: "{0} microsecond" }, perUnit: { long: "{0} per microsecond", short: "{0} per microsecond", narrow: "{0} per microsecond" } });
  expect(merged.data.units.simple.meter).toEqual(existing.data.units.simple.meter);
  expect(merged.data.units.compound).toEqual({ keep: true });
  expect(Object.keys(existing.data.units.simple)).toEqual(["meter"]);
});

it("rejects missing supplemental unit data", () => {
  expect(() => mergeSubsecondUnitData({ locale: "en", data: { units: { simple: {} } } }, { main: { en: { units: {} } } })).toThrow();
});

it("preserves exact locale-rule comparisons and rejects changed operand initializers", () => {
  const expression = '{locale:"en",data:{fn:function(num){const numStr=String(num);const parts=numStr.split(".");const integerPart=parts[0];const n=Math.abs(parseFloat(numStr));const i=Math.floor(Math.abs(parseFloat(integerPart)));if(i % 10 === 1 && n > 1)return "one";return "other";}}}';
  const source = `if(Intl.PluralRules){Intl.PluralRules.__addLocaleData(${expression})}`;
  const converted = extractPluralRulesData(source, "en.js");
  const record = runInNewContext(`(${converted.expression})`, { BigDecimal });
  expect(record.data.fn("10000000000000000001")).toBe("one");
  expect(record.data.fn("1.0000000000000000001")).toBe("one");
  expect(record.data.fn("1")).toBe("other");
  expect(() => extractPluralRulesData(source.replace("Math.abs(parseFloat(numStr))", "parseFloat(numStr)"), "en.js")).toThrow("initializer");
});

const wrapper = (value: string) => `if (Intl.NumberFormat && typeof Intl.NumberFormat.__addLocaleData === 'function') { Intl.NumberFormat.__addLocaleData(${value}); }`;

it("extracts locale data without executing the dependency's global registration", () => {
  const data = { locale: "en", data: { numbers: { value: "test" } } };
  expect(extractNumberFormatData(wrapper(JSON.stringify(data)), "en.js")).toEqual(data);
});

it.each([
  "({locale:'en',data:globalThis.sideEffect()})",
  '{"locale":"en","data":{},"extra":true}',
  '{"locale":7,"data":{}}',
  '{"locale":"en","data":null}'
])("rejects code or malformed data instead of evaluating it: %s", payload => {
  expect(() => extractNumberFormatData(wrapper(payload), "en.js")).toThrow();
});

it("rejects unexpected registration calls and extra script statements", () => {
  const source = wrapper('{"locale":"en","data":{}}');
  expect(() => extractNumberFormatData(source.replace("Intl.NumberFormat.__addLocaleData(", "other("), "en.js")).toThrow();
  expect(() => extractNumberFormatData(source + "sideEffect();", "en.js")).toThrow();
});

it("generates lazy data factories with deterministic locale keys", () => {
  const values = [{ locale: "fr", data: {} }, { locale: "en", data: {} }];
  const source = numberFormatDataModule(values);
  expect(source).toContain('"en": () => (');
  expect(source.indexOf('"en": () => (')).toBeLessThan(source.indexOf('"fr": () => ('));
  expect(source).not.toContain("Intl.NumberFormat");
  expect(source).not.toContain("eval");
});

it("rejects duplicate locale registrations", () => {
  expect(() => numberFormatDataModule([{ locale: "en", data: {} }, { locale: "en", data: {} }])).toThrow();
});

it("interns repeated locale data without losing fresh object semantics", async () => {
  const shared = JSON.parse('{"__proto__":{"safe":true},"values":[0,1,null,false,"العربية",{"label":"a long repeated label"}]}');
  const values = Array.from({ length: 20 }, (_, index) => ({ locale: `en-x-${index}`, data: { shared, repeated: shared } }));
  const source = numberFormatDataModule(values);
  expect(Buffer.byteLength(source)).toBeLessThan(Buffer.byteLength(JSON.stringify(values)));
  const generated = await import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  for (const value of values) expect(generated.localeData[value.locale]()).toEqual(value);
  const first = generated.localeData[values[0]!.locale]();
  first.data.shared.values.push("changed");
  expect(first.data.repeated).toEqual(shared);
  expect(generated.localeData[values[0]!.locale]()).toEqual(values[0]);
  expect(Object.hasOwn(first.data.shared, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(first.data.shared)).toBe(Object.prototype);
});

it("preserves the dependency's license as a bundler-retained legal comment", () => {
  const license = "MIT License\nCopyright example";
  expect(numberFormatDataModule([{ locale: "en", data: {} }], license)).toContain(`/*!\n${license}\n*/`);
});

it("extracts a plural-rule factory without copying its global registration", () => {
  const expression = '{"locale":"en","data":{"fn":function(n){return n===1?"one":"other"}}}';
  const source = `if(Intl.PluralRules){Intl.PluralRules.__addLocaleData(${expression})}else{globalThis.registry=[]}`;
  expect(extractPluralRulesData(source, "en.js")).toEqual({ locale: "en", expression });
});

it("rejects executable plural-data initializers outside rule functions", () => {
  expect(() => extractPluralRulesData('if(Intl.PluralRules){Intl.PluralRules.__addLocaleData({locale:"en",data:sideEffect()})}', "en.js")).toThrow();
});

it("retains valid legacy locale aliases from the plural dataset", () => {
  const expression = '{"locale":"tl","data":{"fn":function(){return "other"}}}';
  expect(extractPluralRulesData(`if(Intl.PluralRules){Intl.PluralRules.__addLocaleData(${expression})}`, "tl.js").locale).toBe("tl");
});

it("gives the copied number engine a private Intl binding and removes stale source maps", () => {
  const operands = Array.from({ length: 5 }, () => "selectPlural(pl,roundedNumber.toNumber(),rules);").join("");
  const source = 'function IsWellFormedUnitIdentifier(unit){unit = toLowerCase(unit);return true;}const SANCTIONED_UNITS=["duration-millisecond"];const denominator=denominatorPattern.replace("{0}", "");' + operands + 'export const make=()=>new Intl.PluralRules();\n//# sourceMappingURL=index.js.map';
  const generated = isolateNumberFormatEngine(source, "MIT notice");
  expect(generated).toContain('import { numberFormatIntl as Intl }');
  expect(generated).toContain("new Intl.PluralRules()");
  expect(generated).toContain("MIT notice");
  expect(generated).not.toContain("sourceMappingURL");
  expect(generated).not.toContain("globalThis.Intl =");
  expect(generated).not.toContain("unit = toLowerCase(unit)");
  expect(() => isolateNumberFormatEngine(source.replace("unit = toLowerCase(unit);", "unit = unit.trim();"), "MIT")).toThrow("unit case conversion");
  expect(generated).toContain('"duration-microsecond","duration-nanosecond"');
  expect(() => isolateNumberFormatEngine(source.replace("duration-millisecond", "changed"), "MIT")).toThrow("unit list");
  expect(generated).toContain('denominatorPattern.replace("{0}", "").trim()');
  expect(() => isolateNumberFormatEngine(source.replace("denominatorPattern", "different"), "MIT")).toThrow("denominator");
  expect(generated).toContain("selectPlural(pl,roundedNumber.toString(),rules)");
  expect(() => isolateNumberFormatEngine(source.replace("roundedNumber.toNumber()", "other.toNumber()"), "MIT")).toThrow("operand");
});

it("rejects unexpected engine shape instead of silently leaving host plural rules", () => {
  expect(() => isolateNumberFormatEngine("export const make=()=>7", "MIT")).toThrow();
  expect(() => isolateNumberFormatEngine("const Intl={};export const make=()=>new Intl.PluralRules()", "MIT")).toThrow();
});

it("retains exact formatted plural text and rejects changed dependency shapes", () => {
  const source = 'function ResolvePluralInternal(){return PluralRuleSelect(locale, type, n, GetOperands(s, exponent));}\nfunction PluralRuleSelect(locale,type,n,operands){return "broken";}\nvar PluralRules=class PluralRules{resolvedOptions(){const internalSlots=getInternalSlots(this);const opts={};return opts;}};\nfunction ResolvePluralRange(pluralRules,x,y,context){if (!x.isFinite() || !y.isFinite()) throw new RangeError("finite");return "other";}\n//# sourceMappingURL=index.js.map';
  const generated = isolatePluralRulesEngine(source, "MIT notice");
  expect(generated).toContain("PluralRuleSelect(locale, type, s, exponent)");
  expect(generated).toContain('fn(formattedString, type === "ordinal", exponent)');
  expect(generated).not.toContain("GetOperands(s, exponent)");
  expect(generated).not.toContain("sourceMappingURL");
  expect(generated).toContain("MIT notice");
  for (const field of ["roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay"])
    expect(generated).toContain(`opts.${field} = internalSlots.${field};`);
  expect(() => isolatePluralRulesEngine(source.replace("return opts;", "return different;"), "MIT")).toThrow("resolved-options shape");
  expect(generated).toContain("x.isNaN() || y.isNaN()");
  expect(() => isolatePluralRulesEngine(source.replace("!x.isFinite()", "x.isNaN()"), "MIT")).toThrow("range guard");
  expect(() => isolatePluralRulesEngine(source.replace("GetOperands(s, exponent)", "differentOperands(s)"), "MIT")).toThrow();
  expect(() => isolatePluralRulesEngine("export const other=1;", "MIT")).toThrow();
});
