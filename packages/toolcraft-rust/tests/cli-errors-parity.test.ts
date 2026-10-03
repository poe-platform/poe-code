import assert from "node:assert/strict";
import {afterEach,beforeEach,it,vi} from "vitest";
import {Command,CommanderError} from "commander";
import * as nativeDefinitions from "../dist/index.js";
import * as referenceDefinitions from "../../toolcraft/dist/index.js";
import * as nativeDesign from "toolcraft-design-rust";
import * as referenceDesign from "../../toolcraft-design/dist/index.js";
import {original} from "./cli-errors-reference.mjs";
import * as api from "../dist/cli-errors.js";
const initialExitCode=process.exitCode;
beforeEach(()=>{process.exitCode=0;nativeDesign.configureTheme({brand:"blue",label:"Toolcraft"});referenceDesign.configureTheme({brand:"blue",label:"Toolcraft"});});
afterEach(()=>{process.exitCode=initialExitCode;vi.restoreAllMocks();});
async function render(module,error,options={}){
  const output=[],stderr=[];process.exitCode=0;
  const spy=vi.spyOn(process.stderr,"write").mockImplementation(chunk=>{stderr.push(String(chunk));return true;});
  try{await module.handleRunError(error,{debugControlEnabled:true,debugStackMode:undefined,output:"rich",verbose:false,verboseControlEnabled:true,rootUsageName:"app",commandPath:"jobs run",userErrorPattern:"usage",outputEmitter:entry=>output.push(entry),...options});return {output,stderr,exitCode:process.exitCode};}finally{spy.mockRestore();}
}
it("Native CLI error handling preserves user, definition and unexpected errors",async()=>{
  for(const pattern of ["definition","usage","runtime-user"])for(const output of ["rich","md","json"]){
    const actual=await render(api,new nativeDefinitions.UserError("Missing input"),{userErrorPattern:pattern,output});assert.deepEqual(actual,await render(original,new referenceDefinitions.UserError("Missing input"),{userErrorPattern:pattern,output}));assert.equal(actual.exitCode,1);
  }
  for(const error of [undefined,null,false,17,Symbol("failure"),Object.assign(new Error("failed"),{stack:"Error: failed\n    at run (file:///app/run.ts:1:2)"})])for(const debugStackMode of [undefined,"raw","trim"])assert.deepEqual(await render(api,error,{debugStackMode}),await render(original,error,{debugStackMode}));
});
it("Native CLI error handling routes Commander diagnostics and silent help exits",async()=>{
  const program=new Command("app"),jobs=new Command("jobs"),run=new Command("run").alias("r").option("--name <value>").option("--count <value>");jobs.addCommand(run);program.addCommand(jobs);
  for(const [code,message] of [["commander.helpDisplayed","help"],["commander.version","version"],["commander.unknownCommand","error: unknown command 'rnu'"],["commander.unknownOption","error: unknown option '--naem'"],["commander.missingArgument","missing required argument 'name'"]]){
    const error=new CommanderError(code.includes("help")||code.includes("version")?0:1,code,message),options={program,argv:["node","app","jobs","r"],commandPath:""};assert.deepEqual(await render(api,error,options),await render(original,error,options));
  }
});
it("Native CLI HTTP error rendering preserves redaction, problem details and GraphQL output",async()=>{
  for(const body of ["upstream failed",{title:"Invalid input",detail:"Check name",status:422},{errors:[{message:"Invalid field",path:["user",0],extensions:{code:"BAD_INPUT"}}]},{message:"failed",field_errors:{name:["required"]}},undefined])for(const verbose of [false,true]){
    const error={name:"HttpError",message:"Request failed",request:{method:"POST",url:"https://example.invalid/jobs",headers:{authorization:"Bearer synthetic-secret"},body:{token:"synthetic-secret",name:"test"}},response:{status:422,statusText:"Unprocessable Entity",headers:{"x-request-id":"request-1"},body}};
    const actual=await render(api,error,{verbose});assert.deepEqual(actual,await render(original,error,{verbose}));assert.equal(actual.exitCode,1);assert.ok(!actual.stderr.join("").includes("synthetic-secret"));
  }
});
it("Native CLI command diagnostics preserve hidden/default child admission",async()=>{
  function inspect(module){const program=new Command("app"),fallback=new Command("default"),publicChild=new Command("run").alias("r");program.addCommand(fallback,{isDefault:true});program.addCommand(publicChild);Reflect.set(program,"_toolcraftHiddenDefaultNames",["default"]);Reflect.set(program,"_toolcraftReservedChildNames",["private"]);module.configureCommanderSuggestionOutput(program,"1");return [[],["run"],["r"],["rnu"],["private"],["default"],["/path"],["--","rnu"]].map(args=>{const result=module.findUnknownCommanderCommand(program,["node","app",...args]);return result===undefined?undefined:{input:result.input,path:result.commandPath,name:result.currentCommand.name()};});}
  assert.deepEqual(inspect(api),inspect(original));
});
