import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildBrowserCodegen } from "./build-browser-codegen.js";
import { buildBrowserScreenshot } from './build-browser-screenshot.js';
import { buildBrowserProvider } from './build-browser-provider.js';

/** Bundle the pinned native client once; guest source is data in the host bundle. */
export async function buildBrowserRunCodeGuest() {
	await buildBrowserProvider();
	await buildBrowserCodegen();
	await buildBrowserScreenshot();
	const output = join(
		dirname(fileURLToPath(import.meta.url)),
		"../src/browser-run-code-guest.generated.js",
	);
	const result = await build({
		entryPoints: [
			join(
				dirname(fileURLToPath(import.meta.url)),
				"../src/browser-run-code-guest.ts",
			),
		],
		bundle: true,
		format: "esm",
		platform: "browser",
		conditions: ["workerd"],
		alias: { "#safe-playwright-provider": join(dirname(fileURLToPath(import.meta.url)), "../src/browser-provider.generated.js") },
		target: "es2022",
		external: ["cloudflare:*", "browser-user-code.js"],
		write: false,
		minify: true,
		legalComments: "inline",
	});
	const source = result.outputFiles[0]?.text;
	if (!source) throw new Error("Native Playwright guest bundle missing");
	await mkdir(dirname(output), { recursive: true });
	await writeFile(
		output,
    `/** @type {string} */\nexport const browserRunCodeGuestSource = ${JSON.stringify(source)};\n`,
	);
}

await buildBrowserRunCodeGuest();
