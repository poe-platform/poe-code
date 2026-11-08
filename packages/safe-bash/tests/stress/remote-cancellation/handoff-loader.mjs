import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, resolve as absolute } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const revision = "3731587fa287333ca59c7a81569b367cec66f61d";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const mockPath = "tests/fs/webdav/mock.ts";
const sources = new Map();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
for (const path of git("ls-tree", "-r", "--name-only", revision, "src", mockPath).trim().split("\n")) {
  if (!path.endsWith(".ts")) continue;
  const source = git("show", `${revision}:${path}`);
  sources.set(path, { source, sha256: createHash("sha256").update(source).digest("hex"), blob: git("rev-parse", `${revision}:${path}`).trim() });
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith("file:")) return nextLoad(url, context);
  const path = relative(root, fileURLToPath(url));
  if (!path.startsWith("src/") && path !== mockPath) return nextLoad(url, context);
  const pinned = sources.get(path);
  if (!pinned) throw new Error(`Unpinned product module: ${path}`);
  const output = ts.transpileModule(pinned.source, {
    fileName: absolute(root, path),
    compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
  });
  console.error(`PINNED_SOURCE ${JSON.stringify({ revision, path, sha256: pinned.sha256, blob: pinned.blob })}`);
  return { format: "module", source: output.outputText, shortCircuit: true };
}
