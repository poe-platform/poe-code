import { createTreeCommand } from "./tree.js";
export { createTreeCommand } from "./tree.js";
export function createTreeCommands(options = {}) {
    return [createTreeCommand(options)];
}
export function treeCommands(options = {}) {
    const commands = createTreeCommands(options);
    const replace = options.replace ?? false;
    return { name: "tree-commands", setup(host) {
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