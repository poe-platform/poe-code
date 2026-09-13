import { describe, expect, it } from "vitest";
import { MSO_LANGUAGE_ID } from "./language-enum.js";
import {
  XL_AXIS_CROSSES,
  XL_CHART_TYPE,
  XL_DATA_LABEL_POSITION,
  XL_LABEL_POSITION,
  XL_LEGEND_POSITION
} from "./chart-enums.js";
import { MSO_FILL_TYPE, MSO_LINE, MSO_PATTERN } from "./drawing-enums.js";
import { MSO, MSO_SHAPE_TYPE } from "./shape-types.js";
import { PP_MEDIA_TYPE } from "./media-enum.js";

describe("public enum values and bounded conversions", () => {
  it("retains language aliases and canonical XML tokens", () => {
    expect(MSO_LANGUAGE_ID.ENGLISH_US).toBe(1033);
    expect(MSO_LANGUAGE_ID.to_xml(1033)).toBe("en-US");
    expect(MSO_LANGUAGE_ID.from_xml("pl-PL")).toBe(MSO_LANGUAGE_ID.POLISH);
    expect(MSO_LANGUAGE_ID.KIRGHIZ).toBe(MSO_LANGUAGE_ID.KYRGYZ);
    expect(MSO_LANGUAGE_ID.SESOTHO).toBe(MSO_LANGUAGE_ID.SUTU);
    expect(
      Object.keys(MSO_LANGUAGE_ID).filter(
        (key) => typeof MSO_LANGUAGE_ID[key as keyof typeof MSO_LANGUAGE_ID] === "number"
      )
    ).toHaveLength(216);
  });
  it("retains all chart inspection symbols independently of creation support", () => {
    expect(XL_CHART_TYPE.THREE_D_AREA).toBe(-4098);
    expect(
      Object.keys(XL_CHART_TYPE).filter(
        (key) => typeof XL_CHART_TYPE[key as keyof typeof XL_CHART_TYPE] === "number"
      )
    ).toHaveLength(73);
    expect(XL_LABEL_POSITION).toBe(XL_DATA_LABEL_POSITION);
    expect(XL_DATA_LABEL_POSITION.ABOVE).toBe(0);
    expect(XL_DATA_LABEL_POSITION.from_xml("t")).toBe(0);
    expect(XL_AXIS_CROSSES.to_xml(XL_AXIS_CROSSES.AUTOMATIC)).toBe("autoZero");
    expect(XL_LEGEND_POSITION.to_xml(XL_LEGEND_POSITION.CORNER)).toBe("tr");
  });
  it("adds metadata and XML helpers to existing drawing symbols", () => {
    expect(MSO_FILL_TYPE.metadata(1)).toEqual({ name: "SOLID", value: 1 });
    expect(MSO_LINE.from_xml("sysDot")).toBe(3);
    expect(MSO_LINE.to_xml(6)).toBe("lgDashDotDot");
    expect(MSO_PATTERN.metadata(6)).toEqual({ name: "PERCENT_40", value: 6, xml_value: "pct40" });
    expect(MSO_PATTERN.to_xml(6)).toBe("pct40");
    expect(() => MSO_PATTERN.to_xml(-2)).toThrow();
    expect(MSO).toBe(MSO_SHAPE_TYPE);
  });
  it("retains the documented media numeric collision", () => {
    expect(PP_MEDIA_TYPE.OTHER).toBe(PP_MEDIA_TYPE.SOUND);
    expect(PP_MEDIA_TYPE.MOVIE).toBe(3);
  });
  it.each([null, false, true, "1033", 1.2, NaN, Infinity, {}, undefined])(
    "rejects coerced enum input %s",
    (value) => {
      expect(() => MSO_LANGUAGE_ID.to_xml(value as never)).toThrow();
      expect(() => MSO_LANGUAGE_ID.metadata(value as never)).toThrow();
      expect(() => MSO_LANGUAGE_ID.validate(value as never)).toThrow();
    }
  );
  it("keeps enum definitions and metadata immutable", () => {
    expect(Object.isFrozen(MSO_LANGUAGE_ID)).toBe(true);
    expect(Object.isFrozen(MSO_LANGUAGE_ID.metadata(1033))).toBe(true);
    expect(Reflect.set(MSO_LANGUAGE_ID, "ENGLISH_US", 0)).toBe(false);
    expect(() => MSO_LANGUAGE_ID.from_xml("EN-us")).toThrow();
    expect(() => MSO_LANGUAGE_ID.from_xml(1033 as never)).toThrow();
  });
});

import { MSO_TEXT_UNDERLINE_TYPE, MSO_UNDERLINE } from "./text-runs.js";
import { PROG_ID } from "./ole-enum.js";
it("converts underline values including explicit none without boolean coercion", () => {
  expect(MSO_UNDERLINE).toBe(MSO_TEXT_UNDERLINE_TYPE);
  expect(MSO_UNDERLINE.from_xml("none")).toBe(0);
  expect(MSO_UNDERLINE.to_xml(0)).toBe("none");
  expect(MSO_UNDERLINE.metadata(17)).toEqual({
    name: "WAVY_DOUBLE_LINE",
    value: 17,
    xml_value: "wavyDbl"
  });
  expect(() => MSO_UNDERLINE.to_xml(false as never)).toThrow();
  expect(() => MSO_UNDERLINE.to_xml(-2)).toThrow();
});
it("provides immutable OLE application metadata without host filenames", () => {
  expect(PROG_ID.XLSX.progId).toBe("Excel.Sheet.12");
  expect(PROG_ID.PPTX.width.emu).toBe(965200);
  expect(PROG_ID.DOCX.height.emu).toBe(609600);
  expect(PROG_ID.DOCX.icon_filename).toBe("document-icon");
  expect(PROG_ID.XLSX.value).toBe("XLSX");
  expect(PROG_ID.XLSX.name).toBe("XLSX");
  expect(Object.isFrozen(PROG_ID.XLSX)).toBe(true);
});

import { PP_ACTION, PP_ACTION_TYPE } from "./links-model.js";
import { MSO_FILL, MSO_LINE_DASH_STYLE, MSO_PATTERN_TYPE } from "./drawing-enums.js";
import { MSO_THEME_COLOR, MSO_THEME_COLOR_INDEX } from "./color-enums.js";
import { MSO_CONNECTOR, MSO_CONNECTOR_TYPE } from "./connectors.js";
import { MSO_SHAPE, MSO_AUTO_SHAPE_TYPE } from "./shape-presets.js";
import { PP_PLACEHOLDER, PP_PLACEHOLDER_TYPE } from "./shape-placeholder-types.js";
import { MSO_ANCHOR, MSO_VERTICAL_ANCHOR } from "./text-frame-enums.js";
import { PP_ALIGN, PP_PARAGRAPH_ALIGNMENT } from "./paragraph-alignment.js";
it.each([
  [PP_ACTION, PP_ACTION_TYPE],
  [XL_LABEL_POSITION, XL_DATA_LABEL_POSITION],
  [MSO_FILL, MSO_FILL_TYPE],
  [MSO_LINE, MSO_LINE_DASH_STYLE],
  [MSO_PATTERN, MSO_PATTERN_TYPE],
  [MSO_THEME_COLOR, MSO_THEME_COLOR_INDEX],
  [MSO, MSO_SHAPE_TYPE],
  [MSO_CONNECTOR, MSO_CONNECTOR_TYPE],
  [MSO_SHAPE, MSO_AUTO_SHAPE_TYPE],
  [PP_PLACEHOLDER, PP_PLACEHOLDER_TYPE],
  [MSO_ANCHOR, MSO_VERTICAL_ANCHOR],
  [MSO_UNDERLINE, MSO_TEXT_UNDERLINE_TYPE],
  [PP_ALIGN, PP_PARAGRAPH_ALIGNMENT]
])("retains documented alias identity", (alias, definition) => {
  expect(alias).toBe(definition);
  expect(Object.isFrozen(definition)).toBe(true);
});

import { ValueError } from "./errors.js";
it.each([MSO_SHAPE, MSO_CONNECTOR])(
  "raises the typed value category for unsupported geometry conversion",
  (definition) => {
    expect(() => definition.from_xml("not-a-geometry-token")).toThrow(ValueError);
    expect(() => definition.metadata(999999 as never)).toThrow(ValueError);
  }
);
