import type { CDPSession, Frame, Page } from "@cloudflare/playwright";

const sessions = new WeakMap<Frame, Promise<CDPSession>>();

/** Cloudflare resets touch emulation when any page CDP session detaches. Keep
 * one identity session per live page; page/context destruction releases it.
 * The owning browser's page limit bounds these sessions. Native frame identity
 * also unifies the page wrappers used for navigation and run-code. */
export function browserPageCDP(page: Page): Promise<CDPSession> {
	const frame = page.mainFrame();
	const existing = sessions.get(frame);
	if (existing) return existing;
	const pending = page.context().newCDPSession(page);
	sessions.set(frame, pending);
	const forget = () => {
		if (sessions.get(frame) === pending) sessions.delete(frame);
		page.off("close", forget);
	};
	page.on("close", forget);
	void pending.catch(forget);
	return pending;
}
