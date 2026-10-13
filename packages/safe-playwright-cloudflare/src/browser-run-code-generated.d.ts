declare module "*.generated.js" {
	export const loadBrowserRunCodeGuestSource: (signal: AbortSignal) => Promise<string>;
}
