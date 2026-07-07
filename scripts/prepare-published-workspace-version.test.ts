import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";

import { preparePublishedWorkspaceVersion } from "./prepare-published-workspace-version.mjs";

describe("preparePublishedWorkspaceVersion", () => {
  it("waits for a registry release containing the current workspace source", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/tiny-http-mcp-server/package.json": JSON.stringify({
        name: "tiny-http-mcp-server",
        version: "0.1.0",
        license: "MIT"
      })
    });
    const fileSystem = createFsFromVolume(volume);
    const registryMetadata = [
      { name: "tiny-http-mcp-server", version: "0.1.3", gitHead: "old-release" },
      { name: "tiny-http-mcp-server", version: "0.1.4", gitHead: "current-release" }
    ];
    const readPublishedMetadata = vi.fn(() => registryMetadata.shift());
    const sourceChangedSince = vi.fn((gitHead: string) => gitHead === "old-release");
    const delay = vi.fn(async () => undefined);

    await expect(
      preparePublishedWorkspaceVersion({
        packageDir: "/repo/packages/tiny-http-mcp-server",
        attempts: 2,
        delay,
        fileSystem,
        readPublishedMetadata,
        sourceChangedSince
      })
    ).resolves.toBe("0.1.4");

    expect(delay).toHaveBeenCalledTimes(1);
    expect(sourceChangedSince).toHaveBeenCalledWith("old-release");
    expect(sourceChangedSince).toHaveBeenCalledWith("current-release");
    expect(
      JSON.parse(
        fileSystem.readFileSync(
          "/repo/packages/tiny-http-mcp-server/package.json",
          "utf8"
        ) as string
      )
    ).toEqual({
      name: "tiny-http-mcp-server",
      version: "0.1.4",
      license: "MIT"
    });
  });

  it("fails instead of bundling a stale release", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/tiny-http-mcp-server/package.json": JSON.stringify({
        name: "tiny-http-mcp-server",
        version: "0.1.0"
      })
    });
    const fileSystem = createFsFromVolume(volume);

    await expect(
      preparePublishedWorkspaceVersion({
        packageDir: "/repo/packages/tiny-http-mcp-server",
        attempts: 2,
        delay: async () => undefined,
        fileSystem,
        readPublishedMetadata: () => ({
          name: "tiny-http-mcp-server",
          version: "0.1.3",
          gitHead: "old-release"
        }),
        sourceChangedSince: () => true
      })
    ).rejects.toThrow(
      "tiny-http-mcp-server has no published release containing the current workspace source"
    );
  });

  it("rejects incomplete registry metadata", async () => {
    const volume = Volume.fromJSON({
      "/repo/packages/tiny-http-mcp-server/package.json": JSON.stringify({
        name: "tiny-http-mcp-server",
        version: "0.1.0"
      })
    });
    const fileSystem = createFsFromVolume(volume);

    await expect(
      preparePublishedWorkspaceVersion({
        packageDir: "/repo/packages/tiny-http-mcp-server",
        fileSystem,
        readPublishedMetadata: () => ({ version: "0.1.4" }),
        sourceChangedSince: () => false
      })
    ).rejects.toThrow("Invalid published metadata for tiny-http-mcp-server");
  });
});
