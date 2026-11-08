import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context);
  if (result.url.startsWith("node:")) return result;
  if (!result.url.startsWith("file:")) throw new Error(`BOUNDARY:SOURCE_FALLBACK:${result.url}`);
  const filename = fileURLToPath(result.url);
  const root = realpathSync(process.env.HTML_FIXTURE_ROOT);
  const path = relative(root, realpathSync(filename));
  if (isAbsolute(path) || path === ".." || path.startsWith("../") || /\.(?:ts|tsx|mts|cts)$/.test(filename)) {
    throw new Error(`BOUNDARY:SOURCE_FALLBACK:${result.url}`);
  }
  return result;
}
