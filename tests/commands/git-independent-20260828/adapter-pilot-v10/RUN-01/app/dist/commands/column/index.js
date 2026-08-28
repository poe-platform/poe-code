import { createColumnCommand } from "./column.js";
export { createColumnCommand } from "./column.js";
export function createColumnCommands(options = {}) {
    return [createColumnCommand(options)];
}
export function columnCommands(options = {}) {
    const commands = createColumnCommands(options), replace = options.replace ?? false;
    return { name: "column-commands", setup(host) {
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