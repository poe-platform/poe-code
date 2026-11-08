import { describe, expect, it } from "vitest";
import * as core from "./core.js";

import { captureHostContext } from "./host-context.js";
import { parseFsConfig, resolveFsConfig } from "./modules/fs-config.js";
import { Budget } from "./interp/budget.js";
import { lint } from "./lint.js";
import { run } from "./run.js";

describe("@poe-code/safe-js/core", () => {
  it("exports the lightweight interpreter surface without agent spawning", () => {
    expect(core.captureHostContext).toBe(captureHostContext);
    expect(core.parseFsConfig).toBe(parseFsConfig);
    expect(core.resolveFsConfig).toBe(resolveFsConfig);
    expect(core.Budget).toBe(Budget);
    expect(core.lint).toBe(lint);
    expect(core.run).toBe(run);
    expect(core.createReplayableRandom({ seed: 123 }).next()).toBe(0.2837369213812053);
    expect(Object.keys(core).sort()).toEqual(
      [
        "Budget", "EnvAccessError", "FS_OPTION_SURFACE", "HarnessFailure",
        "SandboxError", "SnapshotValidationError",
        "admitNativePromiseProperties", "captureHostContext", "createRealm", "createReplayableRandom",
        "createRootedSourceResolver", "declareHostOperation", "deepCopyFromSandbox",
        "deepCopyToSandbox", "defineExtension", "dump", "lint", "makeEnvModule",
        "makeFailModule", "makeFsModule", "makeHarnessModule", "makeMetricModule",
        "makeTimeModule", "makeLogModule", "parse", "parseEnvConfig", "parseFsConfig", "parseModule",
        "parseSourceModule", "resolveFsConfig", "restore", "run"
      ].sort()
    );
  });
});
