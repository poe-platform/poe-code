import { expect, it } from "vitest";
import { lint } from "./index.js";

it("recognizes ArrayBuffer construction in harness code", () => {
  expect(lint("export default () => new ArrayBuffer(8).byteLength").filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
});
