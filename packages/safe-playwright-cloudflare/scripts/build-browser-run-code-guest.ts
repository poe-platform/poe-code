import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildBrowserCodegen } from "./build-browser-codegen.js";

/** Bundle the pinned native client once; guest source is data in the host bundle. */
export async function buildBrowserRunCodeGuest() {
	await buildBrowserCodegen();
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
		platform: "node",
		target: "es2022",
		external: ["node:*", "cloudflare:*", "browser-user-code.js"],
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
