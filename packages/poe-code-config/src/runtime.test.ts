import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deepMergeDocuments } from "./merge.js";
import { parseRunner, parseRuntime, resolveRuntime, runtimeConfigScope } from "./runtime.js";
import { resolveScope } from "./resolve.js";

const existsSyncMock = vi.hoisted(() => vi.fn<(filePath: string) => boolean>());

vi.mock("node:fs", () => ({
  existsSync: existsSyncMock
}));

describe("runtime config", () => {
  it("defaults to the host runtime", () => {
    expect(parseRuntime(undefined)).toEqual({
      type: "host",
      build_args: {},
      mounts: []
    });
  });

  it("rejects invalid runtime values", () => {
    expect(() => parseRuntime(null)).toThrow("runtime: expected an object.");
    expect(() => parseRuntime("docker")).toThrow("runtime: expected an object.");
    expect(() => parseRuntime({ type: "container" })).toThrow(
      'type: expected "host", "docker", or "e2b".'
    );
  });

  it("defaults runner scope values when runtime scope is absent", () => {
    expect(resolveScope(runtimeConfigScope.schema, undefined, {}).runner).toEqual({
      detach: false,
      upload_max_file_mb: 100,
      download_conflict: "refuse",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });
  });

  it("parses runner scope fields", () => {
    expect(
      parseRunner({
        detach: true,
        upload_max_file_mb: 250,
        download_conflict: "overwrite",
        workspace: {
          exclude: ["coverage", "tmp"]
        }
      })
    ).toEqual({
      detach: true,
      upload_max_file_mb: 250,
      download_conflict: "overwrite",
      workspace: {
        exclude: ["coverage", "tmp"]
      }
    });
  });

  it("applies runner defaults for omitted nested fields", () => {
    expect(parseRunner({})).toEqual({
      detach: false,
      upload_max_file_mb: 100,
      download_conflict: "refuse",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });

    expect(parseRunner({ workspace: {} })).toEqual({
      detach: false,
      upload_max_file_mb: 100,
      download_conflict: "refuse",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });
  });

  it("parses runner scope through the runtime schema", () => {
    expect(
      resolveScope(
        runtimeConfigScope.schema,
        {
          runner: JSON.stringify({
            detach: true,
            upload_max_file_mb: 1,
            download_conflict: "overwrite",
            workspace: { exclude: [] }
          })
        },
        {}
      ).runner
    ).toEqual({
      detach: true,
      upload_max_file_mb: 1,
      download_conflict: "overwrite",
      workspace: {
        exclude: []
      }
    });
  });

  it("rejects invalid runner scope values", () => {
    expect(() => parseRunner(null)).toThrow("runner: expected an object.");
    expect(() => parseRunner({ detach: "yes" })).toThrow("runner.detach: expected a boolean.");
    expect(() => parseRunner({ upload_max_file_mb: Number.POSITIVE_INFINITY })).toThrow(
      "runner.upload_max_file_mb: expected a finite number."
    );
    expect(() => parseRunner({ upload_max_file_mb: 0 })).toThrow(
      "runner.upload_max_file_mb: expected a positive finite number."
    );
    expect(() => parseRunner({ download_conflict: "merge" })).toThrow(
      'runner.download_conflict: expected "refuse" or "overwrite".'
    );
    expect(() => parseRunner({ workspace: [] })).toThrow("runner.workspace: expected an object.");
    expect(() => parseRunner({ workspace: { exclude: [".git", 42] } })).toThrow(
      "runner.workspace.exclude[1]: expected a string."
    );
  });

  it("parses docker runtime fields", () => {
    expect(
      parseRuntime({
        type: "docker",
        image: "node:22",
        build_args: { NODE_VERSION: "22" },
        mounts: [{ source: ".", target: "/workspace", readonly: true }],
        link: "https://example.test/dockerfile",
        engine: "podman",
        network: "host",
        extra_args: ["--gpus", "all"]
      })
    ).toEqual({
      type: "docker",
      image: "node:22",
      build_args: { NODE_VERSION: "22" },
      mounts: [{ source: ".", target: "/workspace", readonly: true }],
      link: "https://example.test/dockerfile",
      engine: "podman",
      network: "host",
      extra_args: ["--gpus", "all"]
    });
  });

  it("applies e2b defaults and validates preserve range", () => {
    expect(parseRuntime({ type: "e2b", template_id: "tmpl_123" })).toEqual({
      type: "e2b",
      template_id: "tmpl_123",
      build_args: {},
      mounts: [],
      preserve_after_exit_hours: 24,
      api_key_env: "E2B_API_KEY"
    });

    expect(
      parseRuntime({
        type: "e2b",
        template_id: "tmpl_123",
        cpu: 4,
        memory_mb: 8192,
        timeout_minutes: 60,
        preserve_after_exit_hours: 168,
        api_key_env: "CUSTOM_E2B_API_KEY"
      })
    ).toMatchObject({
      type: "e2b",
      cpu: 4,
      memory_mb: 8192,
      timeout_minutes: 60,
      preserve_after_exit_hours: 168,
      api_key_env: "CUSTOM_E2B_API_KEY"
    });

    expect(() =>
      parseRuntime({ type: "e2b", template_id: "tmpl_123", preserve_after_exit_hours: 169 })
    ).toThrow("preserve_after_exit_hours: expected a number from 0 to 168");
  });

  it("resolves dockerfile and build context defaults when a docker runtime builds from a Dockerfile", () => {
    existsSyncMock.mockReturnValueOnce(true);
    const cwd = "/repo";

    expect(resolveRuntime({ cwd, config: { runtime: parseRuntime({ type: "docker" }) } })).toEqual({
      runtime: {
        type: "docker",
        build_args: {},
        mounts: []
      },
      runner: "docker",
      dockerfilePath: path.join(cwd, ".poe-code", "Dockerfile"),
      buildContext: cwd
    });
    expect(existsSyncMock).toHaveBeenCalledWith(path.join(cwd, ".poe-code", "Dockerfile"));
  });

  it("resolves custom dockerfile and build context paths", () => {
    existsSyncMock.mockReturnValueOnce(true).mockReturnValueOnce(true);

    expect(
      resolveRuntime({
        cwd: "/repo",
        config: {
          runtime: parseRuntime({
            type: "docker",
            dockerfile: "containers/Dockerfile",
            build_context: "containers"
          })
        }
      })
    ).toMatchObject({
      runner: "docker",
      dockerfilePath: "/repo/containers/Dockerfile",
      buildContext: "/repo/containers"
    });

    expect(
      resolveRuntime({
        cwd: "/repo",
        config: {
          runtime: parseRuntime({
            type: "e2b",
            dockerfile: "/tmp/runtime.Dockerfile",
            build_context: "/tmp/context"
          })
        }
      })
    ).toMatchObject({
      runner: "e2b",
      dockerfilePath: "/tmp/runtime.Dockerfile",
      buildContext: "/tmp/context"
    });
  });

  it("uses prebuilt docker and e2b artifacts without requiring a Dockerfile", () => {
    existsSyncMock.mockReturnValue(false);

    expect(
      resolveRuntime({
        cwd: "/repo",
        config: { runtime: parseRuntime({ type: "docker", image: "node:22" }) }
      })
    ).toMatchObject({
      runner: "docker",
      dockerfilePath: null,
      buildContext: null
    });

    expect(
      resolveRuntime({
        cwd: "/repo",
        config: { runtime: parseRuntime({ type: "e2b", template_id: "tmpl_123" }) }
      })
    ).toMatchObject({
      runner: "e2b",
      dockerfilePath: null,
      buildContext: null
    });
  });

  it("hard-errors when docker or e2b has neither a prebuilt artifact nor Dockerfile", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() =>
      resolveRuntime({ cwd: "/repo", config: { runtime: parseRuntime({ type: "docker" }) } })
    ).toThrow("Docker runtime requires image or a Dockerfile at /repo/.poe-code/Dockerfile.");

    expect(() =>
      resolveRuntime({ cwd: "/repo", config: { runtime: parseRuntime({ type: "e2b" }) } })
    ).toThrow("E2B runtime requires template_id or a Dockerfile at /repo/.poe-code/Dockerfile.");
  });

  it("exposes a runtime scope with direct runtime fields", () => {
    expect(
      parseRuntime(
        resolveScope(
          runtimeConfigScope.schema,
          {
            type: "e2b",
            template_id: "tmpl_123",
            preserve_after_exit_hours: 0
          },
          {}
        )
      )
    ).toEqual({
      type: "e2b",
      template_id: "tmpl_123",
      build_args: {},
      mounts: [],
      preserve_after_exit_hours: 0,
      api_key_env: "E2B_API_KEY"
    });
  });

  it("deep-merges runtime config with mount and workspace exclude concatenation", () => {
    expect(
      deepMergeDocuments(
        {
          runtime: {
            type: "docker",
            build_args: { NODE_VERSION: "22" },
            mounts: [{ source: "~/.ssh", target: "/root/.ssh", readonly: true }],
            engine: "docker",
            runner: {
              workspace: {
                exclude: ["global-cache"]
              }
            }
          }
        },
        {
          runtime: {
            build_args: { PACKAGE_MANAGER: "npm" },
            mounts: [{ source: ".", target: "/workspace" }],
            network: "host",
            runner: {
              workspace: {
                exclude: ["project-cache"]
              }
            }
          }
        }
      )
    ).toEqual({
      runtime: {
        type: "docker",
        build_args: { NODE_VERSION: "22", PACKAGE_MANAGER: "npm" },
        mounts: [
          { source: "~/.ssh", target: "/root/.ssh", readonly: true },
          { source: ".", target: "/workspace" }
        ],
        engine: "docker",
        network: "host",
        runner: {
          workspace: {
            exclude: ["global-cache", "project-cache"]
          }
        }
      }
    });
  });

  it("keeps one-sided runtime concat arrays when merging", () => {
    expect(
      deepMergeDocuments(
        {
          runtime: {
            mounts: [{ source: "~/.cache", target: "/cache" }],
            runner: {
              workspace: {
                exclude: ["global-cache"]
              }
            }
          }
        },
        {
          runtime: {
            runner: {
              detach: true
            }
          }
        }
      )
    ).toEqual({
      runtime: {
        mounts: [{ source: "~/.cache", target: "/cache" }],
        runner: {
          detach: true,
          workspace: {
            exclude: ["global-cache"]
          }
        }
      }
    });

    expect(
      deepMergeDocuments(
        { runtime: { runner: { detach: false } } },
        {
          runtime: {
            mounts: [{ source: ".", target: "/workspace" }],
            runner: {
              workspace: {
                exclude: ["project-cache"]
              }
            }
          }
        }
      )
    ).toEqual({
      runtime: {
        mounts: [{ source: ".", target: "/workspace" }],
        runner: {
          detach: false,
          workspace: {
            exclude: ["project-cache"]
          }
        }
      }
    });
  });
});
