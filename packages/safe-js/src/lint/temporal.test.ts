import { expect, it } from "vitest";
import { lint } from "./index.js";

it("recognizes the Temporal namespace exposed by the runtime",()=>{
  expect(lint("export default () => new Temporal.Instant(0n).epochNanoseconds")
    .filter(diagnostic=>diagnostic.severity==="error")).toEqual([]);
});
