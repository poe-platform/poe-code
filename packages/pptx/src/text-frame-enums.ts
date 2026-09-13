import { OfficeError } from "./errors.js";

enum AutoSizeValue {
  NONE = 0,
  SHAPE_TO_FIT_TEXT = 1,
  TEXT_TO_FIT_SHAPE = 2,
  MIXED = -2
}
enum VerticalAnchorValue {
  TOP = 1,
  MIDDLE = 3,
  BOTTOM = 4,
  MIXED = -2
}
export interface AutoSizeMetadata {
  readonly name: string;
  readonly value: MSO_AUTO_SIZE;
}
export interface VerticalAnchorMetadata {
  readonly name: string;
  readonly value: MSO_VERTICAL_ANCHOR;
  readonly xml_value: string | null;
}
const sizes: readonly AutoSizeMetadata[] = [
  { name: "NONE", value: 0 },
  { name: "SHAPE_TO_FIT_TEXT", value: 1 },
  { name: "TEXT_TO_FIT_SHAPE", value: 2 },
  { name: "MIXED", value: -2 }
].map((value) => Object.freeze(value));
const anchors: readonly VerticalAnchorMetadata[] = [
  { name: "TOP", value: 1, xml_value: "t" },
  { name: "MIDDLE", value: 3, xml_value: "ctr" },
  { name: "BOTTOM", value: 4, xml_value: "b" },
  { name: "MIXED", value: -2, xml_value: null }
].map((value) => Object.freeze(value));
function invalid(): never {
  throw new OfficeError("invalid-value", "Invalid text frame enumeration value.", "usage");
}
export type MSO_AUTO_SIZE = AutoSizeValue;
export const MSO_AUTO_SIZE = Object.freeze(
  Object.assign(AutoSizeValue, {
    metadata(value: MSO_AUTO_SIZE): AutoSizeMetadata {
      return sizes.find((item) => item.value === value) ?? invalid();
    }
  })
);
export type MSO_VERTICAL_ANCHOR = VerticalAnchorValue;
export const MSO_VERTICAL_ANCHOR = Object.freeze(
  Object.assign(VerticalAnchorValue, {
    metadata(value: MSO_VERTICAL_ANCHOR): VerticalAnchorMetadata {
      return anchors.find((item) => item.value === value) ?? invalid();
    },
    from_xml(xml_value: string): MSO_VERTICAL_ANCHOR {
      return (
        anchors.find((item) => item.xml_value !== null && item.xml_value === xml_value)?.value ??
        invalid()
      );
    },
    to_xml(value: MSO_VERTICAL_ANCHOR): string {
      return anchors.find((item) => item.value === value)?.xml_value ?? invalid();
    },
    validate(value: MSO_VERTICAL_ANCHOR): void {
      if (!anchors.some((item) => item.value === value && item.xml_value !== null)) invalid();
    }
  })
);
export { MSO_VERTICAL_ANCHOR as MSO_ANCHOR };
