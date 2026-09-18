import { expect, it } from "vitest";
import {
  boundaries,
  createLintInputGuard,
  guardedInputs,
  model,
  root
} from "./lint-eslint.fixtures.js";

it("admits the observed repository subject count within a bounded growth allowance", () => {
  const state = model({ "src/one.js": "export {};" });
  const guard = createLintInputGuard({
    root,
    boundaries,
    fileSystem: state.fileSystem,
    limits: { subjects: 16001 }
  });
  expect(guard.read("src/one.js", "subject").toString()).toBe("export {};");
  expect(guard.snapshot()).toMatchObject({ subjects: 1, opens: 1, closes: 1, failed: false });
  expect(guardedInputs.LIMITS.subjects).toBeLessThanOrEqual(20000);
  expect(() =>
    createLintInputGuard({
      root,
      boundaries,
      fileSystem: state.fileSystem,
      limits: { subjects: 20001 }
    })
  ).toThrow("invalid input limit: subjects");
});

it("stops before opening the first subject beyond an explicitly lowered budget", () => {
  const state = model({ "src/one.js": "one", "src/two.js": "two", "src/three.js": "three" });
  const guard = createLintInputGuard({
    root,
    boundaries,
    fileSystem: state.fileSystem,
    limits: { subjects: 2 }
  });
  expect(guard.read("src/one.js", "subject").toString()).toBe("one");
  expect(guard.read("src/two.js", "subject").toString()).toBe("two");
  expect(() => guard.read("src/three.js", "subject")).toThrow("subject cap");
  expect(guard.snapshot()).toMatchObject({
    subjects: 2,
    subjectBytes: 6,
    opens: 2,
    closes: 2,
    failed: true
  });
  expect(() => guard.read("src/three.js", "subject")).toThrow("input guard is busy or failed");
});
