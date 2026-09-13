import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

export async function rewriteWorkspaceRuntime(directory, routes, files = fileSystem) {
  for (const entry of await files.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteWorkspaceRuntime(filename, routes, files);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      const source = await files.readFile(filename, "utf8");
      const rewritten = rewriteModuleSpecifiers(filename, source, (specifier) => {
        const target = Object.hasOwn(routes, specifier) ? routes[specifier] : undefined;
        if (!target) return specifier;
        const relative = path.relative(path.dirname(filename), target).split(path.sep).join("/");
        return relative.startsWith(".") ? relative : `./${relative}`;
      });
      if (rewritten !== source) await files.writeFile(filename, rewritten);
    }
  }
}
