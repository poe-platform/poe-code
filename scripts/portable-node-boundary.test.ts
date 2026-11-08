import { build } from "esbuild";
import { expect, it } from "vitest";
import { rejectNodeImports } from "./verify-safe-bash-profiles.mjs";

it.each(["node:fs", "fs", "node:crypto", "crypto", "node:stream/promises", "stream/promises"])(
  "rejects static and dynamic Node dependency %s even when externalized", async specifier => {
    for (const contents of [`import ${JSON.stringify(specifier)};`, `export const load = () => import(${JSON.stringify(specifier)});`]) {
      await expect(build({ stdin: { contents }, bundle: true, write: false,
        platform: "neutral", format: "esm", external: [specifier], logLevel: "silent",
        plugins: [rejectNodeImports],
      })).rejects.toThrow("Node builtin forbidden");
    }
  },
);
