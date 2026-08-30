import { onlyKeys, record, stringValue, withSignal } from "./values.js";
function guestOptions(value) {
    if (value === undefined)
        return {};
    const options = record(value, "shell options");
    onlyKeys(options, ["cwd", "env", "stdin"]);
    const env = options.env === undefined ? undefined : record(options.env, "env");
    const entries = env === undefined ? undefined : Object.entries(env).map(([key, entry]) => {
        if (key.includes("\0") || key.includes("="))
            throw new TypeError("Invalid environment key");
        const text = stringValue(entry, `env.${key}`);
        if (text.includes("\0"))
            throw new TypeError("Invalid environment value");
        return [key, text];
    });
    return {
        ...(options.cwd === undefined ? {} : { cwd: stringValue(options.cwd, "cwd") }),
        ...(options.stdin === undefined ? {} : { stdin: stringValue(options.stdin, "stdin") }),
        ...(entries === undefined ? {} : { env: Object.fromEntries(entries) }),
    };
}
export function makeSafeJsShellModule(executor, options) {
    if (options.fs === undefined)
        throw new TypeError("An explicit filesystem is required");
    if (!(options.signal instanceof AbortSignal))
        throw new TypeError("An explicit signal is required");
    if (options.replayPolicy !== "read-side-effect") {
        throw new TypeError("Shell operations require the read-side-effect replay policy");
    }
    if (typeof options.declareHostOperation !== "function") {
        throw new TypeError("SafeJS declareHostOperation must be injected");
    }
    const execute = typeof executor === "function" ? executor : executor.exec.bind(executor);
    if (typeof execute !== "function")
        throw new TypeError("A shell executor is required");
    async function exec(source, input) {
        const text = stringValue(source, "source");
        const request = guestOptions(input);
        return withSignal(options.signal, async () => {
            const result = await execute(text, { ...request, fs: options.fs, signal: options.signal });
            if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) {
                throw new TypeError("Shell exitCode must be an integer between 0 and 255");
            }
            return {
                stdout: stringValue(result.stdout, "stdout"),
                stderr: stringValue(result.stderr, "stderr"),
                exitCode: result.exitCode,
            };
        });
    }
    return { exec: options.declareHostOperation(exec, options.replayPolicy) };
}
//# sourceMappingURL=shell.js.map