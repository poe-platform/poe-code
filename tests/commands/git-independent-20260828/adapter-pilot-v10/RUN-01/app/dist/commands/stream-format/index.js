import { createSeqCommand } from "./seq.js";
import { createNlCommand } from "./nl.js";
import { createRevCommand } from "./rev.js";
import { createUnexpandCommand } from "./unexpand.js";
import { settings } from "./shared.js";
export function createStreamFormatCommands(options = {}) {
    const limits = settings(options);
    return [createSeqCommand(limits), createNlCommand(limits), createRevCommand(limits), createUnexpandCommand(limits)];
}
export function streamFormatCommands(options = {}) {
    const commands = createStreamFormatCommands(options);
    return { name: "stream-format-commands", setup(host) {
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