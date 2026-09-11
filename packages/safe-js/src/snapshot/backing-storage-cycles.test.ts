import { expect, it } from "vitest";
import { serialize } from "./serialize.js";
import { restore } from "./restore.js";

it.each([1,2])("rejects an ordinary backing-storage cycle of length %s without exhausting the stack", length => {
  const source="return 0";
  const buffers=Array.from({length},()=>new ArrayBuffer(4));
  const saved=JSON.parse(JSON.stringify(serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{buffers}}],callStack:[],pendingPromises:[],moduleBindings:{}})));
  const nodes=Object.entries(saved.heap as Record<string,Record<string,unknown>>)
    .filter(([,node])=>node.kind==="arraybuffer");
  expect(nodes).toHaveLength(length);
  for (let index=0;index<nodes.length;index++) {
    const node=nodes[index][1];
    delete node.bytes;
    node.buffer={kind:"ref",id:Number(nodes[(index+1)%nodes.length][0])};
  }
  expect(()=>restore(saved,{source})).toThrow(new TypeError("Cyclic backing storage reference."));
});

it("preserves property cycles between a buffer and its view", () => {
  const source="return 0";
  const buffer=new ArrayBuffer(4);
  const view=new Uint8Array(buffer);
  Object.defineProperty(buffer,"view",{value:view});
  const saved=serialize({source,currentAstNodeId:1,
    scopeChain:[{id:"external",bindings:{buffer,view}}],callStack:[],pendingPromises:[],moduleBindings:{}});
  const scope=restore(JSON.parse(JSON.stringify(saved)),{source}).currentScope;
  const restoredBuffer=scope.lookup("buffer");
  const restoredView=scope.lookup("view");
  if (!restoredBuffer.found||!restoredView.found) throw new Error("Missing storage bindings");
  expect((restoredView.value as Uint8Array).buffer).toBe(restoredBuffer.value);
  expect(Object.getOwnPropertyDescriptor(restoredBuffer.value!,"view")?.value).toBe(restoredView.value);
});
