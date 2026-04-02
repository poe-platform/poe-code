import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  followManagedLogsMock,
  listManagedProcessesMock,
  readManagedLogsMock,
  removeManagedProcessMock,
  restartManagedProcessMock,
  runManagedProcessMock,
  startManagedProcessMock,
  stopManagedProcessMock
} = vi.hoisted(() => ({
  followManagedLogsMock: vi.fn(),
  listManagedProcessesMock: vi.fn(),
  readManagedLogsMock: vi.fn(),
  removeManagedProcessMock: vi.fn(),
  restartManagedProcessMock: vi.fn(),
  runManagedProcessMock: vi.fn(),
  startManagedProcessMock: vi.fn(),
  stopManagedProcessMock: vi.fn()
}));

vi.mock("@poe-code/process-launcher", () => ({
  followManagedLogs: followManagedLogsMock,
  listManagedProcesses: listManagedProcessesMock,
  readManagedLogs: readManagedLogsMock,
  removeManagedProcess: removeManagedProcessMock,
  restartManagedProcess: restartManagedProcessMock,
  runManagedProcess: runManagedProcessMock,
  startManagedProcess: startManagedProcessMock,
  stopManagedProcess: stopManagedProcessMock
}));

import {
  followLaunchLogs,
  listLaunches,
  readLaunchLogs,
  removeLaunch,
  restartLaunch,
  runLaunchDaemon,
  startLaunch,
  stopLaunch
} from "./launch.js";

describe("launch sdk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards start options to the process-launcher package", async () => {
    startManagedProcessMock.mockResolvedValue({ id: "api" });

    await startLaunch({
      cwd: "/repo",
      homeDir: "/home/test",
      spec: {
        id: "api",
        command: "npm",
        args: ["run", "dev"],
        restart: "on-failure"
      }
    });

    expect(startManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseDir: "/home/test/.poe-code/launch",
        spec: expect.objectContaining({
          command: "npm",
          id: "api"
        }),
        spawnDaemon: expect.any(Function)
      })
    );
  });

  it("forwards the remaining launch operations", async () => {
    await stopLaunch({ homeDir: "/home/test", id: "api" });
    await restartLaunch({ homeDir: "/home/test", id: "api" });
    await listLaunches({ homeDir: "/home/test" });
    await readLaunchLogs({ homeDir: "/home/test", id: "api" });
    followLaunchLogs({ homeDir: "/home/test", id: "api" });
    await removeLaunch({ homeDir: "/home/test", id: "api" });
    await runLaunchDaemon({ homeDir: "/home/test", id: "api" });

    expect(stopManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(restartManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(listManagedProcessesMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch" })
    );
    expect(readManagedLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(followManagedLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(removeManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
    expect(runManagedProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseDir: "/home/test/.poe-code/launch", id: "api" })
    );
  });


  it("falls back to direct pid signaling when the detached process group is missing", async () => {
    await stopLaunch({ homeDir: "/home/test", id: "api" });

    const stopOptions = stopManagedProcessMock.mock.calls[0]?.[0];
    expect(stopOptions?.signalProcess).toBeTypeOf("function");

    const error = new Error("kill ESRCH") as Error & { code?: string };
    error.code = "ESRCH";
    const killSpy = vi
      .spyOn(process, "kill")
      .mockImplementationOnce(() => {
        throw error;
      })
      .mockImplementationOnce(() => true);

    stopOptions.signalProcess(123, "SIGTERM");

    expect(killSpy).toHaveBeenNthCalledWith(1, -123, "SIGTERM");
    expect(killSpy).toHaveBeenNthCalledWith(2, 123, "SIGTERM");
  });
});
