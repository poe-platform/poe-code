import { describe, expect, it } from "vitest";
import { acquireFileLock } from "@poe-code/file-lock";
import { lockWorkflow } from "./lock.js";

describe("lockWorkflow", () => {
  it("re-exports acquireFileLock", () => {
    expect(lockWorkflow).toBe(acquireFileLock);
  });
});
