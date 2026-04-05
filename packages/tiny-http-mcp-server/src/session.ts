import { randomUUID } from "node:crypto";

export interface Session {
  id: string;
  initialized: boolean;
  createdAt: Date;
}

export interface SessionStore {
  create(id: string): Session;
  get(id: string): Session | undefined;
  delete(id: string): boolean;
  has(id: string): boolean;
}

export function defaultSessionIdGenerator(): string {
  return randomUUID();
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    create(id) {
      const session = {
        id,
        initialized: false,
        createdAt: new Date(),
      };

      sessions.set(id, session);

      return session;
    },
    get(id) {
      return sessions.get(id);
    },
    delete(id) {
      return sessions.delete(id);
    },
    has(id) {
      return sessions.has(id);
    },
  };
}
