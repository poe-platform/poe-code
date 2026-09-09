import { expect, it } from "vitest";
import { createRealm } from "./realm.js";
import { runResources } from "./interp/resources.js";

it("poisons a realm with the original owned-job failure", async () => {
  const failure = new Error("finalization cleanup failed");
  const realm = createRealm({bindings:{report:() => {
    runResources.getStore()!.reportError!(failure);
  }}});
  try {
    await expect(realm.evaluate("report();return 7")).rejects.toBe(failure);
    await expect(realm.evaluate("return 8")).rejects.toBe(failure);
  } finally { await realm.close(); }
});
