import {createRequire} from 'node:module';
const {USER_ERROR_NAME}=createRequire(import.meta.url)('./user-error-rust.node');

// Error causes, stack traces and realm identity are Node platform values. Keep
// them in the JS heap rather than capturing arbitrary causes in a native object.
export class UserError extends Error {
 constructor(message,options){
  super(message,options);
  this.name=USER_ERROR_NAME;
  this.hint=options?.hint;
 }
}
export function isUserError(error){return error instanceof Error&&error.name===USER_ERROR_NAME;}
