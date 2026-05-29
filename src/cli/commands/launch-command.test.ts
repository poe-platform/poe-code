import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";
import { registerLaunchCommand } from "./launch.js";

const {
  followLaunchLogsMock,
  listLaunchesMock,
  readLaunchLogsMock,
  removeLaunchMock,
  restartLaunchMock,
  runLaunchDaemonMock,
  startLaunchMock,
  stopLaunchMock
} = vi.hoisted(() => ({
  followLaunchLogsMock: vi.fn(),
  listLaunchesMock: vi.fn(),
  readLaunchLogsMock: vi.fn(),
  removeLaunchMock: vi.fn(),
  restartLaunchMock: vi.fn(),
  runLaunchDaemonMock: vi.fn(),
  startLaunchMock: vi.fn(),
  stopLaunchMock: vi.fn()
}));

const {
  cancelMock,
  getThemeMock,
  isCancelMock,
  promptTextMock,
  renderTableMock,
  selectMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getThemeMock: vi.fn(() => "dark"),
  isCancelMock: vi.fn(() => false),
  promptTextMock: vi.fn(),
  renderTableMock: vi.fn(() => "rendered table"),
  selectMock: vi.fn()
}));

vi.mock("../../sdk/launch.js", () => ({
  followLaunchLogs: followLaunchLogsMock,
  listLaunches: listLaunchesMock,
  readLaunchLogs: readLaunchLogsMock,
  removeLaunch: removeLaunchMock,
  restartLaunch: restartLaunchMock,
  runLaunchDaemon: runLaunchDaemonMock,
  startLaunch: startLaunchMock,
  stopLaunch: stopLaunchMock
}));

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return {
    ...actual,
    cancel: cancelMock,
    getTheme: getThemeMock,
    isCancel: isCancelMock,
    promptText: promptTextMock,
    renderTable: renderTableMock,
    select: selectMock
  };
});

describe("launch command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    followLaunchLogsMock.mockReturnValue((async function* () {})());
    listLaunchesMock.mockResolvedValue([]);
    readLaunchLogsMock.mockResolvedValue([]);
    startLaunchMock.mockResolvedValue(undefined);
    stopLaunchMock.mockResolvedValue(undefined);
    restartLaunchMock.mockResolvedValue(undefined);
    removeLaunchMock.mockResolvedValue(undefined);
    runLaunchDaemonMock.mockResolvedValue(undefined);
  });

  it("parses launch start flags and forwards a structured spec to the sdk", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "launch",
      "start",
      "api",
      "--restart",
      "always",
      "--max-restarts",
      "7",
      "--ready-pattern",
      "ready",
      "--cwd",
      "/repo/apps/api",
      "--env",
      "NODE_ENV=development",
      "--image",
      "node:20",
      "--mount",
      "/repo:/workspace:ro",
      "--port",
      "3000:3000",
      "--network",
      "devnet",
      "--engine",
      "docker",
      "--",
      "npm",
      "run",
      "dev"
    ]);

    expect(startLaunchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        homeDir: "/home/test",
        spec: {
          id: "api",
          command: "npm",
          args: ["run", "dev"],
          cwd: "/repo/apps/api",
          env: { NODE_ENV: "development" },
          restart: "always",
          maxRestarts: 7,
          readyCheck: { kind: "log-pattern", pattern: "ready" },
          docker: {
            image: "node:20",
            engine: "docker",
            mounts: [
              {
                source: "/repo",
                target: "/workspace",
                readonly: true
              }
            ],
            network: "devnet",
            ports: [
              {
                host: 3000,
                container: 3000
              }
            ]
          }
        }
      })
    );
  });

  it("preserves prototype-named launch environment entries", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync([
      "node", "cli", "launch", "start", "api", "--env", "__proto__=visible", "--", "node", "server.js"
    ]);

    const spec = startLaunchMock.mock.calls[0]?.[0].spec;
    expect(Object.hasOwn(spec.env, "__proto__")).toBe(true);
    expect(spec.env.__proto__).toBe("visible");
  });

  it("prompts for missing start values and uses --yes defaults for runtime and restart", async () => {
    promptTextMock
      .mockResolvedValueOnce("api")
      .mockResolvedValueOnce("npm run dev");

    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync(["node", "cli", "--yes", "launch", "start"]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(startLaunchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          id: "api",
          command: "npm",
          args: ["run", "dev"],
          restart: "on-failure"
        })
      })
    );
  });

  it("infers the host runtime when a command is provided without a docker image", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "launch",
      "start",
      "test-echo",
      "--ready-pattern",
      "ready",
      "--",
      "sh",
      "-c",
      "echo ready && sleep 30"
    ]);

    expect(selectMock).not.toHaveBeenCalled();
    expect(startLaunchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        spec: expect.objectContaining({
          id: "test-echo",
          command: "sh",
          args: ["-c", "echo ready && sleep 30"],
          readyCheck: { kind: "log-pattern", pattern: "ready" },
          restart: "on-failure"
        })
      })
    );
  });

  it("renders launch status as a table", async () => {
    listLaunchesMock.mockResolvedValue([
      {
        daemonPid: 500,
        spec: {
          id: "api",
          command: "npm",
          restart: "on-failure"
        },
        state: {
          id: "api",
          pid: 123,
          status: "running",
          runtime: "host",
          restartCount: 1,
          lastExitCode: null,
          lastStartedAt: "2026-04-02T00:00:00.000Z",
          lastStoppedAt: null,
          command: "npm",
          args: ["run", "dev"]
        }
      }
    ]);

    let loggerOutput = "";
    const program = createBaseProgram();
    registerLaunchCommand(
      program,
      createContainer((message) => {
        loggerOutput += `${message}\n`;
      })
    );

    await program.parseAsync(["node", "cli", "launch", "status"]);

    expect(renderTableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({ name: "ID" }),
          expect.objectContaining({ name: "RUNTIME" }),
          expect.objectContaining({ name: "STATUS" }),
          expect.objectContaining({ name: "PID" }),
          expect.objectContaining({ name: "RESTARTS" }),
          expect.objectContaining({ name: "UPTIME" }),
          expect.objectContaining({ name: "LAST EXIT" })
        ])
      })
    );
    expect(loggerOutput).toContain("rendered table");
  });

  it("forwards string ids for restart, rm, and internal daemon run", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync(["node", "cli", "launch", "restart", "api"]);
    await program.parseAsync(["node", "cli", "launch", "rm", "api"]);
    await program.parseAsync(["node", "cli", "launch", "__run", "api"]);

    expect(restartLaunchMock).toHaveBeenCalledWith({ homeDir: "/home/test", id: "api" });
    expect(removeLaunchMock).toHaveBeenCalledWith({ homeDir: "/home/test", id: "api" });
    expect(runLaunchDaemonMock).toHaveBeenCalledWith({ homeDir: "/home/test", id: "api" });
  });

  it("shows help for launch start", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    let helpOutput = "";
    program.configureOutput({
      writeOut: (value) => {
        helpOutput += value;
      },
      writeErr: (value) => {
        helpOutput += value;
      }
    });
    for (const command of program.commands) {
      command.configureOutput({
        writeOut: (value) => {
          helpOutput += value;
        },
        writeErr: (value) => {
          helpOutput += value;
        }
      });
      for (const subcommand of command.commands) {
        subcommand.configureOutput({
          writeOut: (value) => {
            helpOutput += value;
          },
          writeErr: (value) => {
            helpOutput += value;
          }
        });
      }
    }

    try {
      await program.parseAsync(["node", "cli", "launch", "start", "--help"]);
    } catch {
      // commander exits after help
    }

    expect(helpOutput).toContain("launch start");
    expect(helpOutput).toContain("Arguments:");
    expect(helpOutput).toContain("id");
    expect(helpOutput).toContain("Managed process identifier");
    expect(helpOutput).toContain("command");
    expect(helpOutput).toContain("Command and arguments to run after --");
    expect(helpOutput).toContain("--restart <policy>");
    expect(helpOutput).toContain("--max-restarts <n>");
    expect(helpOutput).toContain("--ready-pattern <string>");
    expect(helpOutput).toContain("--ready-port <port>");
    expect(helpOutput).toContain("--image <image>");
  });

  it("shows argument descriptions for launch subcommands with process ids", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    for (const argv of [
      ["node", "cli", "launch", "stop", "--help"],
      ["node", "cli", "launch", "restart", "--help"],
      ["node", "cli", "launch", "logs", "--help"],
      ["node", "cli", "launch", "rm", "--help"]
    ]) {
      let helpOutput = "";
      program.configureOutput({
        writeOut: (value) => {
          helpOutput += value;
        },
        writeErr: (value) => {
          helpOutput += value;
        }
      });
      for (const command of program.commands) {
        command.configureOutput({
          writeOut: (value) => {
            helpOutput += value;
          },
          writeErr: (value) => {
            helpOutput += value;
          }
        });
        for (const subcommand of command.commands) {
          subcommand.configureOutput({
            writeOut: (value) => {
              helpOutput += value;
            },
            writeErr: (value) => {
              helpOutput += value;
            }
          });
        }
      }

      try {
        await program.parseAsync(argv);
      } catch {
        // commander exits after help
      }

      expect(helpOutput).toContain("Arguments:");
      expect(helpOutput).toContain("Managed process identifier");
    }
  });
});

function createBaseProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  return program;
}

function createContainer(logger: (message: string) => void = () => {}): ReturnType<typeof createCliContainer> {
  return createCliContainer({
    fs: createMemFs(),
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd: "/repo", homeDir: "/home/test", variables: { POE_CODE_OAUTH_LOGIN: "0" } },
    logger
  });
}

function createMemFs(): FileSystem {
  const volume = new Volume();
  volume.mkdirSync("/repo", { recursive: true });
  volume.mkdirSync("/home/test", { recursive: true });
  volume.mkdirSync("/home/test/.poe-code", { recursive: true });
  return createFsFromVolume(volume).promises as unknown as FileSystem;
}
