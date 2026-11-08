import assert from "node:assert/strict";
import type { BrowserWorker, Page } from "@cloudflare/playwright";
import { createPlaywrightController } from "@poe-platform/safe-bash/playwright";
import { createCloudflarePlaywrightAdapter } from "../src/index";

function textboxRef(snapshot: string, name: string) {
  const line = snapshot.split("\n").find(line => line.includes(`textbox "${name}"`));
  const ref = line?.match(/\[ref=(e\d+)\]/)?.[1];
  assert.ok(ref, snapshot);
  return ref;
}

export default {
  async fetch(request: Request, env: { BROWSER: BrowserWorker }) {
    const controller = createPlaywrightController({ adapter: createCloudflarePlaywrightAdapter(env.BROWSER) });
    async function run(...args: string[]) {
      let output = "";
      await controller.run({ args, env: {}, signal: AbortSignal.timeout(10000),
        async write(text) { output += text; } });
      return output;
    }
    try {
      const origin = await request.text();
      const mode = new URL(request.url).pathname;
      await run("open", origin);
      const page = controller.inspectSessions()[0]?.context.pages()[0] as Page | undefined;
      assert.ok(page);
      await page.setContent('<input aria-label="Email"><iframe srcdoc="<input aria-label=Child>"></iframe>');
      if (mode === "/fallback") Object.assign(page, { ariaSnapshot: undefined, _snapshotForAI: undefined });
      const childFrame = page.frames().find(frame => frame !== page.mainFrame());
      assert.ok(childFrame);
      await childFrame.getByRole("textbox").waitFor();
      if (mode === "/json") await run("snapshot", "--json");
      const first = await run("snapshot");
      const parent = textboxRef(first, "Email");
      const child = textboxRef(first, "Child");
      assert.equal(textboxRef(await run("snapshot"), "Email"), parent);
      // Keep the frame object, replace its document, and restart the provider's node IDs.
      await childFrame.goto(`${origin}/child-next`);
      await childFrame.setContent('<input aria-label="Child">');
      if (mode === "/json") await run("snapshot", "--json");
      const refreshed = await run("fill", parent, "preserved");
      assert.equal(await page.getByRole("textbox", { name: "Email" }).inputValue(), "preserved");
      await assert.rejects(run("fill", child, "wrong document"), {
        message: `Ref ${child} not found in the current page snapshot. Try capturing new snapshot.`,
      });
      assert.equal(await childFrame.getByRole("textbox").inputValue(), "");
      const freshChild = textboxRef(refreshed, "Child");
      assert.notEqual(freshChild, child);
      await run("fill", freshChild, "fresh document");
      assert.equal(await childFrame.getByRole("textbox").inputValue(), "fresh document");
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: String(error), stack: error instanceof Error ? error.stack : "" }, { status: 500 });
    } finally { await controller.dispose(); }
  },
};
