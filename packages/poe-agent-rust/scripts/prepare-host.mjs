import { mkdirSync, readdirSync, copyFileSync } from "node:fs";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(new URL("src/", root)))
  if (name.endsWith(".d.ts")) copyFileSync(new URL("src/" + name, root), new URL(name, dist));

copyFileSync(new URL("../poe-acp-client-rust/src/types.d.ts", root), new URL("acp-types.d.ts", dist));
