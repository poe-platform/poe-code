import storeSchema from "./schema/store.schema.json";
import taskSchema from "./schema/task.schema.json";

describe("task-list schemas", () => {
  it("allows flattened task metadata without a nested metadata field", () => {
    expect(taskSchema.required).toEqual(["name", "state"]);
    expect(taskSchema.properties).not.toHaveProperty("metadata");
    expect(taskSchema.additionalProperties).toBe(true);
    expect(taskSchema.properties.state).toEqual({
      type: "string"
    });
  });

  it("requires the yaml store envelope fields", () => {
    expect(storeSchema.required).toEqual(["$schema", "kind", "version", "lists"]);
    expect(storeSchema.additionalProperties).toBe(false);
    expect(storeSchema.properties.lists.additionalProperties.additionalProperties.$ref).toBe(
      "./task.schema.json"
    );
  });
});
