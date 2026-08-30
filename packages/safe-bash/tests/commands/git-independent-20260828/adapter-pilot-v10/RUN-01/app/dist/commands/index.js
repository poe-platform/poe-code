import {} from "../contracts/index.js";
import { basicCommands } from "./basic.js";
import { filesystemCommands } from "./filesystem.js";
import { streamCommands } from "./streams.js";
import { textCommands } from "./text.js";
import { grepCommands } from "./grep.js";
import { predicateCommands } from "./predicates.js";
import { directExecutor, executionCommands } from "./execution.js";
import { findCommands } from "./find.js";
import { diagnostic } from "./internal.js";
export function createStandardCommands(options = {}) {
    const commands = [];
    const execute = directExecutor(options.execute ?? (async (context) => {
        const command = commands.find(definition => definition.name === context.command);
        if (command)
            return command.execute(context);
        await diagnostic(context, new Error("command not found"));
        return { exitCode: 127 };
    }));
    commands.push(...basicCommands(), ...filesystemCommands(), ...streamCommands(), ...textCommands(), ...grepCommands(options.regex), ...predicateCommands(), ...executionCommands(execute), ...findCommands(execute));
    return commands;
}
export function standardCommands(options = {}) {
    return {
        name: "standard-commands",
        setup(host) {
            const commands = createStandardCommands({ ...options, execute: options.execute ?? (async (context) => {
                    const command = host.commands.get(context.command);
                    if (command)
                        return command.execute(context);
                    await diagnostic(context, new Error("command not found"));
                    return { exitCode: 127 };
                }) });
            if (!options.replace) {
                for (const command of commands) {
                    if (host.commands.has(command.name))
                        throw new Error(`Command already registered: ${command.name}`);
                }
            }
            for (const command of commands)
                host.commands.register(command, { replace: options.replace ?? false });
        },
    };
}
//# sourceMappingURL=index.js.map