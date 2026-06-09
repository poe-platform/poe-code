import { describe, expect, it } from "vitest";
import { applyRuntimeOverrides } from "./poe-command-execution.js";

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("ignores inherited raw runtime scopes when applying overrides", async () => {
    await withObjectPrototypeProperties(
      { rawScope: { type: "docker", build_args: {}, mounts: [] } },
      () => {
        const resolved = applyRuntimeOverrides(
          {
            runtime: {
              type: "host",
              mounts: []
            },
            runner: {
              detach: false,
              upload_max_file_mb: 100,
              download_conflict: "refuse",
              sync: "both",
              workspace: { exclude: [] }
            }
          },
          {
            mountPoeCode: true
          },
          "/repo"
        );

        expect(resolved.runtime).toEqual({
          type: "host",
          build_args: {},
          mounts: [
            {
              source: "/repo",
              target: "/usr/local/lib/poe-code",
              readonly: true
            }
          ]
        });
      }
    );
  });
});
