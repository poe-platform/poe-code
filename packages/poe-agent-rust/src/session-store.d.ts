import type { ChatMessage } from "./types.js";
interface SessionStoreFs {
  mkdir(
    path: string,
    options?: {
      recursive?: boolean;
    }
  ): Promise<unknown>;
  readFile(path: string, encoding: "utf8"): Promise<string | Buffer>;
  writeFile(
    path: string,
    content: string,
    options?:
      | "utf8"
      | {
          encoding: "utf8";
          flag?: string;
        }
  ): Promise<unknown>;
}
export interface PersistedAgentSession {
  version: 1;
  threadId: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}
export interface AgentSessionStore {
  load(threadId: string): Promise<PersistedAgentSession | undefined>;
  save(session: PersistedAgentSession): Promise<void>;
}
export declare function createAgentSessionStore(options?: {
  homeDir?: string;
  fs?: SessionStoreFs;
}): AgentSessionStore;
