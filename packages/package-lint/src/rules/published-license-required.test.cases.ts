import { describe, expect, it } from "vitest";
import {
  addWorkflowPublishing,
  makeWorkspaceWithPackageFiles,
  pkgJson
} from "../fixtures.js";
import { publishedLicenseRequired } from "./published-license-required.js";

describe("published-license-required", () => {
  it("requires SPDX metadata and license text in published npm packages", async () => {
    const workspace = await makeWorkspaceWithPackageFiles(
      {
        "/repo/package.json": pkgJson({ name: "root", private: true }),
        "/repo/packages/tool/package.json": pkgJson({ name: "tool", files: ["dist"] }),
        "/repo/packages/tool/README.md": "# tool\n",
        "/repo/packages/tool/dist/index.js": "export {};\n"
      },
      [["packages/tool", ["dist/index.js"]]]
    );
    const model = addWorkflowPublishing(workspace, ["packages/tool"]);

    expect(publishedLicenseRequired.run(model)).toMatchObject([
      {
        rule: "published-license-required",
        package: "tool",
        detail: { missing: ["license-metadata", "license-file"] }
      }
    ]);
  });

  it("accepts a published package with SPDX metadata and packed license text", async () => {
    const workspace = await makeWorkspaceWithPackageFiles(
      {
        "/repo/package.json": pkgJson({ name: "root", private: true }),
        "/repo/packages/tool/package.json": pkgJson({
          name: "tool",
          license: "MIT",
          files: ["dist", "LICENSE"]
        }),
        "/repo/packages/tool/README.md": "# tool\n",
        "/repo/packages/tool/LICENSE": "MIT License\n",
        "/repo/packages/tool/dist/index.js": "export {};\n"
      },
      [["packages/tool", ["dist/index.js", "LICENSE"]]]
    );
    const model = addWorkflowPublishing(workspace, ["packages/tool"]);

    expect(publishedLicenseRequired.run(model)).toHaveLength(0);
  });

  it("ignores packages that are not published", async () => {
    const model = await makeWorkspaceWithPackageFiles(
      {
        "/repo/package.json": pkgJson({ name: "root", private: true }),
        "/repo/packages/internal/package.json": pkgJson({ name: "internal", private: true }),
        "/repo/packages/internal/README.md": "# internal\n"
      },
      [["packages/internal", []]]
    );

    expect(publishedLicenseRequired.run(model)).toHaveLength(0);
  });
});
