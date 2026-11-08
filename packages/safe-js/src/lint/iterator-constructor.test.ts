import { expect, it } from "vitest";
import { lint } from "./index.js";

it("recognizes Iterator inheritance in harness source",()=>{
  expect(lint("export default () => { class Counter extends Iterator { next(){return {done:true}} } return new Counter(); }")
    .filter(diagnostic=>diagnostic.severity==="error")).toEqual([]);
});
