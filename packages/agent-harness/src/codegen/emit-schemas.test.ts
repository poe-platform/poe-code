import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";

import { runHarnessCodegen } from "./emit-schemas.js";

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
      "experiment-demo.schema.json",
      "pipeline-demo.schema.json",
      "ralph-demo.schema.json",
      "superintendent-demo.schema.json"
    ]);

    for (const kind of [
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
      expect(schema.properties).toHaveProperty("$schema");
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
});
