import { describe, expect, it } from "vitest";
import { AS012 } from "./AS012.js";

function messages(source: string): string[] {
  return AS012(source).map((diagnostic) => diagnostic.message);
}

describe("AS012", () => {
  it("allows supported regex string methods and function replacers", () => {
    expect(
      messages(
        [
          "text.split(/,/);",
          "text.replace(/a/, (match) => match);",
          "text.replaceAll(/a/g, (match) => match);",
          "text.match(/a/);",
          "text.matchAll(/a/g);",
          "text.search(/a/);"
        ].join("\n")
      )
    ).toEqual([]);
  });

  it("reports unsupported sort comparators", () => {
    expect(messages("items.sort((left, right) => left.name.localeCompare(right.name));")).toEqual(
      []
    );
    expect(messages("items.sort((left, right) => left.name > right.name);")).toEqual([
      "Array#sort only supports comparators that are arrows returning a number."
    ]);
  });

  it("visits nested and computed expressions", () => {
    expect(messages("export default () => ({ [text.split(/,/)] : items.sort(compare) });")).toEqual(
      ["Array#sort only supports comparators that are arrows returning a number."]
    );
  });
});
