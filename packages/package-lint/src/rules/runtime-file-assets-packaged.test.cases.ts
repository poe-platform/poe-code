import { describe, expect, it } from "vitest";
import {
  addRootShipping,
  addWorkflowPublishing,
  makeWorkspaceWithPackageFiles,
  pkgJson
} from "../fixtures.js";
import { runtimeFileAssetsPackaged } from "./runtime-file-assets-packaged.js";

async function publishedModel(files: Record<string, string>, packedFiles: string[]) {
  const model = await makeWorkspaceWithPackageFiles(files, [
    [".", []],
    ["packages/a", packedFiles]
  ]);
  return addWorkflowPublishing(model, ["packages/a"]);
}

describe("runtime-file-assets-packaged", () => {
  it("errors when a referenced source asset is missing from dist", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readFileSync } from "node:fs";
          readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
        `,
        "/repo/packages/a/src/templates/x.md": "# x\n"
      },
      []
    );

    expect(runtimeFileAssetsPackaged.run(model)).toMatchObject([
      {
        rule: "runtime-file-assets-packaged",
        package: "a",
        severity: "error",
        detail: { missing: ["runtime-file", "published-package"] }
      }
    ]);
  });

  it("errors when a dist asset exists but is absent from the package packlist", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readFileSync } from "node:fs";
          readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
        `,
        "/repo/packages/a/src/templates/x.md": "# x\n",
        "/repo/packages/a/dist/templates/x.md": "# x\n"
      },
      ["dist/index.js"]
    );

    expect(runtimeFileAssetsPackaged.run(model)[0]?.detail).toMatchObject({
      missing: ["published-package"]
    });
  });

  it("errors when root ships a package dist but the root packlist omits the asset", async () => {
    const base = await makeWorkspaceWithPackageFiles(
      {
        "/repo/package.json": pkgJson({
          name: "root",
          files: ["packages/a/dist"]
        }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", private: true, files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readFileSync } from "node:fs";
          readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
        `,
        "/repo/packages/a/dist/templates/x.md": "# x\n"
      },
      [
        [".", ["packages/a/dist/index.js"]],
        ["packages/a", ["dist/templates/x.md"]]
      ]
    );
    const model = addRootShipping(base, ["packages/a"]);

    expect(runtimeFileAssetsPackaged.run(model)[0]?.detail).toMatchObject({
      missing: ["root-files"]
    });
  });

  it("passes when the asset exists and every required packlist includes it", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readFileSync } from "node:fs";
          readFileSync(new URL("./templates/x.md", import.meta.url), "utf8");
        `,
        "/repo/packages/a/dist/templates/x.md": "# x\n"
      },
      ["dist/templates/x.md"]
    );

    expect(runtimeFileAssetsPackaged.run(model)).toEqual([]);
  });

  it("passes when a dynamic user file cannot be resolved to a package asset", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readFile } from "node:fs/promises";
          export async function load(filePath: string) {
            await readFile(filePath, "utf8");
          }
        `
      },
      []
    );

    expect(runtimeFileAssetsPackaged.run(model)).toEqual([]);
  });

  it("passes for a directory asset with packed files", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readdirSync } from "node:fs";
          readdirSync(new URL("./corpus", import.meta.url));
        `,
        "/repo/packages/a/dist/corpus/a.md": "# a\n"
      },
      ["dist/corpus/a.md"]
    );

    expect(runtimeFileAssetsPackaged.run(model)).toEqual([]);
  });

  it("errors for an empty or absent runtime directory", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({ name: "a", version: "1.0.0", files: ["dist"] }),
        "/repo/packages/a/src/index.ts": `
          import { readdirSync } from "node:fs";
          readdirSync(new URL("./corpus", import.meta.url));
        `
      },
      []
    );

    expect(runtimeFileAssetsPackaged.run(model)[0]?.detail).toMatchObject({
      missing: ["runtime-directory", "published-package"]
    });
  });

  it("verifies manifest-declared runtime assets", async () => {
    const model = await publishedModel(
      {
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/a/package.json": pkgJson({
          name: "a",
          version: "1.0.0",
          files: ["dist"],
          poeCode: {
            runtimeAssets: [{ source: "src/templates", runtime: "dist/templates" }]
          }
        })
      },
      []
    );

    expect(runtimeFileAssetsPackaged.run(model)).toMatchObject([
      {
        detail: {
          runtimePath: "packages/a/dist/templates",
          missing: ["runtime-directory", "published-package"]
        }
      }
    ]);
  });
});
