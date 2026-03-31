import { afterEach, beforeEach, describe, it, expect, vi } from "bun:test";
import { EventEmitter } from "node:events";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";

let spawnSpy: ReturnType<typeof vi.spyOn>;
let existsSyncSpy: ReturnType<typeof vi.spyOn>;
let accessSyncSpy: ReturnType<typeof vi.spyOn>;

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
    spawnSpy = vi.spyOn(childProcess, "spawn");
    spawnSpy.mockClear();
    existsSyncSpy = vi.spyOn(fs, "existsSync");
    existsSyncSpy.mockClear();
    accessSyncSpy = vi.spyOn(fs, "accessSync");
    accessSyncSpy.mockClear();
  });

  afterEach(() => {
    spawnSpy.mockRestore();
    existsSyncSpy.mockRestore();
    accessSyncSpy.mockRestore();
  });

  it("skips download when binary is healthy", async () => {
    existsSyncSpy.mockReturnValue(true);
    accessSyncSpy.mockImplementation(() => undefined);
    const probeChild = createChild();
    spawnSpy.mockReturnValueOnce(probeChild as any);

    const { ensureFreezeBinary } = await import("./ensure-binary.js");
    const promise = ensureFreezeBinary("/bin/freeze", "/scripts/download.js", {
      probeTimeoutMs: 10
    });
    probeChild.emit("exit", 0, null);
    await promise;

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    const [command, args] = spawnSpy.mock.calls[0];
    expect(command).toBe("/bin/freeze");
    expect(args).toEqual(["--help"]);
  });

  it("downloads when binary is missing", async () => {
    existsSyncSpy.mockReturnValue(false);
    const downloadChild = createChild();
    const probeChild = createChild();
    spawnSpy
      .mockReturnValueOnce(downloadChild as any)
      .mockReturnValueOnce(probeChild as any);

    const { ensureFreezeBinary } = await import("./ensure-binary.js");
    const promise = ensureFreezeBinary("/bin/freeze", "/scripts/download.js", {
      probeTimeoutMs: 10
    });
    downloadChild.emit("exit", 0, null);
    await new Promise((resolve) => setImmediate(resolve));
    probeChild.emit("exit", 0, null);
    await promise;

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    const [command, args] = spawnSpy.mock.calls[0];
    const [probeCommand, probeArgs] = spawnSpy.mock.calls[1];
    expect(command).toBe(process.execPath);
    expect(args).toEqual(["/scripts/download.js"]);
    expect(probeCommand).toBe("/bin/freeze");
    expect(probeArgs).toEqual(["--help"]);
  });

  it("downloads when probe fails", async () => {
    existsSyncSpy.mockReturnValue(true);
    accessSyncSpy.mockImplementation(() => undefined);
    const probeChild = createChild();
    const downloadChild = createChild();
    const postDownloadProbe = createChild();
    spawnSpy
      .mockReturnValueOnce(probeChild as any)
      .mockReturnValueOnce(downloadChild as any)
      .mockReturnValueOnce(postDownloadProbe as any);

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

    expect(spawnSpy).toHaveBeenCalledTimes(3);
    const [probeCommand] = spawnSpy.mock.calls[0];
    const [downloadCommand, downloadArgs] = spawnSpy.mock.calls[1];
    const [postProbeCommand, postProbeArgs] = spawnSpy.mock.calls[2];
    expect(probeCommand).toBe("/bin/freeze");
    expect(downloadCommand).toBe(process.execPath);
    expect(downloadArgs).toEqual(["/scripts/download.js"]);
    expect(postProbeCommand).toBe("/bin/freeze");
    expect(postProbeArgs).toEqual(["--help"]);
  });
});
