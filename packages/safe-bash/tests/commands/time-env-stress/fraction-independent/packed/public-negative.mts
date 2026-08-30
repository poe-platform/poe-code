import { Shell, MemoryFileSystem, standardCommands } from "virtual-bash";
new Shell({ fs: new MemoryFileSystem(), clock: () => 0 });
standardCommands({ execute: () => "wrong result" });
