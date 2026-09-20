import type {TokenVerifier} from './auth.js';
export interface InMemoryAccessTokenInput {
 token?: string;
 issuer: string;
 audience: readonly string[];
 scopes: readonly string[];
 expiresAt: number;
 claims?: Record<string,unknown>;
 subject?: string;
 clientId?: string;
}
export interface InMemoryTokenVerifier {
 verifier: TokenVerifier;
 issueToken(input: InMemoryAccessTokenInput): string;
}
export declare function createInMemoryTokenVerifier(options?: Partial<{now:()=>number}>): InMemoryTokenVerifier;
