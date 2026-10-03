import { expect, test } from "vitest";
import { ResourceScope } from "./resources.js";

test("completed database results leave the cleanup scope while live resources remain owned", async () => {
  const releases: number[] = [];
  const scope = new ResourceScope(new AbortController().signal, () => {});
  const connection = await scope.acquire(async () => ({ id: -1 }), async value => { releases.push(value.id); });
  for (let id = 0; id < 1000; id++) {
    const result = await scope.acquire(async () => ({ id }), async value => { releases.push(value.id); });
    scope.forget(result); // Caller has completed and closed this result.
  }
  await scope.close();
  expect(releases).toEqual([connection.id]);
});
