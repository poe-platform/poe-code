import assert from "node:assert/strict";
import { it } from "vitest";
import { createFsFromVolume, Volume } from "memfs";
import * as own from "@poe-code/config-mutations-rust";

it("Native configuration mutation subpath exposes the reference namespace and own identities", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/config-mutations"),
    import("toolcraft/config-mutations")
  ]);
  assert.deepEqual(Object.keys(native).sort(), Object.keys(reference).sort());
  for (const name of Object.keys(reference)) assert.equal(native[name], own[name], name);
});

it("Native configuration mutation subpath preserves format edits, dry runs and observer traces", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/config-mutations"),
    import("toolcraft/config-mutations")
  ]);
  for (const format of ["json", "toml", "yaml"] as const) {
    const outcomes = [];
    for (const api of [reference, native]) {
      const volume = new Volume(), events = [];
      const fs = createFsFromVolume(volume).promises;
      await fs.mkdir("/home");
      const baseline = volume.toJSON();
      const target = `~/config.${format}`, file = `/home/config.${format}`;
      const context = { fs, homeDir: "/home", observers: {
        onStart(details) { events.push(["start", details]); },
        onComplete(details, outcome) { events.push(["complete", details, outcome]); }
      }};
      const initial = [api.configMutation.merge({ target, format, value: { keep: { enabled: true }, drop: "old" } })];
      const preview = await api.runMutations(initial, {...context, dryRun: true});
      assert.deepEqual(volume.toJSON(), baseline);
      const created = await api.runMutations(initial, context);
      const stable = await api.runMutations(initial, context);
      assert.equal(stable.changed, false);
      const changed = await api.runMutations([
        api.configMutation.merge({ target, format, value: { keep: { nested: ["one", "two"] } } }),
        api.configMutation.prune({ target, format, shape: { drop: null } }),
        api.configMutation.transform({ target, format, transform(doc) {
          assert.deepEqual(doc, { keep: { enabled: true, nested: ["one", "two"] } });
          return { content: {...doc, added: 3}, changed: true };
        }})
      ], context);
      const files = volume.toJSON();
      const content = await api.readFileIfExists(fs, file);
      assert.equal(typeof content, "string");
      assert.equal(content, files[file]);
      assert.equal(await api.pathExists(fs, file), true);
      assert.equal(await api.readFileIfExists(fs, "/missing"), null);
      const failure = new Error("caller transform failed");
      await assert.rejects(api.runMutations([
        api.configMutation.transform({ target, format, transform() { throw failure; } })
      ], context), error => error === failure);
      assert.deepEqual(volume.toJSON(), files);
      outcomes.push({preview, created, stable, changed, files, events});
    }
    assert.deepEqual(outcomes[1], outcomes[0], format);
  }
});

it("Native configuration mutation subpath preserves template rendering and template file writes", async () => {
  const [native, reference] = await Promise.all([
    import("toolcraft-rust/config-mutations"),
    import("toolcraft/config-mutations")
  ]);
  const outcomes = [];
  for (const api of [reference, native]) {
    const volume = new Volume(), fs = createFsFromVolume(volume).promises;
    const result = await api.runMutations([
      api.fileMutation.ensureDirectory({path: "~/generated"}),
      api.templateMutation.write({target: "~/generated/readme", templateId: "readme", context: {name: "Rust"}})
    ], {fs, homeDir: "/home", templates: async id => `# ${id}: {{name}}\n`});
    assert.equal(volume.toJSON()["/home/generated/readme"], "# readme: Rust\n");
    outcomes.push({result, files: volume.toJSON(), rendered: api.renderTemplate("Hi {{name}}", {name: "Rust"})});
  }
  assert.deepEqual(outcomes[1], outcomes[0]);
});
