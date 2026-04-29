import { describe, expect, it } from "vitest";

import * as api from "./index.js";
import { dump } from "./dump.js";
import { lint } from "./lint.js";
import { parse } from "./parse.js";
import { restore } from "./restore.js";
import { run } from "./run.js";

describe("@poe-code/agent-script public exports", () => {
  it("re-exports the placeholder entrypoints", () => {
    expect(api.parse).toBe(parse);
    expect(api.lint).toBe(lint);
    expect(api.run).toBe(run);
    expect(api.dump).toBe(dump);
    expect(api.restore).toBe(restore);
    expect(Object.keys(api).sort()).toEqual(["dump", "lint", "parse", "restore", "run"]);
  });

  it("keeps placeholders explicit until implemented", () => {
    expect(() => api.parse()).toThrowError("Not implemented");
    expect(() => api.lint()).toThrowError("Not implemented");
    expect(() => api.run()).toThrowError("Not implemented");
    expect(() => api.dump()).toThrowError("Not implemented");
    expect(() => api.restore()).toThrowError("Not implemented");
  });
});
