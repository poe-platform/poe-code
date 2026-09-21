import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const root = new URL("../", import.meta.url),
  dist = new URL("dist/", root);
mkdirSync(dist, { recursive: true });
for (const name of readdirSync(new URL("src/", root)))
  if (name.endsWith(".d.ts")) copyFileSync(new URL("src/" + name, root), new URL(name, dist));
mkdirSync(new URL("configs/", dist), { recursive: true });
for (const name of readdirSync(new URL("../../agent-defs-rust/definitions/", import.meta.url))) {
  const data = JSON.parse(
    readFileSync(new URL("../../agent-defs-rust/definitions/" + name, import.meta.url), "utf8")
  );
  if (!data.spawnConfig && !data.acpSpawnConfig) continue;
  const stem = data.exportName.endsWith("Agent") ? data.exportName.slice(0, -5) : data.exportName;
  let code = "import {getSpawnConfig,getAcpSpawnConfig} from '../index.js';\n",
    types = "import type {CliSpawnConfig,AcpSpawnConfig} from '../types.js';\n";
  if (data.spawnConfig) {
    code += `export const ${stem}SpawnConfig=getSpawnConfig(${JSON.stringify(data.definition.id)});\n`;
    types += `export declare const ${stem}SpawnConfig:CliSpawnConfig;\n`;
  }
  if (data.acpSpawnConfig) {
    code += `export const ${stem}AcpSpawnConfig=getAcpSpawnConfig(${JSON.stringify(data.definition.id)});\n`;
    types += `export declare const ${stem}AcpSpawnConfig:AcpSpawnConfig;\n`;
  }
  writeFileSync(new URL("configs/" + data.definition.id + ".js", dist), code);
  writeFileSync(new URL("configs/" + data.definition.id + ".d.ts", dist), types);
}

// Keep the owned SDK hosts together behind the agent-spawn addon. Tooling is dev-only.
function embedHosts(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const input = new URL(entry.name + (entry.isDirectory() ? "/" : ""), source),
      output = new URL(entry.name + (entry.isDirectory() ? "/" : ""), target);
    if (entry.isDirectory()) {
      embedHosts(input, output);
      continue;
    }
    if (entry.name.endsWith(".node")) continue;
    if (!entry.name.endsWith(".js")) {
      copyFileSync(input, output);
      continue;
    }
    let binding = path
      .relative(
        path.dirname(fileURLToPath(output)),
        fileURLToPath(new URL("agent-spawn-rust.node", dist))
      )
      .split(path.sep)
      .join("/");
    if (!binding.startsWith(".")) binding = "./" + binding;
    const parsed = ts.createSourceFile(
      fileURLToPath(input),
      readFileSync(input, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS
    );
    const transformed = ts.transform(parsed, [
      (context) => (node) =>
        ts.visitNode(node, function visit(current) {
          if (
            ts.isStringLiteral(current) &&
            (current.text.endsWith("/agent-harness-tools-rust.node") ||
              current.text.endsWith("/process-runner-rust.node") ||
              current.text.endsWith("/agent-skill-config-rust.node") ||
              current.text.endsWith("/agent-hook-config-rust.node") ||
              current.text.endsWith("/toolcraft-design-rust.node") ||
              current.text.endsWith("/poe-acp-client-rust.node"))
          )
            return ts.factory.createStringLiteral(binding);
          return ts.visitEachChild(current, visit, context);
        })
    ]);
    try {
      writeFileSync(output, ts.createPrinter().printFile(transformed.transformed[0]));
    } finally {
      transformed.dispose();
    }
  }
}
embedHosts(
  new URL("../../agent-harness-tools-rust/dist/", import.meta.url),
  new URL("harness/", dist)
);
embedHosts(new URL("../../process-runner-rust/dist/", import.meta.url), new URL("process/", dist));
embedHosts(
  new URL("../../agent-skill-config-rust/dist/", import.meta.url),
  new URL("skills/", dist)
);
embedHosts(new URL("../../agent-hook-config-rust/dist/", import.meta.url), new URL("hooks/", dist));
embedHosts(new URL("../../toolcraft-design-rust/dist/", import.meta.url), new URL("design/", dist));

embedHosts(new URL("../../poe-acp-client-rust/dist/", import.meta.url), new URL("acp/", dist));
