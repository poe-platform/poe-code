import { afterEach, expect, it, vi } from "vitest";
import { createTest262Realm } from "./realm.js";

afterEach(() => vi.unstubAllGlobals());

function collectionNotices() {
  const notices: Array<() => void> = [];
  const unregister = vi.fn(() => true);
  vi.stubGlobal("FinalizationRegistry", class {
    constructor(private readonly cleanup: (cell: unknown) => void) {}
    register(_target: unknown, cell: unknown) {
      notices.push(() => this.cleanup(cell));
    }
    unregister = unregister;
  });
  return { notices, unregister };
}

it("owns finalization cells across separate fixture scripts", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluate("const token={};const registry=new FinalizationRegistry(()=>{});registry.register({},7,token)"))
      .toMatchObject({ status: "normal" });
    expect(await realm.evaluate("registry.unregister(token)"))
      .toMatchObject({ status: "normal", value: true });
    expect(await realm.settle()).toMatchObject({ status: "normal" });
  } finally { await realm.dispose(); }
});

it("provides a finalization owner for source modules", async () => {
  const realm = createTest262Realm();
  try {
    expect(await realm.evaluateModule("const registry=new FinalizationRegistry(()=>{});registry.register({},7);export {};", "owner.js"))
      .toMatchObject({ status: "normal" });
  } finally { await realm.dispose(); }
});

it("reports scheduled cleanup failures to the owning realm only", async () => {
  const { notices } = collectionNotices();
  const first = createTest262Realm(), second = createTest262Realm();
  try {
    expect(await first.evaluate("const registry=new FinalizationRegistry(()=>{throw 42});registry.register({},7)"))
      .toMatchObject({ status: "normal" });
    expect(notices).toHaveLength(1);
    notices[0]!();
    expect(await first.settle()).toMatchObject({ status: "host-error", error: 42 });
    expect(await second.evaluate("1")).toMatchObject({ status: "normal", value: 1 });
    expect(await second.settle()).toMatchObject({ status: "normal" });
  } finally { await first.dispose(); await second.dispose(); }
});

it("cancels child registry cells and late notices when the fixture is disposed", async () => {
  const { notices, unregister } = collectionNotices();
  const printed = vi.fn();
  const realm = createTest262Realm({}, printed);
  try {
    expect(await realm.evaluate(`$262.createRealm().evalScript("const registry=new FinalizationRegistry(()=>print('unexpected'));registry.register({},7)")`))
      .toMatchObject({ status: "normal" });
    expect(notices).toHaveLength(1);
    await realm.dispose();
    expect(unregister).toHaveBeenCalledTimes(1);
    notices[0]!();
    await Promise.resolve();
    expect(printed).not.toHaveBeenCalled();
  } finally { await realm.dispose(); }
});
