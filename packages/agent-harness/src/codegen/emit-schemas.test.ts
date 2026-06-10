import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { runHarnessCodegen } from "./emit-schemas.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

describe("harness schema codegen", () => {
  it("writes all built-in harness schema files into docs/schemas/harnesses", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;

    await runHarnessCodegen({
      fs,
      repoRoot: "/repo"
    });

    await expect(
      fs.readdir("/repo/docs/schemas/harnesses").then((entries) => [...entries].sort())
    ).resolves.toEqual([
      "coverage-demo.schema.json",
      "experiment-demo.schema.json",
      "pipeline-demo.schema.json",
      "ralph-demo.schema.json",
      "superintendent-demo.schema.json"
    ]);

    for (const kind of [
      "coverage-demo",
      "experiment-demo",
      "pipeline-demo",
      "ralph-demo",
      "superintendent-demo"
    ]) {
      const raw = await fs.readFile(`/repo/docs/schemas/harnesses/${kind}.schema.json`, "utf8");
      const schema = JSON.parse(raw.toString()) as {
        $id?: string;
        $schema?: string;
        properties?: Record<string, unknown>;
      };

      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.$id).toBe(
        `https://poe-platform.github.io/poe-code/schemas/harnesses/${kind}.schema.json`
      );
      expect(schema.properties).toHaveProperty("kind");
      if (kind !== "coverage-demo") {
        expect(schema.properties).toHaveProperty("$schema");
      }
    }
  });

  it("serializes schema keys in a stable order", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;

    await runHarnessCodegen({
      fs,
      repoRoot: "/repo"
    });

    const raw = await fs.readFile("/repo/docs/schemas/harnesses/ralph-demo.schema.json", "utf8");
    const lines = raw.toString().split("\n");

    expect(lines.slice(0, 4)).toEqual([
      "{",
      '  "$schema": "https://json-schema.org/draft/2020-12/schema",',
      '  "$id": "https://poe-platform.github.io/poe-code/schemas/harnesses/ralph-demo.schema.json",',
      '  "type": "object",'
    ]);
    expect(raw.toString()).toContain(`  "properties": {
    "$schema": {
      "type": "string",
      "enum": [
        "https://poe-platform.github.io/poe-code/schemas/harnesses/ralph-demo.schema.json"`);
  });

  it("rejects a generated schema symlink outside the repository", async () => {
    const volume = Volume.fromJSON({
      "/outside.json": "{\"external\":true}\n"
    });
    const fs = createFsFromVolume(volume).promises;
    volume.mkdirSync("/repo/docs/schemas/harnesses", { recursive: true });
    volume.symlinkSync(
      "/outside.json",
      "/repo/docs/schemas/harnesses/pipeline-demo.schema.json"
    );

    await expect(runHarnessCodegen({ fs, repoRoot: "/repo" })).rejects.toThrow(
      "Generated schema output must remain inside the repository."
    );
    await expect(fs.readFile("/outside.json", "utf8")).resolves.toBe("{\"external\":true}\n");
  });

  it("does not ignore schema realpath errors with inherited missing-path codes", async () => {
    const volume = new Volume();
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      async realpath(filePath: Parameters<typeof rawFs.realpath>[0]) {
        if (String(filePath).endsWith("/coverage-demo.schema.json")) {
          throw new Error("schema realpath denied");
        }

        return rawFs.realpath(filePath);
      }
    };

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
      await expect(runHarnessCodegen({ fs, repoRoot: "/repo" })).rejects.toThrow(
        "schema realpath denied"
      );
    });
  });

  it("does not remove a colliding staged schema symlink", async () => {
    const volume = Volume.fromJSON({
      "/outside.tmp": "outside-state\n"
    });
    const rawFs = createFsFromVolume(volume).promises;
    let stagedPath: string | undefined;
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        const pathText = String(filePath);
        if (
          pathText.startsWith("/repo/docs/schemas/harnesses/.coverage-demo.schema.json.") &&
          pathText.endsWith(".tmp")
        ) {
          stagedPath = pathText;
          volume.symlinkSync("/outside.tmp", pathText);
          expect(options).toEqual({ encoding: "utf8", flag: "wx" });
        }

        return rawFs.writeFile(filePath, data, options);
      }
    };

    await expect(runHarnessCodegen({ fs, repoRoot: "/repo" })).rejects.toThrow();

    expect(stagedPath).toBeDefined();
    expect(volume.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(volume.lstatSync(stagedPath as string).isSymbolicLink()).toBe(true);
    await expect(fs.readFile("/repo/docs/schemas/harnesses/coverage-demo.schema.json", "utf8"))
      .rejects.toThrow();
  });

  it("restores previously published schemas when a later write fails", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/schemas/harnesses/coverage-demo.schema.json": "old coverage schema\n",
      "/repo/docs/schemas/harnesses/experiment-demo.schema.json": "old experiment schema\n"
    });
    const rawFs = createFsFromVolume(volume).promises;
    let writeCount = 0;
    let partialStagedPath: string | undefined;
    const fs = {
      ...rawFs,
      async writeFile(
        filePath: Parameters<typeof rawFs.writeFile>[0],
        data: Parameters<typeof rawFs.writeFile>[1],
        options?: Parameters<typeof rawFs.writeFile>[2]
      ) {
        writeCount += 1;
        if (writeCount === 2) {
          partialStagedPath = String(filePath);
          await rawFs.writeFile(filePath, "partial schema\n", options);
          throw new Error("simulated later schema failure");
        }

        return rawFs.writeFile(filePath, data, options);
      }
    };

    await expect(runHarnessCodegen({ fs, repoRoot: "/repo" })).rejects.toThrow(
      "simulated later schema failure"
    );
    await expect(fs.readFile("/repo/docs/schemas/harnesses/coverage-demo.schema.json", "utf8"))
      .resolves.toBe("old coverage schema\n");
    await expect(fs.readFile("/repo/docs/schemas/harnesses/experiment-demo.schema.json", "utf8"))
      .resolves.toBe("old experiment schema\n");
    expect(partialStagedPath).toMatch(
      /^\/repo\/docs\/schemas\/harnesses\/\..+\.schema\.json\..+\.tmp$/
    );
    await expect(fs.readFile(partialStagedPath ?? "", "utf8")).rejects.toThrow();
  });

  it("restores previously published schemas when a later publish rename fails", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/schemas/harnesses/coverage-demo.schema.json": "old coverage schema\n",
      "/repo/docs/schemas/harnesses/experiment-demo.schema.json": "old experiment schema\n"
    });
    const rawFs = createFsFromVolume(volume).promises;
    const fs = {
      ...rawFs,
      async rename(
        fromPath: Parameters<typeof rawFs.rename>[0],
        toPath: Parameters<typeof rawFs.rename>[1]
      ) {
        const fromText = String(fromPath);
        if (
          fromText.includes("/.experiment-demo.schema.json.") &&
          fromText.endsWith(".tmp")
        ) {
          throw new Error("simulated schema publish failure");
        }

        return rawFs.rename(fromPath, toPath);
      }
    };

    await expect(runHarnessCodegen({ fs, repoRoot: "/repo" })).rejects.toThrow(
      "simulated schema publish failure"
    );
    await expect(fs.readFile("/repo/docs/schemas/harnesses/coverage-demo.schema.json", "utf8"))
      .resolves.toBe("old coverage schema\n");
    await expect(fs.readFile("/repo/docs/schemas/harnesses/experiment-demo.schema.json", "utf8"))
      .resolves.toBe("old experiment schema\n");
    await expect(
      fs.readdir("/repo/docs/schemas/harnesses").then((entries) => [...entries].sort())
    ).resolves.toEqual(["coverage-demo.schema.json", "experiment-demo.schema.json"]);
  });
});
