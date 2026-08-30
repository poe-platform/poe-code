import { describe, expect, it } from "vitest";
import * as root from "@poe-code/safe-fs";
import * as core from "../src/core.js";
import * as host from "../src/node-host.js";
import { platform, comparisonContext } from "#safe-fs-platform";
import { wrapperScenarios } from "./helpers/wrapper-scenarios.js";
import { proofScenarios } from "./helpers/proof-scenarios.js";

describe("selected Node core graph", () => {
  for (const scenario of proofScenarios) it(scenario.name, scenario.run);
  it("shares constructors, errors and backing registries across all entry facades", async () => {
    for (const name of ["FsError", "MemoryFileSystem", "ReadOnlyFileSystem", "MountFileSystem", "OverlayFileSystem", "WebDavFileSystem"] as const) {
      expect(core[name]).toBe(root[name]);
      expect(host[name]).toBe(root[name]);
    }
    const memory = new core.MemoryFileSystem();
    await memory.writeFile("/file", new Uint8Array([1]));
    const mounted = new host.MountFileSystem({ root: new root.ReadOnlyFileSystem(memory) });
    expect(await mounted.compareEntry("/file", memory, "/file")).toBe("same");
    await expect(memory.stat("/absent")).rejects.toBeInstanceOf(root.FsError);
    expect(core.isFsError({ code: "ENOENT" })).toBe(false);
  });

  it("keeps host-only and deferred backends out of core", () => {
    for (const name of ["RealFileSystem", "createNodeFsBridge", "S3FileSystem", "MockS3Client", "createS3HttpTransport", "createNodeFileSystemAdapterRegistry"]) {
      expect(core).not.toHaveProperty(name);
      expect(host).toHaveProperty(name);
    }
  });

  it("keeps selected policy operations immutable and native errno tables private", () => {
    expect(Object.isFrozen(platform)).toBe(true);
    expect(Object.isFrozen(comparisonContext)).toBe(true);
    for (const value of [...Object.values(platform), ...Object.values(comparisonContext)]) {
      expect(value).not.toBeInstanceOf(Map);
      expect(value).not.toBeInstanceOf(WeakMap);
    }
    expect(Reflect.set(platform, "errno", () => 0)).toBe(false);
    expect(Reflect.set(comparisonContext, "active", () => false)).toBe(false);
    expect(new core.FsError("ENOENT").errno).toBe(new root.FsError("ENOENT").errno);
    expect(typeof new core.FsError("ENOENT").errno).toBe("number");
  });

  for (const scenario of wrapperScenarios) it(scenario.name, scenario.run);
});
