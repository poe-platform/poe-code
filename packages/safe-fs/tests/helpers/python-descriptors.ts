import type { FileDescriptor, FileDescriptorCapabilities, FileStat } from "../../src/contracts/filesystem.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { PythonFileSystem } from "../../src/python/index.js";

/** Drive the unchanged canonical memory cases through the Python RPC descriptor surface. */
export function pythonDescriptorFixture(options?: ConstructorParameters<typeof MemoryFileSystem>[0]): MemoryFileSystem {
  const fs = new MemoryFileSystem(options);
  const service = new PythonFileSystem(fs, { cwd: "/", open: fs.open.bind(fs) });
  fs.open = async (path, options): Promise<FileDescriptor> => {
    const id = await service.dispatch({ op: "open", args: [path, options] }) as number;
    const capabilities = await service.dispatch({ op: "descriptorCapabilities", args: [id] }) as FileDescriptorCapabilities;
    let closing: Promise<void> | undefined;
    return {
      capabilities,
      stat: async () => await service.dispatch({ op: "fstat", args: [id] }) as FileStat,
      read: async (buffer, position) => {
        const data = await service.dispatch({ op: "read", args: [id, buffer.length, position] }) as Uint8Array;
        buffer.set(data);
        return data.length;
      },
      write: async (buffer, position) => await service.dispatch({ op: "write", args: [id, buffer, position] }) as number,
      truncate: async length => { await service.dispatch({ op: "ftruncate", args: [id, length] }); },
      sync: async dataOnly => { await service.dispatch({ op: "sync", args: [id, dataOnly] }); },
      close: () => closing ??= service.dispatch({ op: "close", args: [id] }).then(() => {}),
    };
  };
  return fs;
}
