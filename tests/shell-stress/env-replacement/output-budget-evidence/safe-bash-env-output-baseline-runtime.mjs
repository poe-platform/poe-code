import { ACCESS_MODES, composeMiddleware, createBytePipe, pipeBytes, resolvePath, toByteSource, validateExitCode, writeText, } from "../contracts/index.js";
import { HereDocumentSyntaxError, hereDocumentWords, parseShellInputUnit, parseShellUnit } from "./parser.js";
import { ShellLimitError, ShellSyntaxError } from "./types.js";
import { ShellInput } from "./input.js";
import { evaluateArithmetic } from "./arithmetic.js";
import { compilePattern, matchesPattern } from "./pattern.js";
import { byteLocale } from "./locale.js";
import { functionDisplay } from "./display.js";
export const defaultLimits = {
    maxOutputBytes: 16 * 1024 * 1024,
    maxCommands: 10_000,
    maxLoopIterations: 10_000,
    maxSubstitutionDepth: 64,
    maxSourceBytes: 1024 * 1024,
    maxExpansionFields: 10_000,
    maxExpansionBytes: 16 * 1024 * 1024,
    pipeHighWaterMark: 64 * 1024,
};
const shellBuiltinNames = new Set([
    ":", "true", "false", "pwd", "cd", "set", "shift", "export", "local", "unset", "read",
    "exit", "return", "break", "continue", "command", "type", "readonly", "echo", "printf", "test", "[", ".", "source", "eval",
]);
const implementedBuiltins = new Set([...shellBuiltinNames].filter(name => !["echo", "printf", "test", "["].includes(name)));
const specialBuiltinNames = new Set([":", ".", "break", "continue", "eval", "exit", "export", "readonly", "return", "set", "shift", "unset"]);
export function resolveLimits(...limits) {
    const result = Object.assign({}, defaultLimits, ...limits);
    for (const [key, value] of Object.entries(result)) {
        if (!Number.isSafeInteger(value) || value < (key === "pipeHighWaterMark" ? 1 : 0)) {
            throw new RangeError(`${key} must be a ${key === "pipeHighWaterMark" ? "positive" : "nonnegative"} safe integer`);
        }
    }
    return result;
}
export class Budget {
    limits;
    commands = 0;
    iterations = 0;
    bytes = 0;
    sourceBytes = 0;
    controller = new AbortController();
    signal;
    constructor(limits, signal) {
        this.limits = limits;
        this.signal = signal ? AbortSignal.any([signal, this.controller.signal]) : this.controller.signal;
    }
    fail(limit) {
        const error = new ShellLimitError(limit);
        this.controller.abort(error);
        throw error;
    }
    tick() {
        this.signal.throwIfAborted();
        if (++this.commands > this.limits.maxCommands)
            this.fail("maxCommands");
    }
    loop() {
        this.signal.throwIfAborted();
        if (++this.iterations > this.limits.maxLoopIterations)
            this.fail("maxLoopIterations");
    }
    source(bytes) {
        this.signal.throwIfAborted();
        if (bytes > this.limits.maxSourceBytes - this.sourceBytes)
            this.fail("maxSourceBytes");
        this.sourceBytes += bytes;
    }
    sink(sink, signal = this.signal) {
        return {
            write: async (chunk) => {
                signal.throwIfAborted();
                if (!(chunk instanceof Uint8Array))
                    throw new TypeError("Shell output must be Uint8Array");
                if (chunk.byteLength > this.limits.maxOutputBytes - this.bytes)
                    this.fail("maxOutputBytes");
                this.bytes += chunk.byteLength;
                await interruptible(sink.write(chunk), signal);
            },
        };
    }
}
export async function interruptible(promise, signal) {
    if (signal.aborted) {
        void promise.catch(() => undefined);
        throw signal.reason;
    }
    let abort;
    const aborted = new Promise((_resolve, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
    });
    try {
        return await Promise.race([promise, aborted]);
    }
    finally {
        signal.removeEventListener("abort", abort);
    }
}
export class Capture {
    chunks = [];
    length = 0;
    async write(chunk) {
        this.chunks.push(new Uint8Array(chunk));
        this.length += chunk.byteLength;
    }
    bytes() {
        const bytes = new Uint8Array(this.length);
        let offset = 0;
        for (const chunk of this.chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return bytes;
    }
}
function isolateIO(io) {
    return { ...io, ...(io.descriptors ? { descriptors: new Map([...io.descriptors].map(([number, descriptor]) => [number, { ...descriptor }])) } : {}) };
}
function activeIO(io) {
    const input = io.descriptors?.get(0);
    const output = io.descriptors?.get(1);
    const error = io.descriptors?.get(2);
    if (!(input?.closed && input.input === io.stdin) && !(output?.closed && output.output === io.stdout) && !(error?.closed && error.output === io.stderr))
        return io;
    return {
        ...io,
        ...(input?.closed && input.input === io.stdin ? { stdin: closedSource, stdinIsDefault: false } : {}),
        ...(output?.closed && output.output === io.stdout ? { stdout: closedSink } : {}),
        ...(error?.closed && error.output === io.stderr ? { stderr: closedSink } : {}),
    };
}
class Flow extends Error {
    kind;
    status;
    levels;
    constructor(kind, status, levels = 1) {
        super(kind);
        this.kind = kind;
        this.status = status;
        this.levels = levels;
    }
}
class ExecutionFailure extends Error {
    original;
    io;
    diagnostic;
    constructor(original, io, diagnostic) {
        super(message(original));
        this.original = original;
        this.io = io;
        this.diagnostic = diagnostic;
    }
}
class ExpansionFailure extends Error {
    line;
    constructor(message, line) {
        super(message);
        this.line = line;
    }
}
class CommandFailure extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
class FatalCommandFailure extends CommandFailure {
}
class ParameterExpansionFailure extends ExpansionFailure {
}
class PipelineClosed extends Error {
    code = "EPIPE";
    constructor() { super("Pipeline consumer exited"); }
}
function signalSink(sink, signal) {
    return { async write(chunk) { signal.throwIfAborted(); await interruptible(sink.write(chunk), signal); } };
}
function cloneState(state) {
    return {
        ...state,
        variables: Object.assign(Object.create(null), state.variables),
        exported: new Set(state.exported), functions: new Map(state.functions), positional: [...state.positional],
        readonlyVariables: new Set(state.readonlyVariables),
        locals: state.locals.map((scope) => new Map(scope)),
    };
}
function errorCode(error) {
    return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
}
function message(error) { return error instanceof Error ? error.message : String(error); }
function filesystemDiagnostic(error, target) {
    const descriptions = { ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted", ENOTDIR: "Not a directory", EISDIR: "Is a directory", ELOOP: "Too many levels of symbolic links", ENOSPC: "No space left on device", EROFS: "Read-only file system" };
    const description = descriptions[errorCode(error) ?? ""];
    return description ? `${target}: ${description}` : undefined;
}
const closedSink = { async write() { throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" }); } };
const closedSource = { async *[Symbol.asyncIterator]() { throw Object.assign(new Error("Bad file descriptor"), { code: "EBADF" }); } };
export class Runtime {
    fs;
    commands;
    middleware;
    budget;
    signal;
    fileWrites;
    outputFiles;
    constructor(fs, commands, middleware, budget, signal = budget.signal, fileWrites = new Map(), outputFiles = new Map()) {
        this.fs = fs;
        this.commands = commands;
        this.middleware = middleware;
        this.budget = budget;
        this.signal = signal;
        this.fileWrites = fileWrites;
        this.outputFiles = outputFiles;
    }
    diagnostic(io, text) {
        return writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${text}\n`);
    }
    writeVariable(state, name, value) {
        if (state.readonlyVariables?.has(name))
            throw new Error(`${name}: readonly variable`);
        state.variables[name] = value;
    }
    arithmeticVariables(state) {
        if (!state.readonlyVariables?.size)
            return state.variables;
        return new Proxy(state.variables, { set: (_target, key, value) => { this.writeVariable(state, String(key), value); return true; } });
    }
    async run(script, state, io) {
        return (await this.runUnit(script, state, io)).exitCode;
    }
    async runUnit(script, state, io) {
        try {
            return { exitCode: await this.script(script, state, io), terminated: false };
        }
        catch (error) {
            if (error instanceof Flow && error.kind === "exit")
                return { exitCode: error.status, terminated: true };
            throw error;
        }
    }
    async script(script, state, io) {
        for (const list of script.lists) {
            for (let index = 0; index < list.pipelines.length; index++) {
                const operator = list.operators[index - 1];
                if ((operator === "&&" && state.status !== 0) || (operator === "||" && state.status === 0))
                    continue;
                state.status = await this.pipeline(list.pipelines[index], state, io);
            }
        }
        return script.lists.length ? state.status : 0;
    }
    async pipeline(pipeline, state, io) {
        this.signal.throwIfAborted();
        let status;
        if (pipeline.commands.length === 1)
            status = await this.command(pipeline.commands[0], state, io);
        else {
            const pipes = pipeline.commands.slice(1).map(() => createBytePipe({
                highWaterMark: this.budget.limits.pipeHighWaterMark, signal: this.signal,
            }));
            const controllers = pipeline.commands.map(() => new AbortController());
            const written = new Set();
            const completed = new Set();
            const closing = new Set();
            const tasks = pipeline.commands.map(async (command, index) => {
                const incoming = pipes[index - 1];
                const outgoing = pipes[index];
                const signal = AbortSignal.any([this.signal, controllers[index].signal]);
                const runtime = new Runtime(this.fs, this.commands, this.middleware, this.budget, signal, this.fileWrites, this.outputFiles);
                const input = new ShellInput(incoming?.readable ?? io.stdin, this.budget, signal);
                const pipeOutput = outgoing && { write: async (chunk) => {
                        try {
                            await outgoing.writable.write(chunk);
                            if (chunk.byteLength)
                                written.add(index);
                        }
                        catch (error) {
                            if (errorCode(error) === "EPIPE") {
                                const closed = new PipelineClosed();
                                controllers[index].abort(closed);
                                throw closed;
                            }
                            throw error;
                        }
                    } };
                try {
                    return await interruptible(runtime.runCommandIsolated(command, { ...cloneState(state), isolated: true }, {
                        ...isolateIO(io),
                        stdin: input,
                        ...(incoming ? { stdinIsDefault: false } : {}),
                        stdout: pipeOutput ? this.budget.sink(pipeOutput, signal) : signalSink(io.stdout, signal),
                        stderr: signalSink(io.stderr, signal),
                    }), signal);
                }
                catch (error) {
                    if (error instanceof PipelineClosed)
                        return 141;
                    throw error;
                }
                finally {
                    completed.add(index);
                    if (incoming) {
                        const upstream = index - 1;
                        const close = setImmediate(() => {
                            closing.delete(close);
                            if (written.has(upstream) && !completed.has(upstream))
                                controllers[upstream].abort(new PipelineClosed());
                        });
                        closing.add(close);
                        await incoming.abort();
                    }
                    await input.close().catch((error) => { if (!(error instanceof PipelineClosed))
                        throw error; });
                    if (outgoing)
                        await outgoing.close().catch(() => undefined);
                }
            });
            try {
                const statuses = await interruptible(Promise.all(tasks), this.signal);
                status = state.pipefail ? statuses.findLast((status) => status !== 0) ?? 0 : statuses.at(-1);
            }
            finally {
                for (const close of closing)
                    clearImmediate(close);
                for (const controller of controllers)
                    controller.abort(new PipelineClosed());
                await Promise.all(pipes.map((pipe) => pipe.abort()));
            }
        }
        return pipeline.negate ? Number(status === 0) : status;
    }
    async runCommandIsolated(command, state, io, fileShortcut = false) {
        try {
            return await this.command(command, state, io, fileShortcut);
        }
        catch (error) {
            if (error instanceof Flow && (error.kind === "exit" || error.kind === "return"))
                return error.status;
            throw error;
        }
    }
    async command(command, state, originalIO, fileShortcut = false) {
        originalIO = activeIO(originalIO);
        originalIO.descriptors ??= new Map([
            [0, { input: originalIO.stdin, ...(originalIO.stdinIsDefault === undefined ? {} : { stdinIsDefault: originalIO.stdinIsDefault }) }],
            [1, { output: originalIO.stdout }], [2, { output: originalIO.stderr }],
        ]);
        originalIO = { ...originalIO, diagnosticLine: (command.line ?? 1) + (originalIO.diagnosticOffset ?? 0) };
        if (command.kind === "subshell")
            originalIO = isolateIO(originalIO);
        this.budget.tick();
        if (this.budget.commands % 128 === 0)
            await interruptible(new Promise((resolve) => setImmediate(resolve)), this.signal);
        this.signal.throwIfAborted();
        const inputs = new Set();
        const outputs = new Set();
        let io = originalIO;
        try {
            if (command.kind === "function") {
                if (state.profile === "sh" && specialBuiltinNames.has(command.name)) {
                    await this.diagnostic(io, `\`${command.name}': is a special builtin`);
                    throw new Flow("exit", 2);
                }
                state.functions.set(command.name, command.body);
                return 0;
            }
            if (command.kind === "simple")
                return await this.simple(command, state, originalIO, inputs, outputs, fileShortcut);
            io = await this.redirect(command.redirects, state, io, inputs, outputs, command.kind === "subshell", command.kind !== "subshell");
            if (command.kind === "arithmetic") {
                try {
                    return Number(evaluateArithmetic(command.expression, this.arithmeticVariables(state)) === 0n);
                }
                catch (error) {
                    throw new Error(`((: ${message(error)}`);
                }
            }
            if (command.kind === "subshell") {
                const child = cloneState(state);
                child.isolated = true;
                child.loopDepth = 0;
                return await this.run(command.body, child, io);
            }
            if (command.kind === "group")
                return await this.script(command.body, state, io);
            if (command.kind === "if") {
                for (const branch of command.branches) {
                    if (await this.script(branch.condition, state, io) === 0)
                        return await this.script(branch.body, state, io);
                }
                return command.otherwise ? await this.script(command.otherwise, state, io) : 0;
            }
            if (command.kind === "case") {
                const subject = (await this.word(command.subject, state, io, false)).join("");
                const work = { remaining: this.budget.limits.maxExpansionBytes, signal: this.signal, exhausted: () => this.budget.fail("maxExpansionBytes") };
                let status = 0;
                let fallthrough = false;
                let patterns = 0;
                for (const clause of command.clauses) {
                    let matched = fallthrough;
                    if (!matched)
                        for (const word of clause.patterns) {
                            if (++patterns % 128 === 0)
                                await interruptible(new Promise((resolve) => setImmediate(resolve)), this.signal);
                            const pattern = (await this.word(word, state, io, false, true)).join("");
                            if (await matchesPattern(pattern, subject, work)) {
                                matched = true;
                                break;
                            }
                        }
                    if (!matched)
                        continue;
                    if (clause.body.lists.length)
                        status = await this.script(clause.body, state, io);
                    if (clause.terminator === ";;" || clause.terminator === "esac")
                        break;
                    fallthrough = clause.terminator === ";&";
                }
                return status;
            }
            let status = 0;
            state.loopDepth++;
            try {
                if (command.kind === "for") {
                    const values = command.words ? await this.words(command.words, state, io) : state.positional;
                    for (const value of values) {
                        this.budget.loop();
                        this.writeVariable(state, command.name, value);
                        const result = await this.loopBody(command.body, state, io);
                        status = result.status;
                        if (result.stop)
                            break;
                    }
                }
                else {
                    while (true) {
                        this.budget.loop();
                        const condition = await this.script(command.condition, state, io);
                        if ((condition === 0) !== (command.kind === "while"))
                            break;
                        const result = await this.loopBody(command.body, state, io);
                        status = result.status;
                        if (result.stop)
                            break;
                    }
                }
            }
            finally {
                state.loopDepth--;
            }
            return status;
        }
        catch (error) {
            const diagnostic = error instanceof ExecutionFailure ? error.diagnostic : undefined;
            if (error instanceof ExecutionFailure) {
                io = error.io;
                error = error.original;
            }
            this.signal.throwIfAborted();
            if (error instanceof Flow || error instanceof ShellLimitError || error instanceof ShellSyntaxError)
                throw error;
            if (error instanceof HereDocumentSyntaxError) {
                await writeText(io.stderr, error.diagnostic);
                return 1;
            }
            if (errorCode(error) === "EPIPE")
                return 141;
            const line = error instanceof ExpansionFailure ? error.line ?? io.diagnosticLine ?? 1 : io.diagnosticLine ?? 1;
            try {
                await writeText(io.stderr, `${io.scriptName ?? "shell"}: line ${line}: ${diagnostic ?? message(error)}\n`);
            }
            catch {
                this.signal.throwIfAborted();
            }
            if (error instanceof ExpansionFailure)
                throw new Flow("exit", error instanceof ParameterExpansionFailure && !state.isolated ? 127 : 1);
            if (error instanceof FatalCommandFailure)
                throw new Flow("exit", error.status);
            if (error instanceof CommandFailure)
                return error.status;
            return 1;
        }
        finally {
            for (const close of outputs)
                close();
            await Promise.all([...inputs].map((input) => input.close()));
        }
    }
    async loopBody(body, state, io) {
        try {
            return { status: await this.script(body, state, io), stop: false };
        }
        catch (error) {
            if (!(error instanceof Flow) || (error.kind !== "break" && error.kind !== "continue"))
                throw error;
            if (--error.levels > 0)
                throw error;
            return { status: 0, stop: error.kind === "break" };
        }
    }
    async document(document, state, io, line = document.endLine) {
        this.signal.throwIfAborted();
        let value = "";
        let size = 0;
        let words = 0;
        const warnings = [];
        try {
            for (const word of hereDocumentWords(document, line, byteLocale(state.variables), warnings)) {
                this.signal.throwIfAborted();
                for (const warning of warnings.splice(0))
                    await writeText(io.stderr, `shell: warning: ${warning}\n`);
                if (++words % 128 === 0)
                    await interruptible(new Promise((resolve) => setImmediate(resolve)), this.signal);
                const part = (await this.word(word, state, io, false)).join("");
                size += Buffer.byteLength(part);
                if (size > this.budget.limits.maxExpansionBytes)
                    this.budget.fail("maxExpansionBytes");
                value += part;
            }
        }
        finally {
            for (const warning of warnings.splice(0))
                await writeText(io.stderr, `shell: warning: ${warning}\n`);
        }
        return value;
    }
    async redirect(redirects, state, io, inputs, outputs, isolatedInlineInput = false, persistMoves = false, fileShortcut = false, line) {
        io.descriptors ??= new Map([
            [0, { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) }],
            [1, { output: io.stdout }], [2, { output: io.stderr }],
        ]);
        const inputDescriptor = io.descriptors.get(0);
        const outputDescriptor = io.descriptors.get(1);
        const errorDescriptor = io.descriptors.get(2);
        const descriptors = new Map([
            ...io.descriptors ?? [],
            [0, inputDescriptor?.input === io.stdin ? inputDescriptor : { input: io.stdin, ...(io.stdinIsDefault === undefined ? {} : { stdinIsDefault: io.stdinIsDefault }) }],
            [1, outputDescriptor?.output === io.stdout ? outputDescriptor : { output: io.stdout }],
            [2, errorDescriptor?.output === io.stderr ? errorDescriptor : { output: io.stderr }],
        ]);
        const replaced = new Set();
        let errorTarget;
        if (io.stdin === closedSource)
            descriptors.delete(0);
        if (io.stdout === closedSink)
            descriptors.delete(1);
        if (io.stderr === closedSink)
            descriptors.delete(2);
        const currentIO = () => {
            const descriptor = descriptors.get(0)?.closed ? undefined : descriptors.get(0);
            const stdinIsDefault = descriptor?.input ? descriptor.stdinIsDefault : false;
            return {
                ...(io.diagnosticLine === undefined ? {} : { diagnosticLine: io.diagnosticLine }),
                ...(io.diagnosticOffset === undefined ? {} : { diagnosticOffset: io.diagnosticOffset }),
                ...(io.scriptName === undefined ? {} : { scriptName: io.scriptName }),
                stdin: descriptor?.input ?? closedSource,
                ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
                stdout: descriptors.get(1)?.closed ? closedSink : descriptors.get(1)?.output ?? closedSink,
                stderr: descriptors.get(2)?.closed ? closedSink : descriptors.get(2)?.output ?? closedSink,
                descriptors,
            };
        };
        try {
            for (const redirect of redirects) {
                replaced.add(redirect.descriptor);
                if (redirect.document || redirect.operator === "<<<") {
                    const hereString = redirect.operator === "<<<";
                    let value;
                    try {
                        value = redirect.document ? await this.document(redirect.document, state, currentIO(), line) : (await this.word(redirect.target, state, currentIO(), false, false, hereString)).join("");
                    }
                    catch (error) {
                        if (error instanceof ParameterExpansionFailure && !isolatedInlineInput)
                            throw error;
                        if (error instanceof ParameterExpansionFailure)
                            throw new CommandFailure(error.message, state.isolated ? 1 : 127);
                        if (error instanceof ExpansionFailure)
                            throw new Error(error.message);
                        throw error;
                    }
                    if (hereString) {
                        if (Buffer.byteLength(value) >= this.budget.limits.maxExpansionBytes)
                            this.budget.fail("maxExpansionBytes");
                        value += "\n";
                    }
                    const input = new ShellInput(toByteSource(value), this.budget, this.signal);
                    inputs.add(input);
                    descriptors.set(redirect.descriptor, { input, stdinIsDefault: false });
                    continue;
                }
                const targets = await this.word(redirect.target, state, currentIO());
                if (targets.length !== 1)
                    throw new Error("Ambiguous redirect");
                const target = targets[0];
                errorTarget = target;
                if (redirect.operator.endsWith("&")) {
                    if (target === "-")
                        descriptors.delete(redirect.descriptor);
                    else {
                        if (!/^\d+-?$/u.test(target))
                            throw new Error(`${target}: Bad file descriptor`);
                        const move = target.endsWith("-");
                        if (move && !redirect.move)
                            throw new Error(`${target}: ambiguous redirect`);
                        const sourceDescriptor = Number(move ? target.slice(0, -1) : target);
                        const descriptor = descriptors.get(sourceDescriptor);
                        if (!descriptor || descriptor.closed || (!move && (redirect.operator === "<&" ? !descriptor.input : !descriptor.output)))
                            throw new Error(`${move ? sourceDescriptor : target}: Bad file descriptor`);
                        descriptors.set(redirect.descriptor, { ...descriptor });
                        if (move && sourceDescriptor !== redirect.descriptor) {
                            descriptors.delete(sourceDescriptor);
                            if (persistMoves && !replaced.has(sourceDescriptor))
                                descriptor.closed = true;
                        }
                    }
                }
                else {
                    const path = resolvePath(state.cwd, target);
                    const options = { signal: this.signal };
                    if (redirect.operator === "<") {
                        await interruptible(this.fs.access(path, 4, options), this.signal);
                        const stat = await interruptible(this.fs.stat(path, options), this.signal);
                        if (stat.type === "directory" && !fileShortcut)
                            throw new Error(`${target}: Is a directory`);
                        const source = stat.type === "directory" ? toByteSource("") : this.fs.readStream
                            ? this.fs.readStream(path, options)
                            : toByteSource(await interruptible(this.fs.readFile(path, { ...options, maxBytes: this.budget.limits.maxOutputBytes }), this.signal));
                        const input = new ShellInput(source, this.budget, this.signal);
                        inputs.add(input);
                        descriptors.set(redirect.descriptor, { input, stdinIsDefault: false });
                    }
                    else {
                        const append = redirect.operator === ">>";
                        let file;
                        await this.fileOperation(path, async () => {
                            await this.fs.writeFile(path, new Uint8Array(), { ...options, flag: append ? "a" : "w" });
                            file = this.outputFiles.get(path) ?? { data: undefined, references: 0 };
                            if (!append)
                                file.data = new Uint8Array();
                            file.references++;
                            this.outputFiles.set(path, file);
                        });
                        let closed = false;
                        outputs.add(() => {
                            closed = true;
                            if (--file.references === 0 && this.outputFiles.get(path) === file)
                                this.outputFiles.delete(path);
                        });
                        let offset = 0;
                        const output = this.budget.sink({ write: (chunk) => {
                                const copy = new Uint8Array(chunk);
                                return this.fileOperation(path, async () => {
                                    if (closed)
                                        throw new Error("Output descriptor is closed");
                                    const current = file.data;
                                    if (append) {
                                        await this.fs.appendFile(path, copy, options);
                                        if (current) {
                                            const bytes = new Uint8Array(current.length + copy.length);
                                            bytes.set(current);
                                            bytes.set(copy, current.length);
                                            file.data = bytes;
                                        }
                                    }
                                    else {
                                        const bytes = new Uint8Array(Math.max(current?.length ?? 0, offset + copy.length));
                                        if (current)
                                            bytes.set(current);
                                        bytes.set(copy, offset);
                                        await this.fs.writeFile(path, bytes, options);
                                        file.data = bytes;
                                        offset += copy.length;
                                    }
                                });
                            } }, this.signal);
                        descriptors.set(redirect.descriptor, { output });
                    }
                }
            }
        }
        catch (error) {
            const diagnostic = errorTarget === undefined ? undefined : filesystemDiagnostic(error, errorTarget);
            throw new ExecutionFailure(error, currentIO(), diagnostic);
        }
        return currentIO();
    }
    async fileOperation(path, operation) {
        const previous = this.fileWrites.get(path) ?? Promise.resolve();
        const pending = previous.catch(() => undefined).then(() => { this.signal.throwIfAborted(); return operation(); });
        this.fileWrites.set(path, pending);
        try {
            await interruptible(pending, this.signal);
        }
        finally {
            if (this.fileWrites.get(path) === pending)
                this.fileWrites.delete(path);
        }
    }
    assignment(word) {
        const first = word.parts[0];
        if (first?.kind !== "text" || first.quoted)
            return undefined;
        const match = /^([a-zA-Z_][a-zA-Z_0-9]*)=/u.exec(first.value);
        if (!match)
            return undefined;
        return { name: match[1], value: { offset: word.offset, parts: [{ ...first, value: first.value.slice(match[0].length) }, ...word.parts.slice(1)] } };
    }
    async simple(command, state, originalIO, inputs, outputs, fileShortcut = false) {
        state.substitutionStatus = 0;
        const assignments = [];
        let wordIndex = 0;
        for (; wordIndex < command.words.length; wordIndex++) {
            const assignment = this.assignment(command.words[wordIndex]);
            if (!assignment)
                break;
            assignments.push(assignment);
        }
        const commandWords = command.words.slice(wordIndex);
        let declarationIndex = 0;
        while (commandWords[declarationIndex]?.plain === "command") {
            declarationIndex++;
            if (commandWords[declarationIndex]?.plain === "--")
                declarationIndex++;
        }
        const words = await this.words(commandWords, state, originalIO, ["export", "local", "readonly"].includes(commandWords[declarationIndex]?.plain ?? ""));
        const special = state.profile === "sh" && specialBuiltinNames.has(words[0] ?? "");
        const inlineInput = command.redirects.some((redirect) => redirect.document || redirect.operator === "<<<");
        const functionCommand = words.length > 0 && state.functions.has(words[0]);
        const isolatedInlineInput = inlineInput && words.length > 0 && !shellBuiltinNames.has(words[0]) && !functionCommand;
        if (isolatedInlineInput)
            state = cloneState(state);
        let io = originalIO;
        const previous = new Map();
        const assign = async () => {
            for (const assignment of assignments) {
                const value = (await this.word(assignment.value, state, io, false)).join("");
                if (state.readonlyVariables?.has(assignment.name)) {
                    await this.diagnostic(io, `${assignment.name}: readonly variable`);
                    if (state.profile === "sh" || !words.length)
                        throw new Flow("exit", state.profile === "sh" && (special || !words.length) ? 127 : 1);
                    continue;
                }
                if (!previous.has(assignment.name))
                    previous.set(assignment.name, { value: state.variables[assignment.name], exported: state.exported.has(assignment.name) });
                state.variables[assignment.name] = value;
                if (words.length)
                    state.exported.add(assignment.name);
            }
        };
        try {
            if (inlineInput || (state.profile === "sh" || !words.length) && assignments.some(assignment => state.readonlyVariables?.has(assignment.name)))
                await assign();
            if (inlineInput && functionCommand && previous.size) {
                const variables = Object.assign(Object.create(null), state.variables);
                const redirectAssignments = new Map();
                for (const [name, saved] of previous) {
                    redirectAssignments.set(name, state.variables[name]);
                    if (saved.value === undefined)
                        delete variables[name];
                    else
                        variables[name] = saved.value;
                }
                const redirectState = { ...state, variables, redirectAssignments };
                try {
                    io = await this.redirect(command.redirects, redirectState, io, inputs, outputs, false, true, false, command.line ?? 1);
                }
                finally {
                    state.substitutionStatus = redirectState.substitutionStatus;
                    for (const [name, value] of Object.entries(variables)) {
                        if (!previous.has(name))
                            state.variables[name] = value;
                    }
                    for (const [name, saved] of previous)
                        saved.value = variables[name];
                }
            }
            else
                io = await this.redirect(command.redirects, state, io, inputs, outputs, isolatedInlineInput, !words.length || shellBuiltinNames.has(words[0]) || functionCommand, fileShortcut, command.line ?? 1);
            if (!inlineInput)
                await assign();
            if (fileShortcut) {
                const input = io.descriptors?.get(command.redirects[0].descriptor)?.input;
                if (!input)
                    throw new Error("Bad file descriptor");
                await pipeBytes(input, io.stdout, this.signal);
                return 0;
            }
            return words.length ? await this.dispatch(words[0], words.slice(1), state, io, previous) : state.substitutionStatus;
        }
        catch (error) {
            if (error instanceof Flow)
                throw error;
            this.signal.throwIfAborted();
            const original = error instanceof ExecutionFailure ? error.original : error;
            if (special && !(original instanceof ShellLimitError) && !(original instanceof ExpansionFailure) && !(original instanceof Flow) && !(original instanceof ShellSyntaxError)) {
                throw new ExecutionFailure(new FatalCommandFailure(message(original), 1), error instanceof ExecutionFailure ? error.io : io, error instanceof ExecutionFailure ? error.diagnostic : undefined);
            }
            if (error instanceof ExecutionFailure)
                throw error;
            throw new ExecutionFailure(error, io);
        }
        finally {
            if (words.length)
                for (const [key, saved] of previous) {
                    if (saved.value === undefined)
                        delete state.variables[key];
                    else
                        state.variables[key] = saved.value;
                    if (saved.exported)
                        state.exported.add(key);
                    else
                        state.exported.delete(key);
                }
        }
    }
    async dispatch(name, args, state, io, assignments, bypassFunctions = false) {
        let builtinFailure;
        const env = Object.create(null);
        for (const key of state.exported) {
            const value = state.variables[key];
            if (value !== undefined)
                env[key] = value;
        }
        const initialEnv = { ...env };
        const context = {
            ...io, command: name, args, env, cwd: state.cwd, fs: this.fs, signal: this.signal,
            invoke: (name, args, options) => this.invoke(name, args, options, context, state),
        };
        const execute = composeMiddleware(this.middleware, async (context) => {
            const previous = new Map();
            const cwd = state.cwd;
            state.cwd = resolvePath("/", context.cwd);
            for (const key of new Set([...Object.keys(initialEnv), ...Object.keys(context.env)])) {
                if (initialEnv[key] === context.env[key])
                    continue;
                const value = context.env[key];
                if (key.includes("\0") || key.includes("=") || (value !== undefined && (typeof value !== "string" || value.includes("\0"))))
                    throw new TypeError("Invalid middleware environment value");
                previous.set(key, { value: state.variables[key], exported: state.exported.has(key), overlay: value });
                if (value === undefined) {
                    delete state.variables[key];
                    state.exported.delete(key);
                }
                else {
                    state.variables[key] = value;
                    state.exported.add(key);
                }
            }
            try {
                const selected = this.internalDiscovery(context.command, state, bypassFunctions)[0];
                const body = selected?.kind === "function" ? state.functions.get(context.command) : undefined;
                if (body) {
                    if (state.depth >= this.budget.limits.maxSubstitutionDepth)
                        this.budget.fail("maxSubstitutionDepth");
                    const positional = state.positional;
                    const positionalSetVersion = state.positionalSetVersion ?? 0;
                    state.positional = [...context.args];
                    state.functionDepth++;
                    state.depth++;
                    const locals = new Map();
                    state.locals.push(locals);
                    try {
                        return { exitCode: await this.command(body, state, context) };
                    }
                    catch (error) {
                        if (error instanceof Flow && error.kind === "return")
                            return { exitCode: error.status };
                        throw error;
                    }
                    finally {
                        state.positional = positional;
                        state.positionalSetVersion = positionalSetVersion;
                        state.functionDepth--;
                        state.depth--;
                        state.locals.pop();
                        for (const [name, previous] of locals) {
                            if (previous.value === undefined)
                                delete state.variables[name];
                            else
                                state.variables[name] = previous.value;
                            if (previous.exported)
                                state.exported.add(name);
                            else
                                state.exported.delete(name);
                            if (!previous.readOnly)
                                state.readonlyVariables?.delete(name);
                        }
                    }
                }
                if (selected?.kind === "builtin") {
                    if (context.command === "command" || context.command === "type")
                        return { exitCode: await this.discoveryBuiltin(context, state, io, assignments) };
                    const special = state.profile === "sh" && !bypassFunctions && specialBuiltinNames.has(context.command);
                    if (special)
                        assignments.clear();
                    if (context.command === "." || context.command === "source")
                        return { exitCode: await this.sourceBuiltin(context, state, { ...io, ...context }, special) };
                    if (context.command === "eval")
                        return { exitCode: await this.evalBuiltin(context, state, { ...io, ...context }, special) };
                    const builtin = await this.builtin(context, state, assignments, (error, diagnostic) => { builtinFailure = { error, diagnostic }; }, bypassFunctions);
                    if (builtin !== undefined) {
                        if (special && builtin !== 0 && context.command !== "shift")
                            throw new Flow("exit", builtin);
                        return { exitCode: builtin };
                    }
                }
                const definition = this.commands.get(context.command);
                if (!definition) {
                    if (context.command === "bash" || context.command === "sh")
                        return { exitCode: await this.interpreter(context, state, io) };
                    if (context.command.includes("/") || state.variables.PATH === undefined && state.pathUnset)
                        return { exitCode: await this.scriptFile(context, state, io, context.command, context.args, true) };
                    const target = await this.searchPath(context.command, state);
                    if (target !== undefined)
                        return { exitCode: await this.scriptFile(context, state, io, target, context.args, true) };
                    await this.diagnostic({ ...io, ...context }, `${context.command}: command not found`);
                    return { exitCode: 127 };
                }
                return await definition.execute(context);
            }
            finally {
                if (context.command !== "cd" && state.cwd === context.cwd)
                    state.cwd = cwd;
                for (const [key, saved] of previous) {
                    if (state.variables[key] !== saved.overlay)
                        continue;
                    if (saved.value === undefined)
                        delete state.variables[key];
                    else
                        state.variables[key] = saved.value;
                    if (saved.exported)
                        state.exported.add(key);
                    else
                        state.exported.delete(key);
                }
            }
        });
        try {
            return validateExitCode((await interruptible(execute(context), this.signal)).exitCode);
        }
        catch (error) {
            if (builtinFailure && error === builtinFailure.error)
                throw new ExecutionFailure(error, io, builtinFailure.diagnostic);
            throw error;
        }
    }
    internalDiscovery(name, state, bypassFunctions = false) {
        const matches = [];
        if (!bypassFunctions && state.functions.has(name))
            matches.push({ kind: "function", name });
        if (implementedBuiltins.has(name))
            matches.push({ kind: "builtin", name });
        else if (this.commands.has(name))
            matches.push({ kind: "command", name });
        else if (name === "bash" || name === "sh")
            matches.push({ kind: "interpreter", name });
        if (state.profile === "sh" && specialBuiltinNames.has(name))
            matches.sort((left, right) => Number(right.kind === "builtin") - Number(left.kind === "builtin"));
        return matches;
    }
    async discoveryBuiltin(context, state, io, assignments) {
        const args = [...context.args];
        const command = context.command === "command";
        let mode = "describe";
        let discover = !command;
        let all = false;
        let skipFunctions = false;
        let forcePath = false;
        while (args[0]?.startsWith("-") && args[0] !== "-") {
            const option = args.shift();
            if (option === "--")
                break;
            for (const flag of option.slice(1)) {
                if (command && (flag === "v" || flag === "V")) {
                    discover = true;
                    mode = flag === "v" ? "name" : "describe";
                }
                else if (!command && flag === "a")
                    all = true;
                else if (!command && flag === "f")
                    skipFunctions = true;
                else if (!command && flag === "t")
                    mode = "kind";
                else if (!command && (flag === "p" || flag === "P")) {
                    mode = "path";
                    if (flag === "P")
                        forcePath = true;
                }
                else {
                    if (command && flag !== "p") {
                        await this.diagnostic({ ...io, ...context }, `command: -${flag}: invalid option`);
                        await writeText(context.stderr, "command: usage: command [-pVv] command [arg ...]\n");
                    }
                    else
                        await writeText(context.stderr, `${context.command}: ${option}: unsupported option\n`);
                    return 2;
                }
            }
        }
        if (!discover) {
            const target = args.shift();
            if (target === undefined)
                return 0;
            this.budget.tick();
            if (state.depth >= this.budget.limits.maxSubstitutionDepth)
                this.budget.fail("maxSubstitutionDepth");
            state.depth++;
            try {
                return await this.dispatch(target, args, state, { ...io, ...context }, assignments, true);
            }
            finally {
                state.depth--;
            }
        }
        let found = 0;
        for (const name of args) {
            this.signal.throwIfAborted();
            let matches = forcePath || all && mode === "path" ? [] : this.internalDiscovery(name, state, skipFunctions);
            if (!all)
                matches = matches.slice(0, 1);
            if (all || !matches.length) {
                const paths = await this.searchPaths(name, state, all, true);
                matches.push(...paths.map(path => {
                    const absolute = command && mode === "describe";
                    if ((absolute || state.profile === "sh") && !name.includes("/") && !path.startsWith("/")) {
                        const relative = absolute && path.startsWith("./") ? path.slice(2) : path;
                        path = `${state.cwd === "/" ? "" : state.cwd}/${relative}`;
                    }
                    return { kind: "file", name: path };
                }));
            }
            if (!matches.length) {
                if (mode === "describe")
                    await writeText(context.stderr, `${io.scriptName ?? "shell"}: line ${io.diagnosticLine ?? 1}: ${context.command}: ${name}: not found\n`);
                continue;
            }
            found++;
            for (const match of matches) {
                if (mode === "path" && match.kind !== "file")
                    continue;
                let text;
                if (mode === "kind")
                    text = `${match.kind}\n`;
                else if (mode === "name" || mode === "path")
                    text = `${match.name}\n`;
                else if (match.kind === "function")
                    text = `${name} is a function\n${functionDisplay(name, state.functions.get(name))}`;
                else
                    text = `${name} is ${match.kind === "builtin" ? "a shell builtin" : match.kind === "command" ? "a registered command" : match.kind === "interpreter" ? "a virtual shell interpreter" : match.name}\n`;
                await writeText(context.stdout, text);
            }
        }
        return (command ? found > 0 || args.length === 0 : found === args.length) ? 0 : 1;
    }
    async searchPath(name, state) {
        return (await this.searchPaths(name, state))[0];
    }
    async searchPaths(name, state, all = false, discovery = false) {
        if (!name)
            return [];
        const path = state.variables.PATH;
        if (path !== undefined && Buffer.byteLength(path) > this.budget.limits.maxExpansionBytes)
            this.budget.fail("maxExpansionBytes");
        const components = name.includes("/") || path === undefined ? [undefined] : path.split(":");
        if (components.length > this.budget.limits.maxExpansionFields)
            this.budget.fail("maxExpansionFields");
        let denied;
        const matches = [];
        for (const component of components) {
            this.signal.throwIfAborted();
            const target = component === undefined ? name : `${component || "."}${component?.endsWith("/") ? "" : "/"}${name}`;
            const resolved = resolvePath(state.cwd, target);
            try {
                const options = { signal: this.signal };
                if ((await interruptible(this.fs.stat(resolved, options), this.signal)).type !== "file")
                    continue;
                if (this.fs.capabilities.permissions !== true)
                    throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
                await interruptible(this.fs.access(resolved, ACCESS_MODES.X_OK, options), this.signal);
                matches.push(target);
                if (!all)
                    return matches;
            }
            catch (error) {
                this.signal.throwIfAborted();
                if (error instanceof CommandFailure) {
                    if (discovery)
                        continue;
                    throw error;
                }
                const code = errorCode(error);
                if (code === "ENOENT" || code === "ENOTDIR")
                    continue;
                if (code !== "EACCES" && code !== "EPERM")
                    throw new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, 126);
                denied ??= new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, 126);
            }
        }
        if (denied && !matches.length && !discovery)
            throw denied;
        return matches;
    }
    processState(context, state, arg0, args) {
        if (state.depth >= this.budget.limits.maxSubstitutionDepth)
            this.budget.fail("maxSubstitutionDepth");
        const variables = Object.assign(Object.create(null), context.env, { PWD: state.cwd });
        return {
            cwd: state.cwd, variables, exported: new Set(Object.keys(variables)), functions: new Map(),
            positional: [...args], arg0, profile: context.command === "sh" ? "sh" : "bash", status: 0, substitutionStatus: 0, depth: state.depth + 1,
            loopDepth: 0, functionDepth: 0, locals: [], pipefail: false, isolated: true,
        };
    }
    async interpreter(context, state, io) {
        const args = [...context.args];
        let commandString = false;
        let standardInput = false;
        while (args.length && /^[+-]/u.test(args[0])) {
            const option = args.shift();
            if (option === "--" || option === "-")
                break;
            if (!/^-[cs]+$/u.test(option)) {
                await writeText(context.stderr, `${context.command}: ${option}: unsupported option; supported flags are -c and -s\n`);
                return 2;
            }
            commandString ||= option.includes("c");
            standardInput ||= option.includes("s");
        }
        if (!commandString && !standardInput && args.length)
            return this.scriptFile(context, state, io, args[0], args.slice(1), false);
        const source = commandString ? args.shift() : undefined;
        if (commandString && source === undefined) {
            await writeText(context.stderr, `${context.command}: -c: option requires an argument\n`);
            return 2;
        }
        const arg0 = commandString ? args.shift() ?? context.command : context.command;
        const child = this.processState(context, state, arg0, args);
        const childIO = isolateIO({ ...io, ...context, diagnosticLine: 1, diagnosticOffset: 0, scriptName: arg0 });
        if (source !== undefined) {
            this.budget.source(Buffer.byteLength(source));
            return this.runCommandString(source, child, childIO);
        }
        const input = new ShellInput(context.stdin, this.budget, this.signal);
        return this.runStandardInput(input, child, { ...childIO, stdin: input });
    }
    async syntaxFailure(error, source, io, commandString) {
        const offset = io.diagnosticOffset ?? 0;
        const line = source.slice(0, error.offset).split("\n").length;
        const prefix = `${io.scriptName ?? "shell"}:${commandString ? " -c:" : ""}`;
        if (error.unclosedQuote)
            await writeText(io.stderr, `${prefix} line ${offset + error.unclosedQuote.line}: unexpected EOF while looking for matching \`${error.unclosedQuote.quote}'\n`);
        else if (error.offset >= source.length && !/Unterminated|nesting|Unsupported/u.test(error.reason)) {
            const context = error.incompleteCommand ? ` from \`${error.incompleteCommand.name}' command on line ${offset + error.incompleteCommand.line}` : "";
            await writeText(io.stderr, `${prefix} line ${offset + source.split("\n").length + Number(!source.endsWith("\n"))}: syntax error: unexpected end of file${context}\n`);
        }
        else {
            const token = /^[;&|()<>]|^[^\s;&|()<>]+/u.exec(source.slice(error.offset))?.[0] ?? "newline";
            await writeText(io.stderr, `${prefix} line ${offset + line}: syntax error near unexpected token \`${token}'\n${prefix} line ${offset + line}: \`${source.split("\n")[line - 1] ?? ""}'\n`);
        }
        return error.exitCode;
    }
    async runCommandString(source, state, io) {
        let position = 0;
        let status = 0;
        try {
            do {
                this.signal.throwIfAborted();
                const unit = parseShellUnit(source, position, byteLocale(state.variables));
                for (const warning of unit.script.warnings ?? [])
                    await writeText(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
                if (unit.script.lists.length) {
                    const result = await this.runUnit(unit.script, state, io);
                    status = result.exitCode;
                    if (result.terminated)
                        return status;
                }
                position = unit.next;
            } while (position < source.length);
            return status;
        }
        catch (error) {
            if (!(error instanceof ShellSyntaxError))
                throw error;
            return this.syntaxFailure(error, source, io, true);
        }
    }
    sourceText(bytes, name) {
        if (bytes.some(byte => byte < 9 || byte > 10 && byte < 13 || byte > 13 && byte < 32 || byte === 127))
            throw new CommandFailure(`${name}: cannot execute binary script`, 126);
        try {
            return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        }
        catch {
            throw new CommandFailure(`${name}: cannot execute binary or non-UTF-8 script`, 126);
        }
    }
    async runStandardInput(input, state, io) {
        let source = "";
        let offset = 0;
        let status = 0;
        let lines = 0;
        while (true) {
            if (++lines % 32 === 0)
                await interruptible(new Promise(resolve => setImmediate(resolve)), this.signal);
            this.signal.throwIfAborted();
            const bytes = await input.sourceLine();
            const eof = bytes === undefined;
            if (bytes)
                source += this.sourceText(bytes, io.scriptName ?? "shell");
            const unitIO = { ...io, diagnosticOffset: offset };
            try {
                const unit = eof ? parseShellUnit(source, 0, byteLocale(state.variables)) : parseShellInputUnit(source, byteLocale(state.variables));
                if (unit) {
                    for (const warning of unit.script.warnings ?? [])
                        await writeText(io.stderr, `${io.scriptName}: warning: ${warning}\n`);
                    if (unit.script.lists.length) {
                        const result = await this.runUnit(unit.script, state, unitIO);
                        status = result.exitCode;
                        if (result.terminated)
                            return status;
                    }
                    offset += source.slice(0, unit.next).split("\n").length - 1;
                    source = source.slice(unit.next);
                }
            }
            catch (error) {
                if (!(error instanceof ShellSyntaxError))
                    throw error;
                return this.syntaxFailure(error, source, unitIO, false);
            }
            if (eof)
                return status;
        }
    }
    async scriptFile(context, state, io, target, args, direct) {
        if (target === "")
            throw new CommandFailure(`${context.command}: : No such file or directory`, 127);
        if (state.depth >= this.budget.limits.maxSubstitutionDepth)
            this.budget.fail("maxSubstitutionDepth");
        const path = resolvePath(state.cwd, target);
        let source;
        try {
            const options = { signal: this.signal };
            const stat = await interruptible(this.fs.stat(path, options), this.signal);
            if (stat.type !== "file")
                throw new CommandFailure(`${target}: ${stat.type === "directory" ? "Is a directory" : "not a regular file"}`, 126);
            if (direct && this.fs.capabilities.permissions !== true)
                throw new CommandFailure(`${target}: execution permissions are not supported by this filesystem`, 126);
            await interruptible(this.fs.access(path, ACCESS_MODES.R_OK | (direct ? ACCESS_MODES.X_OK : 0), options), this.signal);
            const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
            if (stat.size > maxBytes)
                this.budget.fail("maxSourceBytes");
            const bytes = await interruptible(this.fs.readFile(path, { ...options, maxBytes }), this.signal);
            this.budget.source(bytes.byteLength);
            source = this.sourceText(bytes, target);
            if (source.startsWith("#!")) {
                const interpreter = source.split("\n", 1)[0].slice(2).replace(/^[ \t]+|[ \t]+$/gu, "");
                if (interpreter !== "/bin/bash" && interpreter !== "/usr/bin/bash")
                    throw new CommandFailure(`${target}: unsupported interpreter: ${interpreter}`, 126);
            }
            else if (direct)
                throw new CommandFailure(`${target}: direct execution requires a supported Bash shebang`, 126);
        }
        catch (error) {
            this.signal.throwIfAborted();
            if (error instanceof ShellLimitError || error instanceof CommandFailure)
                throw error;
            if (errorCode(error) === "EFBIG")
                this.budget.fail("maxSourceBytes");
            throw new CommandFailure(filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`, errorCode(error) === "ENOENT" ? 127 : 126);
        }
        const units = [];
        try {
            let position = 0;
            do {
                this.signal.throwIfAborted();
                const unit = parseShellUnit(source, position, byteLocale(context.env));
                units.push(unit.script);
                position = unit.next;
            } while (position < source.length);
        }
        catch (error) {
            if (!(error instanceof ShellSyntaxError))
                throw error;
            const line = source.slice(0, error.offset).split("\n").length;
            await writeText(context.stderr, `${target}: line ${line}: syntax error: ${error.reason}\n`);
            return error.exitCode;
        }
        const child = this.processState(context, state, target, args);
        const childIO = isolateIO({ ...io, ...context, diagnosticLine: 1, diagnosticOffset: 0, scriptName: target });
        let status = 0;
        for (const unit of units) {
            for (const warning of unit.warnings ?? [])
                await writeText(context.stderr, `${target}: warning: ${warning}\n`);
            if (!unit.lists.length)
                continue;
            const result = await this.runUnit(unit, child, childIO);
            status = result.exitCode;
            if (result.terminated)
                break;
        }
        return status;
    }
    async runCurrentText(source, state, io, fatalSyntax, syntaxName) {
        let position = 0;
        let status = 0;
        let executed = false;
        try {
            do {
                this.signal.throwIfAborted();
                const unit = parseShellUnit(source, position, byteLocale(state.variables));
                for (const warning of unit.script.warnings ?? [])
                    await writeText(io.stderr, `${io.scriptName ?? "shell"}: warning: ${warning}\n`);
                if (unit.script.lists.length) {
                    status = await this.script(unit.script, state, io);
                    executed = true;
                }
                position = unit.next;
            } while (position < source.length);
            return status;
        }
        catch (error) {
            if (!(error instanceof ShellSyntaxError))
                throw error;
            const status = await this.syntaxFailure(error, source, syntaxName === undefined ? io : { ...io, scriptName: syntaxName }, false);
            if (fatalSyntax && !executed)
                throw new Flow("exit", status);
            return status;
        }
    }
    async evalBuiltin(context, state, io, special) {
        const args = [...context.args];
        if (args[0] === "--")
            args.shift();
        else if (args[0]?.startsWith("-") && args[0] !== "-") {
            await this.diagnostic(io, `eval: -${args[0][1]}: invalid option`);
            await writeText(io.stderr, "eval: usage: eval [arg ...]\n");
            if (special)
                throw new Flow("exit", 2);
            return 2;
        }
        if (!args.length)
            return 0;
        if (state.depth >= this.budget.limits.maxSubstitutionDepth)
            this.budget.fail("maxSubstitutionDepth");
        const source = args.join(" ");
        this.budget.source(Buffer.byteLength(source));
        this.sourceText(Buffer.from(source), "eval");
        state.depth++;
        try {
            return await this.runCurrentText(source, state, { ...io, diagnosticOffset: (io.diagnosticLine ?? 1) - 1 }, special, `${io.scriptName ?? "shell"}: eval`);
        }
        finally {
            state.depth--;
        }
    }
    async sourceBuiltin(context, state, io, special) {
        const args = [...context.args];
        if (args[0] === "--")
            args.shift();
        else if (args[0]?.startsWith("-") && args[0] !== "-") {
            await this.diagnostic(io, `${context.command}: ${args[0]}: unsupported option`);
            if (special)
                throw new Flow("exit", 2);
            return 2;
        }
        const filename = args.shift();
        if (filename === undefined) {
            await this.diagnostic(io, `${context.command}: filename argument required`);
            await writeText(io.stderr, `${context.command}: usage: ${context.command} [-p path] filename [arguments]\n`);
            if (special)
                throw new Flow("exit", 2);
            return 2;
        }
        if (state.depth >= this.budget.limits.maxSubstitutionDepth)
            this.budget.fail("maxSubstitutionDepth");
        let target = filename;
        let source;
        try {
            const options = { signal: this.signal };
            if (filename && !filename.includes("/") && state.variables.PATH) {
                if (Buffer.byteLength(state.variables.PATH) > this.budget.limits.maxExpansionBytes)
                    this.budget.fail("maxExpansionBytes");
                const components = state.variables.PATH.split(":");
                if (components.length > this.budget.limits.maxExpansionFields)
                    this.budget.fail("maxExpansionFields");
                let found = false;
                for (const component of components) {
                    this.signal.throwIfAborted();
                    const candidate = `${component || "."}${component.endsWith("/") ? "" : "/"}${filename}`;
                    const path = resolvePath(state.cwd, candidate);
                    try {
                        if ((await interruptible(this.fs.stat(path, options), this.signal)).type !== "file")
                            continue;
                        await interruptible(this.fs.access(path, ACCESS_MODES.R_OK, options), this.signal);
                        target = candidate;
                        found = true;
                        break;
                    }
                    catch (error) {
                        this.signal.throwIfAborted();
                        if (!["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(errorCode(error) ?? ""))
                            throw error;
                    }
                }
                if (!found && state.profile === "sh")
                    throw new CommandFailure(`${context.command}: ${filename}: file not found`, 1);
            }
            if (!filename)
                throw new CommandFailure(": No such file or directory", 1);
            const path = resolvePath(state.cwd, target);
            const stat = await interruptible(this.fs.stat(path, options), this.signal);
            if (stat.type === "directory")
                throw new CommandFailure(`${context.command}: ${target}: is a directory`, 1);
            if (stat.type !== "file")
                throw new CommandFailure(`${target}: not a regular file`, 1);
            await interruptible(this.fs.access(path, ACCESS_MODES.R_OK, options), this.signal);
            const maxBytes = this.budget.limits.maxSourceBytes - this.budget.sourceBytes;
            if (stat.size > maxBytes)
                this.budget.fail("maxSourceBytes");
            const bytes = await interruptible(this.fs.readFile(path, { ...options, maxBytes }), this.signal);
            this.budget.source(bytes.byteLength);
            source = this.sourceText(bytes, target);
        }
        catch (error) {
            this.signal.throwIfAborted();
            if (error instanceof ShellLimitError)
                throw error;
            if (errorCode(error) === "EFBIG")
                this.budget.fail("maxSourceBytes");
            const diagnostic = error instanceof CommandFailure ? error.message : filesystemDiagnostic(error, target) ?? `${target}: ${message(error)}`;
            if (special)
                throw new FatalCommandFailure(diagnostic, 1);
            throw new CommandFailure(diagnostic, error instanceof CommandFailure ? error.status : 1);
        }
        const positional = state.positional;
        const version = state.positionalSetVersion ?? 0;
        if (args.length)
            state.positional = args;
        state.sourceDepth = (state.sourceDepth ?? 0) + 1;
        state.depth++;
        try {
            return await this.runCurrentText(source, state, { ...io, scriptName: target, diagnosticOffset: 0, diagnosticLine: 1 }, special);
        }
        catch (error) {
            if (error instanceof Flow && error.kind === "return")
                return error.status;
            throw error;
        }
        finally {
            state.depth--;
            state.sourceDepth--;
            if (args.length && (state.functionDepth > 0 || (state.positionalSetVersion ?? 0) === version)) {
                state.positional = positional;
                state.positionalSetVersion = version;
            }
        }
    }
    async invoke(name, args, options = {}, context, state) {
        this.signal.throwIfAborted();
        if (typeof name !== "string" || name.includes("\0") || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0")))
            throw new TypeError("invoke requires a command and literal string arguments without NUL");
        if (state.depth >= this.budget.limits.maxSubstitutionDepth)
            this.budget.fail("maxSubstitutionDepth");
        const child = cloneState(state);
        child.cwd = resolvePath(context.cwd, options.cwd ?? ".");
        for (const key of child.exported)
            delete child.variables[key];
        const env = { ...context.env, ...options.env, PWD: child.cwd };
        for (const [key, value] of Object.entries(env)) {
            if (key.includes("\0") || key.includes("=") || typeof value !== "string" || value.includes("\0"))
                throw new TypeError("Invalid invoke environment entry");
            child.variables[key] = value;
        }
        child.exported = new Set(Object.keys(env));
        child.depth++;
        child.loopDepth = 0;
        child.functionDepth = 0;
        child.sourceDepth = 0;
        child.locals = [];
        const input = options.stdin === undefined ? undefined : new ShellInput(options.stdin, this.budget, this.signal);
        const stdinIsDefault = options.stdin === undefined ? context.stdinIsDefault : (options.stdinIsDefault ?? false);
        const io = {
            ...context,
            stdin: input ?? context.stdin,
            ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
            stdout: options.stdout ? this.budget.sink(options.stdout, this.signal) : context.stdout,
            stderr: options.stderr ? this.budget.sink(options.stderr, this.signal) : context.stderr,
        };
        const command = {
            kind: "simple", redirects: [],
            words: [name, ...args].map((value) => ({ offset: 0, parts: [{ kind: "text", value, quoted: true }] })),
        };
        try {
            return { exitCode: await this.runCommandIsolated(command, child, io) };
        }
        finally {
            await input?.close();
        }
    }
    async builtin(context, state, assignments, diagnose, suppressSpecial = false) {
        const { command, args, stdout, stderr } = context;
        if (command === ":" || command === "true")
            return 0;
        if (command === "false")
            return 1;
        if (command === "pwd") {
            if (args.some((arg) => arg !== "-L" && arg !== "-P")) {
                await writeText(stderr, "pwd: invalid option\n");
                return 2;
            }
            const path = args.at(-1) === "-P" ? await this.fs.realpath(state.cwd, { signal: this.signal }) : state.cwd;
            await writeText(stdout, `${path}\n`);
            return 0;
        }
        if (command === "cd") {
            if (args.length > 1) {
                await writeText(stderr, "cd: too many arguments\n");
                return 1;
            }
            const target = args[0] === "-" ? state.variables.OLDPWD : (args[0] ?? state.variables.HOME);
            if (target === undefined) {
                await writeText(stderr, `cd: ${args[0] === "-" ? "OLDPWD" : "HOME"} not set\n`);
                return 1;
            }
            const path = resolvePath(state.cwd, target || ".");
            try {
                if ((await this.fs.stat(path, { signal: this.signal })).type !== "directory")
                    throw new Error(`cd: ${target}: Not a directory`);
            }
            catch (error) {
                const diagnostic = filesystemDiagnostic(error, `cd: ${target}`);
                if (diagnostic)
                    diagnose?.(error, diagnostic);
                throw error;
            }
            this.writeVariable(state, "OLDPWD", state.cwd);
            state.cwd = path;
            this.writeVariable(state, "PWD", path);
            state.exported.add("PWD");
            state.exported.add("OLDPWD");
            if (args[0] === "-")
                await writeText(stdout, `${path}\n`);
            return 0;
        }
        if (command === "set") {
            if (args[0] === "--") {
                state.positional = args.slice(1);
                state.positionalSetVersion = (state.positionalSetVersion ?? 0) + 1;
                return 0;
            }
            if (args.length === 2 && (args[0] === "-o" || args[0] === "+o") && args[1] === "pipefail") {
                state.pipefail = args[0] === "-o";
                return 0;
            }
            if (args.some((arg) => /^[+-]/u.test(arg))) {
                await writeText(stderr, "set: unsupported shell option; supported forms are -- arguments, -o pipefail, +o pipefail\n");
                if (state.profile === "sh" && suppressSpecial)
                    return 2;
                throw new Flow("exit", 2);
            }
            await writeText(stderr, "set: supported forms are -- arguments, -o pipefail, +o pipefail\n");
            return 2;
        }
        if (command === "shift") {
            const count = args[0] === undefined ? 1 : Number(args[0]);
            if (args.length > 1 || !Number.isSafeInteger(count) || count < 0 || count > state.positional.length)
                return 1;
            state.positional = state.positional.slice(count);
            return 0;
        }
        if (command === "export" || command === "local" || command === "readonly") {
            const declarationArgs = [...args];
            if (command === "readonly") {
                while (declarationArgs[0]?.startsWith("-")) {
                    const option = declarationArgs.shift();
                    if (option === "--")
                        break;
                    if (option !== "-p") {
                        await writeText(stderr, `readonly: ${option}: unsupported option\n`);
                        return 2;
                    }
                }
            }
            const locals = state.locals.at(-1);
            if (command === "local" && !locals) {
                await writeText(stderr, "local: not in a function\n");
                return 1;
            }
            let status = 0;
            if (!declarationArgs.length) {
                const names = command === "readonly" ? state.readonlyVariables ?? [] : state.exported;
                const prefix = state.profile === "sh" ? command : command === "readonly" ? "declare -r" : "declare -x";
                for (const name of [...names].sort())
                    await writeText(stdout, `${prefix} ${name}=${JSON.stringify(state.variables[name] ?? "")}\n`);
            }
            for (const arg of declarationArgs) {
                const match = /^([a-zA-Z_][a-zA-Z_0-9]*)(?:=(.*))?$/su.exec(arg);
                if (!match) {
                    await this.diagnostic(context, `${command}: \`${arg}': not a valid identifier`);
                    status = 1;
                    continue;
                }
                const name = match[1];
                if (state.readonlyVariables?.has(name) && (match[2] !== undefined || command === "local")) {
                    await this.diagnostic(context, `${name}: readonly variable`);
                    status = 1;
                    continue;
                }
                if (command === "local" && !locals.has(name)) {
                    locals.set(name, assignments.get(name) ?? { value: state.variables[name], exported: state.exported.has(name) });
                    if (!assignments.has(name) && match[2] === undefined)
                        delete state.variables[name];
                }
                if (match[2] !== undefined)
                    state.variables[name] = match[2];
                if (command === "export")
                    state.exported.add(name);
                if (command === "readonly") {
                    state.readonlyVariables ??= new Set();
                    state.readonlyVariables.add(name);
                }
                assignments.delete(name);
            }
            return status;
        }
        if (command === "unset") {
            let status = 0;
            for (const name of args) {
                if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name)) {
                    await writeText(stderr, `unset: ${name}: not a valid identifier\n`);
                    status = 1;
                    continue;
                }
                if (state.readonlyVariables?.has(name)) {
                    await this.diagnostic(context, `unset: ${name}: cannot unset: readonly variable`);
                    status = 1;
                    continue;
                }
                if (name === "PATH")
                    state.pathUnset = true;
                delete state.variables[name];
                state.exported.delete(name);
                if (state.profile === "sh")
                    assignments.delete(name);
            }
            return status;
        }
        if (command === "read") {
            const names = [...args];
            let raw = false;
            let count;
            let exact = false;
            let delimiter;
            let invalid = false;
            while (names[0]?.startsWith("-") && names[0] !== "--" && names[0] !== "-") {
                const option = names.shift();
                for (let index = 1; index < option.length; index++) {
                    const flag = option[index];
                    if (flag === "r") {
                        raw = true;
                        continue;
                    }
                    if (flag !== "n" && flag !== "N" && flag !== "d") {
                        invalid = true;
                        break;
                    }
                    if (flag === "N")
                        exact = true;
                    const value = option.slice(index + 1) || names.shift();
                    if (value === undefined)
                        invalid = true;
                    else if (flag === "d")
                        delimiter = new TextEncoder().encode(value)[0] ?? 0;
                    else if (exact && (!/^[ \t]*[+-]?\d+[ \t]*$/u.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
                        const diagnosticIO = context;
                        await writeText(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: ${value}: invalid ${/^[+-]?0[xX]/u.test(value) ? "hex " : ""}number\n`);
                        return 1;
                    }
                    else if (!exact && (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))))
                        invalid = true;
                    else
                        count = Number(value);
                    break;
                }
                if (invalid)
                    break;
            }
            if (names[0] === "--")
                names.shift();
            const invalidName = names.find(name => !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name));
            if (exact && !invalid && invalidName !== undefined) {
                const diagnosticIO = context;
                await writeText(stderr, `${diagnosticIO.scriptName ?? "shell"}: line ${diagnosticIO.diagnosticLine ?? 1}: read: \`${invalidName}': not a valid identifier\n`);
                return 1;
            }
            if (invalid || names.some((name) => !/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(name))) {
                await writeText(stderr, "read: invalid variable name or unsupported option\n");
                return 2;
            }
            const input = context.stdin instanceof ShellInput ? context.stdin : new ShellInput(context.stdin, this.budget, this.signal);
            const line = count === 0 && context.stdin === closedSource ? { value: "", escaped: new Set(), terminated: false }
                : await input.line(raw, count === undefined && delimiter === undefined ? undefined : {
                    ...(count === undefined ? {} : { count }), ...(delimiter === undefined ? {} : { delimiter }), byteCount: byteLocale(state.variables), exact,
                });
            if (!names.length) {
                if (state.readonlyVariables?.has("REPLY")) {
                    await this.diagnostic(context, "REPLY: readonly variable");
                    return 1;
                }
                state.variables.REPLY = line.value;
            }
            else {
                const separators = exact ? "" : state.variables.IFS ?? " \t\n";
                const characters = Array.from(line.value);
                const separator = (index) => index < characters.length && !line.escaped.has(index) && separators.includes(characters[index]);
                const whitespace = (index) => separator(index) && /[ \t\n]/u.test(characters[index]);
                let end = characters.length;
                while (end > 0 && whitespace(end - 1))
                    end--;
                let position = 0;
                while (position < end && whitespace(position))
                    position++;
                const fields = [];
                while (position < end) {
                    const start = position;
                    while (position < end && !separator(position))
                        position++;
                    fields.push({ start, end: position });
                    while (position < end && whitespace(position))
                        position++;
                    if (position < end && separator(position))
                        position++;
                    while (position < end && whitespace(position))
                        position++;
                }
                for (let index = 0; index < names.length; index++) {
                    if (state.readonlyVariables?.has(names[index])) {
                        await this.diagnostic(context, `${names[index]}: readonly variable`);
                        return index === names.length - 1 ? 1 : 2;
                    }
                    const field = fields[index];
                    state.variables[names[index]] = field ? characters.slice(field.start, index === names.length - 1 && fields.length > names.length ? end : field.end).join("") : "";
                }
            }
            return line.terminated ? 0 : 1;
        }
        if (command === "exit" || command === "return") {
            if (command === "return" && state.functionDepth === 0 && !state.sourceDepth) {
                await writeText(stderr, "return: not in a function\n");
                return 1;
            }
            if (args.length > 1) {
                await writeText(stderr, `${command}: too many arguments\n`);
                return 1;
            }
            if (args[0] !== undefined && !/^[+-]?\d+$/u.test(args[0])) {
                await writeText(stderr, `${command}: ${args[0]}: numeric argument required\n`);
                throw new Flow(command, 2);
            }
            const status = args[0] === undefined ? state.status : Number((BigInt(args[0]) % 256n + 256n) % 256n);
            throw new Flow(command, status);
        }
        if (command === "break" || command === "continue") {
            const levels = args[0] === undefined ? 1 : Number(args[0]);
            if (args.length > 1 || !Number.isSafeInteger(levels) || levels < 1) {
                await writeText(stderr, `${command}: invalid loop count\n`);
                return 1;
            }
            if (!state.loopDepth) {
                await writeText(stderr, `${command}: only meaningful in a loop\n`);
                return 0;
            }
            throw new Flow(command, 0, Math.min(levels, state.loopDepth));
        }
        return undefined;
    }
    async words(words, state, io, declaration = false) {
        const fields = [];
        for (const word of words) {
            fields.push(...await this.word(word, state, io, !(declaration && this.assignment(word))));
            if (fields.length > this.budget.limits.maxExpansionFields)
                this.budget.fail("maxExpansionFields");
        }
        return fields;
    }
    async part(part, state, io, hereString = false) {
        if (part.kind === "failed-substitution") {
            if (state.depth >= this.budget.limits.maxSubstitutionDepth)
                this.budget.fail("maxSubstitutionDepth");
            await writeText(io.stderr, part.diagnostic);
            state.status = state.substitutionStatus = 2;
            return "";
        }
        if (part.kind === "arithmetic") {
            try {
                return String(evaluateArithmetic(part.expression, this.arithmeticVariables(state)));
            }
            catch (error) {
                throw new ExpansionFailure(message(error), io.diagnosticLine ?? part.line);
            }
        }
        if (part.kind === "substitution") {
            if (state.depth >= this.budget.limits.maxSubstitutionDepth)
                this.budget.fail("maxSubstitutionDepth");
            const capture = new Capture();
            const child = cloneState(state);
            child.isolated = true;
            for (const [name, value] of state.redirectAssignments ?? []) {
                child.variables[name] = value;
                child.exported.add(name);
            }
            delete child.redirectAssignments;
            child.depth++;
            child.loopDepth = 0;
            const pipeline = part.script.lists.length === 1 && part.script.lists[0].pipelines.length === 1 ? part.script.lists[0].pipelines[0] : undefined;
            const command = pipeline && !pipeline.negate && pipeline.commands.length === 1 ? pipeline.commands[0] : undefined;
            const fileShortcut = command?.kind === "simple" && command.words.length === 0 && command.redirects.length === 1 && command.redirects[0].operator === "<";
            const captureIO = { ...isolateIO(io), diagnosticOffset: (io.diagnosticLine ?? part.line) - (part.sourceLine ?? part.line), stdout: this.budget.sink(capture, this.signal) };
            state.substitutionStatus = fileShortcut ? await this.runCommandIsolated(command, child, captureIO, true) : await this.run(part.script, child, captureIO);
            state.status = state.substitutionStatus;
            const bytes = capture.bytes();
            if (bytes.includes(0))
                await writeText(io.stderr, `shell: line ${io.diagnosticLine ?? part.line}: warning: command substitution: ignored null byte in input\n`);
            return new TextDecoder().decode(bytes.includes(0) ? bytes.filter((byte) => byte !== 0) : bytes).replace(/\n+$/u, "");
        }
        let value = part.name === "?" ? String(state.status)
            : part.name === "#" ? String(state.positional.length)
                : part.name === "@" || part.name === "*" ? state.positional.join(hereString && (part.name === "@" || !part.quoted) ? " " : Array.from(state.variables.IFS ?? " ")[0] ?? "")
                    : part.name === "0" ? state.arg0 ?? "virtual-bash"
                        : /^\d+$/u.test(part.name) ? state.positional[Number(part.name) - 1]
                            : state.variables[part.name];
        if (part.operator) {
            if (["#", "##", "%", "%%"].includes(part.operator)) {
                const pattern = (await this.word(part.alternate, state, io, false, true, hereString)).join("");
                const expression = globExpression(pattern);
                const text = value ?? "";
                const lengths = Array.from({ length: text.length + 1 }, (_, index) => index);
                if (part.operator.length === 2)
                    lengths.reverse();
                for (const length of lengths) {
                    const prefix = part.operator.startsWith("#");
                    if (expression.test(prefix ? text.slice(0, length) : text.slice(text.length - length))) {
                        return prefix ? text.slice(length) : text.slice(0, text.length - length);
                    }
                }
                return text;
            }
            const missing = value === undefined || (part.operator.startsWith(":") && value === "");
            const operator = part.operator.at(-1);
            if ((operator === "+" && !missing) || (operator !== "+" && missing)) {
                const alternate = (await this.word(part.alternate, state, io, false, false, hereString)).join("");
                if (operator === "?")
                    throw new ParameterExpansionFailure(`${part.name}: ${alternate || (part.operator.startsWith(":") ? "parameter null or not set" : "parameter not set")}`, io.diagnosticLine ?? part.line);
                if (operator === "=") {
                    if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name))
                        throw new Error("Cannot assign special parameter");
                    this.writeVariable(state, part.name, alternate);
                }
                value = alternate;
            }
            else if (operator === "+")
                value = "";
        }
        return part.length ? String(Array.from(value ?? "").length) : value ?? "";
    }
    async word(word, state, io, split = true, pattern = false, hereString = false) {
        const fields = [{ value: "", pattern: "", present: false }];
        let expansionBytes = 0;
        const append = (value, glob, present) => {
            const size = Buffer.byteLength(value);
            if (size > this.budget.limits.maxExpansionBytes - expansionBytes)
                this.budget.fail("maxExpansionBytes");
            expansionBytes += size;
            const field = fields.at(-1);
            field.value += value;
            field.pattern += glob ? value : value.replace(/[\\*?[\]\-^]/gu, "\\$&");
            field.present ||= present;
        };
        const parts = word.parts.map((part) => ({ part, splitText: false }));
        for (let index = 0; index < parts.length; index++) {
            const { part, splitText } = parts[index];
            if (part.kind === "variable" && ["-", "+", ":-", ":+"].includes(part.operator ?? "") && /^[a-zA-Z_][a-zA-Z_0-9]*$/u.test(part.name)) {
                const value = state.variables[part.name];
                const missing = value === undefined || (part.operator.startsWith(":") && value === "");
                if (part.operator.endsWith("+") ? !missing : missing) {
                    const alternate = part.alternate.parts.map((entry) => ({ part: { ...entry, quoted: entry.quoted || part.quoted }, splitText: true }));
                    if (!alternate.length && part.quoted)
                        append("", false, true);
                    parts.splice(index + 1, 0, ...alternate);
                    continue;
                }
            }
            if (part.kind === "text" && !splitText) {
                let value = part.value;
                if (index === 0 && !part.quoted && /^~(?:\/|$)/u.test(value))
                    value = (state.variables.HOME ?? "~") + value.slice(1);
                append(value, !part.quoted, part.quoted || value.length > 0);
            }
            else if (part.kind === "variable" && part.name === "@" && part.quoted && !part.operator && split) {
                for (let position = 0; position < state.positional.length; position++) {
                    if (position > 0)
                        fields.push({ value: "", pattern: "", present: false });
                    append(state.positional[position], false, true);
                }
                if (state.positional.length === 0 && word.parts.every((entry) => (entry.kind === "text" && entry.value === "") || entry === part))
                    fields[0].present = false;
            }
            else {
                const value = part.kind === "text" ? part.value : await this.part(part, state, io, hereString);
                if (part.quoted || !split || state.variables.IFS === "")
                    append(value, !part.quoted, part.quoted || !split || value.length > 0);
                else {
                    const separators = state.variables.IFS ?? " \t\n";
                    let boundary = false;
                    for (const character of value) {
                        if (separators.includes(character)) {
                            if (!/[ \t\n]/u.test(character)) {
                                fields.at(-1).present = true;
                                fields.push({ value: "", pattern: "", present: false });
                            }
                            else if (fields.at(-1).present)
                                boundary = true;
                        }
                        else {
                            if (boundary)
                                fields.push({ value: "", pattern: "", present: false });
                            boundary = false;
                            append(character, true, true);
                        }
                    }
                    if (boundary)
                        fields.push({ value: "", pattern: "", present: false });
                }
            }
            if (fields.length > this.budget.limits.maxExpansionFields)
                this.budget.fail("maxExpansionFields");
        }
        const result = [];
        let resultBytes = 0;
        for (const field of fields) {
            if (!field.present && split)
                continue;
            for (const value of split ? await this.glob(field.value, field.pattern, state) : [pattern ? field.pattern : field.value]) {
                const size = Buffer.byteLength(value);
                if (size > this.budget.limits.maxExpansionBytes - resultBytes)
                    this.budget.fail("maxExpansionBytes");
                resultBytes += size;
                result.push(value);
            }
            if (result.length > this.budget.limits.maxExpansionFields)
                this.budget.fail("maxExpansionFields");
        }
        return result;
    }
    async glob(value, pattern, state) {
        if (!/(?:^|[^\\])[*?[]/u.test(pattern))
            return [value];
        const absolute = pattern.startsWith("/");
        const work = { remaining: Math.min(Number.MAX_SAFE_INTEGER, this.budget.limits.maxExpansionBytes * 4 + 1024), signal: this.signal, exhausted: () => this.budget.fail("maxExpansionBytes") };
        let candidates = [absolute ? "/" : ""];
        for (const segment of pattern.split("/").filter((segment) => segment.length > 0)) {
            const next = [];
            let candidateBytes = 0;
            const addCandidate = (candidate) => {
                const size = Buffer.byteLength(candidate);
                if (size > this.budget.limits.maxExpansionBytes - candidateBytes)
                    this.budget.fail("maxExpansionBytes");
                candidateBytes += size;
                next.push(candidate);
                if (next.length > this.budget.limits.maxExpansionFields)
                    this.budget.fail("maxExpansionFields");
            };
            if (!/(?:^|[^\\])[*?[]/u.test(segment)) {
                const literal = segment.replace(/\\(.)/gu, "$1");
                for (const candidate of candidates)
                    addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${literal}`);
            }
            else {
                const matches = await compilePattern(segment, work);
                for (const candidate of candidates) {
                    let entries;
                    try {
                        entries = await this.fs.readdir(resolvePath(state.cwd, candidate || "."), { signal: this.signal });
                    }
                    catch (error) {
                        if (["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? ""))
                            continue;
                        throw error;
                    }
                    for (const entry of entries) {
                        if ((!entry.name.startsWith(".") || segment.startsWith(".")) && await matches(entry.name)) {
                            addCandidate(`${candidate}${candidate && candidate !== "/" ? "/" : ""}${entry.name}`);
                        }
                    }
                }
            }
            candidates = next;
        }
        const found = [];
        for (const candidate of candidates) {
            try {
                const stat = await this.fs.stat(resolvePath(state.cwd, candidate), { signal: this.signal });
                if (!value.endsWith("/") || stat.type === "directory")
                    found.push(candidate + (value.endsWith("/") ? "/" : ""));
            }
            catch (error) {
                if (!["ENOENT", "ENOTDIR", "EACCES"].includes(errorCode(error) ?? ""))
                    throw error;
            }
        }
        return found.length ? found.sort() : [value];
    }
}
function globExpression(pattern) {
    let expression = "^";
    for (let index = 0; index < pattern.length; index++) {
        const character = pattern[index];
        if (character === "\\" && index + 1 < pattern.length)
            expression += pattern[++index].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        else if (character === "*")
            expression += ".*";
        else if (character === "?")
            expression += ".";
        else if (character === "[") {
            const end = pattern.indexOf("]", index + 1);
            if (end > index + 1) {
                let contents = pattern.slice(index + 1, end);
                if (contents.startsWith("!"))
                    contents = `^${contents.slice(1)}`;
                expression += `[${contents.replace(/\\/gu, "\\\\")}]`;
                index = end;
            }
            else
                expression += "\\[";
        }
        else
            expression += character.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    }
    try {
        return new RegExp(`${expression}(?![\\s\\S])`, "su");
    }
    catch {
        return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![\\s\\S])`, "su");
    }
}
