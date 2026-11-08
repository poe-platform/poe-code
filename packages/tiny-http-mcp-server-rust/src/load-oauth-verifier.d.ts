import type {TokenVerifier} from './auth.js';
export declare function loadOAuthVerifier(input:{modulePath:string;exportName?:string;cwd?:string}):Promise<TokenVerifier>;
