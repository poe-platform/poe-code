import type {ExecutionMeter} from "./execution-budget.js";
import type {CompiledProgram} from "./program-compilation.js";
import type {RuntimeCompiledCode} from "./runtime-code.js";
import type {RuntimeValue,RuntimeValues} from "./runtime-values.js";
import type {CompiledFunction} from "./function-compilation.js";

/** Execution-owned association, keyed by compiler identity rather than source
 * text or reflected fields. Retaining nested code retains its literal/definition
 * environment. This is trusted compiler metadata, not a guest security boundary. */
export class RuntimeCodePrograms {
  readonly #programs=new WeakMap<RuntimeCompiledCode,CompiledProgram<RuntimeValue>>();
  readonly #moduleFunctions=new WeakMap<RuntimeCompiledCode,CompiledFunction<RuntimeValue>>();
  constructor(private readonly meter:ExecutionMeter,private readonly values:RuntimeValues){meter.checkpoint(1,160);Object.freeze(this);}

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
    const program=this.#programs.get(code);
    if(program?.module===code){
      const existing=this.#moduleFunctions.get(code);if(existing!==undefined)return existing;
      this.meter.checkpoint(1,240);
      const name=this.values.string("<module>"),firstLine=this.values.integer(1);
      const result:CompiledFunction<RuntimeValue>={scope:code.scope,source:code.source,flags:code.flags,kind:"function",name,qualifiedName:name,firstLine,docstring:code.docstring,body:{kind:"module",program}};
      this.meter.checkpoint(1,48);this.#moduleFunctions.set(code,result);return result;
    }
    const node=code.scope.scope.node;
    if(node.kind!=="class")return undefined;
    const wrapper=program?.classFunctions.get(node);
    this.meter.checkpoint();
    return wrapper?.body.kind==="class"&&wrapper.body.code===code?wrapper:undefined;
  }
}
