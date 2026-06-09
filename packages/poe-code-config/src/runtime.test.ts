import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { deepMergeDocuments } from "./merge.js";
import { parseRunner, parseRuntime, resolveRuntime, runtimeConfigScope } from "./runtime.js";
import { resolveScope } from "./resolve.js";

function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => T
): T {
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
    return callback();
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
      sync: "both",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });
  });

  it("does not expose mutable runtime backend defaults", () => {
    expect(() => {
      (runtimeConfigScope.schema.type as { default: string }).default = "docker";
    }).toThrow();
    expect(resolveScope(runtimeConfigScope.schema, undefined, {}).type).toBe("host");
  });

  it("returns independent nested runner defaults", () => {
    const first = resolveScope(runtimeConfigScope.schema, undefined, {}).runner;
    first.workspace?.exclude?.push("secret.txt");

    expect(resolveScope(runtimeConfigScope.schema, undefined, {}).runner.workspace?.exclude).not.toContain("secret.txt");
  });

  it("parses runner scope fields", () => {
    expect(
      parseRunner({
        detach: true,
        upload_max_file_mb: 250,
        download_conflict: "overwrite",
        sync: "upload",
        workspace: {
          exclude: ["coverage", "tmp"]
        }
      })
    ).toEqual({
      detach: true,
      upload_max_file_mb: 250,
      download_conflict: "overwrite",
      sync: "upload",
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
      sync: "both",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });

    expect(parseRunner({ workspace: {} })).toEqual({
      detach: false,
      upload_max_file_mb: 100,
      download_conflict: "refuse",
      sync: "both",
      workspace: {
        exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
      }
    });
  });

  it("ignores inherited runner fields", () => {
    withObjectPrototypeProperties(
      {
        detach: true,
        upload_max_file_mb: 1,
        download_conflict: "overwrite",
        sync: "none",
        workspace: {
          exclude: ["polluted-workspace"]
        },
        exclude: ["polluted-exclude"]
      },
      () => {
        expect(parseRunner({})).toEqual({
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse",
          sync: "both",
          workspace: {
            exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
          }
        });

        expect(parseRunner({ workspace: {} })).toEqual({
          detach: false,
          upload_max_file_mb: 100,
          download_conflict: "refuse",
          sync: "both",
          workspace: {
            exclude: [".git", "node_modules", "dist", ".turbo", ".next", ".poe-code/state.json"]
          }
        });
      }
    );
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
            sync: "none",
            workspace: { exclude: [] }
          })
        },
        {}
      ).runner
    ).toEqual({
      detach: true,
      upload_max_file_mb: 1,
      download_conflict: "overwrite",
      sync: "none",
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
    expect(() => parseRunner({ sync: "download" })).toThrow(
      'runner.sync: expected "both", "upload", or "none".'
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

  it("ignores inherited runtime fields", () => {
    withObjectPrototypeProperties(
      {
        type: "docker",
        image: "polluted:latest",
        build_args: { POLLUTED: "1" },
        mounts: [{ source: ".", target: "/workspace" }],
        link: "https://polluted.example/runtime",
        dockerfile: "../Dockerfile",
        build_context: "..",
        engine: "podman",
        network: "host",
        extra_args: ["--polluted"],
        template_id: "tmpl_polluted",
        from_template: "polluted-template",
        workspace_dir: "/polluted",
        cpu: 1,
        memory_mb: 128,
        timeout_minutes: 1,
        preserve_after_exit_hours: 1
      },
      () => {
        expect(parseRuntime({})).toEqual({
          type: "host",
          build_args: {},
          mounts: []
        });

        expect(parseRuntime({ type: "docker" })).toEqual({
          type: "docker",
          build_args: {},
          mounts: []
        });

        expect(parseRuntime({ type: "e2b" })).toEqual({
          type: "e2b",
          build_args: {},
          mounts: [],
          workspace_dir: "/workspace",
          preserve_after_exit_hours: 24
        });
      }
    );
  });

  it("applies e2b defaults and validates preserve range", () => {
    expect(parseRuntime({ type: "e2b", template_id: "tmpl_123" })).toEqual({
      type: "e2b",
      template_id: "tmpl_123",
      build_args: {},
      mounts: [],
      workspace_dir: "/workspace",
      preserve_after_exit_hours: 24
    });

    expect(
      parseRuntime({
        type: "e2b",
        template_id: "tmpl_123",
        cpu: 4,
        memory_mb: 8192,
        timeout_minutes: 60,
        workspace_dir: "/sandbox/workspace/../project/",
        preserve_after_exit_hours: 168
      })
    ).toMatchObject({
      type: "e2b",
      cpu: 4,
      memory_mb: 8192,
      timeout_minutes: 60,
      workspace_dir: "/sandbox/project",
      preserve_after_exit_hours: 168
    });

    expect(() =>
      parseRuntime({ type: "e2b", template_id: "tmpl_123", preserve_after_exit_hours: 169 })
    ).toThrow("preserve_after_exit_hours: expected a number from 0 to 168");
    expect(() => parseRuntime({ type: "e2b", template_id: "tmpl_123", timeout_minutes: -1 })).toThrow(
      "timeout_minutes: expected a non-negative finite number."
    );
    expect(() => parseRuntime({ type: "e2b", template_id: "tmpl_123", cpu: -1 })).toThrow(
      "cpu: expected a positive finite number."
    );
    expect(() => parseRuntime({ type: "e2b", template_id: "tmpl_123", memory_mb: -128 })).toThrow(
      "memory_mb: expected a positive finite number."
    );
    expect(() =>
      parseRuntime({ type: "e2b", template_id: "tmpl_123", workspace_dir: "workspace" })
    ).toThrow("workspace_dir: expected an absolute sandbox path");
  });

  it("rejects empty docker mount sources", () => {
    expect(() => parseRuntime({ type: "docker", mounts: [{ source: "", target: "/workspace" }] })).toThrow(
      "mounts[0].source: expected a non-empty string."
    );
  });

  it("ignores inherited mount fields", () => {
    withObjectPrototypeProperties(
      {
        source: ".",
        target: "/workspace",
        readonly: true
      },
      () => {
        expect(() => parseRuntime({ type: "docker", mounts: [{}] })).toThrow(
          "mounts[0].source: expected a string."
        );
      }
    );
  });

  it("preserves __proto__ build argument keys", () => {
    const runtime = parseRuntime(JSON.parse('{"type":"docker","build_args":{"__proto__":"value"}}'));

    expect(Object.hasOwn(runtime.build_args, "__proto__")).toBe(true);
    expect(runtime.build_args.__proto__).toBe("value");
  });

  it("resolves dockerfile and build context defaults when a docker runtime builds from a Dockerfile", () => {
    withTempProject(({ cwd }) => {
      const dockerfilePath = path.join(cwd, ".poe-code", "Dockerfile");
      mkdirSync(path.dirname(dockerfilePath), { recursive: true });
      writeFileSync(dockerfilePath, "FROM scratch\n");

      expect(resolveRuntime({ cwd, config: { runtime: parseRuntime({ type: "docker" }) } })).toEqual({
        runtime: {
          type: "docker",
          build_args: {},
          mounts: []
        },
        runner: "docker",
        dockerfilePath,
        buildContext: cwd
      });
    });
  });

  it("ignores inherited prebuilt runtime artifact fields while resolving", () => {
    withTempProject(({ cwd }) => {
      const dockerfilePath = path.join(cwd, ".poe-code", "Dockerfile");
      mkdirSync(path.dirname(dockerfilePath), { recursive: true });
      writeFileSync(dockerfilePath, "FROM scratch\n");

      withObjectPrototypeProperties(
        {
          image: "polluted:latest",
          template_id: "tmpl_polluted"
        },
        () => {
          expect(resolveRuntime({ cwd, config: { runtime: parseRuntime({ type: "docker" }) } })).toEqual({
            runtime: {
              type: "docker",
              build_args: {},
              mounts: []
            },
            runner: "docker",
            dockerfilePath,
            buildContext: cwd
          });
        }
      );
    });
  });

  it("resolves custom dockerfile and build context paths inside the runtime cwd", () => {
    withTempProject(({ cwd }) => {
      const dockerfilePath = path.join(cwd, "containers", "Dockerfile");
      const e2bDockerfilePath = path.join(cwd, "runtimes", "e2b", "Dockerfile");
      mkdirSync(path.dirname(dockerfilePath), { recursive: true });
      mkdirSync(path.dirname(e2bDockerfilePath), { recursive: true });
      writeFileSync(dockerfilePath, "FROM scratch\n");
      writeFileSync(e2bDockerfilePath, "FROM scratch\n");

      expect(
        resolveRuntime({
          cwd,
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
        dockerfilePath,
        buildContext: path.join(cwd, "containers")
      });

      expect(
        resolveRuntime({
          cwd,
          config: {
            runtime: parseRuntime({
              type: "e2b",
              dockerfile: "runtimes/e2b/Dockerfile",
              build_context: "runtimes/e2b"
            })
          }
        })
      ).toMatchObject({
        runner: "e2b",
        dockerfilePath: e2bDockerfilePath,
        buildContext: path.join(cwd, "runtimes", "e2b")
      });
    });
  });

  it("rejects docker build paths that escape the runtime cwd", () => {
    withTempProject(({ root, cwd }) => {
      const dockerfilePath = path.join(cwd, "Dockerfile");
      const outsideDockerfilePath = path.join(root, "outside", "Dockerfile");
      mkdirSync(path.dirname(outsideDockerfilePath), { recursive: true });
      writeFileSync(dockerfilePath, "FROM scratch\n");
      writeFileSync(outsideDockerfilePath, "FROM scratch\n");

      expect(() =>
        resolveRuntime({
          cwd,
          config: {
            runtime: parseRuntime({
              type: "docker",
              dockerfile: "Dockerfile",
              build_context: ".."
            })
          }
        })
      ).toThrow(`runtime.build_context must remain inside runtime cwd ${cwd}.`);

      expect(() =>
        resolveRuntime({
          cwd,
          config: {
            runtime: parseRuntime({
              type: "docker",
              dockerfile: outsideDockerfilePath,
              build_context: "."
            })
          }
        })
      ).toThrow(`runtime.dockerfile must remain inside runtime cwd ${cwd}.`);
    });
  });

  it("uses prebuilt docker and e2b artifacts without requiring a Dockerfile", () => {
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
    withTempProject(({ cwd }) => {
      expect(() =>
        resolveRuntime({ cwd, config: { runtime: parseRuntime({ type: "docker" }) } })
      ).toThrow(
        `Docker runtime requires image or a Dockerfile at ${path.join(cwd, ".poe-code", "Dockerfile")}.`
      );

      expect(() =>
        resolveRuntime({ cwd, config: { runtime: parseRuntime({ type: "e2b" }) } })
      ).toThrow(
        `E2B runtime requires template_id or a Dockerfile at ${path.join(cwd, ".poe-code", "Dockerfile")}.`
      );
    });
  });

  it("exposes a runtime scope with direct runtime fields", () => {
    expect(
      parseRuntime(
        resolveScope(
          runtimeConfigScope.schema,
          {
            type: "e2b",
            template_id: "tmpl_123",
            workspace_dir: "/sandbox/workspace",
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
      workspace_dir: "/sandbox/workspace",
      preserve_after_exit_hours: 0
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

function withTempProject(fn: (project: { root: string; cwd: string }) => void): void {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "poe-runtime-config-"));
  const cwd = path.join(root, "project");
  mkdirSync(cwd, { recursive: true });

  try {
    fn({ root, cwd });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
