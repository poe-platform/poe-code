import path from "node:path";
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import {
  assertMcpSdkIsDevDependencyOnly,
  type AuditFileSystem,
} from "./sdk-dependency-audit.js";

function createMemFs(
  files: Record<string, string>
): AuditFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as AuditFileSystem;
}

describe("assertMcpSdkIsDevDependencyOnly", () => {
  it("passes for the current repository package manifests", async () => {
    await expect(
      assertMcpSdkIsDevDependencyOnly({
        packagesDir: path.resolve(process.cwd(), "packages"),
      })
    ).resolves.toBeUndefined();
  });

  it("fails when a package.json moves the SDK from devDependencies to dependencies", async () => {
    const fs = createMemFs({
      "/repo/packages/allowed/package.json": JSON.stringify({
        name: "allowed",
        devDependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
        },
      }),
      "/repo/packages/forbidden/package.json": JSON.stringify({
        name: "forbidden",
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
        },
      }),
    });

    await expect(
      assertMcpSdkIsDevDependencyOnly({
        packagesDir: "/repo/packages",
        fs,
      })
    ).rejects.toThrow(
      'packages/forbidden/package.json -> dependencies["@modelcontextprotocol/sdk"] must move to devDependencies.'
    );
  });

  it("fails when the SDK appears in peerDependencies or optionalDependencies", async () => {
    const fs = createMemFs({
      "/repo/packages/peer-only/package.json": JSON.stringify({
        name: "peer-only",
        peerDependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
        },
      }),
      "/repo/packages/optional-only/package.json": JSON.stringify({
        name: "optional-only",
        optionalDependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
        },
      }),
    });

    await expect(
      assertMcpSdkIsDevDependencyOnly({
        packagesDir: "/repo/packages",
        fs,
      })
    ).rejects.toThrow(
      [
        'packages/optional-only/package.json -> optionalDependencies["@modelcontextprotocol/sdk"] must move to devDependencies.',
        'packages/peer-only/package.json -> peerDependencies["@modelcontextprotocol/sdk"] must move to devDependencies.',
      ].join("\n")
    );
  });

  it("ignores nested dependency package.json files under node_modules", async () => {
    const fs = createMemFs({
      "/repo/packages/app/package.json": JSON.stringify({
        name: "app",
      }),
      "/repo/packages/app/node_modules/forbidden/package.json": JSON.stringify({
        name: "forbidden",
        dependencies: {
          "@modelcontextprotocol/sdk": "^1.26.0",
        },
      }),
    });

    await expect(
      assertMcpSdkIsDevDependencyOnly({
        packagesDir: "/repo/packages",
        fs,
      })
    ).resolves.toBeUndefined();
  });
});
