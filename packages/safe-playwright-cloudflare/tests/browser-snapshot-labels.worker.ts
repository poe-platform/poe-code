import assert from "node:assert/strict";
import type { Page } from "@cloudflare/playwright";
import type {
  PlaywrightSnapshotJSONCapture,
  PlaywrightSnapshotJSONNode
} from "@poe-platform/safe-bash/playwright";

export async function verifySnapshotLabels(page: Page, capture: PlaywrightSnapshotJSONCapture) {
  await page.setContent(`<label for="action">First</label><button id="action">Fallback</button><label for="action">Second</label>
    <label>Implicit<input id="implicit"></label><input type="hidden" id="hidden">
    <span id="duplicate"></span><label for="duplicate">Wrong target</label><button id="duplicate">Duplicate fallback</button>
    <div id="shadow"></div><iframe srcdoc="<label for='child'>Frame label</label><button id='child'>Child fallback</button>"></iframe>`);
  await page.evaluate(() => {
    document.querySelector("#shadow")!.attachShadow({ mode: "open" }).innerHTML =
      '<label for="action">Shadow label</label><button id="action">Shadow fallback</button>';
  });
  await page.frameLocator("iframe").getByRole("button").waitFor();
  const options = { signal: new AbortController().signal, timeoutMs: 20000, maxBytes: Infinity };
  const names = (tree: readonly PlaywrightSnapshotJSONNode[]) => {
    const pending = [...tree];
    for (let i = 0; i < pending.length; i++) {
      for (const child of pending[i]!.children ?? [])
        if (typeof child !== "string") pending.push(child);
    }
    return pending.map((node) => node.name).filter(Boolean);
  };
  const first = names(await capture(page, options));
  for (const name of [
    "First Second",
    "Implicit",
    "Duplicate fallback",
    "Shadow label",
    "Frame label"
  ])
    assert.ok(first.includes(name), name);
  await page.evaluate(() => {
    document.querySelector('label[for="action"]')!.textContent = "Changed";
    document.querySelectorAll('label[for="action"]')[1]!.remove();
    document.querySelector("#implicit")!.parentElement!.firstChild!.textContent =
      "Updated implicit";
  });
  const second = names(await capture(page, options));
  assert.ok(second.includes("Changed"));
  assert.ok(second.includes("Updated implicit"));
  assert.ok(!second.includes("First Second"));
  assert.deepEqual(
    await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>("#action")!;
      const input = document.querySelector<HTMLInputElement>("#hidden")!;
      return {
        nativeList: button.labels instanceof NodeList,
        count: button.labels.length,
        hidden: input.labels
      };
    }),
    { nativeList: true, count: 1, hidden: null }
  );
}
