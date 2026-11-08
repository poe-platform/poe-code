import test from "node:test";
import assert from "node:assert/strict";
import { Volume, createFsFromVolume } from "memfs";
import { parseDocument as reference } from "yaml";
import { parseDocument as own } from "../dist/yaml-document.js";
import { openTaskList } from "../dist/index.js";
const content =
  "# store\nlists:\n  work:\n    # first task\n    first:\n      name: First # keep inline\n      state: draft\n    # second task\n    second:\n      name: Second\n      state: draft\n";
test("source-preserving YAML leaf updates and pair moves", () => {
  const doc = own(content);
  assert.deepEqual(doc.errors, []);
  doc.setIn(["lists", "work", "first", "name"], "Updated");
  const text = doc.toString();
  assert.ok(text.includes("# store"));
  assert.ok(text.includes("name: Updated # keep inline"));
  assert.ok(text.includes("# second task"));
  assert.equal(reference(text).toJS().lists.work.first.name, "Updated");
  const list = doc.get("lists").get("work");
  const moved = list.items.splice(0, 1)[0];
  list.items.push(moved);
  const output = doc.toString();
  assert.ok(output.indexOf("# second task") < output.indexOf("# first task"));
  assert.deepEqual(Object.keys(reference(output).toJS().lists.work), ["second", "first"]);
});
test("YAML backend creates and updates entirely in memfs", async () => {
  const volume = Volume.fromJSON(
      {
        "/tasks.yaml":
          "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json\nkind: task-store\nversion: 1\n" +
          content
      },
      "/"
    ),
    fs = createFsFromVolume(volume).promises;
  const store = await openTaskList({ type: "yaml-file", path: "/tasks.yaml", fs }),
    tasks = store.list("work");
  await tasks.update("first", { name: "Updated" });
  await tasks.fire("first", "plan");
  await tasks.reorder(["second", "first"]);
  const output = await fs.readFile("/tasks.yaml", "utf8");
  assert.ok(output.includes("# first task"));
  assert.ok(output.includes("# second task"));
  assert.ok(output.includes("# keep inline"));
  assert.deepEqual(
    (await tasks.all()).map((t) => t.id),
    ["second", "first"]
  );
  assert.equal((await tasks.get("first")).state, "planned");
});
test("updates preserve existing scalar quoting and merge-derived fields", () => {
  const source =
    "%YAML 1.1\n---\ndefaults: &defaults {owner: Alice}\nconfig:\n  <<: *defaults\n  name: 'Old' # quote\n  state: \"draft\"\n";
  const doc = own(source);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(doc.toJS(), reference(source).toJS());
  doc.setIn(["config", "name"], "It's new");
  doc.setIn(["config", "state"], "planned");
  const output = doc.toString();
  assert.ok(output.includes("name: 'It''s new' # quote"));
  assert.ok(output.includes('state: "planned"'));
  assert.deepEqual(reference(output).toJS().config, {
    owner: "Alice",
    name: "It's new",
    state: "planned"
  });
});
test("scalar mapping key types match SDK node behavior", () => {
  const source = 'values: {1: A, "2": B, true: C}';
  const doc = own(source),
    sdk = reference(source);
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(
    doc.get("values").items.map((pair) => pair.key.value),
    sdk.get("values").items.map((pair) => pair.key.value)
  );
});
test("unsupported flow-comment edits reject before memfs writes", async () => {
  const source =
    "$schema: https://poe-platform.github.io/poe-code/schemas/task-list/store.schema.json\nkind: task-store\nversion: 1\nlists:\n  work: {first: {name: First, state: draft}, # keep\n    second: {name: Second, state: draft}}\n";
  const volume = Volume.fromJSON({ "/tasks.yaml": source }, "/"),
    fs = createFsFromVolume(volume).promises;
  const store = await openTaskList({ type: "yaml-file", path: "/tasks.yaml", fs });
  await assert.rejects(
    () => store.list("work").update("first", { name: "Updated" }),
    /flow mappings with comments/
  );
  assert.equal(await fs.readFile("/tasks.yaml", "utf8"), source);
});
test("string paths retain SDK distinction from numeric mapping keys", () => {
  const source = 'values: {1: A, "2": B}';
  const doc = own(source),
    sdk = reference(source);
  assert.equal(doc.get("values").get("1"), sdk.get("values").get("1"));
  doc.setIn(["values", "1"], "C");
  sdk.setIn(["values", "1"], "C");
  assert.deepEqual(doc.toJS(), sdk.toJS());
  assert.deepEqual(reference(doc.toString()).toJS(), sdk.toJS());
});
