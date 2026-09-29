import { expect, it, vi } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import { publishDeclarations } from "./publish-declarations.mjs";
vi.mock("../packages/package-lint/dist/source-files.js", () => import("../packages/package-lint/src/source-files.js"));

it("publishes only the reachable declaration closure and survives workspace rebuilds", async () => {
  const original = 'export { Xml } from "xml-owner"; export type Literal = "xml-owner";';
  const volume = Volume.fromJSON({
    "/repo/packages/fs/dist/index.d.ts": original,
    "/repo/packages/xml/dist/index.d.ts": 'export { Xml } from "./model.js";',
    "/repo/packages/xml/dist/model.d.ts": "export declare class Xml {}",
    "/repo/packages/xml/dist/unused.d.ts": 'export * from "missing-private-package";',
    "/repo/dist/types/stale/index.d.ts": "export {};",
  });
  const files = createFsFromVolume(volume).promises;
  const manifest = { exports: { "./fs": { types: "./dist/types/fs/index.d.ts" } } };
  const workspaces = [
    { dir: "fs", pkg: { name: "fs-owner", types: "./dist/index.d.ts" } },
    { dir: "xml", pkg: { name: "xml-owner", exports: { ".": { types: "./dist/index.d.ts" } } } },
  ];
  await publishDeclarations("/repo", manifest, workspaces, { files });
  expect(volume.readFileSync("/repo/packages/fs/dist/index.d.ts", "utf8")).toBe(original);
  expect(volume.readFileSync("/repo/dist/types/fs/index.d.ts", "utf8")).toBe(
    'export { Xml } from "../xml/index.js"; export type Literal = "xml-owner";',
  );
  expect(volume.existsSync("/repo/dist/types/xml/unused.d.ts")).toBe(false);
  expect(volume.existsSync("/repo/dist/types/stale/index.d.ts")).toBe(false);
  await files.rm("/repo/packages", { recursive: true });
  expect(volume.readFileSync("/repo/dist/types/xml/model.d.ts", "utf8")).toBe("export declare class Xml {}");
});

it("retains conditional policies, wildcard exports, and shared identity across public roots", async () => {
  const volume = Volume.fromJSON({
    "/repo/dist/index.d.ts": 'export { Value } from "owner";',
    "/repo/packages/owner/dist/index.d.ts": 'export type Value = import("#platform").Value;',
    "/repo/packages/owner/dist/routes/nested/value.d.ts": 'export { Value } from "../../index.js";',
    "/repo/packages/owner/dist/node.d.ts": 'export type Value = import("node:fs").Stats;',
    "/repo/packages/owner/dist/browser.d.ts": "export type Value = Uint8Array;",
  });
  await publishDeclarations("/repo", {
    exports: {
      ".": { types: "./dist/index.d.ts" },
      "./routes/*": { types: "./dist/types/owner/routes/*.d.ts" },
    },
    imports: { "#platform": { types: {
      browser: "./dist/types/owner/browser.d.ts", default: "./dist/types/owner/node.d.ts",
    } } },
  }, [{ dir: "owner", pkg: { name: "owner", types: "./dist/index.d.ts" } }], {
    files: createFsFromVolume(volume).promises,
  });
  expect(volume.readFileSync("/repo/dist/index.d.ts", "utf8")).toContain('from "./types/owner/index.js"');
  expect(volume.readFileSync("/repo/dist/types/owner/index.d.ts", "utf8")).toContain('import("#platform")');
  expect(volume.readFileSync("/repo/dist/types/owner/routes/nested/value.d.ts", "utf8")).toContain('from "../../index.js"');
  expect(volume.existsSync("/repo/dist/types/owner/node.d.ts")).toBe(true);
  expect(volume.existsSync("/repo/dist/types/owner/browser.d.ts")).toBe(true);
});

it("fails missing reachable declarations before replacing an existing publication", async () => {
  const volume = Volume.fromJSON({
    "/repo/packages/owner/dist/index.d.ts": 'export { Value } from "./missing.js";',
    "/repo/dist/types/owner/index.d.ts": "previous publication",
  });
  await expect(publishDeclarations("/repo", {
    exports: { ".": { types: "./dist/types/owner/index.d.ts" } },
  }, [{ dir: "owner", pkg: { name: "owner" } }], {
    files: createFsFromVolume(volume).promises,
  })).rejects.toThrow("missing");
  expect(volume.readFileSync("/repo/dist/types/owner/index.d.ts", "utf8")).toBe("previous publication");
});

it("refuses explicitly blocked workspace exports instead of guessing a dist path", async () => {
  const volume = Volume.fromJSON({
    "/repo/dist/index.d.ts": 'export type Value = import("owner/blocked").Value;',
    "/repo/packages/owner/dist/blocked.d.ts": "export type Value = string;",
  });
  await expect(publishDeclarations("/repo", {
    exports: { ".": { types: "./dist/index.d.ts" } },
  }, [{ dir: "owner", pkg: { name: "owner", exports: { "./blocked": { types: null } } } }], {
    files: createFsFromVolume(volume).promises,
  })).rejects.toThrow("Missing or blocked workspace declaration export: owner/blocked");
});

it("preserves ESM and CommonJS declaration extensions for vendor type imports", async () => {
  const volume = Volume.fromJSON({
    "/repo/dist/index.d.ts": 'export type Font = import("../packages/pdf/dist/vendor/font.mjs").Font; export type Image = import("../packages/pdf/dist/vendor/image.cjs").Image;',
    "/repo/packages/pdf/dist/vendor/font.d.mts": "export interface Font {}",
    "/repo/packages/pdf/dist/vendor/image.d.cts": "export interface Image {}",
  });
  await publishDeclarations("/repo", { exports: { ".": { types: "./dist/index.d.ts" } } }, [], {
    files: createFsFromVolume(volume).promises,
  });
  expect(volume.readFileSync("/repo/dist/index.d.ts", "utf8")).toContain('import("./types/pdf/vendor/font.mjs")');
  expect(volume.readFileSync("/repo/dist/index.d.ts", "utf8")).toContain('import("./types/pdf/vendor/image.cjs")');
  expect(volume.existsSync("/repo/dist/types/pdf/vendor/font.d.mts")).toBe(true);
  expect(volume.existsSync("/repo/dist/types/pdf/vendor/image.d.cts")).toBe(true);
});

it.each(["symlink", "held-identity"])("rejects %s source declarations before copying their bytes", async defect => {
  const volume = Volume.fromJSON({
    "/repo/packages/owner/src/held.d.ts": "excluded bytes",
    "/repo/packages/owner/dist/placeholder": "",
    "/repo/dist/types/owner/index.d.ts": "previous publication",
  });
  if (defect === "symlink") volume.symlinkSync("../src/held.d.ts", "/repo/packages/owner/dist/index.d.ts");
  else volume.linkSync("/repo/packages/owner/src/held.d.ts", "/repo/packages/owner/dist/index.d.ts");
  const files = createFsFromVolume(volume).promises;
  const read = vi.spyOn(files, "readFile");
  await expect(publishDeclarations("/repo", { exports: { ".": { types: "./dist/types/owner/index.d.ts" } } }, [
    { dir: "owner", pkg: { name: "owner", poeCode: { packageLint: { sourceExclude: ["src/held.d.ts"] } } } },
  ], { files })).rejects.toThrow();
  expect(read).not.toHaveBeenCalledWith("/repo/packages/owner/dist/index.d.ts", "utf8");
  expect(volume.readFileSync("/repo/dist/types/owner/index.d.ts", "utf8")).toBe("previous publication");
});
