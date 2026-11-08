import { randomUUID } from "node:crypto";

export interface Session {
  id: string;
  initialized: boolean;
  authSubject?: string;
  protocolVersion?: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export interface SessionStore {
  create(id: string): Session;
  get(id: string): Session | undefined;
  delete(id: string): boolean;
  has(id: string): boolean;
  touch?(id: string): void;
  entries?(): Iterable<Session>;
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
        lastSeenAt: new Date(),
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
    touch(id) {
      const session = sessions.get(id);
      if (session !== undefined) {
        session.lastSeenAt = new Date();
      }
    },
    entries() {
      return sessions.values();
    },
  };
}
