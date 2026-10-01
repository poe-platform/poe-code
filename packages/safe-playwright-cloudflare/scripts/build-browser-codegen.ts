import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import ts from "typescript";

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
		platform: "browser",
		target: "es2022",
		// The distributed generators retain bare imports from the server utility
		// barrel. They perform no code-generation work and pull in the native
		// runtime. Preserve all value imports; the browser build rejects any
		// Node dependency that an actual generator still needs.
		plugins: [
			{
				name: "portable-native-generators",
				setup(builder) {
					builder.onLoad({ filter: /\.js$/ }, async (args) => {
						if (dirname(args.path) !== dirname(entry)) return;
						const source = await readFile(args.path, "utf8");
						const ast = ts.createSourceFile(
							args.path,
							source,
							ts.ScriptTarget.Latest,
							true,
							ts.ScriptKind.JS
						);
						return {
							contents: ast.statements
								.filter((node) => !ts.isImportDeclaration(node) || node.importClause)
								.map((node) => node.getFullText(ast))
								.join("\n"),
							loader: "js"
						};
					});
				}
			}
		],
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
