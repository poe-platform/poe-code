import { expect, it } from "vitest";
import * as api from "./index.js";

const families = [
  "WD_UNDERLINE", "WD_COLOR_INDEX", "WD_PARAGRAPH_ALIGNMENT", "WD_LINE_SPACING", "WD_TAB_ALIGNMENT", "WD_TAB_LEADER",
  "MSO_THEME_COLOR", "MSO_COLOR_TYPE", "WD_BUILTIN_STYLE", "WD_STYLE_TYPE", "WD_CELL_VERTICAL_ALIGNMENT", "WD_ORIENTATION",
  "WD_TABLE_ALIGNMENT", "WD_ROW_HEIGHT_RULE", "WD_SECTION_START", "WD_TABLE_DIRECTION", "WD_BREAK_TYPE", "WD_INLINE_SHAPE_TYPE", "WD_HEADER_FOOTER_INDEX"
] as const;

for (const family of families) {
  it(`${family} members satisfies the required readonly string map without losing named aliases`, () => {
    const symbols = api[family], entries = Object.entries(symbols.members);
    const members: ReadonlyMap<string, unknown> = symbols.members;
    expect(typeof members.get).toBe("function");
    expect(members.size).toBe(entries.length);
    expect([...members]).toEqual(entries);
    expect([...members.entries()]).toEqual(entries);
    expect([...members.keys()]).toEqual(entries.map(([key]) => key));
    expect([...members.values()]).toEqual(entries.map(([, value]) => value));
    for (const [key, value] of entries) {
      expect(members.get(key)).toBe(value);
      expect(members.has(key)).toBe(true);
      expect(Object.isFrozen(value)).toBe(true);
    }
    expect(members.has("Absent member")).toBe(false);
    expect(members.get("Absent member")).toBeUndefined();
    const visits: unknown[] = [], scope = {};
    members.forEach(function (this: object, value, key, map) {
      expect(this).toBe(scope); expect(map).toBe(members); visits.push([key, value]);
    }, scope);
    expect(visits).toEqual(entries);
    expect(Object.isFrozen(members)).toBe(true);
    expect(Object.keys(members)).toEqual(entries.map(([key]) => key));
  });

  it(`${family} member-map observations cannot change stable enum values or leak mutation authority`, () => {
    const members: ReadonlyMap<string, unknown> = api[family].members;
    expect(typeof members.entries).toBe("function");
    const original = [...members];
    expect(Reflect.get(members, "set")).toBeUndefined();
    expect(Reflect.get(members, "delete")).toBeUndefined();
    expect(Reflect.get(members, "clear")).toBeUndefined();
    expect(() => Map.prototype.set.call(members, "FORGED", {})).toThrow(TypeError);
    expect(() => Object.defineProperty(members, "FORGED", { value: {} })).toThrow(TypeError);
    const entry = members.entries().next().value!;
    entry[0] = "FORGED"; entry[1] = null;
    expect([...members]).toEqual(original);
    members.forEach((_value, _key, map) => expect(map).toBe(members));
    expect(members.get("FORGED")).toBeUndefined();
  });
}

it("readonly member maps retain break aliases while family iteration remains canonical", () => {
  const members: ReadonlyMap<string, unknown> = api.WD_BREAK_TYPE.members;
  expect(typeof members.get).toBe("function");
  expect(members.get("TEXT_WRAPPING")).toBe(api.WD_BREAK_TYPE.LINE_CLEAR_ALL);
  expect(members.get("LINE_CLEAR_ALL")).toBe(api.WD_BREAK_TYPE.LINE_CLEAR_ALL);
  expect(members.size).toBe(11);
  expect([...api.WD_BREAK_TYPE]).toHaveLength(10);
});
