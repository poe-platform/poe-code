import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {renderMarkdown,resetThemeCache} from "./index.js";
const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
createComponentPolicy(native.designThemeFixturePolicy,{
  forceColor:()=>{process.env.FORCE_COLOR="1";},
  theme:value=>{process.env.POE_THEME=value;},
  deleteTheme:()=>{delete process.env.POE_CODE_THEME;},
  reset:()=>resetThemeCache(),render:source=>renderMarkdown(source),
  stdout:value=>process.stdout.write(value),stderr:value=>process.stderr.write(value),exit:code=>process.exit(code),
  hasAnsi:s=>!!s.includes("\x1b["),same:(a,b)=>a===b,undefined:()=>undefined
})("run",[]);
