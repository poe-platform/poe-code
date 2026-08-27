import { createTimeEnvCommands } from "./node_modules/virtual-bash/dist/commands/time-env/index.js";
createTimeEnvCommands({ unknownOption: true });
createTimeEnvCommands({ clock: () => "wrong" });
createTimeEnvCommands({ scheduler: { now: () => 0, setTimeout: () => 0 } });
createTimeEnvCommands({ limits: { maxOutputBytes: "1" } });
createTimeEnvCommands({ scheduler: { now: () => 0, setTimeout: (_callback: string) => 0, clearTimeout: () => {} } });
