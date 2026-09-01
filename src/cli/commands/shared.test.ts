import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { allAgents } from "@poe-code/agent-defs";
import { resolveConfigPath, resolveProjectConfigPath } from "@poe-code/poe-code-config/core";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { ValidationError } from "../errors.js";
import {
  resolveAssumedDefaultAgent,
  resolveDefaultAgent,
  resolveMergedDocument
} from "./shared.js";

const cwd = "/repo";
const homeDir = "/home/test";
const globalConfigPath = resolveConfigPath(homeDir);
const projectConfigPath = resolveProjectConfigPath(cwd);

function createMemFs(files: Record<string, string> = {}): FileSystem {
  const volume = Volume.fromJSON(files, "/");
  volume.mkdirSync(cwd, { recursive: true });
  volume.mkdirSync(homeDir, { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}

function createContainer(options?: {
  globalDocument?: Record<string, unknown>;
  projectDocument?: Record<string, unknown>;
  variables?: Record<string, string | undefined>;
  logs?: string[];
}) {
  const files: Record<string, string> = {};

  if (options?.globalDocument) {
    files[globalConfigPath] = `${JSON.stringify(options.globalDocument, null, 2)}\n`;
  }

  if (options?.projectDocument) {
    files[projectConfigPath] = `${JSON.stringify(options.projectDocument, null, 2)}\n`;
  }

  return createCliContainer({
    fs: createMemFs(files),
    prompts: vi.fn().mockResolvedValue({}),
    env: {
      cwd,
      homeDir,
      variables: { ...(options?.variables ?? {}) }
    },
    logger: (message: string) => {
      options?.logs?.push(message);
    }
  });
}

describe("shared command helpers", () => {
  it("returns null when the core scope is absent", async () => {
    const container = createContainer();

    await expect(resolveDefaultAgent(container)).resolves.toBeNull();
  });

  it("returns null when defaultAgent is empty string", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: ""
        }
      }
    });

    await expect(resolveDefaultAgent(container)).resolves.toBeNull();
  });

  it("returns null when defaultAgent is whitespace only", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "   \t  "
        }
      }
    });

    await expect(resolveDefaultAgent(container)).resolves.toBeNull();
  });

  it("returns the bare id for a valid agent", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "claude-code"
        }
      }
    });

    await expect(resolveDefaultAgent(container)).resolves.toBe("claude-code");
  });

  it("returns the full specifier for valid agent:model input", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "claude-code:anthropic/claude-sonnet-4.6"
        }
      }
    });

    await expect(resolveDefaultAgent(container)).resolves.toBe(
      "claude-code:anthropic/claude-sonnet-4.6"
    );
  });

  it("throws ValidationError naming core.defaultAgent for an unknown agent id", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "unknown-agent"
        }
      }
    });
    const supported = allAgents.map((agent) => agent.id).join(", ");

    await expect(resolveDefaultAgent(container)).rejects.toEqual(
      new ValidationError(
        `Invalid value for core.defaultAgent: "unknown-agent". Supported agents: ${supported}`
      )
    );
  });

  it("throws ValidationError for agent:model with an unknown agent portion", async () => {
    const value = "unknown-agent:anthropic/claude-sonnet-4.6";
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: value
        }
      }
    });
    const supported = allAgents.map((agent) => agent.id).join(", ");

    await expect(resolveDefaultAgent(container)).rejects.toEqual(
      new ValidationError(
        `Invalid value for core.defaultAgent: "${value}". Supported agents: ${supported}`
      )
    );
  });

  it("project-scope value overrides global-scope value", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "codex"
        }
      },
      projectDocument: {
        core: {
          defaultAgent: "claude-code"
        }
      }
    });

    await expect(resolveDefaultAgent(container)).resolves.toBe("claude-code");
  });

  it("POE_DEFAULT_AGENT env overrides both file scopes", async () => {
    const container = createContainer({
      globalDocument: {
        core: {
          defaultAgent: "codex"
        }
      },
      projectDocument: {
        core: {
          defaultAgent: "claude-code"
        }
      },
      variables: {
        POE_DEFAULT_AGENT: "goose"
      }
    });

    await expect(resolveMergedDocument(container)).resolves.toMatchObject({
      core: {
        defaultAgent: "goose"
      }
    });
    await expect(resolveDefaultAgent(container)).resolves.toBe("goose");
  });
});

describe("resolveAssumedDefaultAgent", () => {
  it("announces the built-in default agent when no config default exists", async () => {
    const logs: string[] = [];
    const container = createContainer({ logs });

    await expect(
      resolveAssumedDefaultAgent({
        container,
        logger: container.loggerFactory.create({})
      })
    ).resolves.toBe("claude-code");

    expect(logs.join("\n")).toContain("Using default agent: claude-code (built-in default");
  });

  it("announces the configured default agent and drops the model portion", async () => {
    const logs: string[] = [];
    const container = createContainer({
      globalDocument: { core: { defaultAgent: "codex:openai/gpt-5.4" } },
      logs
    });

    await expect(
      resolveAssumedDefaultAgent({
        container,
        logger: container.loggerFactory.create({})
      })
    ).resolves.toBe("codex");

    expect(logs.join("\n")).toContain("Using default agent: codex (from core.defaultAgent)");
  });
});
