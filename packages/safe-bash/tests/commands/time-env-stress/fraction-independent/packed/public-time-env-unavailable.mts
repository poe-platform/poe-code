import { createTimeEnvCommands, timeEnvCommands } from "virtual-bash";
createTimeEnvCommands({ clock: () => 0 });
timeEnvCommands();
