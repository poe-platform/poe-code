// Kept in sync with the sibling *.schema.json files by ids.test.ts. Inlined as
// constants so every artifact surface (tsc dist, esbuild bundles) works without
// runtime file lookups, and without JSON import attributes — a syntax error
// before Node 18.20 despite the >=18.18 engines floor (#517).
export const STORE_SCHEMA_ID =
  "https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json";
export const TASK_SCHEMA_ID =
  "https://poe-platform.github.io/poe-code/schemas/task-list/task.schema.json";
