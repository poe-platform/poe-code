import type {ExecutionMeter} from "./execution-budget.js";
import type {CompiledProgram} from "./program-compilation.js";
import type {RuntimeCompiledCode} from "./runtime-code.js";
import type {RuntimeValue} from "./runtime-values.js";
import type {CompiledFunction} from "./function-compilation.js";

/** Execution-owned association, keyed by compiler identity rather than source
 * text or reflected fields. Retaining nested code retains its literal/definition
 * environment. This is trusted compiler metadata, not a guest security boundary. */
export class RuntimeCodePrograms {
  readonly #programs=new WeakMap<RuntimeCompiledCode,CompiledProgram<RuntimeValue>>();
  constructor(private readonly meter:ExecutionMeter){meter.checkpoint(1,96);Object.freeze(this);}

  register(program:CompiledProgram<RuntimeValue>):void {
    this.meter.checkpoint(1,256);
    const pending:RuntimeCompiledCode[]=[];
    try {
      for(const codes of [[program.module],program.functions.values(),program.classes.values(),program.classFunctions.values(),program.generatorExpressions?.values()??[]]){
        for(const code of codes){
          this.meter.checkpoint(1,8);
          const existing=this.#programs.get(code);
          if(existing!==undefined&&existing!==program)throw Error("compiled code already belongs to another program");
          if(existing===undefined)pending.push(code);
        }
      }
      // Reserve publication before mutating the cache. No callbacks or guest
      // operations occur during the following atomic WeakMap insertion batch.
      this.meter.checkpoint(pending.length,48*pending.length);
    } finally {this.meter.checkpoint();}
    for(const code of pending)this.#programs.set(code,program);
  }

  lookup(code:RuntimeCompiledCode):CompiledProgram<RuntimeValue>|undefined {
    this.meter.checkpoint();return this.#programs.get(code);
  }

  /** Ordinary functions carry their environment directly. Class suites resolve
   * through their originating compilation, never by matching metadata text. */
  functionCode(code:RuntimeCompiledCode):CompiledFunction<RuntimeValue>|undefined {
    this.meter.checkpoint();
    if("body" in code)return code;
    const node=code.scope.scope.node;
    if(node.kind!=="class")return undefined;
    const wrapper=this.#programs.get(code)?.classFunctions.get(node);
    this.meter.checkpoint();
    return wrapper?.body.kind==="class"&&wrapper.body.code===code?wrapper:undefined;
  }
}
