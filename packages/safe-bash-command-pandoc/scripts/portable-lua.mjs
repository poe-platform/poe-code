import path from "node:path";
import { createRequire } from "node:module";

const resolveDependency = createRequire(import.meta.url).resolve;

// String/table libraries import the host loader only for an assertion helper.
export const portableLuaLibraries = {
  name: "portable-lua-libraries",
  setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path.startsWith("fengari/src/")) return { path: resolveDependency(args.path, { paths: [args.resolveDir] }) };
      const owner = path.dirname(path.dirname(args.importer));
      if (args.path === "fengari" && path.basename(owner) === "safe-bash-command-pandoc") {
        return { path: path.join(owner, "src/fengari-portable.ts") };
      }
      if (args.path !== "./lualib.js" || !["lstrlib.js", "ltablib.js"].includes(path.basename(args.importer))) return;
      const directory = path.dirname(args.importer);
      if (path.basename(directory) !== "src" || path.basename(path.dirname(directory)) !== "fengari") return;
      return { path: path.join(directory, "llimits.js") };
    });
  },
};
