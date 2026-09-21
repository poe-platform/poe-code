import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from "node:fs";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
mkdirSync(dist, { recursive: true });
for (const name of ["yaml-snapshot.js", "snapshot.js"])
  copyFileSync(new URL("../config-mutations-rust/src/" + name, root), new URL(name, dist));
copyFileSync(new URL("src/yaml-snapshot.d.ts", root), new URL("yaml-snapshot.d.ts", dist));

copyFileSync(
  new URL("../process-runner-rust/src/host-runner.js", root),
  new URL("host-runner.js", dist)
);
for (const name of ["host-runner.d.ts", "runner-types.d.ts", "user-error.d.ts"])
  copyFileSync(new URL("src/" + name, root), new URL(name, dist));
writeFileSync(
  new URL("user-error.js", dist),
  readFileSync(new URL("../user-error-rust/src/index.js", root), "utf8").replaceAll(
    "./user-error-rust.node",
    "./task-list-rust.node"
  )
);
