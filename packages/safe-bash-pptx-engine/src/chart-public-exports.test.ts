import { expect, it } from "vitest";
import * as sdk from "./index.js";

it("exports neutral chart builders and both category object namespaces", () => {
  for (const name of ["CategoryChartData", "ChartData", "XyChartData", "BubbleChartData"])
    expect(sdk).toHaveProperty(name, expect.any(Function));
  expect(sdk).toHaveProperty("chartData.Categories", expect.any(Function));
  expect(sdk).toHaveProperty("chartData.Category", expect.any(Function));
  expect(sdk).toHaveProperty("chart.Categories", expect.any(Function));
  expect(sdk).toHaveProperty("chart.Category", expect.any(Function));
  for (const name of [
    "ChartTitle",
    "Legend",
    "CategoryAxis",
    "DateAxis",
    "ValueAxis",
    "TickLabels",
    "MajorGridlines",
    "ChartFormat",
    "DataLabel",
    "DataLabels",
    "Marker",
    "Point",
    "BarPlot",
    "BubblePlot",
    "LineSeries"
  ])
    expect(sdk.chart).toHaveProperty(name, expect.any(Function));
});
