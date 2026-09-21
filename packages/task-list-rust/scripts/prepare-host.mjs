import { mkdirSync, copyFileSync } from "node:fs";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
mkdirSync(dist, { recursive: true });
for (const name of ["yaml-snapshot.js", "snapshot.js"])
  copyFileSync(new URL("../config-mutations-rust/src/" + name, root), new URL(name, dist));
copyFileSync(new URL("src/yaml-snapshot.d.ts", root), new URL("yaml-snapshot.d.ts", dist));
