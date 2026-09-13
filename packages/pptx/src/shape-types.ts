import { OfficeError } from "./errors.js";
const values = {
  AUTO_SHAPE: 1,
  CALLOUT: 2,
  CANVAS: 20,
  CHART: 3,
  COMMENT: 4,
  DIAGRAM: 21,
  EMBEDDED_OLE_OBJECT: 7,
  FORM_CONTROL: 8,
  FREEFORM: 5,
  GROUP: 6,
  IGX_GRAPHIC: 24,
  INK: 22,
  INK_COMMENT: 23,
  LINE: 9,
  LINKED_OLE_OBJECT: 10,
  LINKED_PICTURE: 11,
  MEDIA: 16,
  OLE_CONTROL_OBJECT: 12,
  PICTURE: 13,
  PLACEHOLDER: 14,
  SCRIPT_ANCHOR: 18,
  TABLE: 19,
  TEXT_BOX: 17,
  TEXT_EFFECT: 15,
  WEB_VIDEO: 26,
  MIXED: -2
} as const;
export type MSO_SHAPE_TYPE = (typeof values)[keyof typeof values];
const entries = (Object.keys(values) as (keyof typeof values)[]).map((name) =>
  Object.freeze({ name, value: values[name] })
);
export const MSO_SHAPE_TYPE = Object.freeze(
  Object.assign(values, {
    metadata(value: MSO_SHAPE_TYPE) {
      const item = entries.find((e) => e.value === value);
      if (!item) throw new OfficeError("invalid-value", "Unknown shape category.", "usage");
      return item;
    }
  })
);
