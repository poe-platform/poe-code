import fs from "node:fs";
import path from "node:path";
import { parse } from "shell-quote";

export function workspaceTestExclusions(root, fileSystem = fs) {
  return workspaceUnitSelections(root, fileSystem).flatMap(selection => selection.exclusions);
}

export function workspaceUnitSelections(root, fileSystem = fs) {
  const selections = [];
  for (const directory of fileSystem.readdirSync(path.join(root, "packages"), { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const prefix = `packages/${directory.name}/`;
    const manifest = path.join(root, prefix, "package.json");
    if (!fileSystem.existsSync(manifest)) continue;
    const scripts = JSON.parse(fileSystem.readFileSync(manifest, "utf8")).scripts ?? {};
    const script = scripts["test:unit"];
    if (typeof script !== "string") continue;
    const tokens = parse(script, () => undefined);
    if (tokens[0] !== "cd" || tokens[1] !== "../.." || tokens[2]?.op !== "&&" || tokens[3] !== "vitest" || tokens[4] !== "run") continue;
    const owned = [];
    const selectors = [];
    let passWithNoTests = false;
    let supported = true;
    for (let index = 5; index < tokens.length; index++) {
      const selector = tokens[index];
      if (selector === "--passWithNoTests") {
        passWithNoTests = true;
        continue;
      }
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
      else { supported = false; break; }
      selectors.push(selector);
    }
    if (supported && selectors.length) selections.push({
      path: `packages/${directory.name}`,
      selectors,
      exclusions: owned,
      passWithNoTests,
      hasHooks: scripts["pretest:unit"] !== undefined || scripts["posttest:unit"] !== undefined
    });
  }
  return selections;
}
