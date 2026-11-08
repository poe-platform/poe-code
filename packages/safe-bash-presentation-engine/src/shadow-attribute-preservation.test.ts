import { expect, it } from "vitest";
import { Shape } from "./index.js";
import { parseXmlPart } from "./xml.js";

const drawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/main";
const presentationNamespace = "http://schemas.openxmlformats.org/presentationml/2006/main";

it.each([
  { shapeTag: "sp", propertyTag: "spPr", present: false, inherit: false },
  { shapeTag: "grpSp", propertyTag: "grpSpPr", present: false, inherit: false },
  { shapeTag: "sp", propertyTag: "spPr", present: true, inherit: true },
  { shapeTag: "grpSp", propertyTag: "grpSpPr", present: true, inherit: true }
])(
  "retains owner attributes for $propertyTag with shadow inheritance $inherit",
  ({ shapeTag, propertyTag, present, inherit }) => {
    for (const attribute of [null, "kept-value"] as const) {
      const model = new Shape(
        parseXmlPart(
          new TextEncoder().encode(
            `<p:${shapeTag} xmlns:p="${presentationNamespace}" xmlns:a="${drawingNamespace}"><p:${propertyTag}${attribute === null ? "" : ` a:retained="${attribute}"`}>${present ? "<a:effectLst/>" : ""}</p:${propertyTag}></p:${shapeTag}>`
          ),
          { maxBytes: 8192, maxNodes: 100, maxDepth: 16 }
        )
      );
      expect(model.shadow.inherit).toBe(!present);
      model.shadow.inherit = inherit;
      expect(model.shadow.inherit).toBe(inherit);
      const properties = model.xml.root.children[0]!;
      expect(properties.name).toEqual({ namespace: presentationNamespace, localName: propertyTag });
      expect(properties.attributes).toEqual(
        attribute === null
          ? []
          : [
              {
                name: { namespace: drawingNamespace, localName: "retained" },
                value: "kept-value"
              }
            ]
      );
      expect(
        properties.children.map((node) => ({
          name: node.name,
          attributes: node.attributes,
          children: node.children
        }))
      ).toEqual(
        inherit
          ? []
          : [
              {
                name: { namespace: drawingNamespace, localName: "effectLst" },
                attributes: [],
                children: []
              }
            ]
      );
      expect(model.xml.root.children).toHaveLength(1);
    }
  }
);
