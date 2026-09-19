declare module "browser-user-code.js" {
	const run: (page: import("@cloudflare/playwright").Page) => unknown;
	export default run;
}
