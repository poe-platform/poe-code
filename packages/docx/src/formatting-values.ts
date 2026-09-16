import type { DocxLength, DocxEnumNames, DocxEnumValue } from "./operation-types.js";

const enumNumbers = {
  "WD_UNDERLINE": {
    "INHERITED": -1,
    "NONE": 0,
    "SINGLE": 1,
    "WORDS": 2,
    "DOUBLE": 3,
    "DOTTED": 4,
    "THICK": 6,
    "DASH": 7,
    "DOT_DASH": 9,
    "DOT_DOT_DASH": 10,
    "WAVY": 11,
    "DOTTED_HEAVY": 20,
    "DASH_HEAVY": 23,
    "DOT_DASH_HEAVY": 25,
    "DOT_DOT_DASH_HEAVY": 26,
    "WAVY_HEAVY": 27,
    "DASH_LONG": 39,
    "WAVY_DOUBLE": 43,
    "DASH_LONG_HEAVY": 55
  },
  "WD_COLOR_INDEX": {
    "INHERITED": -1,
    "AUTO": 0,
    "BLACK": 1,
    "BLUE": 2,
    "BRIGHT_GREEN": 4,
    "DARK_BLUE": 9,
    "DARK_RED": 13,
    "DARK_YELLOW": 14,
    "GRAY_25": 16,
    "GRAY_50": 15,
    "GREEN": 11,
    "PINK": 5,
    "RED": 6,
    "TEAL": 10,
    "TURQUOISE": 3,
    "VIOLET": 12,
    "WHITE": 8,
    "YELLOW": 7
  },
  "WD_PARAGRAPH_ALIGNMENT": {
    "LEFT": 0,
    "CENTER": 1,
    "RIGHT": 2,
    "JUSTIFY": 3,
    "DISTRIBUTE": 4,
    "JUSTIFY_MED": 5,
    "JUSTIFY_HI": 7,
    "JUSTIFY_LOW": 8,
    "THAI_JUSTIFY": 9
  },
  "WD_LINE_SPACING": {
    "SINGLE": 0,
    "ONE_POINT_FIVE": 1,
    "DOUBLE": 2,
    "AT_LEAST": 3,
    "EXACTLY": 4,
    "MULTIPLE": 5
  },
  "WD_TAB_ALIGNMENT": {
    "LEFT": 0,
    "CENTER": 1,
    "RIGHT": 2,
    "DECIMAL": 3,
    "BAR": 4,
    "LIST": 6,
    "CLEAR": 101,
    "END": 102,
    "NUM": 103,
    "START": 104
  },
  "WD_TAB_LEADER": {
    "SPACES": 0,
    "DOTS": 1,
    "DASHES": 2,
    "LINES": 3,
    "HEAVY": 4,
    "MIDDLE_DOT": 5
  },
  "MSO_THEME_COLOR": {
    "NOT_THEME_COLOR": 0,
    "ACCENT_1": 5,
    "ACCENT_2": 6,
    "ACCENT_3": 7,
    "ACCENT_4": 8,
    "ACCENT_5": 9,
    "ACCENT_6": 10,
    "BACKGROUND_1": 14,
    "BACKGROUND_2": 16,
    "DARK_1": 1,
    "DARK_2": 3,
    "FOLLOWED_HYPERLINK": 12,
    "HYPERLINK": 11,
    "LIGHT_1": 2,
    "LIGHT_2": 4,
    "TEXT_1": 13,
    "TEXT_2": 15
  },
  "MSO_COLOR_TYPE": {
    "RGB": 1,
    "THEME": 2,
    "AUTO": 101
  },
  "WD_BUILTIN_STYLE": {
    "BLOCK_QUOTATION": -85,
    "BODY_TEXT": -67,
    "BODY_TEXT_2": -81,
    "BODY_TEXT_3": -82,
    "BODY_TEXT_FIRST_INDENT": -78,
    "BODY_TEXT_FIRST_INDENT_2": -79,
    "BODY_TEXT_INDENT": -68,
    "BODY_TEXT_INDENT_2": -83,
    "BODY_TEXT_INDENT_3": -84,
    "BOOK_TITLE": -265,
    "CAPTION": -35,
    "CLOSING": -64,
    "COMMENT_REFERENCE": -40,
    "COMMENT_TEXT": -31,
    "DATE": -77,
    "DEFAULT_PARAGRAPH_FONT": -66,
    "EMPHASIS": -89,
    "ENDNOTE_REFERENCE": -43,
    "ENDNOTE_TEXT": -44,
    "ENVELOPE_ADDRESS": -37,
    "ENVELOPE_RETURN": -38,
    "FOOTER": -33,
    "FOOTNOTE_REFERENCE": -39,
    "FOOTNOTE_TEXT": -30,
    "HEADER": -32,
    "HEADING_1": -2,
    "HEADING_2": -3,
    "HEADING_3": -4,
    "HEADING_4": -5,
    "HEADING_5": -6,
    "HEADING_6": -7,
    "HEADING_7": -8,
    "HEADING_8": -9,
    "HEADING_9": -10,
    "HTML_ACRONYM": -96,
    "HTML_ADDRESS": -97,
    "HTML_CITE": -98,
    "HTML_CODE": -99,
    "HTML_DFN": -100,
    "HTML_KBD": -101,
    "HTML_NORMAL": -95,
    "HTML_PRE": -102,
    "HTML_SAMP": -103,
    "HTML_TT": -104,
    "HTML_VAR": -105,
    "HYPERLINK": -86,
    "HYPERLINK_FOLLOWED": -87,
    "INDEX_1": -11,
    "INDEX_2": -12,
    "INDEX_3": -13,
    "INDEX_4": -14,
    "INDEX_5": -15,
    "INDEX_6": -16,
    "INDEX_7": -17,
    "INDEX_8": -18,
    "INDEX_9": -19,
    "INDEX_HEADING": -34,
    "INTENSE_EMPHASIS": -262,
    "INTENSE_QUOTE": -182,
    "INTENSE_REFERENCE": -264,
    "LINE_NUMBER": -41,
    "LIST": -48,
    "LIST_2": -51,
    "LIST_3": -52,
    "LIST_4": -53,
    "LIST_5": -54,
    "LIST_BULLET": -49,
    "LIST_BULLET_2": -55,
    "LIST_BULLET_3": -56,
    "LIST_BULLET_4": -57,
    "LIST_BULLET_5": -58,
    "LIST_CONTINUE": -69,
    "LIST_CONTINUE_2": -70,
    "LIST_CONTINUE_3": -71,
    "LIST_CONTINUE_4": -72,
    "LIST_CONTINUE_5": -73,
    "LIST_NUMBER": -50,
    "LIST_NUMBER_2": -59,
    "LIST_NUMBER_3": -60,
    "LIST_NUMBER_4": -61,
    "LIST_NUMBER_5": -62,
    "LIST_PARAGRAPH": -180,
    "MACRO_TEXT": -46,
    "MESSAGE_HEADER": -74,
    "NAV_PANE": -90,
    "NORMAL": -1,
    "NORMAL_INDENT": -29,
    "NORMAL_OBJECT": -158,
    "NORMAL_TABLE": -106,
    "NOTE_HEADING": -80,
    "PAGE_NUMBER": -42,
    "PLAIN_TEXT": -91,
    "QUOTE": -181,
    "SALUTATION": -76,
    "SIGNATURE": -65,
    "STRONG": -88,
    "SUBTITLE": -75,
    "SUBTLE_EMPHASIS": -261,
    "SUBTLE_REFERENCE": -263,
    "TABLE_COLORFUL_GRID": -172,
    "TABLE_COLORFUL_LIST": -171,
    "TABLE_COLORFUL_SHADING": -170,
    "TABLE_DARK_LIST": -169,
    "TABLE_LIGHT_GRID": -161,
    "TABLE_LIGHT_GRID_ACCENT_1": -175,
    "TABLE_LIGHT_LIST": -160,
    "TABLE_LIGHT_LIST_ACCENT_1": -174,
    "TABLE_LIGHT_SHADING": -159,
    "TABLE_LIGHT_SHADING_ACCENT_1": -173,
    "TABLE_MEDIUM_GRID_1": -166,
    "TABLE_MEDIUM_GRID_2": -167,
    "TABLE_MEDIUM_GRID_3": -168,
    "TABLE_MEDIUM_LIST_1": -164,
    "TABLE_MEDIUM_LIST_1_ACCENT_1": -178,
    "TABLE_MEDIUM_LIST_2": -165,
    "TABLE_MEDIUM_SHADING_1": -162,
    "TABLE_MEDIUM_SHADING_1_ACCENT_1": -176,
    "TABLE_MEDIUM_SHADING_2": -163,
    "TABLE_MEDIUM_SHADING_2_ACCENT_1": -177,
    "TABLE_OF_AUTHORITIES": -45,
    "TABLE_OF_FIGURES": -36,
    "TITLE": -63,
    "TOAHEADING": -47,
    "TOC_1": -20,
    "TOC_2": -21,
    "TOC_3": -22,
    "TOC_4": -23,
    "TOC_5": -24,
    "TOC_6": -25,
    "TOC_7": -26,
    "TOC_8": -27,
    "TOC_9": -28
  },
  "WD_STYLE_TYPE": {
    "CHARACTER": 2,
    "LIST": 4,
    "PARAGRAPH": 1,
    "TABLE": 3
  },
  "WD_CELL_VERTICAL_ALIGNMENT": { "TOP": 0, "CENTER": 1, "BOTTOM": 3, "BOTH": 101 },
  "WD_ORIENTATION": { "PORTRAIT": 0, "LANDSCAPE": 1 },
  "WD_TABLE_ALIGNMENT": { "LEFT": 0, "CENTER": 1, "RIGHT": 2 },
  "WD_ROW_HEIGHT_RULE": { "AUTO": 0, "AT_LEAST": 1, "EXACTLY": 2 },
  "WD_SECTION_START": { "CONTINUOUS": 0, "NEW_COLUMN": 1, "NEW_PAGE": 2, "EVEN_PAGE": 3, "ODD_PAGE": 4 },
  "WD_TABLE_DIRECTION": { "LTR": 0, "RTL": 1 },
  "WD_BREAK_TYPE": { "COLUMN": 8, "LINE": 6, "LINE_CLEAR_LEFT": 9, "LINE_CLEAR_RIGHT": 10, "LINE_CLEAR_ALL": 11, "PAGE": 7, "SECTION_CONTINUOUS": 3, "SECTION_EVEN_PAGE": 4, "SECTION_NEXT_PAGE": 2, "SECTION_ODD_PAGE": 5, "TEXT_WRAPPING": 11 },
  "WD_INLINE_SHAPE_TYPE": { "CHART": 12, "LINKED_PICTURE": 4, "PICTURE": 3, "SMART_ART": 15, "NOT_IMPLEMENTED": -6 },
  "WD_HEADER_FOOTER_INDEX": { "PRIMARY": 1, "FIRST_PAGE": 2, "EVEN_PAGE": 3 }

} as const;
export type FormattingEnum = keyof typeof enumNumbers;
export type EnumMember<K extends FormattingEnum> = DocxEnumValue<K> & Readonly<{ value: number; xml_value?: string | null; toString(): string }>;
type Symbols<K extends FormattingEnum> = { readonly [N in keyof typeof enumNumbers[K]]: EnumMember<K> & Readonly<{ name: K extends "WD_BREAK_TYPE" ? N extends "TEXT_WRAPPING" ? "LINE_CLEAR_ALL" : N : N }> } & Iterable<EnumMember<K>> & Readonly<{
  members: Readonly<{ [N in keyof typeof enumNumbers[K]]: EnumMember<K> }>;
  fromValue(value: number): EnumMember<K>;
  from_xml(value: string | null): EnumMember<K>;
  to_xml(value: DocxEnumValue<K> | number | null): string | null;
}>;
const ownedEnumMembers = new WeakSet<object>();
/** Trusted immutable SDK values are distinct from user-supplied transport objects. */
export function isEnumMember(value: unknown): value is EnumMember<FormattingEnum> { return value !== null && typeof value === "object" && ownedEnumMembers.has(value); }
function symbols<K extends FormattingEnum>(family: K): Symbols<K> {
  const byValue = new Map<number, EnumMember<K>>();
  const entries = Object.entries(enumNumbers[family]).map(([name, value]) => {
    let member = byValue.get(value);
    if (!member) {
      const record = { enum: family, name } as unknown as EnumMember<K>;
      Object.defineProperties(record, {
        value: { value },
        xml_value: { get: () => enumRepresentation(record) },
        toString: { value: () => `${name} (${value})` },
        [Symbol.toPrimitive]: { value: (hint: string) => { if (hint === "string") return `${name} (${value})`; throw new TypeError("Use explicit enum values instead of numeric coercion."); } }
      });
      ownedEnumMembers.add(record); member = Object.freeze(record); byValue.set(value, member);
    }
    return [name, member] as const;
  });
  const members = Object.freeze(Object.fromEntries(entries));
  const result = Object.fromEntries(entries);
  Object.defineProperties(result, {
    members: { value: members },
    fromValue: { value: (value: number) => enumFromValue(family, value) },
    from_xml: { value: (value: string | null) => enumFromXml(family, value) },
    to_xml: { value: (value: DocxEnumValue<K> | number | null) => enumToXml(family, value) },
    [Symbol.iterator]: { value: function* () { yield* byValue.values(); } }
  });
  return Object.freeze(result) as Symbols<K>;
}
export const WD_UNDERLINE = symbols("WD_UNDERLINE");
export const WD_COLOR_INDEX = symbols("WD_COLOR_INDEX");
export const WD_PARAGRAPH_ALIGNMENT = symbols("WD_PARAGRAPH_ALIGNMENT");
export const WD_LINE_SPACING = symbols("WD_LINE_SPACING");
export const WD_TAB_ALIGNMENT = symbols("WD_TAB_ALIGNMENT");
export const WD_TAB_LEADER = symbols("WD_TAB_LEADER");
export const MSO_THEME_COLOR = symbols("MSO_THEME_COLOR");
export const MSO_COLOR_TYPE = symbols("MSO_COLOR_TYPE");
export const WD_BUILTIN_STYLE = symbols("WD_BUILTIN_STYLE");
export const WD_STYLE_TYPE = symbols("WD_STYLE_TYPE");
export const WD_ALIGN_PARAGRAPH = WD_PARAGRAPH_ALIGNMENT;
export const MSO_THEME_COLOR_INDEX = MSO_THEME_COLOR;
export const WD_STYLE = WD_BUILTIN_STYLE;
export const WD_CELL_VERTICAL_ALIGNMENT = symbols("WD_CELL_VERTICAL_ALIGNMENT");
export const WD_ORIENTATION = symbols("WD_ORIENTATION");
export const WD_TABLE_ALIGNMENT = symbols("WD_TABLE_ALIGNMENT");
export const WD_ROW_HEIGHT_RULE = symbols("WD_ROW_HEIGHT_RULE");
export const WD_SECTION_START = symbols("WD_SECTION_START");
export const WD_TABLE_DIRECTION = symbols("WD_TABLE_DIRECTION");
export const WD_BREAK_TYPE = symbols("WD_BREAK_TYPE");
export const WD_INLINE_SHAPE_TYPE = symbols("WD_INLINE_SHAPE_TYPE");
export const WD_HEADER_FOOTER_INDEX = symbols("WD_HEADER_FOOTER_INDEX");
export const WD_ALIGN_VERTICAL = WD_CELL_VERTICAL_ALIGNMENT;
export const WD_ORIENT = WD_ORIENTATION;
export const WD_ROW_HEIGHT = WD_ROW_HEIGHT_RULE;
export const WD_SECTION = WD_SECTION_START;
export const WD_BREAK = WD_BREAK_TYPE;
export const WD_INLINE_SHAPE = WD_INLINE_SHAPE_TYPE;
export const WD_HEADER_FOOTER = WD_HEADER_FOOTER_INDEX;
export const enumFamilies = Object.freeze({ WD_UNDERLINE, WD_COLOR_INDEX, WD_PARAGRAPH_ALIGNMENT, WD_LINE_SPACING, WD_TAB_ALIGNMENT, WD_TAB_LEADER, MSO_THEME_COLOR, MSO_COLOR_TYPE, WD_BUILTIN_STYLE, WD_STYLE_TYPE, WD_CELL_VERTICAL_ALIGNMENT, WD_ORIENTATION, WD_TABLE_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_SECTION_START, WD_TABLE_DIRECTION, WD_BREAK_TYPE, WD_INLINE_SHAPE_TYPE, WD_HEADER_FOOTER_INDEX });
export function enumValue(value: DocxEnumValue<keyof DocxEnumNames>): number {
  if (!isEnumMember(value)) {
    if (value === null || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError("Expected an enum symbol.");
    const fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).length !== 2 || !fields.enum || !fields.name || !("value" in fields.enum) || !("value" in fields.name) || typeof fields.enum.value !== "string" || typeof fields.name.value !== "string") throw new TypeError("Expected an inert enum symbol.");
  }
  if (!Object.hasOwn(enumNumbers, value.enum)) throw new RangeError("Unknown formatting enum family.");
  const family = enumNumbers[value.enum as FormattingEnum];
  if (!family || !Object.hasOwn(family, value.name)) throw new RangeError("Unknown formatting enum symbol.");
  return (family as Readonly<Record<string, number>>)[value.name]!;
}
export function enumFromValue<K extends FormattingEnum>(family: K, value: number): EnumMember<K> {
  if (!Number.isSafeInteger(value)) throw new TypeError("Expected an integer enum value.");
  const numbers = enumNumbers[family]; if (!numbers) throw new RangeError("Unknown formatting enum family.");
  const name = Object.keys(numbers).find(name => (numbers as Readonly<Record<string, number>>)[name] === value);
  if (!name) throw new RangeError("Unknown formatting enum value.");
  return (enumFamilies[family] as unknown as Readonly<Record<string, EnumMember<K>>>)[name]!;
}

export interface Length extends DocxLength {
  readonly emu: number; readonly inches: number; readonly cm: number; readonly mm: number; readonly pt: number; readonly twips: number;
}
const unitScale = { emu: 1, in: 914400, cm: 360000, mm: 36000, pt: 12700, twip: 635 };
const ownedLengths = new WeakSet<object>();
class LengthValue implements Length {
  readonly #emu: number;
  readonly value: number;
  readonly unit: DocxLength["unit"];
  constructor(value: number, unit: DocxLength["unit"]) {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("Expected a finite numeric length.");
    const scaled = value * unitScale[unit], rounded = Math.sign(scaled) * Math.round(Math.abs(scaled));
    if (!Number.isSafeInteger(rounded)) throw new RangeError("Length exceeds safe integer EMUs.");
    this.#emu = rounded; this.value = rounded / unitScale[unit]; this.unit = unit; ownedLengths.add(this); Object.freeze(this);
  }
  get emu(): number { return this.#emu; }
  get inches(): number { return this.emu / 914400; }
  get cm(): number { return this.emu / 360000; }
  get mm(): number { return this.emu / 36000; }
  get pt(): number { return this.emu / 12700; }
  get twips(): number { return Math.sign(this.emu) * Math.round(Math.abs(this.emu) / 635); }
  [Symbol.toPrimitive](): never { throw new TypeError("Use explicit length accessors instead of numeric coercion."); }
}
function lengthConstructor(unit: DocxLength["unit"]): (value: number) => Length { return value => new LengthValue(value, unit); }
export const Length = lengthConstructor("emu");
export const Emu = Length;
export const Inches = lengthConstructor("in");
export const Cm = lengthConstructor("cm");
export const Mm = lengthConstructor("mm");
export const Pt = lengthConstructor("pt");
export const Twips = lengthConstructor("twip");

/** Normalize only the owned immutable value type; arbitrary prototypes remain invalid. */
export function plainLength(value: DocxLength): DocxLength { return ownedLengths.has(value) ? { value: (value as Length).emu, unit: "emu" } : value; }

const enumXmlValues: Readonly<Partial<Record<FormattingEnum, Readonly<Record<string, string | null>>>>> = {
  "WD_UNDERLINE": {
    "INHERITED": null,
    "NONE": "none",
    "SINGLE": "single",
    "WORDS": "words",
    "DOUBLE": "double",
    "DOTTED": "dotted",
    "THICK": "thick",
    "DASH": "dash",
    "DOT_DASH": "dotDash",
    "DOT_DOT_DASH": "dotDotDash",
    "WAVY": "wave",
    "DOTTED_HEAVY": "dottedHeavy",
    "DASH_HEAVY": "dashedHeavy",
    "DOT_DASH_HEAVY": "dashDotHeavy",
    "DOT_DOT_DASH_HEAVY": "dashDotDotHeavy",
    "WAVY_HEAVY": "wavyHeavy",
    "DASH_LONG": "dashLong",
    "WAVY_DOUBLE": "wavyDouble",
    "DASH_LONG_HEAVY": "dashLongHeavy"
  },
  "WD_COLOR_INDEX": {
    "INHERITED": null,
    "AUTO": "default",
    "BLACK": "black",
    "BLUE": "blue",
    "BRIGHT_GREEN": "green",
    "DARK_BLUE": "darkBlue",
    "DARK_RED": "darkRed",
    "DARK_YELLOW": "darkYellow",
    "GRAY_25": "lightGray",
    "GRAY_50": "darkGray",
    "GREEN": "darkGreen",
    "PINK": "magenta",
    "RED": "red",
    "TEAL": "darkCyan",
    "TURQUOISE": "cyan",
    "VIOLET": "darkMagenta",
    "WHITE": "white",
    "YELLOW": "yellow"
  },
  "WD_PARAGRAPH_ALIGNMENT": {
    "LEFT": "left",
    "CENTER": "center",
    "RIGHT": "right",
    "JUSTIFY": "both",
    "DISTRIBUTE": "distribute",
    "JUSTIFY_MED": "mediumKashida",
    "JUSTIFY_HI": "highKashida",
    "JUSTIFY_LOW": "lowKashida",
    "THAI_JUSTIFY": "thaiDistribute"
  },
  "WD_LINE_SPACING": {
    "SINGLE": "UNMAPPED",
    "ONE_POINT_FIVE": "UNMAPPED",
    "DOUBLE": "UNMAPPED",
    "AT_LEAST": "atLeast",
    "EXACTLY": "exact",
    "MULTIPLE": "auto"
  },
  "WD_TAB_ALIGNMENT": {
    "LEFT": "left",
    "CENTER": "center",
    "RIGHT": "right",
    "DECIMAL": "decimal",
    "BAR": "bar",
    "LIST": "list",
    "CLEAR": "clear",
    "END": "end",
    "NUM": "num",
    "START": "start"
  },
  "WD_TAB_LEADER": {
    "SPACES": "none",
    "DOTS": "dot",
    "DASHES": "hyphen",
    "LINES": "underscore",
    "HEAVY": "heavy",
    "MIDDLE_DOT": "middleDot"
  },
  "MSO_THEME_COLOR": {
    "NOT_THEME_COLOR": "UNMAPPED",
    "ACCENT_1": "accent1",
    "ACCENT_2": "accent2",
    "ACCENT_3": "accent3",
    "ACCENT_4": "accent4",
    "ACCENT_5": "accent5",
    "ACCENT_6": "accent6",
    "BACKGROUND_1": "background1",
    "BACKGROUND_2": "background2",
    "DARK_1": "dark1",
    "DARK_2": "dark2",
    "FOLLOWED_HYPERLINK": "followedHyperlink",
    "HYPERLINK": "hyperlink",
    "LIGHT_1": "light1",
    "LIGHT_2": "light2",
    "TEXT_1": "text1",
    "TEXT_2": "text2"
  },
  "WD_STYLE_TYPE": {
    "CHARACTER": "character",
    "LIST": "numbering",
    "PARAGRAPH": "paragraph",
    "TABLE": "table"
  },
  "WD_CELL_VERTICAL_ALIGNMENT": { "TOP": "top", "CENTER": "center", "BOTTOM": "bottom", "BOTH": "both" },
  "WD_ORIENTATION": { "PORTRAIT": "portrait", "LANDSCAPE": "landscape" },
  "WD_TABLE_ALIGNMENT": { "LEFT": "left", "CENTER": "center", "RIGHT": "right" },
  "WD_ROW_HEIGHT_RULE": { "AUTO": "auto", "AT_LEAST": "atLeast", "EXACTLY": "exact" },
  "WD_SECTION_START": { "CONTINUOUS": "continuous", "NEW_COLUMN": "nextColumn", "NEW_PAGE": "nextPage", "EVEN_PAGE": "evenPage", "ODD_PAGE": "oddPage" },
  "WD_HEADER_FOOTER_INDEX": { "PRIMARY": "default", "FIRST_PAGE": "first", "EVEN_PAGE": "even" }

};
function enumRepresentation(value: DocxEnumValue<keyof DocxEnumNames>): string | null | undefined {
  const representations = enumXmlValues[value.enum as FormattingEnum];
  if (!representations) return undefined;
  const representation = representations[value.name];
  return representation === "UNMAPPED" ? null : representation;
}
export function enumToXml<K extends FormattingEnum>(family: K, value: DocxEnumValue<K> | number | null): string | null {
  if (!enumXmlValues[family]) throw new RangeError("Enum family has no XML conversion.");
  if (value === null) return null;
  const number = typeof value === "number" ? value : enumValue(value);
  if (typeof value !== "number" && value.enum !== family) throw new TypeError("Expected a symbol from the declared enum family.");
  const member = enumFromValue(family, number);
  const representation = enumXmlValues[family]?.[member.name];
  if (representation === undefined || representation === "UNMAPPED") throw new RangeError("Enum member has no XML representation.");
  return representation;
}
export function enumXml(value: DocxEnumValue<keyof DocxEnumNames>): string {
  enumValue(value);
  const representation = enumXmlValues[value.enum as FormattingEnum]?.[value.name];
  if (!representation || representation === "UNMAPPED") throw new RangeError("Enum member has no XML representation.");
  return representation;
}
export function enumFromXml<K extends FormattingEnum>(family: K, value: string | null): EnumMember<K> {
  if (value !== null && typeof value !== "string") throw new TypeError("Expected an XML value or null.");
  if (value === "UNMAPPED") throw new RangeError("Enum sentinel has no XML representation.");
  const representations = enumXmlValues[family];
  const name = representations && Object.keys(representations).find(name => representations[name] === value);
  if (name === undefined) throw new RangeError("Unknown enum XML value.");
  return (enumFamilies[family] as unknown as Readonly<Record<string, EnumMember<K>>>)[name]!;
}
export function enumMembers<K extends FormattingEnum>(family: K): readonly EnumMember<K>[] {
  const symbols = enumFamilies[family]; if (!symbols) throw new RangeError("Unknown formatting enum family.");
  return Object.freeze([...symbols]) as unknown as readonly EnumMember<K>[];
}
export function isLength(value: unknown): value is Length { return value !== null && typeof value === "object" && ownedLengths.has(value); }
export function enumString(value: DocxEnumValue<keyof DocxEnumNames>): string {
  const number = enumValue(value);
  return `${value.name} (${number})`;
}
export const WD_COLOR = WD_COLOR_INDEX;
