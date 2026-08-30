import { describe, expect, it, vi } from "vitest";
import { memLintFs, pkgJson } from "./fixtures.js";
import { loadWorkspace } from "./model.js";
import { runRules } from "./rules/index.js";
import { scanRuntimeFileAssets } from "./runtime-files.js";
import { scanSourceImports } from "./source-imports.js";

const source = `
  import "../../neighbor/src/index.js";
  import { readFileSync } from "node:fs";
  readFileSync(new URL("../../neighbor/asset.txt", import.meta.url), "utf8");
`;

const invalidPaths = [
  "",
  ".",
  "src",
  "src/",
  "../src/held",
  "/src/held",
  "C:/src/held",
  "src/../held",
  "src/held/../../neighbor",
  "src/./held",
  "src//held",
  "src/held/",
  "src\\held",
  "src/*",
  "src/**",
  "src/held?.ts",
  "src/[held]",
  "src/{held,other}",
  "!src/held",
  "src/!(held)",
  " src/held",
  "src/held ",
  "src/held\u0000.ts",
  "dist/held"
];

describe.each(["bulk", "recursive"])("source admission with %s listing", (listing) => {
  for (const scanner of [scanSourceImports, scanRuntimeFileAssets]) {
    it(`${scanner.name} excludes held paths before reads and retains neighbors`, async () => {
      const heldPaths = [
        "/repo/packages/agent/src/held/deep/entry.ts",
        "/repo/packages/agent/src/held-file.ts"
      ];
      const neighborPaths = [
        "/repo/packages/agent/src/index.ts",
        "/repo/packages/agent/src/held-neighbor.ts",
        "/repo/packages/agent/src/held-file.tsx"
      ];
      const fs = memLintFs(
        Object.fromEntries([...heldPaths, ...neighborPaths].map((file) => [file, source]))
      );
      if (listing === "recursive") fs.listFiles = undefined;
      const readFile = vi.spyOn(fs, "readFile");
      const readdir = vi.spyOn(fs, "readdir");
      const packages = [
        {
          name: "agent",
          dir: "packages/agent",
          workspaceNames: new Set(["neighbor"]),
          sourceExclude: ["src/held", "src/held-file.ts"]
        }
      ];

      const view = await scanner(fs, "/repo", packages);

      for (const file of heldPaths) expect(readFile).not.toHaveBeenCalledWith(file);
      for (const file of neighborPaths) expect(readFile).toHaveBeenCalledWith(file);
      expect(view.get("packages/agent")).toHaveLength(scanner === scanSourceImports ? 6 : 3);
      if (listing === "recursive") {
        expect(readdir).not.toHaveBeenCalledWith("/repo/packages/agent/src/held");
      }
    });

    it(`${scanner.name} does not treat dependencies or tool metadata as owned source`, async () => {
      const ignoredPaths = ["node_modules/dependency", ".git", ".turbo"].map(
        (directory) => `/repo/packages/agent/src/${directory}/entry.ts`
      );
      const fs = memLintFs({
        ...Object.fromEntries(ignoredPaths.map((file) => [file, source])),
        "/repo/packages/agent/src/index.ts": source,
        "/repo/packages/agent/src/types.d.ts": source
      });
      if (listing === "recursive") fs.listFiles = undefined;
      const readFile = vi.spyOn(fs, "readFile");

      await scanner(fs, "/repo", [
        {
          name: "agent",
          dir: "packages/agent",
          workspaceNames: new Set(["neighbor"])
        }
      ]);

      expect(readFile.mock.calls).toEqual([["/repo/packages/agent/src/index.ts"]]);
    });
  }

  it("applies manifest exclusions before gathering either model view without hiding violations", async () => {
    const heldPath = "/repo/packages/agent/src/held/entry.ts";
    const neighborPath = "/repo/packages/neighbor/src/held/entry.ts";
    const fs = memLintFs({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({
        name: "agent",
        poeCode: { packageLint: { sourceExclude: ["src/held"] } }
      }),
      "/repo/packages/neighbor/package.json": pkgJson({ name: "neighbor" }),
      [heldPath]: source,
      "/repo/packages/agent/src/index.ts": source,
      "/repo/packages/agent/src/held-neighbor.ts": source,
      [neighborPath]: 'import "../../../agent/src/index.js";'
    });
    if (listing === "recursive") fs.listFiles = undefined;
    const readFile = vi.spyOn(fs, "readFile");

    const model = await loadWorkspace(fs, "/repo");
    const result = runRules(model, undefined, [
      "no-cross-package-relative-import",
      "runtime-file-assets-collocated"
    ]);

    expect(readFile).not.toHaveBeenCalledWith(heldPath);
    expect(readFile).toHaveBeenCalledWith(neighborPath);
    expect(model.sourceImports.get("packages/agent")).toHaveLength(4);
    expect(model.runtimeFileAssets.get("packages/agent")).toHaveLength(2);
    expect(result.summary.ok).toBe(false);
    expect(result.violations).toHaveLength(5);
    expect(result.violations.every((violation) => violation.severity === "error")).toBe(true);
  });
});

describe("source admission validation", () => {
  const invalidConfigs = [
    null,
    false,
    "src/held",
    [],
    {},
    { exclude: ["src/held"] },
    { sourceExclude: null },
    { sourceExclude: "src/held" },
    { sourceExclude: [false] },
    { sourceExclude: ["src/held", "src/held"] },
    { sourceExclude: [], unknown: true },
    ...invalidPaths.map((entry) => ({ sourceExclude: [entry] }))
  ];

  it.each(invalidConfigs)(
    "rejects invalid manifest configuration %j before source reads",
    async (config) => {
      const fs = memLintFs({
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/ordinary/package.json": pkgJson({ name: "ordinary" }),
        "/repo/packages/ordinary/src/index.ts": source,
        "/repo/packages/agent/package.json": pkgJson({
          name: "agent",
          poeCode: { packageLint: config }
        }),
        "/repo/packages/agent/src/held/entry.ts": source
      });
      const readFile = vi.spyOn(fs, "readFile");

      await expect(loadWorkspace(fs, "/repo")).rejects.toThrow(
        "packages/agent/package.json: poeCode.packageLint"
      );
      expect(readFile.mock.calls.every(([file]) => !file.endsWith(".ts"))).toBe(true);
    }
  );

  it.each([undefined, { packageLint: { sourceExclude: [] } }, { runtimeAssets: [] }])(
    "preserves ordinary analysis with omitted or empty exclusions %j",
    async (poeCode) => {
      const fs = memLintFs({
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/agent/package.json": pkgJson({ name: "agent", poeCode }),
        "/repo/packages/agent/src/index.ts": source
      });

      const model = await loadWorkspace(fs, "/repo");

      expect(model.sourceImports.get("packages/agent")).toHaveLength(2);
      expect(model.runtimeFileAssets.get("packages/agent")).toHaveLength(1);
    }
  );

  for (const scanner of [scanSourceImports, scanRuntimeFileAssets]) {
    it(`${scanner.name} validates every package before reading any source`, async () => {
      const fs = memLintFs({ "/repo/packages/ordinary/src/index.ts": source });
      const readFile = vi.spyOn(fs, "readFile");

      await expect(
        scanner(fs, "/repo", [
          { name: "ordinary", dir: "packages/ordinary", workspaceNames: new Set() },
          {
            name: "agent",
            dir: "packages/agent",
            workspaceNames: new Set(),
            sourceExclude: ["src"]
          }
        ])
      ).rejects.toThrow("sourceExclude");
      expect(readFile).not.toHaveBeenCalled();
    });

    it(`${scanner.name} rejects files outside src from a bulk listing`, async () => {
      const fs = memLintFs({
        "/repo/packages/agent/src/index.ts": source,
        "/repo/packages/neighbor/src/index.ts": source,
        "/repo/packages/agent/dist/index.ts": source
      });
      fs.listFiles = async () => [
        "/repo/packages/agent/src/index.ts",
        "/repo/packages/neighbor/src/index.ts",
        "/repo/packages/agent/dist/index.ts"
      ];
      const readFile = vi.spyOn(fs, "readFile");

      await scanner(fs, "/repo", [
        {
          name: "agent",
          dir: "packages/agent",
          workspaceNames: new Set()
        }
      ]);

      expect(readFile.mock.calls).toEqual([["/repo/packages/agent/src/index.ts"]]);
    });
  }
});
