import { Volume, createFsFromVolume } from "memfs";
import {
  planSchemaDocuments,
  runPlanSchemaCodegen,
  serializeJsonDocument
} from "../../scripts/generate-plan-schemas.js";

describe("plan schema codegen", () => {
  it("writes all plan schema files into docs/schemas/plans", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume).promises;

    await runPlanSchemaCodegen({
      fs,
      repoRoot: "/repo"
    });

    await expect(fs.readdir("/repo/docs/schemas/plans").then((entries) => [...entries].sort())).resolves.toEqual([
      "experiment.schema.json",
      "pipeline.schema.json",
      "plan.schema.json",
      "ralph.schema.json",
      "superintendent-base.schema.json",
      "superintendent.schema.json"
    ]);

    for (const document of planSchemaDocuments) {
      const filePath = `/repo/docs/schemas/plans/${document.fileName}`;
      await expect(fs.readFile(filePath, "utf8")).resolves.toBe(
        serializeJsonDocument(document.schema)
      );
    }
  });

  it("serializes nested schema objects deterministically", () => {
    expect(
      serializeJsonDocument({
        z: 1,
        list: [
          {
            b: 2,
            a: 1
          }
        ],
        a: {
          d: 4,
          c: 3
        }
      })
    ).toBe(`{
  "a": {
    "c": 3,
    "d": 4
  },
  "list": [
    {
      "a": 1,
      "b": 2
    }
  ],
  "z": 1
}\n`);
  });

  it("orders known schema keys before alphabetical keys", () => {
    expect(
      serializeJsonDocument({
        additionalProperties: false,
        required: ["kind"],
        properties: { kind: { const: "plan", type: "string" } },
        type: "object",
        title: "Generic plan",
        $id: "https://example.com/plan.schema.json",
        $schema: "https://json-schema.org/draft/2020-12/schema"
      })
    ).toBe(`{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/plan.schema.json",
  "title": "Generic plan",
  "type": "object",
  "properties": {
    "kind": {
      "type": "string",
      "const": "plan"
    }
  },
  "required": [
    "kind"
  ],
  "additionalProperties": false
}\n`);
  });
});
