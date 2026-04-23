import type { CommandNode } from "agent-kit";

export interface TokenSource {
  getToken(): Promise<string>;
  invalidate?(): Promise<void>;
}

export interface CommandContributor {
  commands: CommandNode<any>[];
}

export type AuthProvider = TokenSource & CommandContributor;
