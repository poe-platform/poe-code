import { expect, it } from "vitest";
import { model, createLintInputGuard, root, boundaries } from "./lint-eslint.fixtures.js";

it("supports a repository subject budget above twelve thousand without bypassing other input guards", () => {
  const state = model({ "subjects/a.ts": "export {};" });
  const guard = createLintInputGuard({
    root,
    boundaries,
    fileSystem: state.fileSystem,
    limits: { subjects: 12001 }
  });
  expect(guard.read("subjects/a.ts", "subject").toString()).toBe("export {};");
  expect(guard.snapshot()).toMatchObject({ subjects: 1, opens: 1, closes: 1, failed: false });
});

it("keeps reduced subject limits finite and refuses another file before opening it", () => {
  const state = model({
    "subjects/a.ts": "export {};",
    "subjects/b.ts": "export {};",
    "subjects/c.ts": "export {};"
  });
  const guard = createLintInputGuard({
    root,
    boundaries,
    fileSystem: state.fileSystem,
    limits: { subjects: 2 }
  });
  guard.read("subjects/a.ts", "subject");
  guard.read("subjects/b.ts", "subject");
  expect(() => guard.read("subjects/c.ts", "subject")).toThrow("subject cap");
  expect(guard.snapshot()).toMatchObject({ subjects: 2, opens: 2, closes: 2, failed: true });
});

it("checks cached inspection metadata against its cap", () => {
 const state = model({ "subjects/a.ts": "export {};" });
 const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, _isCachedRealFs: true }, limits: { metadataOperations: 100 } });
 guard.inspect("subjects/a.ts");
 expect(() => { for (let i = 0; i < 101; i++) guard.inspect("subjects/a.ts"); }).toThrow("metadata operation cap");
});
it("retains cached ancestor segments after beginning lint", () => {
 const state = model({ "subjects/a.ts": "export {};" });
 const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, _isCachedRealFs: true } });
 guard.begin();
 const segments = [];
 guard.fileSystem.inspectAdmittedInput(root + "/subjects/a.ts", absolute => segments.push(absolute));
 expect(segments).toContain(root + "/subjects/a.ts");
});
it("rejects growth after cached subject inspection", () => {
 const state = model({ "subjects/a.ts": "x" });
 const guard = createLintInputGuard({ root, boundaries, fileSystem: { ...state.fileSystem, _isCachedRealFs: true } });
 guard.inspect("subjects/a.ts");
 state.fileSystem.writeFileSync(root + "/subjects/a.ts", "grown beyond bound");
 expect(() => guard.read("subjects/a.ts", "subject", 1)).toThrow(/individual input cap|identity/);
});
