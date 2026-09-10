import { afterEach, expect, it, vi } from "vitest";
import { createRealm } from "../../realm.js";

afterEach(() => vi.unstubAllGlobals());

function collectionNotice() {
  const notices: Array<() => void> = [];
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(private readonly cleanup: (cell: unknown) => void) {}
    register(_target: unknown, cell: unknown) {
      if (typeof cell === "object" && cell !== null && "heldValue" in cell && cell.heldValue === 7)
        notices.push(() => this.cleanup(cell));
    }
    unregister() { return true; }
  });
  return () => {
    expect(notices).toHaveLength(1);
    notices[0]!();
  };
}

it("runs a collection notice through the owning realm with normal callback arguments", async () => {
  const collect = collectionNotice();
  const values: unknown[] = [];
  const realm = createRealm({bindings:{collect,record:(value:unknown) => {values.push(value);}}});
  try {
    expect(await realm.evaluate(`const registry=new FinalizationRegistry(function(held){
      record([this===undefined,arguments.length,held]);});
      registry.register({},7);collect();return 'done'`)).toMatchObject({ok:true,returnValue:"done"});
    expect(values).toEqual([[true,1,7]]);
  } finally { await realm.close(); }
});

it("reports a cleanup exception to its realm instead of an unhandled host promise", async () => {
  const collect = collectionNotice();
  const realm = createRealm({bindings:{collect}});
  try {
    await expect(realm.evaluate(`const registry=new FinalizationRegistry(()=>{throw new Error('cleanup failure')});
      registry.register({},7);collect();return 'done'`)).rejects.toMatchObject({message:"cleanup failure"});
    await expect(realm.evaluate("return 1")).rejects.toMatchObject({message:"cleanup failure"});
  } finally { await realm.close(); }
});

it("suppresses native collection notices after the realm is closed", async () => {
  const collect = collectionNotice();
  const record = vi.fn();
  const realm = createRealm({bindings:{record}});
  expect(await realm.evaluate(`const registry=new FinalizationRegistry(record);registry.register({},7);return 'done'`))
    .toMatchObject({ok:true,returnValue:"done"});
  await realm.close();
  collect();
  await Promise.resolve();
  expect(record).not.toHaveBeenCalled();
});

it("runs a later collection notice after the creating evaluation has returned", async () => {
  const collect = collectionNotice();
  const values: unknown[] = [];
  const realm = createRealm({bindings:{record:(value:unknown) => {values.push(value);}}});
  try {
    expect(await realm.evaluate(`const registry=new FinalizationRegistry(held=>record(held));
      registry.register({},7);return 'created'`)).toMatchObject({ok:true,returnValue:"created"});
    collect();
    expect(await realm.evaluate("return 'next evaluation'"))
      .toMatchObject({ok:true,returnValue:"next evaluation"});
    expect(values).toEqual([7]);
  } finally { await realm.close(); }
});

it("cancels an already queued cleanup when the guest unregisters its token", async () => {
  const collect = collectionNotice();
  const record = vi.fn();
  const realm = createRealm({bindings:{collect,record}});
  try {
    expect(await realm.evaluate(`const token={};const registry=new FinalizationRegistry(record);
      registry.register({},7,token);collect();return registry.unregister(token)`))
      .toMatchObject({ok:true,returnValue:true});
    expect(await realm.evaluate("return 'drained'"))
      .toMatchObject({ok:true,returnValue:"drained"});
    expect(record).not.toHaveBeenCalled();
  } finally { await realm.close(); }
});

it("delivers repeated native notices for one cell only once", async () => {
  const collect = collectionNotice();
  const record = vi.fn();
  const realm = createRealm({bindings:{collect,record}});
  try {
    expect(await realm.evaluate(`const registry=new FinalizationRegistry(record);
      registry.register({},7);collect();collect();return 'queued'`))
      .toMatchObject({ok:true,returnValue:"queued"});
    collect();
    expect(await realm.evaluate("return 'drained'"))
      .toMatchObject({ok:true,returnValue:"drained"});
    expect(record).toHaveBeenCalledExactlyOnceWith(7);
  } finally { await realm.close(); }
});
