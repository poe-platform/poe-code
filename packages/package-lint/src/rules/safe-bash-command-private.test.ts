import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { runRules } from "./index.js";

describe("Safe Bash command workspace identity", () => {
  it.each([
    ["safe-bash-command-example", "example"],
    ["example", "safe-bash-command-example"],
    ["safe-bash-command-example", "safe-bash-command-other"],
  ])("rejects directory %s with manifest %s", async (directory, name) => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      [`/repo/packages/${directory}/package.json`]: pkgJson({ name, private: true }),
    });
    expect(runRules(model, undefined, ["safe-bash-command-private"]).violations).toHaveLength(1);
  });

  it.each(["docx", "@poe-code/media-cli"])("rejects legacy command workspace %s imported by a facade", async name => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      "/repo/packages/legacy/package.json": pkgJson({ name, private: true }),
      "/repo/packages/safe-bash/package.json": pkgJson({ name: "@poe-platform/safe-bash", private: true }),
      "/repo/packages/safe-bash/src/commands/example/index.ts": `export * from ${JSON.stringify(name)};`,
    });
    expect(runRules(model, undefined, ["safe-bash-command-private"]).violations).toHaveLength(1);
  });

  it.each(["safe-bash-command-example", "safe-bash-example-engine", "safe-bash-contracts", "@poe-code/safe-fs", "@poe-code/pdf-ast"])("allows the command dependency %s", async name => {
    const directory = name.split("/").at(-1)!;
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      [`/repo/packages/${directory}/package.json`]: pkgJson({ name, private: true }),
      "/repo/packages/safe-bash/package.json": pkgJson({ name: "@poe-platform/safe-bash", private: true }),
      "/repo/packages/safe-bash/src/commands/example/index.ts": `export * from ${JSON.stringify(name)};`,
    });
    expect(runRules(model, undefined, ["safe-bash-command-private"]).violations).toEqual([]);
  });
});
