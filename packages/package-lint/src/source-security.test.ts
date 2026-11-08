import { describe, expect, it, vi } from "vitest";
import { memLintFs, pkgJson } from "./fixtures.js";
import { loadWorkspace } from "./model.js";
import { scanImportFiles, scanSourceImports } from "./source-imports.js";
import { scanRuntimeFileAssets } from "./runtime-files.js";
import { runRules } from "./rules/index.js";

const source = `
  import "../../../neighbor/src/index.js";
  import { readFileSync } from "node:fs";
  readFileSync(new URL("../../../neighbor/asset.txt", import.meta.url), "utf8");
`;
const packageDir = "/repo/packages/agent";
const held = `${packageDir}/src/held/secret.ts`;
const descriptors = [
  {
    name: "agent",
    dir: "packages/agent",
    workspaceNames: new Set(["neighbor"]),
    sourceExclude: ["src/held"]
  }
];

describe("root entrypoint source admission", () => {
  it("does not read an entrypoint whose owning metadata cannot be confirmed", async () => {
    const target = `${packageDir}/dist/index.js`;
    const fs = memLintFs({ [target]: source });
    const original = fs.lstat!.bind(fs);
    let targetChecks = 0;
    fs.lstat = async (file) => {
      if (file === target && ++targetChecks > 1)
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return original(file);
    };
    const readFile = vi.spyOn(fs, "readFile");
    await expect(
      scanImportFiles(fs, "/repo", ["packages/agent/dist/index.js"], descriptors)
    ).rejects.toThrow("entrypoint");
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each(["package", "file"])(
    "resolves case-insensitive %s aliases to the owning exclusion",
    async (alias) => {
      const target =
        alias === "package"
          ? "packages/AGENT/src/held/secret.ts"
          : "packages/agent/src/held/SECRET.ts";
      const fs = memLintFs({
        "/repo/package.json": pkgJson({ name: "root", main: target }),
        [`${packageDir}/package.json`]: pkgJson({
          name: "agent",
          poeCode: { packageLint: { sourceExclude: ["src/held/secret.ts"] } }
        }),
        [held]: source
      });
      const original = fs.lstat!.bind(fs);
      fs.lstat = (file) =>
        original(
          file
            .replace("/AGENT/", "/agent/")
            .replace("/AGENT", "/agent")
            .replace("/SECRET.ts", "/secret.ts")
        );
      fs.realpath = async (file) => file;
      const readFile = vi.spyOn(fs, "readFile");
      await expect(loadWorkspace(fs, "/repo")).rejects.toThrow("entrypoint");
      expect(readFile.mock.calls.every(([file]) => !file.endsWith(".ts"))).toBe(true);
    }
  );

  it("does not confuse distinct case-sensitive package owners", async () => {
    const target = "/repo/packages/Agent/src/held/secret.ts";
    const fs = memLintFs({
      "/repo/package.json": pkgJson({ name: "root", main: "packages/Agent/src/held/secret.ts" }),
      [`${packageDir}/package.json`]: pkgJson({
        name: "agent",
        poeCode: { packageLint: { sourceExclude: ["src/held"] } }
      }),
      "/repo/packages/Agent/package.json": pkgJson({ name: "distinct-agent" }),
      [held]: source,
      [target]: source
    });
    const readFile = vi.spyOn(fs, "readFile");
    const model = await loadWorkspace(fs, "/repo");
    expect(model.shippedDistImports.get("packages/Agent/src/held/secret.ts")).toHaveLength(2);
    expect(readFile).not.toHaveBeenCalledWith(held);
    expect(readFile).toHaveBeenCalledWith(target);
  });

  for (const field of ["exports", "main", "bin"]) {
    it.each(["src/held", "src/held/secret.ts"])(
      `${field} rejects held target with exclusion %s`,
      async (excluded) => {
        const target = "./packages/agent/src/held/secret.ts";
        const fs = memLintFs({
          "/repo/package.json": pkgJson({
            name: "root",
            [field]: field === "bin" ? { agent: target } : target
          }),
          [`${packageDir}/package.json`]: pkgJson({
            name: "agent",
            poeCode: { packageLint: { sourceExclude: [excluded] } }
          }),
          [held]: source
        });
        const readFile = vi.spyOn(fs, "readFile");

        await expect(loadWorkspace(fs, "/repo")).rejects.toThrow("entrypoint");
        expect(readFile).not.toHaveBeenCalledWith(held);
      }
    );
  }

  it("rejects a root-owned held entrypoint instead of silently removing it", async () => {
    const fs = memLintFs({
      "/repo/package.json": pkgJson({
        name: "root",
        main: "src/held.ts",
        poeCode: { packageLint: { sourceExclude: ["src/held.ts"] } }
      }),
      "/repo/src/held.ts": source
    });
    const readFile = vi.spyOn(fs, "readFile");
    await expect(loadWorkspace(fs, "/repo")).rejects.toThrow("entrypoint");
    expect(readFile).not.toHaveBeenCalledWith("/repo/src/held.ts");
  });

  it("keeps ordinary built entrypoints analyzed", async () => {
    const fs = memLintFs({
      "/repo/package.json": pkgJson({ name: "root", main: "packages/agent/dist/index.js" }),
      [`${packageDir}/package.json`]: pkgJson({
        name: "agent",
        poeCode: { packageLint: { sourceExclude: ["src/held"] } }
      }),
      [held]: source,
      [`${packageDir}/dist/index.js`]: 'import "unresolved-runtime";'
    });
    const readFile = vi.spyOn(fs, "readFile");
    const model = await loadWorkspace(fs, "/repo");
    expect(model.rootEntryPoints).toHaveLength(1);
    expect(model.shippedDistImports.get("packages/agent/dist/index.js")).toHaveLength(1);
    expect(readFile).not.toHaveBeenCalledWith(held);
  });

  it.each(["symlink", "special"])(
    "rejects %s root entrypoint metadata before reading",
    async (kind) => {
      const target = `${packageDir}/dist/public.js`;
      const fs = memLintFs(
        { [held]: source, ...(kind === "special" ? { [target]: source } : {}) },
        kind === "symlink" ? { [target]: held } : {}
      );
      if (kind === "special") {
        const original = fs.lstat!.bind(fs);
        fs.lstat = async (file) =>
          file === target
            ? {
                ...(await original(file)),
                isDirectory: () => false,
                isFile: () => false,
                isSymbolicLink: () => false
              }
            : original(file);
      }
      const readFile = vi.spyOn(fs, "readFile");
      await expect(scanImportFiles(fs, "/repo", ["packages/agent/dist/public.js"])).rejects.toThrow(
        "Unsupported"
      );
      expect(readFile).not.toHaveBeenCalled();
    }
  );
});

describe.each(["bulk", "recursive"])("metadata admission with %s listing", (listing) => {
  for (const scanner of [scanSourceImports, scanRuntimeFileAssets]) {
    it(`${scanner.name} rejects an alias to excluded source in the same package`, async () => {
      const target = `${packageDir}/src/public.ts`;
      const fs = memLintFs({ [held]: source }, { [target]: held });
      if (listing === "recursive") fs.listFiles = undefined;
      const readFile = vi.spyOn(fs, "readFile");
      await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("Unsupported");
      expect(readFile).not.toHaveBeenCalled();
    });

    it(`${scanner.name} applies exclusions to canonical paths before reading`, async () => {
      const target = `${packageDir}/src/public.ts`;
      const fs = memLintFs({ [held]: source, [target]: source });
      if (listing === "recursive") fs.listFiles = undefined;
      const original = fs.realpath!.bind(fs);
      fs.realpath = (file) => (file === target ? Promise.resolve(held) : original(file));
      const readFile = vi.spyOn(fs, "readFile");
      await scanner(fs, "/repo", descriptors);
      expect(readFile).not.toHaveBeenCalled();
    });

    it(`${scanner.name} fails closed when path identity is unavailable`, async () => {
      const target = `${packageDir}/src/public.ts`;
      const fs = memLintFs({ [target]: source });
      if (listing === "recursive") fs.listFiles = undefined;
      const original = fs.lstat!.bind(fs);
      fs.lstat = async (file) =>
        file === target ? ({ ...(await original(file)), ino: undefined } as never) : original(file);
      const readFile = vi.spyOn(fs, "readFile");
      await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("metadata");
      expect(readFile).not.toHaveBeenCalled();
    });

    it.each(["file", "directory", "source-root", "package-root"])(
      `${scanner.name} rejects a symlinked %s before reading`,
      async (kind) => {
        const link =
          kind === "file"
            ? `${packageDir}/src/public.ts`
            : kind === "directory"
              ? `${packageDir}/src/public`
              : kind === "source-root"
                ? `${packageDir}/src`
                : packageDir;
        const fs = memLintFs(
          { "/repo/held/secret.ts": source },
          { [link]: kind === "file" ? "/repo/held/secret.ts" : "/repo/held" }
        );
        if (listing === "recursive") fs.listFiles = undefined;
        const readFile = vi.spyOn(fs, "readFile");
        await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("Unsupported");
        expect(readFile).not.toHaveBeenCalled();
      }
    );

    it.each(["file", "source-root"])(
      `${scanner.name} rejects a special %s without opening it`,
      async (kind) => {
        const target = kind === "file" ? `${packageDir}/src/public.ts` : `${packageDir}/src`;
        const fs = memLintFs({ [`${packageDir}/src/public.ts`]: source });
        if (listing === "recursive") fs.listFiles = undefined;
        const original = fs.lstat!.bind(fs);
        fs.lstat = async (file) =>
          file === target
            ? {
                ...(await original(file)),
                isDirectory: () => false,
                isFile: () => false,
                isSymbolicLink: () => false
              }
            : original(file);
        const readFile = vi.spyOn(fs, "readFile");
        await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("Unsupported");
        expect(readFile).not.toHaveBeenCalled();
      }
    );

    it(`${scanner.name} rejects canonical paths outside ownership`, async () => {
      const target = `${packageDir}/src/public.ts`;
      const fs = memLintFs({ [target]: source });
      if (listing === "recursive") fs.listFiles = undefined;
      const original = fs.realpath!.bind(fs);
      fs.realpath = async (file) => (file === target ? "/repo/outside/secret.ts" : original(file));
      const readFile = vi.spyOn(fs, "readFile");
      await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("ownership");
      expect(readFile).not.toHaveBeenCalled();
    });

    it.each(["lstat", "realpath"] as const)(
      `${scanner.name} fails closed without %s metadata support`,
      async (method) => {
        const fs = memLintFs({ [`${packageDir}/src/public.ts`]: source });
        if (listing === "recursive") fs.listFiles = undefined;
        fs[method] = undefined;
        const readFile = vi.spyOn(fs, "readFile");
        await expect(scanner(fs, "/repo", descriptors)).rejects.toThrow("metadata");
        expect(readFile).not.toHaveBeenCalled();
      }
    );

    it.each(["directory", "file"])(
      `${scanner.name} binds case-insensitive %s exclusions by identity`,
      async (kind) => {
        const fs = memLintFs({ [held]: source, [`${packageDir}/src/public.ts`]: source });
        if (listing === "recursive") fs.listFiles = undefined;
        const original = fs.lstat!.bind(fs);
        const configured = kind === "file" ? "src/held/SECRET.ts" : "src/HELD";
        fs.lstat = (file) =>
          original(file.replace("/HELD", "/held").replace("/SECRET.ts", "/secret.ts"));
        fs.realpath = async (file) => file;
        const readFile = vi.spyOn(fs, "readFile");
        await scanner(fs, "/repo", [{ ...descriptors[0], sourceExclude: [configured] }]);
        expect(readFile).not.toHaveBeenCalledWith(held);
        expect(readFile).toHaveBeenCalledWith(`${packageDir}/src/public.ts`);
      }
    );

    it(`${scanner.name} preserves distinct case-sensitive neighboring files`, async () => {
      const distinct = `${packageDir}/src/Held/secret.ts`;
      const fs = memLintFs({ [held]: source, [distinct]: source });
      if (listing === "recursive") fs.listFiles = undefined;
      const readFile = vi.spyOn(fs, "readFile");
      await scanner(fs, "/repo", descriptors);
      expect(readFile).not.toHaveBeenCalledWith(held);
      expect(readFile).toHaveBeenCalledWith(distinct);
    });
  }
});

describe.each(["bulk", "recursive"])("ordinary nested dist source with %s listing", (listing) => {
  it.each([undefined, { packageLint: { sourceExclude: [] } }])(
    "retains violations with configuration %j",
    async (poeCode) => {
      const target = `${packageDir}/src/dist/index.ts`;
      const fs = memLintFs({
        "/repo/package.json": pkgJson({ name: "root" }),
        [`${packageDir}/package.json`]: pkgJson({ name: "agent", poeCode }),
        [target]: source
      });
      const readFile = vi.spyOn(fs, "readFile");
      if (listing === "recursive") fs.listFiles = undefined;
      const model = await loadWorkspace(fs, "/repo");
      expect(readFile).toHaveBeenCalledWith(target);
      const result = runRules(model, undefined, [
        "no-cross-package-relative-import",
        "runtime-file-assets-collocated"
      ]);
      expect(result.summary.ok).toBe(false);
      expect(result.violations).toHaveLength(2);
    }
  );
});
