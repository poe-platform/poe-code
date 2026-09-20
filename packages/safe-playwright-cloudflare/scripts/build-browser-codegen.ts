import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageVersion = "1.3.6";
const sourcePath = "lib/playwright-core/src/server/codegen/languages.js";

/** The pinned distribution ships native generators outside its public exports. */
export async function buildBrowserCodegen() {
	const directory = dirname(fileURLToPath(import.meta.url));
	const packageRoot = dirname(
		dirname(createRequire(import.meta.url).resolve("@cloudflare/playwright")),
	);
	const metadata = JSON.parse(
		await readFile(join(packageRoot, "package.json"), "utf8"),
	) as { version: string };
	if (metadata.version !== packageVersion)
		throw new Error(
			"Qualify native code generation before changing Playwright",
		);
	const entry = join(packageRoot, sourcePath);
	const sourceHash = createHash("sha256")
		.update(await readFile(entry))
		.digest("hex");
	const license = await readFile(
		join(directory, "playwright-codegen.LICENSE"),
		"utf8",
	);
	const result = await build({
		stdin: {
			contents: `export { languageSet } from ${JSON.stringify(entry)};`,
			resolveDir: packageRoot,
		},
		bundle: true,
		format: "esm",
		platform: "node",
		target: "es2022",
		external: ["node:*", "cloudflare:*"],
		write: false,
		minify: true,
		legalComments: "inline",
		banner: {
			js: `/*! Generated from @cloudflare/playwright@${packageVersion}/${sourcePath}
Source SHA-256: ${sourceHash}
Upstream: https://github.com/cloudflare/playwright
Playwright code generation copyright Microsoft Corporation. SPDX-License-Identifier: Apache-2.0
${license.replaceAll("*/", "* /")}
*/`,
		},
	});
	const source = result.outputFiles[0]?.text;
	if (!source) throw new Error("Native code generation bundle missing");
	const output = join(directory, "../src/browser-codegen.generated.js");
	await mkdir(dirname(output), { recursive: true });
	await writeFile(output, source);
}
