import { checkSize, command, CommandFailure, emit, ownEnvironment } from "./shared.js";
export function createPrintenvCommand(configuration) {
    return command("printenv", configuration, async (context) => {
        let separator = "\n";
        let offset = 0;
        for (; offset < context.args.length; offset++) {
            const argument = context.args[offset];
            if (argument === "--") {
                offset++;
                break;
            }
            if (argument === "--help") {
                await emit(context, "Usage: printenv [-0|--null] [--] [NAME ...]\nPrint only the virtual command environment.\n", configuration.limits);
                return 0;
            }
            if (argument === "--version") {
                await emit(context, "printenv (safe-bash virtual command)\n", configuration.limits);
                return 0;
            }
            if (argument === "--null" || /^-0+$/.test(argument)) {
                separator = "\0";
                continue;
            }
            if (argument.startsWith("-") && argument !== "-")
                throw new CommandFailure(`invalid option: ${argument}`, 2);
            break;
        }
        const names = context.args.slice(offset);
        const lines = [];
        let total = 0;
        let missing = false;
        const append = (value) => {
            total += Buffer.byteLength(value) + 1;
            checkSize(total, configuration.limits.maxOutputBytes, "output");
            lines.push(value, separator);
        };
        if (names.length) {
            for (const name of names) {
                context.signal.throwIfAborted();
                const value = ownEnvironment(context, name);
                if (name.includes("=") || value === undefined)
                    missing = true;
                else
                    append(value);
            }
        }
        else {
            const keys = Object.getOwnPropertyNames(context.env);
            checkSize(keys.length, configuration.limits.maxEnvironmentEntries, "environment entry");
            for (const name of keys) {
                context.signal.throwIfAborted();
                append(`${name}=${context.env[name]}`);
            }
        }
        await emit(context, lines.join(""), configuration.limits);
        return missing ? 1 : 0;
    });
}
//# sourceMappingURL=printenv.js.map