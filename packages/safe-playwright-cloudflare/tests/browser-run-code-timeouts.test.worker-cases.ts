import assert from "node:assert/strict";
import type { BrowserContext, Page } from "@cloudflare/playwright";

export async function assertRunCodeTimeouts(f: {
	context: BrowserContext;
	page: Page;
	run(source: string): Promise<unknown>;
}) {
	f.context.setDefaultTimeout(90);
	f.context.setDefaultNavigationTimeout(140);
	f.page.setDefaultTimeout(60);
	f.page.setDefaultNavigationTimeout(110);
	const probe = `async page => {
    const capture = async action => {
      try { await action(); return 'unexpected success'; }
      catch (error) { return error.message; }
    };
    const selected = await capture(() => page.getByRole('button', {name:'Missing'}).click());
    const navigation = await capture(() => page.waitForURL('https://missing.invalid'));
    const extra = await page.context().newPage();
    const inherited = await capture(() => extra.getByRole('button', {name:'Missing'}).click());
    const inheritedNavigation = await capture(() => extra.waitForURL('https://missing.invalid'));
    await extra.close();
    return {selected,navigation,inherited,inheritedNavigation};
  }`;
	const result = (await f.run(probe)) as {
		selected: string;
		navigation: string;
		inherited: string;
		inheritedNavigation: string;
	};
	assert.match(result.selected, /Timeout 60ms exceeded/);
	assert.match(result.navigation, /Timeout 110ms exceeded/);
	assert.match(result.inherited, /Timeout 90ms exceeded/);
	assert.match(result.inheritedNavigation, /Timeout 140ms exceeded/);

	await assert.rejects(
		f.run(`async page => {
   page.setDefaultTimeout(30); page.setDefaultNavigationTimeout(50);
   page.context().setDefaultTimeout(40); page.context().setDefaultNavigationTimeout(70);
   throw new Error('after changing timeouts');
 }`),
		/after changing timeouts/,
	);
	await assert.rejects(
		f.page.getByRole("button", { name: "Missing" }).click(),
		/Timeout 30ms exceeded/,
	);
	await assert.rejects(
		f.page.waitForURL("https://missing.invalid"),
		/Timeout 50ms exceeded/,
	);
	const changed = (await f.run(probe)) as typeof result;
	assert.match(changed.selected, /Timeout 30ms exceeded/);
	assert.match(changed.navigation, /Timeout 50ms exceeded/);
	assert.match(changed.inherited, /Timeout 40ms exceeded/);
	assert.match(changed.inheritedNavigation, /Timeout 70ms exceeded/);
	await f.run(`async page => {
   page.setDefaultTimeout(undefined); page.setDefaultNavigationTimeout(undefined);
   page.context().setDefaultTimeout(25); page.context().setDefaultNavigationTimeout(35);
 }`);
	await assert.rejects(
		f.page.getByRole("button", { name: "Missing" }).click(),
		/Timeout 25ms exceeded/,
	);
	await assert.rejects(
		f.page.waitForURL("https://missing.invalid"),
		/Timeout 35ms exceeded/,
	);
	assert.equal(await f.run("async page => page.title()"), "");
}
