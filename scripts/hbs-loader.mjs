import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Node.js module loader hook for .hbs files.
 * Loads Handlebars templates as ES modules that export the file content as a string.
 * Used by the dev script (tsx) to match the behavior of esbuild's text loader in production.
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith(".hbs")) {
    const filePath = fileURLToPath(url);
    const content = await readFile(filePath, "utf-8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(content)};`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
