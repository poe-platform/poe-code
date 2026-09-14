import {PythonRuntimeError} from "./error.js";

/** Failed identifier access retains its resolved spelling independently of the
 * diagnostic. Explicitly raised NameError and UnboundLocalError do not infer it. */
export class PythonNameError extends PythonRuntimeError {
  constructor(readonly identifier:string,message:string){
    super("NameError",message);
  }
}
