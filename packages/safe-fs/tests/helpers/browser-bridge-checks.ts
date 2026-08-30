import { createFsBridge, FsError, MemoryFileSystem, MountFileSystem, OverlayFileSystem, ReadOnlyFileSystem, compareEntries } from "../../src/core.js";
import { FsError as DirectFsError } from "../../src/contracts/errors.js";
import { MemoryFileSystem as DirectMemory } from "../../src/fs/memory/index.js";
import type { FsBridgeCodec } from "../../src/core.js";
import { exerciseBridge } from "./bridge-scenarios.js";

export async function runBrowserBridgeChecks(): Promise<string[]> {
  const checks: string[] = [];
  function check(name: string, condition: boolean): void {
    if (!condition) throw new Error(name);
    checks.push(name);
  }
  check("no ambient Node globals", !["Buffer", "process", "require"].some(name => name in globalThis));
  check("canonical constructors in the bridge graph", FsError === DirectFsError && MemoryFileSystem === DirectMemory);
  const codec: FsBridgeCodec = {
    isEncoding: name => name.toLowerCase() === "utf8" || name.toLowerCase() === "utf-8",
    encode: text => new TextEncoder().encode(text),
    decode: bytes => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes)
  };
  const adapter = new MemoryFileSystem();
  const bridge = createFsBridge(adapter, { codec });
  check("all 21 bridge operations", new Set(await exerciseBridge(bridge)).size === 21);
  const bytes = await bridge.readFile("/work/file");
  check("honest Uint8Array result", bytes instanceof Uint8Array && Object.getPrototypeOf(bytes) === Uint8Array.prototype);
  bytes.fill(0);
  check("binary result ownership", await bridge.readFile("/work/file", "utf8") === "one");
  try { await bridge.writeFile("/unsupported", "ff", "hex"); throw new Error("expected codec refusal"); }
  catch (error) { check("unsupported codec refused", error instanceof TypeError); }
  try { await adapter.stat("/unsupported"); throw new Error("unexpected write"); }
  catch (error) { check("no unsupported-codec write", error instanceof FsError && error.code === "ENOENT"); }
  await adapter.mkdir("/outside");
  let callbacks = 0;
  adapter.compareEntry = async () => { callbacks++; return "same"; };
  check("canonical comparison does not use a replaced callback", await compareEntries(adapter, "/work", adapter, "/outside") === "distinct" && callbacks === 0);
  const controller = new AbortController();
  const reason = { comparison: true };
  controller.abort(reason);
  try { await compareEntries(adapter, "/work", adapter, "/outside", { signal: controller.signal }); throw new Error("expected cancellation"); }
  catch (error) { check("comparison preserves original cancellation reason", error === reason); }
  const cancelled = createFsBridge(adapter, { codec, signal: controller.signal });
  try { await cancelled.readFile("/work/file"); throw new Error("expected bridge cancellation"); }
  catch (error) { check("bridge keeps ABORT_ERR instead of substituting reason", error !== reason && typeof error === "object" && error !== null && "code" in error && error.code === "ABORT_ERR"); }
  const lower = new MemoryFileSystem();
  const upper = new MemoryFileSystem();
  await lower.writeFile("/file", new TextEncoder().encode("lower"));
  const overlay = new OverlayFileSystem({ lower: new ReadOnlyFileSystem(lower), upper });
  const mounted = new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/nested/data": overlay, "/nested/readonly": new ReadOnlyFileSystem(overlay) } });
  const mountedBridge = createFsBridge(mounted, { codec, cwd: "/nested" });
  await mountedBridge.writeFile("data/file", "upper");
  check("shared overlay copy-up through bridge", await mountedBridge.readFile("readonly/file", "utf8") === "upper" && new TextDecoder().decode(await lower.readFile("/file")) === "lower");
  check("canonical readonly alias through mount", await compareEntries(mounted, "/nested/data/file", mounted, "/nested/readonly/file") === "same");
  try { await mountedBridge.writeFile("readonly/file", "forbidden"); throw new Error("expected readonly refusal"); }
  catch (error) { check("readonly bridge error identity", error instanceof DirectFsError && error.code === "EROFS"); }
  await mountedBridge.rm("data/file");
  try { await mountedBridge.readFile("data/file"); throw new Error("expected whiteout"); }
  catch (error) { check("overlay whiteout through bridge", error instanceof DirectFsError && error.code === "ENOENT"); }
  const first = new MemoryFileSystem();
  const second = new MemoryFileSystem();
  await first.symlink("../second", "/escape");
  const confined = createFsBridge(new MountFileSystem({ root: new MemoryFileSystem(), mounts: { "/first": first, "/second": second } }), { codec });
  try { await confined.mkdir("/first/escape/created", { recursive: true }); throw new Error("expected mount refusal"); }
  catch (error) { check("mount confinement is retained by bridge", error instanceof DirectFsError && error.code === "EACCES"); }
  check("mount refusal has no effects", (await second.readdir("/")).length === 0);
  await Promise.all(Array.from({ length: 4 }, async (_value, index) => {
    await mountedBridge.writeFile(`data/concurrent-${index}`, String(index));
    check(`concurrent bridge write ${index}`, await mountedBridge.readFile(`data/concurrent-${index}`, "utf8") === String(index));
  }));
  return checks;
}
