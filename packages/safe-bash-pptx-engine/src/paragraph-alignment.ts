import { ValueError } from "./errors.js";

enum AlignmentValue {
  LEFT = 1,
  CENTER = 2,
  RIGHT = 3,
  JUSTIFY = 4,
  DISTRIBUTE = 5,
  THAI_DISTRIBUTE = 6,
  JUSTIFY_LOW = 7,
  MIXED = -2
}

export interface ParagraphAlignmentMetadata {
  readonly name: string;
  readonly value: PP_PARAGRAPH_ALIGNMENT;
  readonly xml_value: string | null;
}
const alignmentMetadata = [
  { name: "LEFT", value: 1, xml_value: "l" },
  { name: "CENTER", value: 2, xml_value: "ctr" },
  { name: "RIGHT", value: 3, xml_value: "r" },
  { name: "JUSTIFY", value: 4, xml_value: "just" },
  { name: "DISTRIBUTE", value: 5, xml_value: "dist" },
  { name: "THAI_DISTRIBUTE", value: 6, xml_value: "thaiDist" },
  { name: "JUSTIFY_LOW", value: 7, xml_value: "justLow" },
  { name: "MIXED", value: -2, xml_value: null }
].map((value) => Object.freeze(value)) as readonly ParagraphAlignmentMetadata[];

function invalid(): never {
  throw new ValueError("Invalid paragraph alignment value.");
}

export type PP_PARAGRAPH_ALIGNMENT = AlignmentValue;
export const PP_PARAGRAPH_ALIGNMENT = Object.freeze(
  Object.assign(AlignmentValue, {
    metadata(value: PP_PARAGRAPH_ALIGNMENT): ParagraphAlignmentMetadata {
      const found = alignmentMetadata.find((item) => item.value === value);
      return found ?? invalid();
    },
    from_xml(xml_value: string): PP_PARAGRAPH_ALIGNMENT {
      const found = alignmentMetadata.find(
        (item) => item.xml_value !== null && item.xml_value === xml_value
      );
      return found?.value ?? invalid();
    },
    to_xml(value: PP_PARAGRAPH_ALIGNMENT): string {
      const found = alignmentMetadata.find((item) => item.value === value);
      return found?.xml_value ?? invalid();
    },
    validate(value: PP_PARAGRAPH_ALIGNMENT): void {
      if (!alignmentMetadata.some((item) => item.value === value && item.xml_value !== null))
        invalid();
    }
  })
);
export { PP_PARAGRAPH_ALIGNMENT as PP_ALIGN };
