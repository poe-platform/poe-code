import { expect, it } from "vitest";
import { lint } from "./index.js";

it("accepts Float16Array in real harness source", () => {
  expect(lint("export default () => new Float16Array([1.5,2.5]).length")
    .filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
});
