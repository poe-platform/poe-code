import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

export async function publishRootImagePackage(rootDir, files = fileSystem) {
  const filename = path.join(rootDir, "packages/image-ast/dist/index.js");
  const source = await files.readFile(filename, "utf8");
  // Keep the PDF engine shared with its public export and leave workspace
  // output intact for the independently packaged scoped libraries.
  const output = rewriteModuleSpecifiers(filename, source, specifier =>
    specifier === "@poe-code/pdf-ast" ? "poe-code/safe-bash/pdf-ast"
      : ["@poe-code/safe-fs/contracts", "@poe-code/safe-fs/storage"].includes(specifier) ? "poe-code/safe-fs/core"
      : specifier
  );
  await files.mkdir(path.join(rootDir, "dist"), { recursive: true });
  await files.writeFile(path.join(rootDir, "dist/image-ast.js"), output);
}
