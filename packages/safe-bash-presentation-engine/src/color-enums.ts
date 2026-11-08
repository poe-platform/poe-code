import { defineEnum, defineXmlEnum } from "./enum-definition.js";

enum MSO_COLOR_TYPEValues {
  RGB = 1,
  SCHEME = 2,
  HSL = 101,
  PRESET = 102,
  SCRGB = 103,
  SYSTEM = 104
}
export type MSO_COLOR_TYPE = (typeof MSO_COLOR_TYPEValues)[keyof typeof MSO_COLOR_TYPEValues];
export const MSO_COLOR_TYPE = defineEnum(MSO_COLOR_TYPEValues);

const MSO_THEME_COLOR_INDEXValues = {
  NOT_THEME_COLOR: 0,
  ACCENT_1: 5,
  ACCENT_2: 6,
  ACCENT_3: 7,
  ACCENT_4: 8,
  ACCENT_5: 9,
  ACCENT_6: 10,
  BACKGROUND_1: 14,
  BACKGROUND_2: 16,
  DARK_1: 1,
  DARK_2: 3,
  FOLLOWED_HYPERLINK: 12,
  HYPERLINK: 11,
  LIGHT_1: 2,
  LIGHT_2: 4,
  TEXT_1: 13,
  TEXT_2: 15,
  MIXED: -2
} as const;
export type MSO_THEME_COLOR_INDEX =
  (typeof MSO_THEME_COLOR_INDEXValues)[keyof typeof MSO_THEME_COLOR_INDEXValues];
export const MSO_THEME_COLOR_INDEX = defineXmlEnum(MSO_THEME_COLOR_INDEXValues, {
  "0": null,
  "1": "dk1",
  "2": "lt1",
  "3": "dk2",
  "4": "lt2",
  "5": "accent1",
  "6": "accent2",
  "7": "accent3",
  "8": "accent4",
  "9": "accent5",
  "10": "accent6",
  "11": "hlink",
  "12": "folHlink",
  "13": "tx1",
  "14": "bg1",
  "15": "tx2",
  "16": "bg2",
  "-2": null
});
export { MSO_THEME_COLOR_INDEX as MSO_THEME_COLOR };
