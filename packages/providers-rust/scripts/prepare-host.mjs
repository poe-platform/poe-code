import { readdirSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import ts from "typescript";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root),
  providers = new URL("providers/", dist);
mkdirSync(providers, { recursive: true });
for (const name of readdirSync(new URL("src/", root)))
  if (name.endsWith(".d.ts")) copyFileSync(new URL("src/" + name, root), new URL(name, dist));
copyFileSync(
  new URL("../../agent-defs-rust/src/types.d.ts", import.meta.url),
  new URL("agent-types.d.ts", dist)
);
copyFileSync(
  new URL("../../auth-store-rust/src/index.d.ts", import.meta.url),
  new URL("auth-store-types.d.ts", dist)
);
let exports = 'export {allAuthProviders} from "../catalog.js";\n',
  declarations = 'export {allAuthProviders} from "../catalog.js";\n';
for (const filename of readdirSync(new URL("definitions/", root))
  .filter((name) => name.endsWith(".json"))
  .sort()) {
  const id = filename.slice(0, -5);
  let stem = "",
    capitalize = false;
  for (const char of id) {
    if (char === "-" || char === "_") {
      capitalize = true;
      continue;
    }
    stem += capitalize ? char.toUpperCase() : char;
    capitalize = false;
  }
  const name = stem + "Provider",
    constant = id.toUpperCase().split("-").join("_") + "_PROVIDER_ID";
  if (
    !ts.isIdentifierText(name, ts.ScriptTarget.Latest) ||
    !ts.isIdentifierText(constant, ts.ScriptTarget.Latest)
  )
    throw Error("Invalid provider identity");
  writeFileSync(
    new URL(id + ".js", providers),
    'import {catalog} from "../catalog.js";\nexport const ' +
      name +
      "=catalog.find(provider=>provider.id===" +
      JSON.stringify(id) +
      ");\nexport const " +
      constant +
      "=" +
      JSON.stringify(id) +
      ";\n"
  );
  writeFileSync(
    new URL(id + ".d.ts", providers),
    'import type {AuthProvider} from "../types.js";\nexport declare const ' +
      name +
      ":AuthProvider;\nexport declare const " +
      constant +
      ":" +
      JSON.stringify(id) +
      ";\n"
  );
  exports += "export * from " + JSON.stringify("./" + id + ".js") + ";\n";
  declarations += "export * from " + JSON.stringify("./" + id + ".js") + ";\n";
}
writeFileSync(new URL("generated.js", providers), exports);
writeFileSync(new URL("generated.d.ts", providers), declarations);
