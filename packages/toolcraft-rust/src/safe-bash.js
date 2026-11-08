import path from "node:path";
import {createRequire} from "node:module";
import {cloneDefaultValue,toJsonSchema,validate} from "toolcraft-schema-rust";
import {executeCLICommand,formatCLIName} from "./cli.js";
import {validateServices} from "./runtime-io.js";
import {callNative,protect} from "./host-errors.js";

const native=createRequire(import.meta.url)("./toolcraft-rust.node");
let depth=0;
function invoke(operation,args){
  if(depth>=128)throw new RangeError("Maximum call stack size exceeded");
  depth++;
  try{return callNative(native.safeBashPolicy,operation,args,host);}
  finally{depth--;}
}

function handlerFileSystem(invocation){
  const {fs,signal,cwd}=invocation;
  const resolve=value=>path.posix.resolve(cwd,value);
  return {
    async readFile(value,encoding="utf8"){
      return Buffer.from(await fs.readFile(resolve(value),{signal})).toString(encoding);
    },
    async writeFile(value,contents,options={}){
      const bytes=Buffer.from(contents,options.encoding??"utf8");
      const target=resolve(value);
      const flag=options.flag??"w";
      await invoke("write",[fs,target,bytes,options,signal,flag]);
    },
    async exists(value){
      try{await fs.stat(resolve(value),{signal});return true;}
      catch(error){return invoke("existsError",[error]);}
    },
    async lstat(value){
      const stat=await fs.lstat(resolve(value),{signal});
      return {isSymbolicLink:()=>stat.type==="symlink"};
    },
    async rename(from,to){await fs.rename(resolve(from),resolve(to),{signal});},
    async unlink(value){
      invoke("unlink",[fs]);
      await fs.unlink(resolve(value),{signal});
    }
  };
}

function executor(roots,multiple,defaults,options){
  return {
    async execute(argv,invocation){
      invocation.signal.throwIfAborted();
      let services,root;
      try{({services,root}=invoke("select",[roots,multiple,options,argv,invocation]));}
      catch(error){
        invocation.signal.throwIfAborted();
        await invocation.stderr.write(new TextEncoder().encode(`${error instanceof Error?error.message:String(error)}\n`));
        return {exitCode:1};
      }
      const args=invoke("args",[multiple,argv]);
      let pending=Promise.resolve();
      const budget=new native.SafeBashOutputBudget();
      const runtime={
        signal:invocation.signal,
        exitCode:0,
        defaults:invoke("invocationDefaults",[multiple,defaults,root]),
        capabilities:{signal:invocation.signal,stdin:invocation.stdin,stdout:invocation.stdout,stderr:invocation.stderr,cwd:invocation.cwd,regex:invocation.regex,registerCleanup:invocation.registerCleanup,invoke:invocation.invoke,inputBudget:invocation.inputBudget},
        write(chunk,stream="stdout"){
          invocation.signal.throwIfAborted();
          const bytes=new TextEncoder().encode(chunk);
          if(!budget.enqueue(bytes.byteLength))throw new Error("Toolcraft synchronous output exceeded 1 MiB; use a streaming command for larger output");
          pending=pending.then(async()=>{
            invocation.signal.throwIfAborted();
            await invocation[stream].write(bytes);
            budget.complete(bytes.byteLength);
          });
          void pending.catch(()=>{});
        },
        async flush(){await pending;}
      };
      const deniedFetch=async()=>{throw new Error("Network capability is unavailable for this invocation");};
      await executeCLICommand(invoke("visible",[root]),{
        argv:["toolcraft",root.name,...args],
        rootUsageName:root.name,
        version:options.version,
        apiVersion:options.apiVersion,
        services,
        env:{...invocation.env},
        fs:handlerFileSystem(invocation),
        fetch:invocation.fetch??deniedFetch,
        humanInLoop:invoke("humanInLoop",[invocation,options]),
        controls:{output:true,yes:true,...options.controls},
        errorReports:false,
        outputEmitter:entry=>runtime.write(`${entry}\n`)
      },runtime);
      return {exitCode:runtime.exitCode};
    }
  };
}

const operations={
  truthy:value=>!!value,undefined:()=>undefined,true:()=>true,false:()=>false,
  isArray:value=>Array.isArray(value),isFunction:value=>typeof value==="function",singleton:value=>[value],empty:()=>({}),map:()=>new Map(),clone:cloneDefaultValue,
  cliScope:node=>node.scope.includes("cli"),
  filterRoots:roots=>roots.filter(root=>invoke("rootVisible",[root])),
  rootChildren(root,prefix,commands){for(const child of root.children)invoke("visit",[child,`${prefix}${child.name}`,commands]);},
  childCommands(node,commandPath,commands){for(const child of node.children)invoke("visit",[child,`${commandPath}${commandPath?"/":""}${child.name}`,commands]);},
  setCommand:(commands,commandPath,node)=>commands.set(commandPath,node),
  kebabName:node=>formatCLIName(node.name,"kebab"),hasAlias:(node,name)=>node.aliases.includes(name),
  copyAliases:node=>[...node.aliases],addAlias:(node,name)=>[...node.aliases,name],
  visibleChildren:root=>root.children.filter(child=>invoke("nodeVisible",[child])).map(child=>invoke("visibleChild",[child])),
  defaultChild:(children,root)=>children.find(child=>invoke("defaultChild",[child,root])),
  defaultName:(child,root)=>child.name===root.default?.name,
  spread:object=>({...object}),
  projectRoot:(copy,aliases,children,defaultCommand)=>({...copy,aliases,children,default:defaultCommand}),
  projectChild:(copy,aliases)=>({...copy,aliases}),
  object:value=>value!==null&&typeof value==="object",
  schemaObject:value=>value!==null&&typeof value==="object"&&!Array.isArray(value),
  schemaValues(map,commandPath){for(const child of Object.values(map))invoke("schema",[child,commandPath]);},
  schemaItems(items,commandPath){for(const child of items)invoke("schema",[child,commandPath]);},
  schemaChild:(child,commandPath)=>invoke("schema",[child,commandPath]),
  regexError(commandPath){throw new TypeError(`Schema regex validation is unsupported in native Toolcraft commands: ${commandPath}; use the invocation's bounded regex capability in the handler`);},
  paramsJson:command=>toJsonSchema(command.params),eventJson:command=>toJsonSchema(command.stream.event),
  commands:(roots,multiple)=>new Map(roots.flatMap(root=>[...invoke("discoverRoot",[root,multiple])])),
  rootPrefix:root=>`${root.name}/`,emptyPrefix:()=>"",
  schemas(commands){for(const [commandPath,command] of commands)invoke("commandSchema",[commandPath,command]);},
  configuredDefaults:options=>cloneDefaultValue(options.defaults??{}),
  validateDefaults(defaults,commands){for(const [commandPath,values] of Object.entries(defaults))invoke("defaultCommand",[commandPath,values,commands]);},
  commandAt:(commands,commandPath)=>commands.get(commandPath),
  unknownDefault(commandPath){throw new TypeError(`Unknown default command path: ${commandPath}`);},
  defaultValues(commandPath,values,command){for(const [key,value] of Object.entries(values))invoke("defaultValue",[commandPath,key,value,command]);},
  ownsParam:(command,key)=>Object.prototype.hasOwnProperty.call(command.params.shape,key),
  unknownParam(commandPath,key){throw new TypeError(`Unknown default parameter: ${commandPath}/${key}`);},
  validateParam:(command,key,value)=>validate(command.params.shape[key],value),
  invalidParam(commandPath,key,result){throw new TypeError(`Invalid default parameter ${commandPath}/${key}: ${result.issues.map(issue=>issue.message).join("; ")}`);},
  validateServices:options=>validateServices(options.services),executor,
  servicesFactory:(options,invocation)=>options.services(invocation),
  mergeServices:(configured,invocation)=>({...configured,...invocation.services}),
  first:values=>values[0],firstRootName:roots=>roots[0]?.name,
  findRoot:(roots,name)=>roots.find(candidate=>invoke("matchesRoot",[candidate,name])),
  hasRootAlias:(candidate,name)=>candidate.aliases.includes(name??""),
  unknownRoot(name){throw new TypeError(`Unknown toolcraft root: ${name}`);},
  selection:(services,root)=>({services,root}),tail:argv=>argv.slice(1),
  rootDefaults:(defaults,root)=>Object.fromEntries(Object.entries(defaults).filter(([key])=>key.startsWith(`${root.name}/`)).map(([key,value])=>[key.slice(root.name.length+1),value])),
  ownsHuman:object=>Object.prototype.hasOwnProperty.call(object,"humanInLoop"),
  appendFile:(fs,target,bytes,options,signal)=>fs.appendFile(target,bytes,{signal,mode:options.mode}),
  writeFile:(fs,target,bytes,options,signal,flag)=>fs.writeFile(target,bytes,{signal,mode:options.mode,flag}),
  writeFlagError(flag){throw new Error(`Unsupported virtual write flag: ${flag}`);},
  hasCode:error=>"code" in error,throw(error){throw error;},
  unlinkError(){throw new Error("Virtual filesystem does not support unlink");},
  plugin:(library,executor,roots)=>({name:"toolcraft",setup(shell){invoke("setup",[library,executor,roots,shell]);}}),
  capabilityError(){throw new Error("Toolcraft requires a safe-bash runtime with invocation capabilities");},
  registerRoots(library,executor,roots,shell){for(const root of roots)invoke("registerRoot",[library,executor,root,shell]);},
  registerNames(library,executor,root,shell){
    for(const name of new Set([root.name,formatCLIName(root.name,"kebab"),...root.aliases])){
      shell.commands.register({name,description:root.description,execute(context){
        const capabilities=context.capabilities;
        return executor.execute(invoke("commandArgs",[library,root,context]),invoke("capabilities",[context,capabilities]));
      }});
    }
  },
  prefixedArgs:(root,context)=>[root.name,...context.args],contextArgs:context=>context.args,
  contextCapabilities:(context,capabilities)=>({...context,services:capabilities?.services,fetch:capabilities?.fetch,regex:capabilities?.regex}),
  capabilityHuman:(invocation,capabilities)=>({...invocation,humanInLoop:capabilities?.humanInLoop}),
  invalidOperation(){throw new TypeError("Invalid Safe Bash policy operation");}
};
const host={operate:protect((name,args)=>operations[name](...args)),get:protect((value,key)=>value[key])};

export function toolcraftDefaults(_library,defaults){return invoke("defaults",[defaults]);}
export function createToolcraftCommandExecutor(library,options={}){return invoke("create",[library,options]);}
export function toolcraftCommands(library,options={}){return invoke("plugin",[library,options]);}
