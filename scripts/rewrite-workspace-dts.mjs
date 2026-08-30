import path from "node:path";
import * as fileSystem from "node:fs/promises";
import ts from "typescript";
import { canonicalFsRoutes } from "../packages/package-lint/dist/bundle-policy.js";

export async function rewriteWorkspaceDts(
  directory,
  workspaces,
  { rootDir, profile = "node", files = fileSystem }
) {
  if (profile !== "node" && profile !== "browser")
    throw new Error(`Unknown declaration profile: ${profile}`);
  const entries = await files.readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewriteWorkspaceDts(filename, workspaces, { rootDir, profile, files });
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const text = await files.readFile(filename, "utf8");
    const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
    const replacements = [];
    const visit = (node) => {
      const literal =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : ts.isExternalModuleReference(node)
              ? node.expression
              : undefined;
      if (literal && ts.isStringLiteral(literal)) {
        const specifier = literal.text;
        const workspace = workspaces.find(
          ({ pkg }) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`)
        );
        if (workspace) {
          const route = canonicalFsRoutes.find((candidate) => candidate.workspace === specifier);
          const subpath = specifier.slice(workspace.pkg.name.length + 1);
          const exportKey = subpath ? `./${subpath}` : ".";
          const exported = workspace.pkg.exports?.[exportKey]?.types;
          const target = route
            ? path.join(rootDir, route.types[profile])
            : path.join(
                rootDir,
                "packages",
                workspace.dir,
                typeof exported === "string" ? exported : `dist/${subpath || "index"}.d.ts`
              );
          const declarationTarget = target.endsWith(".d.ts") ? `${target.slice(0, -5)}.js` : target;
          let relative = path
            .relative(path.dirname(filename), declarationTarget)
            .split(path.sep)
            .join("/");
          if (!relative.startsWith(".")) relative = `./${relative}`;
          replacements.push({
            start: literal.getStart(source),
            end: literal.end,
            value: JSON.stringify(relative)
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    let rewritten = text;
    for (const replacement of replacements.sort((left, right) => right.start - left.start))
      rewritten =
        rewritten.slice(0, replacement.start) +
        replacement.value +
        rewritten.slice(replacement.end);
    if (rewritten !== text) await files.writeFile(filename, rewritten);
  }
}
