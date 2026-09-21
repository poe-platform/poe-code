import { mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
