import assert from "node:assert/strict";
import type { BrowserWorker } from "@cloudflare/playwright";
import { checkpointBrowserProfile, parseBrowserProfile } from "@poe-platform/safe-bash/playwright";
import { createCloudflarePlaywrightAdapter } from "../src/shell-playwright";
import { controlFaultBinding } from "./browser-storage-admission.test.worker-relay";
import type { Fixture, Origins } from "./browser-storage-admission.test.worker-cases";
import { PROFILE_LIMITS } from "./persistent-playwright.fixture";
import { failureText } from "./browser-storage-admission.test.worker-controls";

// Keep a real Chromium transaction active with requests, rather than withholding
// a completed CDP reply. Every saved row must succeed before the release command.
const holdCommit = `(() => {
  globalThis.commitProbe = { rows: 0, release: false, abort: false, completed: false, aborted: false };
  const original = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function(...args) {
    const tx = original.apply(this, args);
    if (args[1] !== 'readwrite') return tx;
    globalThis.commitProbe.tx = tx;
    tx.addEventListener('complete', () => commitProbe.completed = true);
    tx.addEventListener('abort', () => commitProbe.aborted = true);
    const store = tx.objectStore(tx.objectStoreNames[0]);
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(...values) {
      const request = add.apply(this, values);
      request.addEventListener('success', () => commitProbe.rows++);
      return request;
    };
    const keepAlive = () => {
      if (commitProbe.abort) { tx.abort(); return; }
      if (!commitProbe.release) store.get('__commit_barrier__').onsuccess = keepAlive;
    };
    keepAlive();
    return tx;
  };
})();`;

export async function transactionCommitBarrier(
  create: (owner: string) => Fixture,
  native: BrowserWorker,
  input: Origins,
) {
  for (const abort of [false, true]) {
    const f = create(`commit-barrier-${abort}`);
    const name = "saved";
    const previous = new TextEncoder().encode(JSON.stringify({
      state: { cookies: [], origins: [{ origin: input.origin, localStorage: [], indexedDB: [{
        name: "commit-db", version: 1, stores: [{ name: "rows", autoIncrement: false, indexes: [],
          records: [{ keyEncoded: "first", valueEncoded: { id: 1, o: [{ k: "token", v: "one" }] } },
            { keyEncoded: "second", valueEncoded: { id: 1, o: [{ k: "token", v: "two" }] } }] }],
      }] }] }, tabs: ["about:blank"], selected: 0,
    }));
    await f.profiles.save(name, previous);
    const relay = controlFaultBinding(native);
    relay.interceptRestore(expression => `${holdCommit}\n${expression}`);
    const adapter = createCloudflarePlaywrightAdapter(relay.binding, {
      async loadState(profileName, signal) {
        const bytes = await f.profiles.load(profileName, signal);
        assert.ok(bytes);
        return parseBrowserProfile(bytes, PROFILE_LIMITS).state;
      },
    });
    let settled = false;
    const acquisition = adapter.acquire({ acquisitionId: `commit-${abort}`, session: name, browser: "chromium",
      headless: true, signal: AbortSignal.timeout(15_000) });
    const outcome = acquisition.then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
    let released = false;
    try {
      await relay.restoreStarted;
      const deadline = Date.now() + 5000;
      while (await relay.inspectRestore("globalThis.commitProbe?.rows") !== 2) {
        assert.ok(Date.now() < deadline, "Rows never succeeded");
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.equal(settled, false, "Acquisition resolved before native transaction commit");
      assert.equal(relay.activeTargetCount, 1, "Restore target must remain owned until commit");
      const destroyed = relay.destroyedTargets;
      assert.equal(await relay.inspectRestore("commitProbe.completed"), false);
      assert.equal(relay.destroyedTargets, destroyed, "No target retirement before commit");
      await relay.inspectRestore(`commitProbe.${abort ? "abort" : "release"} = true`);
      const result = await outcome;
      if (abort) {
        assert.ok("error" in result, "Aborted transaction must reject acquisition");
        assert.match(failureText(result.error), /abort/i);
        await relay.assertNativeRetirement();
      } else {
        assert.ok("value" in result);
        try {
          const bytes = await checkpointBrowserProfile({ name, context: result.value.context }, PROFILE_LIMITS, AbortSignal.timeout(10_000));
          assert.deepEqual(parseBrowserProfile(bytes, PROFILE_LIMITS).state, parseBrowserProfile(previous, PROFILE_LIMITS).state);
        } finally { await result.value.release(); released = true; }
        await relay.assertNativeRetirement();
      }
      assert.equal(relay.activeTargetCount, 0);
      assert.ok(relay.destroyedTargets > 0);
      assert.deepEqual(await f.profiles.load(name), previous, "Restore must preserve the saved profile");
    } finally {
      if (!settled) await relay.inspectRestore("commitProbe.release = true");
      const result = await outcome;
      if ("value" in result && !released) await result.value.release();
      await f.client.dispose();
    }
  }
}
