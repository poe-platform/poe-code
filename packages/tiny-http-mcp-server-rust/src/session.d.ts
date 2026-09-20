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
export declare function defaultSessionIdGenerator(): string;
export declare function createSessionStore(): SessionStore;
