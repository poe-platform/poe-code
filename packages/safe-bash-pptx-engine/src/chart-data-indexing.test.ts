import { expect, it } from "vitest";
import { BubbleChartData, CategoryChartData, ChartData, IndexError, XyChartData } from "./index.js";

function collections() {
  const category = new CategoryChartData();
  category.categories = ["Bay", "Hill"];
  const values = category.add_series("Readings", [2, 5]);
  category.add_series("Totals", [3, 7]);
  const xy = new XyChartData();
  const coordinates = xy.add_series("Coordinates");
  coordinates.add_data_point(1, 4);
  coordinates.add_data_point(2, 6);
  const bubble = new BubbleChartData();
  const bubbles = bubble.add_series("Areas");
  bubbles.add_data_point(1, 4, 2);
  bubbles.add_data_point(2, 6, 3);
  const alias = new ChartData();
  alias.add_series("Alias", [1]);
  return [category, category.categories, values, xy, coordinates, bubble, bubbles, alias];
}

it("requires explicit at for negative chart builder collection indexes", () => {
  for (const collection of collections()) {
    const before = [...collection];
    expect(collection[0]).toBe(before[0]);
    expect(collection.at(-1)).toBe(before.at(-1));
    expect(collection.at(-collection.length)).toBe(before[0]);
    expect(collection.slice(-1)).toEqual(before.slice(-1));
    for (const index of [-1, -collection.length, -collection.length - 1])
      expect(() => collection[index]).toThrow(IndexError);
    expect([...collection]).toEqual(before);
  }
});

it("keeps invalid chart builder lookups bounded in both lookup forms", () => {
  for (const collection of collections()) {
    for (const index of [collection.length, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => collection[index]).toThrow(IndexError);
      expect(() => collection.at(index)).toThrow(IndexError);
    }
    expect(() => collection.at(-collection.length - 1)).toThrow(IndexError);
  }
  const empty = new CategoryChartData();
  expect(() => empty[0]).toThrow(IndexError);
  expect(() => empty.at(-1)).toThrow(IndexError);
});
