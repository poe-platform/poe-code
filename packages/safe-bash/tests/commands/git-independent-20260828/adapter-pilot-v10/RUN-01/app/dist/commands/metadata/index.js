import { createChmodCommand } from "./chmod.js";
import { createStatCommand } from "./stat.js";
import { createMktempCommand } from "./mktemp.js";
import { settings } from "./internal.js";
export function createMetadataCommands(options = {}) {
    settings(options);
    return [createChmodCommand(options), createStatCommand(options), createMktempCommand(options)];
}
export function metadataCommands(options = {}) {
    const commands = createMetadataCommands(options);
    return { name: "metadata-commands", setup(host) {
            if (!options.replace)
                for (const command of commands)
                    if (host.commands.has(command.name))
                        throw new Error(`Command already registered: ${command.name}`);
            for (const command of commands)
                host.commands.register(command, { replace: options.replace ?? false });
        } };
}
//# sourceMappingURL=index.js.map