export class CommandRegistry {
    #commands = new Map();
    constructor(commands = []) {
        for (const command of commands)
            this.register(command);
    }
    register(command, options = {}) {
        const { name, execute } = command;
        if (typeof name !== "string" || !name || /[\s/\0]/u.test(name)) {
            throw new TypeError("Command names must be nonempty and contain no whitespace, slash, or NUL");
        }
        if (typeof execute !== "function") {
            throw new TypeError("Command execute must be a function");
        }
        if (this.#commands.has(name) && !options.replace) {
            throw new Error(`Command already registered: ${name}`);
        }
        this.#commands.set(name, Object.freeze({ ...command, name, execute }));
        return this;
    }
    get(name) {
        return this.#commands.get(name);
    }
    has(name) {
        return this.#commands.has(name);
    }
    unregister(name) {
        return this.#commands.delete(name);
    }
    list() {
        return Array.from(this.#commands.values());
    }
}
export function validateExitCode(exitCode) {
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
        throw new RangeError("Exit status must be an integer between 0 and 255");
    }
    return exitCode;
}
//# sourceMappingURL=command.js.map