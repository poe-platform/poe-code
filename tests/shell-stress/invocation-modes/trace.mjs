import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (process.env.INVOCATION_TRACE && url.startsWith("file:") && url.includes("/safe-bash/src/")) {
      appendFileSync(process.env.INVOCATION_TRACE, `${fileURLToPath(url.split("?")[0])}\n`);
    }
    return loaded;
  },
});
