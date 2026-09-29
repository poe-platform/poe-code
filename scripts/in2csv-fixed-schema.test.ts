import { expect, it } from "vitest";
import { evalSyncIn2csv } from "../packages/safe-bash/src/commands/csvkit/index.js";

it.each([0, 1])("reads fixed-width CSV schema records using base %i", base => {
  const schema = new TextEncoder().encode(`column,start,length\nid,${base},3\nlabel,${base + 3},5\n`);
  const input = new TextEncoder().encode("001alpha\n002café \n");
  expect(evalSyncIn2csv(input, ["-s", "/schema.csv", "-"], path => path === "/schema.csv" ? schema : undefined))
    .toBe("id,label\n001,alpha\n002,café\n");
});

it("uses named schema columns and decoded quoted field names", () => {
  const schema = new TextEncoder().encode('\ufefflength,column,start\n3,"item,label",1\n5,value,4\n');
  const input = new TextEncoder().encode("001alpha\n");
  expect(evalSyncIn2csv(input, ["-s", "/schema.csv", "-"], path => path === "/schema.csv" ? schema : undefined))
    .toBe('"item,label",value\n001,alpha\n');
});
