import { registerHooks, findPackageJSON } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    let commonjs = false;
    if (url.startsWith("file:")) {
      const filename = fileURLToPath(url.split("?")[0]);
      if (filename.endsWith(".cjs")) commonjs = true;
      else if (filename.endsWith(".js")) {
        const metadata = findPackageJSON(url);
        commonjs = metadata !== undefined && JSON.parse(readFileSync(metadata, "utf8")).type !== "module";
      }
    }
    // Node 22 synchronous hooks require actual CommonJS source; its default
    // loader can return null when combined with the TypeScript loader.
    const loaded = commonjs ? { format: "commonjs", source: readFileSync(fileURLToPath(url)), shortCircuit: true } : nextLoad(url, context);
    if (process.env.INVOCATION_TRACE && url.startsWith("file:") && url.includes("/safe-bash/src/")) {
      appendFileSync(process.env.INVOCATION_TRACE, `${fileURLToPath(url.split("?")[0])}\n`);
    }
    return loaded;
  },
});
