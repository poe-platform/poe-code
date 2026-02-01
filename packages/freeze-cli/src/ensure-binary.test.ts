import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawn = vi.fn();
const existsSync = vi.fn();
const accessSync = vi.fn();

function createChild() {
  const emitter = new EventEmitter();
  return {
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
    kill: vi.fn()
  };
}

describe("ensureFreezeBinary", () => {
  beforeEach(() => {
    vi.resetModules();
    spawn.mockReset();
    existsSync.mockReset();
    accessSync.mockReset();
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("node:fs", () => ({ existsSync, accessSync }));
  });

  afterEach(() => {
    vi.unmock("node:child_process");
    vi.unmock("node:fs");
  });

  it("skips download when binary is healthy", async () => {
    existsSync.mockReturnValue(true);
    accessSync.mockImplementation(() => undefined);
    const probeChild = createChild();
    spawn.mockReturnValueOnce(probeChild);

    const { ensureFreezeBinary } = await import("./ensure-binary.js");
    const promise = ensureFreezeBinary("/bin/freeze", "/scripts/download.js", {
      probeTimeoutMs: 10
    });
    probeChild.emit("exit", 0, null);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe("/bin/freeze");
    expect(args).toEqual(["--help"]);
  });

  it("downloads when binary is missing", async () => {
    existsSync.mockReturnValue(false);
    const downloadChild = createChild();
    const probeChild = createChild();
    spawn.mockReturnValueOnce(downloadChild).mockReturnValueOnce(probeChild);

    const { ensureFreezeBinary } = await import("./ensure-binary.js");
    const promise = ensureFreezeBinary("/bin/freeze", "/scripts/download.js", {
      probeTimeoutMs: 10
    });
    downloadChild.emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    probeChild.emit("exit", 0, null);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(2);
    const [command, args] = spawn.mock.calls[0];
    const [probeCommand, probeArgs] = spawn.mock.calls[1];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["/scripts/download.js"]);
    expect(probeCommand).toBe("/bin/freeze");
    expect(probeArgs).toEqual(["--help"]);
  });

  it("downloads when probe fails", async () => {
    existsSync.mockReturnValue(true);
    accessSync.mockImplementation(() => undefined);
    const probeChild = createChild();
    const downloadChild = createChild();
    const postDownloadProbe = createChild();
    spawn
      .mockReturnValueOnce(probeChild)
      .mockReturnValueOnce(downloadChild)
      .mockReturnValueOnce(postDownloadProbe);

    const { ensureFreezeBinary } = await import("./ensure-binary.js");
    const promise = ensureFreezeBinary("/bin/freeze", "/scripts/download.js", {
      probeTimeoutMs: 10
    });
    probeChild.emit("exit", 1, null);
    await new Promise((resolve) => setImmediate(resolve));
    downloadChild.emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    postDownloadProbe.emit("exit", 0, null);
    await promise;

    expect(spawn).toHaveBeenCalledTimes(3);
    const [probeCommand] = spawn.mock.calls[0];
    const [downloadCommand, downloadArgs] = spawn.mock.calls[1];
    const [postProbeCommand, postProbeArgs] = spawn.mock.calls[2];
    expect(probeCommand).toBe("/bin/freeze");
    expect(downloadCommand).toBe(process.execPath);
    expect(downloadArgs).toEqual(["/scripts/download.js"]);
    expect(postProbeCommand).toBe("/bin/freeze");
    expect(postProbeArgs).toEqual(["--help"]);
  });
});
