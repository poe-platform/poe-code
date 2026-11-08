import {expect,it} from "vitest";
import * as own from "../dist/safe-bash.js";
import * as reference from "../../toolcraft/dist/safe-bash.js";
import {defineCommand,defineGroup,S} from "../../toolcraft/dist/index.js";
import {withJsonSchema} from "toolcraft-schema";
import {withJsonSchema as withNativeJsonSchema} from "toolcraft-schema-rust";

function invocation(extra:object={}){
  const output:string[]=[],errors:string[]=[];
  return {cwd:"/",env:{},fs:{} as any,stdin:{async *[Symbol.asyncIterator](){}},
    stdout:{async write(bytes:Uint8Array){output.push(new TextDecoder().decode(bytes));}},
    stderr:{async write(bytes:Uint8Array){errors.push(new TextDecoder().decode(bytes));}},
    signal:new AbortController().signal,output,errors,...extra};
}
function root(handler:(ctx:any)=>unknown,name="my_tools"){
  return defineGroup({name,aliases:["tools","my-tools"],children:[defineCommand({name:"do_work",aliases:["go"],params:S.Object({text:S.String({default:"seed"})}),handler})]});
}
async function both(run:(api:typeof own)=>unknown){
  const expected=await run(reference);
  expect(await run(own)).toEqual(expected);
  return expected;
}

it("preserves root accessor order, alias registration and callback receivers",async()=>{
  const result=await both(async api=>{
    const trace:string[]=[];
    const library=new Proxy(root(({params})=>params),{get(target,key,receiver){if(typeof key==="string")trace.push(key);return Reflect.get(target,key,receiver);}});
    const plugin=api.toolcraftCommands([library]);
    const commands:any[]=[];
    const registry={register(command:any){expect(this).toBe(registry);commands.push(command);}};
    plugin.setup({commands:registry,provideCapabilities(){throw new Error("availability only");}} as any);
    const call=invocation({args:["go","--output","json"]});
    const status=await commands[0].execute(call);
    return {trace,names:commands.map(command=>command.name),status,output:call.output,errors:call.errors};
  });
  expect(result).toMatchObject({names:["my_tools","my-tools","tools"],status:{exitCode:0},errors:[]});
});

it("keeps options live, invokes service factories with their receiver and isolates defaults",async()=>{
  const result=await both(async api=>{
    const trace:string[]=[];
    const defaults={do_work:{text:"configured"}};
    const options:any={defaults,services(this:any,call:any){expect(this).toBe(options);trace.push(call.env.MARKER);return {base:"configured",shared:"configured"};}};
    const executor=api.createToolcraftCommandExecutor(root(({params,base,shared}:any)=>({params,base,shared})),options);
    defaults.do_work.text="changed";
    const first=invocation({env:{MARKER:"one"},services:{shared:"invocation"}});
    const a=await executor.execute(["go","--output","json"],first);
    options.services={base:"updated",shared:"updated"};
    const second=invocation();
    const b=await executor.execute(["do-work","--output","json"],second);
    return {trace,a,b,first:JSON.parse(first.output.join("")),second:JSON.parse(second.output.join(""))};
  });
  expect(result).toMatchObject({trace:["one"],first:{params:{text:"configured"},base:"configured",shared:"invocation"},second:{base:"updated"}});
});

it("preserves schema-position regex rejection and admits literal keyword values",async()=>{
  const result=await both(api=>{
    const docs=[
      {type:"object",properties:{pattern:{type:"string",default:"literal"}}},
      {type:"object",default:{pattern:"literal",patternProperties:{}}},
      {type:"object",dependencies:{allowed:["pattern"]}},
      ...["properties","$defs","definitions","dependentSchemas","dependencies"].map(key=>({[key]:{entry:{pattern:"x"}}})),
      ...["allOf","anyOf","oneOf","prefixItems"].map(key=>({[key]:[{patternProperties:{}}]})),
      ...["items","additionalItems","additionalProperties","contains","if","then","else","not","propertyNames","unevaluatedItems","unevaluatedProperties"].map(key=>({[key]:{patternProperties:{}}}))
    ];
    return docs.map(doc=>{
      // Each schema package owns its nativeJsonSchema symbol, just as separate
      // installations of the canonical package do.
      const attach=api===own?withNativeJsonSchema:withJsonSchema;
      const library=defineGroup({name:"schema",children:[defineCommand({name:"run",params:attach(S.Object({}),doc),handler:()=>null})]});
      try{api.createToolcraftCommandExecutor(library);return "accepted";}catch(error:any){return [error.constructor.name,error.message];}
    });
  });
  expect((result as unknown[]).slice(0,3)).toEqual(["accepted","accepted","accepted"]);
  expect((result as unknown[]).slice(3).every(value=>Array.isArray(value)&&value[0]==="TypeError")).toBe(true);
});

it("retains foreign errors and cancellation precedence at selection boundaries",async()=>{
  for(const thrown of [null,undefined,Symbol("sentinel"),{reason:"foreign"},new Error("sentinel")]){
    for(const api of [reference,own]){
      const controller=new AbortController();
      const reason={cancelled:true};
      const options={services(){controller.abort(reason);throw thrown;}};
      const call=invocation({signal:controller.signal});
      const executor=api.createToolcraftCommandExecutor(root(()=>null),options);
      await expect(executor.execute(["go"],call)).rejects.toBe(reason);
      expect(call.errors).toEqual([]);
      const badRoot=new Proxy(root(()=>null),{get(target,key,receiver){if(key==="scope")throw thrown;return Reflect.get(target,key,receiver);}});
      let caught:any=Symbol("not thrown");
      try{api.createToolcraftCommandExecutor(badRoot);}catch(error){caught=error;}
      expect(caught).toBe(thrown);
    }
  }
});

it("preserves filesystem flags, inherited missing codes, receivers and captured cwd",async()=>{
  const result=await both(async api=>{
    const trace:any[]=[];
    const missing=Object.create({code:"ENOENT"});
    const foreign={code:"EACCES"};
    const stat={type:"symlink"};
    const fs:any={
      async readFile(this:any,file:string,options:any){expect(this).toBe(fs);trace.push(["read",file,options.signal===signal]);return new TextEncoder().encode("input");},
      async appendFile(this:any,file:string,bytes:Uint8Array,options:any){expect(this).toBe(fs);trace.push(["append",file,[...bytes],options.mode]);},
      async writeFile(this:any,file:string,bytes:Uint8Array,options:any){expect(this).toBe(fs);trace.push(["write",file,[...bytes],options.flag,options.mode]);},
      async stat(file:string){if(file.endsWith("missing"))throw missing;if(file.endsWith("denied"))throw foreign;return stat;},
      async lstat(){return stat;},async rename(from:string,to:string){trace.push(["rename",from,to]);},
      async unlink(this:any,file:string){expect(this).toBe(fs);trace.push(["unlink",file]);}
    };
    const signal=new AbortController().signal;
    const call=invocation({fs,signal,cwd:"/work"});
    const library=root(async({fs:handler}:any)=>{
      call.cwd="/changed";
      await handler.writeFile("file","61",{encoding:"hex",flag:"a",mode:0o600});
      await handler.writeFile("file","b",{flag:"wx"});
      await handler.writeFile("file","c");
      const flags=[];
      for(const flag of ["r","a+",0])try{await handler.writeFile("file","d",{flag});}catch(error:any){flags.push(error.message);}
      const read=await handler.readFile("../input");
      expect(await handler.exists("missing")).toBe(false);
      expect(await handler.exists("present")).toBe(true);
      await expect(handler.exists("denied")).rejects.toBe(foreign);
      const link=await handler.lstat("file");
      const before=link.isSymbolicLink();stat.type="file";const after=link.isSymbolicLink();
      await handler.rename("file","other");await handler.unlink("other");
      fs.unlink=undefined;
      await expect(handler.unlink("file")).rejects.toThrow("Virtual filesystem does not support unlink");
      return {flags,read,before,after};
    });
    const status=await api.createToolcraftCommandExecutor(library).execute(["go","--output","json"],call);
    return {status,trace,value:JSON.parse(call.output.join("")),errors:call.errors};
  });
  expect(result).toMatchObject({status:{exitCode:0},value:{read:"input",before:true,after:false},errors:[]});
});

it("reads command capabilities once and honors explicit approval revocation",async()=>{
  const result=await both(async api=>{
    const commands:any[]=[];
    const seen:any[]=[];
    const library=root((ctx:any)=>{seen.push([ctx.marker,ctx.regex,ctx.cwd]);return "ok";});
    const plugin=api.toolcraftCommands(library,{services:{marker:"fallback"},humanInLoop:{invoke(){throw new Error("revoked approval");}} as any});
    plugin.setup({provideCapabilities(){},commands:{register(command:any){commands.push(command);}}} as any);
    let reads=0;
    const call=invocation({args:["go","--output","json"]});
    Object.defineProperty(call,"capabilities",{get(){reads++;return {services:{marker:"invocation"},fetch:undefined,regex:undefined,humanInLoop:undefined};}});
    const status=await commands[0].execute(call);
    return {reads,status,seen,output:call.output,errors:call.errors};
  });
  expect(result).toMatchObject({reads:1,status:{exitCode:0},seen:[["invocation",undefined,"/"]],errors:[]});
});

it("enforces synchronous output limits and preserves sink rejection identity",async()=>{
  const result=await both(async api=>{
    const library=defineGroup({name:"output",children:[defineCommand({name:"run",params:S.Object({}),handler:()=>"x".repeat(1_048_576)})]});
    const call=invocation();
    let outcome;
    try{outcome=await api.createToolcraftCommandExecutor(library).execute(["run","--output","json"],call);}catch(error:any){outcome=[error.constructor.name,error.message];}
    return {outcome,output:call.output,errors:call.errors};
  });
  expect(JSON.stringify(result)).toContain("Toolcraft synchronous output exceeded 1 MiB");
  for(const api of [reference,own]){
    const error={sink:"failed"};
    const call=invocation({stdout:{async write(){throw error;}}});
    await expect(api.createToolcraftCommandExecutor(root(()=>"ok")).execute(["go","--output","json"],call)).rejects.toBe(error);
  }
});
