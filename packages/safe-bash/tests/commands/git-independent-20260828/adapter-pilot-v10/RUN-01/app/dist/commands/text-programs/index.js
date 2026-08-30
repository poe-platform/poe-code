import { sedCommand } from "./sed.js";
import { awkCommand } from "./awk.js";
export function createTextProgramCommands(options = {}) {
    return [sedCommand(options), awkCommand(options)];
}
export function textProgramCommands(options = {}) {
    return {
        name: "text-program-commands",
        setup(host) {
            const definitions = createTextProgramCommands(options);
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