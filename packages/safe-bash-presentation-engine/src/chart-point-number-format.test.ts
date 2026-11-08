import { expect, it } from "vitest";
import { createChartXml, validateChartData } from "./chart-editing.js";
import { parseXmlPart } from "./xml.js";
import { child, required, attr } from "./masters.js";

it("preserves explicit point formats on value caches without changing coordinate formats", () => {
  const data = {
    numberFormat: "0.00",
    series: [
      {
        name: "Size",
        xValues: [2, 4],
        values: [3, 5],
        bubbleSizes: [6, 8],
        numberFormat: "0.0",
        pointNumberFormats: [null, "0%"]
      }
    ]
  };
  const document = parseXmlPart(new TextEncoder().encode(createChartXml("BUBBLE", data)), {
    maxBytes: 32768,
    maxNodes: 1000,
    maxDepth: 32
  });
  const plot = required(required(required(document.root, "chart"), "plotArea"), "bubbleChart");
  const series = required(plot, "ser");
  for (const name of ["xVal", "yVal", "bubbleSize"]) {
    const cache = required(required(required(series, name), "numRef"), "numCache");
    const points = cache.children.filter((node) => node.name.localName === "pt");
    expect(attr(points[0]!, "formatCode")).toBeUndefined();
    expect(attr(points[1]!, "formatCode")).toBe(name === "yVal" ? "0%" : undefined);
    expect(document.text(child(cache, "formatCode")!)).toBe(name === "yVal" ? "0.0" : "0.00");
  }
  for (const pointNumberFormats of [["0"], ["0", 1], ["0", undefined]])
    expect(() =>
      validateChartData({ ...data, series: [{ ...data.series[0]!, pointNumberFormats }] } as never)
    ).toThrow();
});
