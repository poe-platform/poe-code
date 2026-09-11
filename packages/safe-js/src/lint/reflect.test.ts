import { expect, it } from "vitest";
import { lint } from "./index.js";

it("accepts Reflect in harness source", () => {
  expect(lint("export default () => Reflect.ownKeys({answer:42})")
    .filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
});
