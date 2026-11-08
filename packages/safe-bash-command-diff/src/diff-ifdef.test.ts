import assert from "node:assert/strict";
import test from "node:test";
import { run } from "./helpers.test-support.js";

const cases = [
  { name: "both incomplete", old: "int old_name;", next: "int new_name;" },
  { name: "old incomplete", old: "int old_name;", next: "int new_name;\n" },
  { name: "new incomplete", old: "int old_name;\n", next: "int new_name;" },
  { name: "both terminated", old: "int old_name;\n", next: "int new_name;\n" },
];

for (const buffered of [false, true]) {
  for (const fixture of cases) test(`ifdef separates directives: ${fixture.name}, buffered=${buffered}`, async () => {
    const result = await run("diff", ["-I", "^NEVER$", "-D", "NEW", "old", "new"], {
      buffered, files: { old: fixture.old, new: fixture.next },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "#ifndef NEW\nint old_name;\n#else /* NEW */\nint new_name;\n#endif /* NEW */\n");
  });

  for (const fixture of [
    { name: "insert", old: "", next: "int value;", expected: "#ifdef NEW\nint value;\n#endif /* NEW */\n", status: 1 },
    { name: "delete", old: "int value;", next: "", expected: "#ifndef NEW\nint value;\n#endif /* ! NEW */\n", status: 1 },
    { name: "unchanged", old: "int value;", next: "int value;", expected: "int value;", status: 0 },
    { name: "unchanged tail", old: "old\ntail", next: "new\ntail", expected: "#ifndef NEW\nold\n#else /* NEW */\nnew\n#endif /* NEW */\ntail", status: 1 },
  ]) test(`ifdef preserves line endings: ${fixture.name}, buffered=${buffered}`, async () => {
    const result = await run("diff", ["-I", "^NEVER$", "--ifdef=NEW", "old", "new"], {
      buffered, files: { old: fixture.old, new: fixture.next },
    });
    assert.equal(result.exitCode, fixture.status);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, fixture.expected);
  });
}
