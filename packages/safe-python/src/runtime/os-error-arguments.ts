import type {ExecutionMeter} from "./execution-budget.js";

export interface OsErrorArgumentContext<Value> {
  readonly none:Value;
  /** Only the exact BlockingIOError type interprets a numeric third argument. */
  readonly blocking:boolean;
  numeric(value:Value):boolean;
  index(value:Value):bigint;
  setMember(name:"errno"|"strerror"|"filename"|"filename2"|"characters_written",value:Value|bigint|undefined):void;
  setArgs(args:readonly Value[]):void;
}

/** CPython's non-Windows oserror_parse_args/oserror_init publication order.
 * The caller owns type selection, numeric protocols and native member storage.
 * Reinitialization deliberately retains omitted filenames and written counts.
 * No filesystem, errno lookup or host exception state is consulted. */
export function initializeOsErrorArguments<Value>(input:readonly Value[],context:OsErrorArgumentContext<Value>,meter:ExecutionMeter):void {
  meter.checkpoint();
  let args=input;
  const parsed=args.length>=2&&args.length<=5;
  const errno=parsed?args[0]:undefined,strerror=parsed?args[1]:undefined;
  const filename=parsed?args[2]:undefined,filename2=parsed?args[4]:undefined;
  if(filename!==undefined&&filename!==context.none){
    if(context.blocking&&context.numeric(filename)){
      const written=context.index(filename);
      meter.checkpoint();
      context.setMember("characters_written",written);
    }else{
      context.setMember("filename",filename);
      if(filename2!==undefined&&filename2!==context.none)context.setMember("filename2",filename2);
      meter.checkpoint(1,32);
      args=args.slice(0,2);
    }
  }
  context.setMember("errno",errno);
  context.setMember("strerror",strerror);
  context.setArgs(args);
}
