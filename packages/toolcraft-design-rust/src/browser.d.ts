/// <reference types="node" />
interface BrowserProcess {
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  unref(): void;
}
type SpawnBrowserProcess = (command: string, args: string[], options: { detached: true; stdio: "ignore" }) => BrowserProcess;
export interface OpenExternalOptions {
  platform?: NodeJS.Platform;
  spawnProcess?: SpawnBrowserProcess;
}
export declare function openExternal(url: string, options?: OpenExternalOptions): Promise<void>;
