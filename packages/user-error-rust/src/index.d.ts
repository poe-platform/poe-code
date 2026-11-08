export declare class UserError extends Error {
 readonly hint?:string;
 constructor(message:string,options?:ErrorOptions&{hint?:string});
}
export declare function isUserError(error:unknown):boolean;
