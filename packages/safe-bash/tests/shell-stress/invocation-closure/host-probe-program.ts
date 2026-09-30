import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { owned } from "./support.js";

const privateWorkspaces = JSON.parse(readFileSync("package.json", "utf8")).poeCode.integration.privateWorkspaces;
export const probeProgram = await build({
  entryPoints: [`${owned}/probe.ts`], bundle: true,
  platform: "node", format: "esm", target: "es2022", write: false,
  alias: {
    ...Object.fromEntries(Object.keys(privateWorkspaces).filter(name => name !== "safe-bash-contracts").flatMap(name => {
      const root = resolve("..", name.startsWith("@") ? name.split("/")[1]! : name);
      const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
      return Object.entries(manifest.exports as Record<string, string | { import: string }>).map(([route, target]) => [
        route === "." ? name : name + route.slice(1),
        resolve(root, typeof target === "string" ? target : target.import),
      ]);
    })),
    "safe-bash-contracts": resolve("../safe-bash-contracts/src"),
    "@poe-code/safe-fs": resolve("../safe-fs/src"),
  },
});

