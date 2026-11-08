import { expect, it } from "vitest";
import { createModuleNamespace } from "../interp/module-namespace.js";
import { createReplayEncodingContext, decodeReplayData, encodeReplayData } from "./replay-data.js";
import { createSandboxClosure, type SandboxValue } from "../interp/values.js";

it("extends a frozen input graph without recapturing mutated aliases", () => {
  const data={count:0};
  const context=createReplayEncodingContext();
  const initial=encodeReplayData({data},{context});
  const memo={nodes:initial.nodes,values:new Map<number,SandboxValue>()};
  const restored=decodeReplayData(initial,{memo}) as {data:{count:number}};
  data.count++;
  restored.data.count++;
  const namespace=encodeReplayData(createModuleNamespace({data,alias:data}),{context,path:["moduleNamespaces","fixture"]});
  const loaded=decodeReplayData(namespace,{memo}) as {data:{count:number};alias:object};
  expect(loaded.data).toBe(restored.data);
  expect(loaded.alias).toBe(restored.data);
  expect(loaded.data.count).toBe(1);
  expect((decodeReplayData(initial) as {data:{count:number}}).data.count).toBe(0);
});

it("does not reuse decoded identities from an unrelated input graph", () => {
  const first=encodeReplayData({value:1});
  const memo={nodes:first.nodes,values:new Map<number,SandboxValue>()};
  decodeReplayData(first,{memo});
  expect(()=>decodeReplayData(encodeReplayData({value:2}),{memo})).toThrow("graph");
});

it("does not cache a partially decoded namespace when a capability is missing", () => {
  const context = createReplayEncodingContext();
  const initial = encodeReplayData({ data: { count: 0 } }, { context });
  const memo = { nodes: initial.nodes, values: new Map<number, SandboxValue>() };
  const restored = decodeReplayData(initial, { memo });
  const before = new Map(memo.values);
  const read = createSandboxClosure({ call: () => 7 });
  const namespace = encodeReplayData(createModuleNamespace({ read }), {
    context,
    path: ["moduleNamespaces", "fixture"],
    identifyCapability: (_value, path) => JSON.stringify(path)
  });
  expect(() => decodeReplayData(namespace, { memo })).toThrow("Missing replay capability");
  expect(memo.values).toEqual(before);
  const requested: string[] = [];
  const loaded = decodeReplayData(namespace, {
    memo,
    resolveCapability: id => {
      requested.push(id);
      return read;
    }
  }) as { read: SandboxValue };
  expect(requested).toEqual(['["moduleNamespaces","fixture","read"]']);
  expect(loaded.read).toBe(read);
  expect(decodeReplayData(initial, { memo })).toBe(restored);
});

it("shares symbol identities between separately encoded roots", () => {
  const symbol = Symbol("key");
  const context = createReplayEncodingContext();
  const initial = encodeReplayData({ symbol }, { context });
  const memo = { nodes: initial.nodes, values: new Map<number, SandboxValue>() };
  const restored = decodeReplayData(initial, { memo }) as { symbol: symbol };
  const namespace = encodeReplayData(createModuleNamespace({ symbol }), { context });
  const loaded = decodeReplayData(namespace, { memo }) as { symbol: symbol };
  expect(loaded.symbol).toBe(restored.symbol);
});

it("rejects reuse of an encoding context after an incomplete graph extension", () => {
  const context = createReplayEncodingContext();
  const initial = encodeReplayData({ value: 1 }, { context });
  const broken = { read: createSandboxClosure({ call: () => 7 }) };
  expect(() => encodeReplayData(broken, { context })).toThrow("explicit resume capability");
  expect(() => encodeReplayData(broken, { context })).toThrow("incomplete graph");
  expect(decodeReplayData(initial)).toEqual({ value: 1 });
});
