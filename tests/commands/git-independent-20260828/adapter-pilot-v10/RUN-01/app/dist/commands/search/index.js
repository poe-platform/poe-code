import { rgCommand } from "./rg.js";
export function createSearchCommands(options = {}) {
    return [rgCommand(options)];
}
export function searchCommands(options = {}) {
    return {
        name: "search-commands",
        setup(host) {
            const definitions = createSearchCommands(options);
            if (!options.replace)
                for (const definition of definitions) {
                    if (host.commands.has(definition.name))
                        throw new Error(`Command already registered: ${definition.name}`);
                }
            for (const definition of definitions)
                host.commands.register(definition, { replace: options.replace ?? false });
        },
    };
}
//# sourceMappingURL=index.js.map