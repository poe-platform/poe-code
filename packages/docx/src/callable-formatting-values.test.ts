import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { RGBColor, Length, Inches, Pt, Cm, Mm, Emu, Twips, Font } from "./index.js";
import { InputTypeError, InvalidValueError } from "./archive.js";
import { w } from "../tests/fixtures/text.js";

describe("public formatting constructors", () => {
  it.each([
    ["Length", Length, 914400, "emu"],
    ["Emu", Emu, 914400, "emu"],
    ["Inches", Inches, 1, "in"],
    ["Pt", Pt, 72, "pt"],
    ["Cm", Cm, 2.54, "cm"],
    ["Mm", Mm, 25.4, "mm"],
    ["Twips", Twips, 1440, "twip"]
  ] as const)("supports calls, new and instanceof for %s", (_name, Constructor, input, unit) => {
    for (const value of [Constructor(input), new Constructor(input)]) {
      expect(value).toBeInstanceOf(Constructor);
      expect(value).toBeInstanceOf(Length);
      expect(value).toMatchObject({ emu: 914400, inches: 1, cm: 2.54, mm: 25.4, pt: 72, twips: 1440, value: input, unit });
      expect(Object.isFrozen(value)).toBe(true);
      expect(() => Number(value)).toThrow(InputTypeError);
    }
    for (const invalid of [NaN, Infinity, "1" as unknown as number]) {
      expect(() => Constructor(invalid)).toThrow(InputTypeError);
      expect(() => new Constructor(invalid)).toThrow(InputTypeError);
    }
    expect(() => Constructor(Number.MAX_VALUE)).toThrow(InvalidValueError);
    expect(() => new Constructor(Number.MAX_VALUE)).toThrow(InvalidValueError);
  });

  it("distinguishes unit constructors and preserves EMU alias and rounding", () => {
    expect(Emu).toBe(Length);
    expect(Inches(1)).not.toBeInstanceOf(Pt);
    expect(Pt(72)).not.toBeInstanceOf(Inches);
    expect(new Length(-0.5).emu).toBe(-1);
    expect(new Twips(-0.5).emu).toBe(-318);
  });

  it("supports callable RGBColor while retaining statics and sequence behavior", () => {
    const colors: RGBColor[] = [RGBColor(255, 0, 17), new RGBColor(255, 0, 17), RGBColor.from_string("ff0011")];
    for (const color of colors) {
      expect(color).toBeInstanceOf(RGBColor);
      expect(color.toString()).toBe("FF0011");
      expect([...color]).toEqual([255, 0, 17]);
      expect(color[0]).toBe(255);
      expect(color.at(-1)).toBe(17);
      expect(color.equals(colors[0])).toBe(true);
      expect(Object.isFrozen(color)).toBe(true);
    }
    expect(() => RGBColor(256, 0, 0)).toThrow(InvalidValueError);
    expect(() => new RGBColor(256, 0, 0)).toThrow(InvalidValueError);
    expect(() => RGBColor(1.5, 0, 0)).toThrow(InputTypeError);
    expect(() => new RGBColor(1.5, 0, 0)).toThrow(InputTypeError);
  });

  it("accepts both invocation styles at live formatting boundaries", () => {
    const volume = Volume.fromJSON({ "/r": `<w:r xmlns:w="${w}"/>` });
    const font = new Font({ getXml: () => volume.readFileSync("/r", "utf8") as string, setXml: xml => { volume.writeFileSync("/r", xml); } });
    for (const size of [Pt(12), new Pt(12)]) {
      font.size = size;
      expect(font.size?.pt).toBe(12);
      expect(font.size).toBeInstanceOf(Length);
    }
    for (const color of [RGBColor(255, 0, 17), new RGBColor(255, 0, 17)]) {
      font.color.rgb = color;
      expect(font.color.rgb).toBeInstanceOf(RGBColor);
      expect(font.color.rgb?.equals(color)).toBe(true);
    }
  });
});
