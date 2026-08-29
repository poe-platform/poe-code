import { grepCommands } from "../grep.js";
function alias(name, grep) {
    return {
        name,
        execute: context => {
            const stdinIsDefault = context.stdinIsDefault;
            const invoke = context.invoke;
            const registerCleanup = context.registerCleanup;
            return grep.execute({
                ...context,
                command: name,
                args: [name === "egrep" ? "-E" : "-F", ...context.args],
                stdin: context.stdin,
                stdout: context.stdout,
                stderr: context.stderr,
                cwd: context.cwd,
                env: context.env,
                fs: context.fs,
                signal: context.signal,
                ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
                ...(invoke === undefined ? {} : { invoke: invoke.bind(context) }),
                ...(registerCleanup === undefined ? {} : { registerCleanup: registerCleanup.bind(context) }),
            });
        },
    };
}
export function createGrepAliasCommands(options = {}) {
    const grep = grepCommands(options.regex)[0];
    return [alias("egrep", grep), alias("fgrep", grep)];
}
export function egrepCommand(options = {}) {
    return alias("egrep", grepCommands(options.regex)[0]);
}
export function fgrepCommand(options = {}) {
    return alias("fgrep", grepCommands(options.regex)[0]);
}
export function grepAliasCommands(options = {}) {
    return {
        name: "grep-alias-commands",
        setup(host) {
            const definitions = createGrepAliasCommands(options);
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