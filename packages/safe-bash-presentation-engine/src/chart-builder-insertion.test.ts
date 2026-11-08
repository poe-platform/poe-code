import { expect, it } from "vitest";
import { CategoryChartData } from "./chart-data-model.js";
import { SlidePlaceholder, type SlideShapeOwner } from "./slide-model.js";
import { parseXmlPart } from "./xml.js";

it("passes a detached category builder through placeholder insertion as typed chart data", () => {
  let xml = parseXmlPart(
    new TextEncoder().encode(
      '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="4" name="Chart"/><p:cNvSpPr/><p:nvPr><p:ph type="chart" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sld>'
    ),
    { maxBytes: 2000, maxNodes: 50, maxDepth: 15 }
  );
  let inserted: unknown;
  const owner: SlideShapeOwner = {
    read: () => xml,
    write: () => {},
    insertChart: (_id, options) => {
      inserted = options.data;
      const tree = xml.root.children[0]!.children[0]!;
      xml = xml.spliceChildren(tree, 0, 1, [
        '<p:graphicFrame xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><p:off x="0" y="0"/><p:ext cx="100" cy="100"/></p:xfrm></p:graphicFrame>'
      ]);
    }
  };
  const builder = new CategoryChartData();
  builder.categories = ["Bay"];
  builder.add_series("Count", [3]);
  new SlidePlaceholder(owner, 4).insert_chart("LINE", builder);
  expect(inserted).toEqual(builder.to_chart_data());
});
