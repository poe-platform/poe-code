import { describe, expect, it } from "vitest";
import { applyRuntimeOverrides } from "./poe-command-execution.js";

describe("runtime command execution overrides", () => {
  it("applies CLI/SDK runtime overrides after config resolution", () => {
    const resolved = applyRuntimeOverrides(
      {
        runtime: {
          type: "host",
          build_args: {},
          mounts: []
        },
        runner: {
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse",
          sync: "both",
          workspace: { exclude: [".git"] }
        }
      },
      {
        runtime: "docker",
        runtimeImage: "poe-code:test",
        detach: true,
        mountPoeCode: true,
        runnerSync: "none"
      },
      "/repo"
    );

    expect(resolved).toEqual({
      runtime: {
        type: "docker",
        build_args: {},
        mounts: [
          {
            source: "/repo",
            target: "/usr/local/lib/poe-code",
            readonly: true
          }
        ],
        image: "poe-code:test"
      },
      runner: {
        detach: true,
        upload_max_file_mb: 100,
        download_conflict: "refuse",
        sync: "none",
        workspace: { exclude: [".git"] }
      }
    });
  });
});
