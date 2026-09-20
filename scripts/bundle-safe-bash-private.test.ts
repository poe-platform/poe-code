import { expect, it } from "vitest";
import { resolvePrivateCommandBuild } from "./bundle-safe-bash.mjs";

it.each(["browser", "workerd", "require"])("rejects an unprepared private command %s export", condition => {
  const name = "safe-bash-command-example";
  const profile = { version: "0.0.1", dependencies: {}, devDependencies: {} };
  const pkg = {
    name, ...profile, private: true, type: "module",
    exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", [condition]: "./dist/alternate.js" } },
  };
  expect(() => resolvePrivateCommandBuild("/repo", { [name]: profile }, [{ dir: name, pkg }], { alias: {}, external: [] }))
    .toThrow("Unsupported private command export condition");
});
