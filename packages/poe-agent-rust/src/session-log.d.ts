import type { SessionEntry } from "./entry-types.js";
type JsonlSessionStoreFs = {
  mkdir(
    path: string,
    options?: {
      recursive?: boolean;
    }
  ): Promise<unknown>;
  appendFile(path: string, data: string, encoding: "utf8"): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string | Buffer>;
};
export interface SessionStore {
  readonly sessionId: string;
  append(entry: SessionEntry): Promise<void>;
  list(): Promise<SessionEntry[]>;
  dispose(): Promise<void>;
}
export declare function createMemorySessionStore(sessionId: string): SessionStore;
export declare function createJsonlSessionStore(
  sessionId: string,
  directory: string,
  options?: {
    fs?: JsonlSessionStoreFs;
  }
): Promise<SessionStore>;
