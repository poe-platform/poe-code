import { OfficeError } from "./errors.js";
const values = {
  BITMAP: 9,
  BODY: 2,
  CENTER_TITLE: 3,
  CHART: 8,
  DATE: 16,
  FOOTER: 15,
  HEADER: 14,
  MEDIA_CLIP: 10,
  OBJECT: 7,
  ORG_CHART: 11,
  PICTURE: 18,
  SLIDE_IMAGE: 101,
  SLIDE_NUMBER: 13,
  SUBTITLE: 4,
  TABLE: 12,
  TITLE: 1,
  VERTICAL_BODY: 6,
  VERTICAL_OBJECT: 17,
  VERTICAL_TITLE: 5,
  MIXED: -2
} as const;
const entries = [
  { name: "BITMAP", value: 9, xml_value: "clipArt" },
  { name: "BODY", value: 2, xml_value: "body" },
  { name: "CENTER_TITLE", value: 3, xml_value: "ctrTitle" },
  { name: "CHART", value: 8, xml_value: "chart" },
  { name: "DATE", value: 16, xml_value: "dt" },
  { name: "FOOTER", value: 15, xml_value: "ftr" },
  { name: "HEADER", value: 14, xml_value: "hdr" },
  { name: "MEDIA_CLIP", value: 10, xml_value: "media" },
  { name: "OBJECT", value: 7, xml_value: "obj" },
  { name: "ORG_CHART", value: 11, xml_value: "dgm" },
  { name: "PICTURE", value: 18, xml_value: "pic" },
  { name: "SLIDE_IMAGE", value: 101, xml_value: "sldImg" },
  { name: "SLIDE_NUMBER", value: 13, xml_value: "sldNum" },
  { name: "SUBTITLE", value: 4, xml_value: "subTitle" },
  { name: "TABLE", value: 12, xml_value: "tbl" },
  { name: "TITLE", value: 1, xml_value: "title" },
  { name: "VERTICAL_BODY", value: 6, xml_value: null },
  { name: "VERTICAL_OBJECT", value: 17, xml_value: null },
  { name: "VERTICAL_TITLE", value: 5, xml_value: null },
  { name: "MIXED", value: -2, xml_value: null }
] as const;
export type PP_PLACEHOLDER_TYPE = (typeof values)[keyof typeof values];
function invalid(): never {
  throw new OfficeError("invalid-value", "Unsupported placeholder type.", "usage");
}
export const PP_PLACEHOLDER_TYPE = Object.freeze(
  Object.assign(values, {
    metadata(value: PP_PLACEHOLDER_TYPE) {
      const item = entries.find((e) => e.value === value);
      return item ? Object.freeze({ ...item }) : invalid();
    },
    from_xml(value: string): PP_PLACEHOLDER_TYPE {
      return entries.find((e) => e.xml_value !== null && e.xml_value === value)?.value ?? invalid();
    },
    to_xml(value: PP_PLACEHOLDER_TYPE): string {
      return entries.find((e) => e.value === value)?.xml_value ?? invalid();
    },
    validate(value: PP_PLACEHOLDER_TYPE): void {
      if (!entries.some((e) => e.value === value && e.xml_value !== null)) invalid();
    }
  })
);
export { PP_PLACEHOLDER_TYPE as PP_PLACEHOLDER };
