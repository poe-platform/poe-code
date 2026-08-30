import { jqCommand } from "./jq.js";
export { defaultJqLimits } from "./limits.js";
export function createStructuredCommands(options = {}) {
    return [jqCommand(options)];
}
export function structuredCommands(options = {}) {
    const definitions = createStructuredCommands(options);
    return {
        name: "structured-commands",
        setup(host) {
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