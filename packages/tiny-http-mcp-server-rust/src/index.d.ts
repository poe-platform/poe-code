export interface ProtectedResourceMetadataOptions{
 resource:string|URL;authorizationServers:readonly(string|URL)[];
 bearerMethodsSupported?:readonly string[];scopesSupported?:readonly string[];
}
export declare function createProtectedResourceMetadataDocument(options:ProtectedResourceMetadataOptions):Record<string,unknown>;
export interface VerifiedAccessToken{
 token:string;issuer:string;audience:readonly string[];scopes:readonly string[];
 expiresAt:number;claims:Record<string,unknown>;subject?:string;clientId?:string;
}
export interface TokenVerifier{
 verify(input:{token:string;resource:string;authorizationServers:readonly string[];requiredScopes:readonly string[]}):Promise<VerifiedAccessToken>;
}
export interface RequestAuthInfo extends VerifiedAccessToken{
 audience:string[];clientId:string;scopes:string[];resource:URL;extra:Record<string,unknown>;
}
export declare class TokenVerificationError extends Error{
 readonly error:'invalid_token'|'insufficient_scope';readonly errorDescription?:string;readonly scope?:readonly string[];
 constructor(input:{error:'invalid_token'|'insufficient_scope';errorDescription?:string;scope?:readonly string[]});
}
export interface Session{
 id:string;initialized:boolean;authSubject?:string;protocolVersion?:string;createdAt:Date;lastSeenAt:Date;
}
export interface SessionStore{
 create(id:string):Session;get(id:string):Session|undefined;delete(id:string):boolean;has(id:string):boolean;
 touch?(id:string):void;entries?():Iterable<Session>;
}
