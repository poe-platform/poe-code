import { settings } from "./options.js";
import { createSplitCommand } from "./split.js";
export function createSplitCommands(options = {}) {
    return [createSplitCommand(settings(options))];
}
export function splitCommands(options = {}) {
    const commands = createSplitCommands(options);
    return { name: "split-commands", setup(host) {
            if (!options.replace)
                for (const command of commands) {
                    if (host.commands.has(command.name))
                        throw new Error(`Command already registered: ${command.name}`);
                }
            for (const command of commands)
                host.commands.register(command, { replace: options.replace ?? false });
        } };
}
//# sourceMappingURL=index.js.map