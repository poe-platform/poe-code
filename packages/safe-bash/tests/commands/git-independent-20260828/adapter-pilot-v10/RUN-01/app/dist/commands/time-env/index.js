import { createPrintenvCommand } from "./printenv.js";
import { createDateCommand } from "./date.js";
import { createSleepCommand } from "./sleep.js";
import { settings } from "./shared.js";
export function createTimeEnvCommands(options = {}) {
    const configuration = settings(options);
    return [createDateCommand(configuration), createSleepCommand(configuration), createPrintenvCommand(configuration)];
}
export function timeEnvCommands(options = {}) {
    const commands = createTimeEnvCommands(options);
    return { name: "time-env-commands", setup(host) {
            if (!options.replace)
                for (const definition of commands) {
                    if (host.commands.has(definition.name))
                        throw new Error(`Command already registered: ${definition.name}`);
                }
            for (const definition of commands)
                host.commands.register(definition, { replace: options.replace ?? false });
        } };
}
//# sourceMappingURL=index.js.map