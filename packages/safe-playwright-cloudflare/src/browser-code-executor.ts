import type { Page } from "@cloudflare/playwright";
import type { PlaywrightCodeExecutor } from "@poe-platform/safe-bash/playwright";
import { createBrowserRunCode } from "./browser-run-code.js";
import { browserRunCodeGuestSource } from "./browser-run-code-guest.generated.js";
import type { acquireCloudflareBrowser } from "./shell-browser-resource.js";

export interface BrowserCodeRuntime {
	ownerId: string;
	loader?: WorkerLoader;
}

export function createBrowserCodeExecutor(
	resource: Awaited<ReturnType<typeof acquireCloudflareBrowser>>,
	runtime?: BrowserCodeRuntime,
): PlaywrightCodeExecutor {
	const execute = runtime?.loader
		? createBrowserRunCode({
				ownerId: runtime.ownerId,
				loader: runtime.loader,
				guestSource: browserRunCodeGuestSource,
				browser: resource.browser,
				connectSocket: resource.connectSocket,
				retire: resource.release,
			})
		: undefined;
	return async (input) => {
		if (!execute)
			throw new Error(
				"Playwright run-code is unavailable: Worker Loader binding missing",
			);
		// The provider created this native Page; the portable adapter narrows its type.
		return execute({ ...input, page: input.page as Page });
	};
}
