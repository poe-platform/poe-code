import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STORE_SCHEMA_ID, TASK_SCHEMA_ID } from "./ids.js";

function schemaId(fileName: string): string {
  const raw = readFileSync(new URL(fileName, import.meta.url), "utf8");
  return (JSON.parse(raw) as { $id: string }).$id;
}

describe("schema id constants", () => {
  it("matches store.schema.json", () => {
    expect(STORE_SCHEMA_ID).toBe(schemaId("store.schema.json"));
  });

  it("matches task.schema.json", () => {
    expect(TASK_SCHEMA_ID).toBe(schemaId("task.schema.json"));
  });
});
