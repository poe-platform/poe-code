import { createTacCommand } from "./tac.js";
import { createExpandCommand } from "./expand.js";
import { createFoldCommand } from "./fold.js";
import { createStringsCommand } from "./strings.js";
import { settings } from "./shared.js";
export function createStreamInspectionCommands(options = {}) {
    const limits = settings(options);
    return [createTacCommand(limits), createExpandCommand(limits), createFoldCommand(limits), createStringsCommand(limits)];
}
export function streamInspectionCommands(options = {}) {
    const commands = createStreamInspectionCommands(options);
    return { name: "stream-inspection-commands", setup(host) {
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