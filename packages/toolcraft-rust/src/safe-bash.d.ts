import type { ByteSink, ByteSource, CommandContext, FileSystem, VirtualShellPlugin, ShellCapabilities } from "@poe-platform/safe-bash";
import { type AnySchema, type Static } from "./schema.js";
import type { Group } from "./index.js";
import type { HumanInLoopRuntime } from "./human-in-loop.js";
import { type CLIControls } from "./cli.js";
export interface ToolcraftInvocation<TServices extends object = Record<string, never>> {
    regex?: ShellCapabilities["regex"];
    registerCleanup?: CommandContext["registerCleanup"];
    invoke?: CommandContext["invoke"];
    inputBudget?: CommandContext["inputBudget"];
    cwd: string;
    env: Readonly<Record<string, string>>;
    fs: FileSystem;
    stdin: ByteSource;
    stdout: ByteSink;
    stderr: ByteSink;
    signal: AbortSignal;
    services?: TServices;
    fetch?: typeof globalThis.fetch;
    humanInLoop?: HumanInLoopRuntime | undefined;
}
declare module "./definitions.js" {
    interface HandlerInvocationCapabilities {
        readonly cwd?: string;
        readonly stdin?: ByteSource;
        readonly stdout?: ByteSink;
        readonly stderr?: ByteSink;
        readonly regex?: ShellCapabilities["regex"];
        readonly registerCleanup?: CommandContext["registerCleanup"];
        readonly invoke?: CommandContext["invoke"];
        readonly inputBudget?: CommandContext["inputBudget"];
    }
}
export interface ToolcraftCapabilities<TServices extends object = Record<string, never>> extends ShellCapabilities {
    readonly services?: TServices | undefined;
    readonly humanInLoop?: HumanInLoopRuntime | undefined;
}
export interface ToolcraftCommandsOptions<TServices extends object = Record<string, never>> {
    services?: TServices | ((invocation: ToolcraftInvocation<TServices>) => TServices);
    defaults?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    apiVersion?: string;
    version?: string;
    controls?: CLIControls;
    humanInLoop?: HumanInLoopRuntime;
}
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (value: infer U) => void ? U : never;
type NodeDefaults<T, TPrefix extends string = ""> = T extends {
    readonly __agentKitCommandTypeInfo: {
        name: infer N extends string;
        params: infer P;
    };
} ? P extends AnySchema ? {
    [K in `${TPrefix}${N}`]?: Partial<Static<P>>;
} : never : T extends {
    readonly __agentKitGroupTypeInfo: {
        name: infer N extends string;
        children: infer C extends readonly unknown[];
    };
} ? UnionToIntersection<NodeDefaults<C[number], `${TPrefix}${N}/`>> : never;
export type ToolcraftParameterDefaults<TLibrary> = TLibrary extends readonly unknown[] ? UnionToIntersection<NodeDefaults<TLibrary[number]>> : TLibrary extends {
    readonly __agentKitGroupTypeInfo: {
        children: infer C extends readonly unknown[];
    };
} ? UnionToIntersection<NodeDefaults<C[number]>> : ToolcraftCommandsOptions["defaults"];
/** Checks paths, parameter names and values against a library's inferred definitions. */
export declare function toolcraftDefaults<TLibrary>(_library: TLibrary, defaults: ToolcraftParameterDefaults<TLibrary>): ToolcraftParameterDefaults<TLibrary>;
/** Executes already-tokenized argv in process, using the same parser and dispatch as runCLI. */
export declare function createToolcraftCommandExecutor<TServices extends object>(library: Group<TServices> | readonly Group<TServices>[], options?: ToolcraftCommandsOptions<TServices>): {
    execute(argv: readonly string[], invocation: ToolcraftInvocation<TServices>): Promise<{
        exitCode: number;
    }>;
};
/** Registers every CLI-visible root and alias; nested commands use shared Toolcraft discovery. */
export declare function toolcraftCommands<TServices extends object>(library: Group<TServices> | readonly Group<TServices>[], options?: ToolcraftCommandsOptions<TServices>): VirtualShellPlugin;
export {};
