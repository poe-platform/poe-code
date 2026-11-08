import type {AuthProvider,ApiShapeId} from "./types.js";
export type {ApiShapeId} from "./types.js";
export declare const allAuthProviders:readonly AuthProvider[];
export declare class ProviderRegistry {
 constructor(providers:readonly AuthProvider[]);
 get(id:string):AuthProvider|undefined;
}
export declare function resolveApiShape(provider:AuthProvider,agent:{apiShapes?:readonly ApiShapeId[]}):ApiShapeId|undefined;
