import { createDuCommand } from "./du.js";
export { createDuCommand } from "./du.js";
export function createDuCommands(options = {}) {
    return [createDuCommand(options)];
}
export function duCommands(options = {}) {
    const commands = createDuCommands(options);
    const replace = options.replace ?? false;
    return { name: "du-commands", setup(host) {
            if (!replace)
                for (const command of commands) {
                    if (host.commands.has(command.name))
                        throw new Error(`Command already registered: ${command.name}`);
                }
            for (const command of commands)
                host.commands.register(command, { replace });
        } };
}
//# sourceMappingURL=index.js.map