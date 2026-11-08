import {expect,test,vi} from "vitest";
import process from "node:process";
const renderer=vi.hoisted(()=>({renderMarkdown:vi.fn(),resetThemeCache:vi.fn()}));
vi.mock("../../toolcraft-design/src/index.js",()=>renderer);
vi.mock("../dist/index.js",()=>renderer);

async function scenario(module,values){
  const trace=[],saved=Object.fromEntries(["FORCE_COLOR","POE_THEME","POE_CODE_THEME"].map(key=>[key,process.env[key]]));
  process.env.POE_CODE_THEME="overridden";
  const failure={failure:true};let index=0;
  vi.resetModules();
  renderer.resetThemeCache.mockImplementation(function(){trace.push(["reset",this===undefined,process.env.POE_THEME,process.env.FORCE_COLOR,process.env.POE_CODE_THEME]);});
  renderer.renderMarkdown.mockImplementation(function(text){trace.push(["render",this===undefined,text]);if(values==="throw")throw failure;return values[index++];});
  vi.spyOn(process.stdout,"write").mockImplementation(function(value){expect(this).toBe(process.stdout);trace.push(["stdout",value]);return true;});
  vi.spyOn(process.stderr,"write").mockImplementation(function(value){expect(this).toBe(process.stderr);trace.push(["stderr",value]);return true;});
  vi.spyOn(process,"exit").mockImplementation(function(code){expect(this).toBe(process);trace.push(["exit",code]);});
  try{
    try{const api=await import(module);trace.push(["exports",Object.keys(api)]);}
    catch(error){expect(error).toBe(failure);trace.push("thrown");}
    trace.push(["env",process.env.POE_THEME,process.env.FORCE_COLOR,process.env.POE_CODE_THEME]);
    return trace;
  }finally{
    for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    vi.restoreAllMocks();renderer.renderMarkdown.mockReset();renderer.resetThemeCache.mockReset();
  }
}

test.each([
  ["valid",["\x1b[31mDark","\x1b[32mLight"]],
  ["dark without color",["Dark","\x1b[32mLight"]],
  ["light without color",["\x1b[31mDark","Light"]],
  ["same outputs",["same","same"]],
  ["render failure","throw"]
])("theme fixture preserves %s side effects",async(_name,values)=>{
  expect(await scenario("../dist/theme-render-fixture.js",values)).toEqual(await scenario("../../toolcraft-design/src/terminal-markdown/testing/theme-render-fixture.ts",values));
});
