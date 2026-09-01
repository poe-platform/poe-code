import fs from "node:fs";
import path from "node:path";
import { parse } from "shell-quote";

export function workspaceTestExclusions(root, fileSystem = fs) {
  const exclusions = [];
  for (const directory of fileSystem.readdirSync(path.join(root, "packages"), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const prefix = `packages/${directory.name}/`;
    const manifest = path.join(root, prefix, "package.json");
    if (!fileSystem.existsSync(manifest)) continue;
    const script = JSON.parse(fileSystem.readFileSync(manifest, "utf8")).scripts?.["test:unit"];
    if (typeof script !== "string") continue;
    const tokens = parse(script, () => undefined);
    if (tokens[0] !== "cd" || tokens[1] !== "../.." || tokens[2]?.op !== "&&" || tokens[3] !== "vitest" || tokens[4] !== "run") continue;
    const owned = [];
    let supported = true;
    for (let index = 5; index < tokens.length; index++) {
      const selector = tokens[index];
      if (selector === "--passWithNoTests") continue;
      if (selector === "--config" && tokens[index + 1] === "vitest.config.ts") {
        index++;
        continue;
      }
      if (typeof selector !== "string" || !(selector + "/").startsWith(prefix) || selector.split("/").includes("..")) {
        supported = false;
        break;
      }
      if (["*", "?", "[", "]", "{", "}", "(", ")", "!", "\\"].some(character => selector.includes(character))) {
        supported = false;
        break;
      }
      const filename = path.join(root, selector);
      if (!fileSystem.existsSync(filename)) {
        supported = false;
        break;
      }
      const metadata = fileSystem.statSync(filename);
      if (metadata.isDirectory()) owned.push(`${selector.endsWith("/") ? selector : selector + "/"}**`);
      else if (metadata.isFile()) owned.push(selector);
    }
    if (supported) exclusions.push(...owned);
  }
  return exclusions;
}
