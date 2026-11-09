import assert from "node:assert/strict";
import { it } from "node:test";
import { allMediaAsts, createMediaAstRegistry } from "./containers/adapters.js";
import { subviewer1Ast } from "./index.js";

it("reads SubViewer v1 markers, skips headers and omits the empty closing cue", () => {
  const registry = createMediaAstRegistry(allMediaAsts());
  for (const newline of ["\n", "\r\n"]) {
    const bytes = new TextEncoder().encode([
      "******** START SCRIPT ********", "[00:00:01]", "First", "line",
      "[00:00:03]", "Second", "[00:00:05]", ""
    ].join(newline));
    for (const filename of [undefined, "timed.sub", "timed.txt"]) {
      const plugin = registry.detect(bytes, filename);
      assert.equal(plugin?.id, "subviewer1");
      const doc = plugin!.parse(bytes);
      assert.equal(doc.durationSeconds, 5);
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration,
        new TextDecoder().decode(sample.data)]), [[1000, 2000, "First\nline"], [3000, 2000, "Second"]]);
      assert.equal(plugin!.probe(bytes).format.format_name, "subviewer1");
    }
  }
});

it("keeps SubViewer v1 distinct from other .sub formats", () => {
  const registry = createMediaAstRegistry(allMediaAsts());
  for (const text of ["{25}{70}First|second\n", "00:00:01.00,00:00:03.00\nFirst\n", "[00:xx:01]\nInvalid\n"]) {
    assert.notEqual(registry.detect(new TextEncoder().encode(text), "timed.sub")?.id, "subviewer1");
  }
  assert.equal(subviewer1Ast().parse(new TextEncoder().encode("******** START SCRIPT ********\n")).tracks[0]!.samples.length, 0);
});
