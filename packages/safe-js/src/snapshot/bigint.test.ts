import { expect, it } from "vitest";
import { encodeReplayData, decodeReplayData } from "./replay-data.js";
import { run } from "../run.js";
import { dump } from "../dump.js";
import { restore } from "../restore.js";

it.each([0n,1n,-1n,9007199254740993n,-9007199254740993n])("round-trips BigInt %s through JSON replay data", value => {
  const data=encodeReplayData([value,{value}]);
  expect(decodeReplayData(JSON.parse(JSON.stringify(data)))).toEqual([value,{value}]);
});

it.each(["", "01", "-0", "+1", " 1", "1 ", "0xff", "1.0", "1e2", "1n", "-", 1, null])("rejects noncanonical BigInt replay payload %j", value => {
  expect(()=>decodeReplayData({root:{tag:"bigint",value},nodes:[]})).toThrow();
});

it("preserves exact BigInt bindings and literals across checkpoint transport", async () => {
  const source="const value=9007199254740993n;await 0;return [value,input];";
  const bindings={input:9007199254740995n};
  const pending=run(source,{bindings});
  const completed=pending.catch(error=>error);
  try {
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    const expected={ok:true,returnValue:[9007199254740993n,9007199254740995n]};
    expect(await completed).toMatchObject(expected);
    expect(await run(source,{snapshot,bindings})).toMatchObject(expected);
  } finally { await completed; }
});

it("preserves boxed BigInts and their properties across a checkpoint", async () => {
  const source="const box=Object(9007199254740993n);box.extra=2n;await 0;return [box.valueOf(),box.extra];";
  const pending=run(source);
  const completed=pending.catch(error=>error);
  try {
    const snapshot=restore(JSON.parse(await dump(pending)),{source});
    const expected={ok:true,returnValue:[9007199254740993n,2n]};
    expect(await completed).toMatchObject(expected);
    expect(await run(source,{snapshot})).toMatchObject(expected);
  } finally { await completed; }
});

it("round-trips native boxed BigInts through replay data", () => {
  const original=Object(9007199254740993n);
  const restored=decodeReplayData(JSON.parse(JSON.stringify(encodeReplayData(original)))) as object;
  expect(BigInt.prototype.valueOf.call(restored)).toBe(9007199254740993n);
});
