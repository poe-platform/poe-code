import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { resolveProjectConfigPath } from "@poe-code/poe-code-config";
import { buildDockerRuntimeTemplate } from "@poe-code/process-runner";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerRuntimeCommand } from "./runtime/index.js";

vi.mock("@poe-code/process-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/process-runner")>();
  return {
    ...actual,
    buildDockerRuntimeTemplate: vi.fn(async () => ({
      backend: "docker",
      hash: "mock-hash",
      image: "poe-code/local:mock-hash",
      cached: false
    }))
  };
});

const cwd = "/repo";
const homeDir = "/home/test";
const projectConfigPath = resolveProjectConfigPath(cwd);
const dockerfilePath = path.join(cwd, ".poe-code", "Dockerfile");
const statePath = path.join(homeDir, ".poe-code", "state", "templates.json");
const buildDockerRuntimeTemplateMock = vi.mocked(buildDockerRuntimeTemplate);

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createContainer(
  fs: FileSystem,
  logs: string[] = [],
  prompts = vi.fn().mockResolvedValue({})
) {
  return createCliContainer({
    fs,
    prompts,
    env: {
      cwd,
      homeDir,
      variables: {}
    },
    logger: (message) => logs.push(message)
  });
}

function stripAnsi(input: string): string {
  let result = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    if (char === "\u001b" && input[index + 1] === "[") {
      index += 2;
      while (index < input.length && input[index] !== "m") {
        index += 1;
      }
      index += 1;
      continue;
    }
    result += char;
    index += 1;
  }

  return result;
}

describe("runtime command", () => {
  beforeEach(() => {
    buildDockerRuntimeTemplateMock.mockClear();
  });

  it("initializes runtime config and default Dockerfile with --yes defaults", async () => {
    const fs = createMemFs();
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "runtime", "init"]);

    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toContain('"type": "docker"');
    await expect(fs.readFile(dockerfilePath, "utf8")).resolves.toContain(
      "npm i -g @poe-code/cli @anthropic-ai/claude-code"
    );
  });

  it("deep-merges only runtime.type on an initialized project", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        {
          runtime: {
            type: "docker",
            build_args: { NODE_ENV: "test" },
            runner: { workspace: { exclude: ["coverage"] } }
          }
        },
        null,
        2
      )}\n`,
      [dockerfilePath]: "FROM custom\n"
    });
    const container = createContainer(fs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "init", "--type", "e2b", "--yes"]);

    await expect(fs.readFile(dockerfilePath, "utf8")).resolves.toBe("FROM custom\n");
    await expect(fs.readFile(projectConfigPath, "utf8")).resolves.toMatchInlineSnapshot(`
      "{
        "runtime": {
          "type": "e2b",
          "build_args": {
            "NODE_ENV": "test"
          },
          "runner": {
            "workspace": {
              "exclude": [
                "coverage"
              ]
            }
          }
        }
      }
      "
    `);
  });

  it("snapshots runtime templates ls output grouped by backend", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            abc123: {
              hash: "abc123",
              image: "poe-code/local:abc123",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            }
          },
          e2b: {
            def456: {
              hash: "def456",
              template_id: "tmpl_def456",
              runtime_type: "e2b",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T11:00:00.000Z"
            }
          }
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "templates", "ls"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
  });

  it("snapshots runtime templates clear output and removes local template entries", async () => {
    const fs = createMemFs({
      [statePath]: `${JSON.stringify(
        {
          docker: {
            abc123: {
              hash: "abc123",
              image: "poe-code/local:abc123",
              runtime_type: "docker",
              dockerfile_path: "/repo/.poe-code/Dockerfile",
              built_at: "2026-05-03T10:00:00.000Z"
            }
          },
          e2b: {}
        },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "--yes", "runtime", "templates", "clear"]);

    expect(stripAnsi(logs.join("\n"))).toMatchSnapshot();
    await expect(fs.readFile(statePath, "utf8")).resolves.toMatchInlineSnapshot(`
      "{
        "docker": {},
        "e2b": {}
      }
      "
    `);
  });

  it("builds docker runtime templates through the exposed helper", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify({ runtime: { type: "docker" } }, null, 2)}\n`,
      [dockerfilePath]: "FROM custom\n"
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "build", "--force"]);

    expect(buildDockerRuntimeTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd,
        runtime: expect.objectContaining({ type: "docker" }),
        force: true,
        state: expect.any(Object)
      })
    );
    expect(stripAnsi(logs.join("\n"))).toContain("Built Docker image poe-code/local:mock-hash");
  });

  it("does not build when a docker image is pinned in config", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        { runtime: { type: "docker", image: "ghcr.io/example/poe-runtime:1" } },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "build"]);

    expect(buildDockerRuntimeTemplateMock).not.toHaveBeenCalled();
    expect(stripAnsi(logs.join("\n"))).toContain(
      "Docker runtime uses pinned image ghcr.io/example/poe-runtime:1."
    );
  });

  it("does not load the e2b builder when a template id is pinned in config", async () => {
    const fs = createMemFs({
      [projectConfigPath]: `${JSON.stringify(
        { runtime: { type: "e2b", template_id: "tmpl_pinned" } },
        null,
        2
      )}\n`
    });
    const logs: string[] = [];
    const container = createContainer(fs, logs);
    const program = createBaseProgram();
    registerRuntimeCommand(program, container);

    await program.parseAsync(["node", "cli", "runtime", "build"]);

    expect(stripAnsi(logs.join("\n"))).toContain("E2B runtime uses pinned template tmpl_pinned.");
  });
});
