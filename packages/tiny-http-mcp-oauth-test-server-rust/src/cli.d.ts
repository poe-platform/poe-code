#!/usr/bin/env node
interface RunCliDependencies {
    stdout?: Pick<NodeJS.WriteStream, "write">;
    stderr?: Pick<NodeJS.WriteStream, "write">;
    waitForShutdown?: (shutdown: () => Promise<void>) => Promise<void>;
}
export declare function isCliInvocation(argv: string[], moduleUrl: string, realpath?: (path: string) => string): boolean;
export declare function runCli(args?: string[], dependencies?: RunCliDependencies): Promise<number>;
export {};
