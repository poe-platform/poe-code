import path from "node:path";
import * as fileSystem from "node:fs/promises";
import { rewriteModuleSpecifiers } from "./package-safe.mjs";

export async function publishRootImagePackage(rootDir, files = fileSystem) {
  // Keep the PDF engine shared with its public export and leave workspace
  // output intact for the independently packaged scoped libraries.
  await files.mkdir(path.join(rootDir, "dist"), { recursive: true });
  for (const name of ["pdf-ast", "image-ast"]) {
    const filename = path.join(rootDir, "packages", name, "dist/index.js");
    const source = await files.readFile(filename, "utf8");
    const output = rewriteModuleSpecifiers(filename, source, specifier =>
      ["@poe-code/pdf-ast", "@poe-code/pdf-ast/image"].includes(specifier) ? "poe-code/safe-bash/pdf-ast"
        : ["@poe-code/safe-fs/contracts", "@poe-code/safe-fs/storage"].includes(specifier) ? "poe-code/safe-fs/core"
        : specifier
    );
    await files.writeFile(path.join(rootDir, "dist", `${name}.js`), output);
  }
}
