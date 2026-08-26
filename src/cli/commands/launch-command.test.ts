import { Command } from "commander";
import { Volume, createFsFromVolume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
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
  selectMock,
  withSpinnerMock
} = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getThemeMock: vi.fn(() => "dark"),
  isCancelMock: vi.fn(() => false),
  promptTextMock: vi.fn(),
  renderTableMock: vi.fn(() => "rendered table"),
  selectMock: vi.fn(),
  withSpinnerMock: vi.fn(async <T>({ fn }: { fn: () => Promise<T> }) => await fn())
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

vi.mock("toolcraft-design", async (importOriginal) => {
  const actual = await importOriginal<typeof import("toolcraft-design")>();
  return {
    ...actual,
    cancel: cancelMock,
    getTheme: getThemeMock,
    isCancel: isCancelMock,
    promptText: promptTextMock,
    renderTable: renderTableMock,
    select: selectMock,
    withSpinner: withSpinnerMock
  };
});

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

function setProcessStdinIsTTY(value: boolean): () => void {
  Object.defineProperty(process.stdin, "isTTY", {
    value,
    configurable: true
  });

  return restoreProcessStdinIsTTY;
}

function restoreProcessStdinIsTTY(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", stdinIsTTYDescriptor);
  } else {
    Reflect.deleteProperty(process.stdin, "isTTY");
  }
}

describe("launch command", () => {
  beforeEach(() => {
    setProcessStdinIsTTY(true);
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

  afterEach(() => {
    restoreProcessStdinIsTTY();
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
    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Starting managed process api; waiting for log readiness...",
        fn: expect.any(Function),
        stopMessage: expect.any(Function)
      })
    );
  });

  it("describes TCP readiness while launch start waits", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync([
      "node",
      "cli",
      "launch",
      "start",
      "api",
      "--ready-port",
      "3000",
      "--",
      "node",
      "server.js"
    ]);

    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Starting managed process api; waiting for TCP port 3000..."
      })
    );
  });

  it("rejects max restarts with trailing suffixes", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await expect(
      program.parseAsync([
        "node",
        "cli",
        "launch",
        "start",
        "api",
        "--max-restarts",
        "2abc",
        "--",
        "node",
        "server.js"
      ])
    ).rejects.toThrow('Invalid max-restarts "2abc". Expected a non-negative integer.');

    expect(startLaunchMock).not.toHaveBeenCalled();
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

  it("prompts for missing start values in interactive launch start", async () => {
    promptTextMock
      .mockResolvedValueOnce("api")
      .mockResolvedValueOnce("npm run dev");

    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync(["node", "cli", "launch", "start"]);

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

  describe.each(["interactive", "explicit argv"])("%s command arguments", (source) => {
    it.each([
      { line: "printf '%s' '' tail", command: "printf", args: ["%s", "", "tail"] },
      { line: 'printf "%s" "" tail', command: "printf", args: ["%s", "", "tail"] },
      { line: "echo ''", command: "echo", args: [""] },
      { line: 'echo ""', command: "echo", args: [""] },
      { line: 'echo "" "" tail', command: "echo", args: ["", "", "tail"] },
      { line: "echo tail '' \"\"", command: "echo", args: ["tail", "", ""] },
      { line: "echo ''\"\" tail", command: "echo", args: ["", "tail"] },
      { line: "echo ''\"\"", command: "echo", args: [""] },
      { line: "echo a''b", command: "echo", args: ["ab"] },
      { line: "echo ''a\"\"", command: "echo", args: ["a"] },
      { line: "echo 'a b' \"c d\"", command: "echo", args: ["a b", "c d"] },
      { line: "echo ' ' \"  \"", command: "echo", args: [" ", "  "] },
      { line: "echo\t''\t\"\"\ttail", command: "echo", args: ["", "", "tail"] },
      { line: "echo\t\talpha  beta", command: "echo", args: ["alpha", "beta"] }
    ])("preserves arguments for $line", async ({ line, command, args }) => {
      const program = createBaseProgram();
      registerLaunchCommand(program, createContainer());
      const argv = ["node", "cli", "launch", "start", "api"];
      if (source === "interactive") {
        promptTextMock.mockResolvedValueOnce(line);
      } else {
        argv.push("--", command, ...args);
      }

      await program.parseAsync(argv);

      expect(startLaunchMock).toHaveBeenCalledTimes(1);
      expect(startLaunchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spec: expect.objectContaining({ command, args })
        })
      );
      expect(promptTextMock).toHaveBeenCalledTimes(source === "interactive" ? 1 : 0);
      expect(selectMock).not.toHaveBeenCalled();
    });

    it.each([
      { line: "'' echo", args: ["echo"] },
      { line: '"" echo', args: ["echo"] },
      { line: "''", args: [] },
      { line: '""', args: [] },
      { line: "''\"\" echo", args: ["echo"] }
    ])("rejects an empty executable for $line before calling the SDK", async ({ line, args }) => {
      const program = createBaseProgram();
      registerLaunchCommand(program, createContainer());
      const argv = ["node", "cli", "launch", "start", "api"];
      if (source === "interactive") {
        promptTextMock.mockResolvedValueOnce(line);
      } else {
        argv.push("--", "", ...args);
      }

      const result = program.parseAsync(argv);

      await expect(result).rejects.toBeInstanceOf(ValidationError);
      await expect(result).rejects.toThrow("Command to run is required.");
      expect(startLaunchMock).not.toHaveBeenCalled();
      expect(withSpinnerMock).not.toHaveBeenCalled();
      expect(selectMock).not.toHaveBeenCalled();
    });
  });

  it.each(["echo 'unfinished", 'echo "unfinished'])(
    "rejects an unterminated quote in %s before calling the SDK",
    async (line) => {
      const program = createBaseProgram();
      registerLaunchCommand(program, createContainer());
      promptTextMock.mockResolvedValueOnce(line);

      const result = program.parseAsync(["node", "cli", "launch", "start", "api"]);

      await expect(result).rejects.toBeInstanceOf(ValidationError);
      await expect(result).rejects.toThrow("Command contains an unterminated quote.");
      expect(startLaunchMock).not.toHaveBeenCalled();
      expect(withSpinnerMock).not.toHaveBeenCalled();
    }
  );

  it("rejects missing launch start values under --yes without prompting", async () => {
    const missingIdProgram = createBaseProgram();
    registerLaunchCommand(missingIdProgram, createContainer());

    await expect(
      missingIdProgram.parseAsync(["node", "cli", "--yes", "launch", "start"])
    ).rejects.toThrow("Process ID is required.");

    const missingCommandProgram = createBaseProgram();
    registerLaunchCommand(missingCommandProgram, createContainer());

    await expect(
      missingCommandProgram.parseAsync(["node", "cli", "--yes", "launch", "start", "api"])
    ).rejects.toThrow("Command to run is required.");

    expect(promptTextMock).not.toHaveBeenCalled();
    expect(startLaunchMock).not.toHaveBeenCalled();
  });

  it("rejects missing launch start values in non-interactive mode without prompting", async () => {
    const restoreStdin = setProcessStdinIsTTY(false);

    try {
      const missingIdProgram = createBaseProgram();
      registerLaunchCommand(missingIdProgram, createContainer());

      await expect(
        missingIdProgram.parseAsync(["node", "cli", "launch", "start"])
      ).rejects.toThrow("Process ID is required when running without an interactive TTY.");

      const missingCommandProgram = createBaseProgram();
      registerLaunchCommand(missingCommandProgram, createContainer());

      await expect(
        missingCommandProgram.parseAsync(["node", "cli", "launch", "start", "api"])
      ).rejects.toThrow("Command to run is required when running without an interactive TTY.");
    } finally {
      restoreStdin();
    }

    expect(promptTextMock).not.toHaveBeenCalled();
    expect(selectMock).not.toHaveBeenCalled();
    expect(startLaunchMock).not.toHaveBeenCalled();
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

  it("previews launch start without executing the managed process", async () => {
    const logs: string[] = [];
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await program.parseAsync([
      "node", "cli", "--dry-run", "--yes", "launch", "start", "api", "--", "node", "server.js"
    ]);

    expect(startLaunchMock).not.toHaveBeenCalled();
    expect(withSpinnerMock).not.toHaveBeenCalled();
    expect(logs).toContain("Dry run: would start managed process api.");
  });

  it("rejects launch start ids that can never name a managed process", async () => {
    const logs: string[] = [];
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await expect(program.parseAsync([
      "node", "cli", "--dry-run", "--yes", "launch", "start", "slee:\n#", "--", "echo", "hi"
    ])).rejects.toThrow(/process id/i);

    expect(startLaunchMock).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("previews launch stop without changing running state", async () => {
    const logs: string[] = [];
    listLaunchesMock.mockResolvedValue([{ id: "api" }]);
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await program.parseAsync(["node", "cli", "--dry-run", "launch", "stop", "api"]);

    expect(listLaunchesMock).toHaveBeenCalledWith({ homeDir: "/home/test" });
    expect(stopLaunchMock).not.toHaveBeenCalled();
    expect(logs).toContain("Dry run: would stop managed process api.");
  });

  it("rejects launch stop dry runs for missing managed processes", async () => {
    const logs: string[] = [];
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "launch", "stop", "missing-process"])
    ).rejects.toThrow("Managed process not found: missing-process");

    expect(stopLaunchMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("previews launch restart without restarting the managed process", async () => {
    const logs: string[] = [];
    listLaunchesMock.mockResolvedValue([{ id: "api" }]);
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await program.parseAsync(["node", "cli", "--dry-run", "launch", "restart", "api"]);

    expect(listLaunchesMock).toHaveBeenCalledWith({ homeDir: "/home/test" });
    expect(restartLaunchMock).not.toHaveBeenCalled();
    expect(withSpinnerMock).not.toHaveBeenCalled();
    expect(logs).toContain("Dry run: would restart managed process api.");
  });

  it("rejects launch restart dry runs for missing managed processes", async () => {
    const logs: string[] = [];
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await expect(
      program.parseAsync(["node", "cli", "--dry-run", "launch", "restart", "missing-process"])
    ).rejects.toThrow("Managed process not found: missing-process");

    expect(restartLaunchMock).not.toHaveBeenCalled();
    expect(withSpinnerMock).not.toHaveBeenCalled();
    expect(logs.join("\n")).not.toContain("Dry run");
  });

  it("wraps launch restart in a progress spinner", async () => {
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer());

    await program.parseAsync(["node", "cli", "launch", "restart", "api"]);

    expect(restartLaunchMock).toHaveBeenCalledWith({ homeDir: "/home/test", id: "api" });
    expect(withSpinnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Restarting managed process api...",
        fn: expect.any(Function),
        stopMessage: expect.any(Function)
      })
    );
  });

  it("previews launch rm without removing managed process data", async () => {
    const logs: string[] = [];
    const program = createBaseProgram();
    registerLaunchCommand(program, createContainer((message) => logs.push(message)));

    await program.parseAsync(["node", "cli", "--dry-run", "launch", "rm", "api"]);

    expect(removeLaunchMock).not.toHaveBeenCalled();
    expect(logs).toContain("Dry run: would remove managed process api.");
  });

  it("renders launch status when invoked bare, without printing help", async () => {
    listLaunchesMock.mockResolvedValue([]);

    let loggerOutput = "";
    const program = createBaseProgram();
    registerLaunchCommand(
      program,
      createContainer((message) => {
        loggerOutput += `${message}\n`;
      })
    );

    await program.parseAsync(["node", "cli", "launch"]);

    expect(listLaunchesMock).toHaveBeenCalled();
    expect(loggerOutput).toContain("No managed processes.");
    expect(loggerOutput).not.toContain("Usage: poe-code launch");
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
