import { expect, it } from "vitest";
import { parseNetpbmHeader } from "./netpbm-header.js";

it.each(["P1", "P2", "P3", "P4", "P5", "P6"].flatMap(magic =>
  ["\v", "\f"].map(separator => ({ magic, separator }))
))("recognizes numeric header whitespace in $magic with $separator", ({ magic, separator }) => {
  const header = `${magic}\n2${separator}3${magic === "P1" || magic === "P4" ? "" : `${separator}255`}\n`;
  const bytes = new TextEncoder().encode(header + "\v\f #");
  expect(parseNetpbmHeader(bytes)).toMatchObject({ width: 2, height: 3, dataOffset: header.length });
});
