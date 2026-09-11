import { expect, it } from "vitest";
import { lint } from "./index.js";

it.each(["BigInt64Array", "BigUint64Array"])("accepts %s in real harness source", name => {
  expect(lint(`export default () => new ${name}([1n,2n]).length`)
    .filter(diagnostic => diagnostic.severity === "error")).toEqual([]);
});
