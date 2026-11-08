import type {Command,CommandRequirementOptions,HandlerEnv,HandlerFs} from "./index.js";
export interface FixtureFetchRequest {method?:string;url:string;}
export interface FixtureFetchResponse {body?:unknown;headers?:Record<string,string>;status?:number;}
export interface FixtureFetchEntry {request:FixtureFetchRequest;response:FixtureFetchResponse;}
export interface FixtureScenario {name:string;services?:Record<string,unknown>;}
export interface ResolvedFixtureRuntime<TServices extends object> {env:HandlerEnv;fetch:typeof globalThis.fetch;fs:HandlerFs;isFixture:boolean;requirementOptions:CommandRequirementOptions;secrets:Record<string,string|undefined>;services:TServices;}
export declare function normalizeHttpMethod(value:string|undefined):string;
export declare function isReadLikeMethod(name:string):boolean;
export declare function isWriteLikeMethod(name:string):boolean;
export declare function matchesFixtureValue(expected:unknown,actual:unknown):boolean;
export declare function getFetchUrl(input:RequestInfo|URL):string;
export declare function createFixtureResponse(response:FixtureFetchResponse):Response;
export declare function createFixtureFetch(entries:FixtureFetchEntry[]|undefined):typeof globalThis.fetch;
export declare function createFixtureFs(definition:unknown):HandlerFs;
export declare function resolveFixtureMethodResult(methodName:string,definition:unknown,args:unknown[]):Promise<unknown>;
export declare function createFixtureService(definition:unknown):Record<string,unknown>;
export declare function resolveFixturePath(commandPath:string):string;
export declare function selectFixtureScenario(scenarios:FixtureScenario[],selector:string,fixturePath:string):FixtureScenario;
export declare function loadFixtureScenario(command:Command<any,any,any,any>,selector:string):Promise<FixtureScenario>;
export declare function resolveFixtureSecrets(command:Command<any,any,any,any>):Record<string,string>;
export declare function createFixtureEnvValues(command:Command<any,any,any,any>):Record<string,string|undefined>;
export declare function resolveFixtureRuntime<TServices extends object>(command:Command<TServices,any,any,any>,services:TServices,requirementOptions:CommandRequirementOptions,runtimeFetch:typeof globalThis.fetch,runtimeEnv?:Record<string,string>,runtimeFs?:HandlerFs,embedded?:boolean):Promise<ResolvedFixtureRuntime<TServices>>;
