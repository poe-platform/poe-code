import {createRequire} from "node:module";
import {createComponentPolicy} from "./component-host.js";
import {createRenderPerformanceMonitor,formatRenderPerformance} from "./render-performance.js";
import {createLogger,resolveOutputFormat} from "./logging.js";
import {ScreenBuffer,diff} from "./dashboard-buffer.js";
import {renderContextPane} from "./dashboard-context.js";
import {plainTerminalText} from "./dashboard-ansi.js";
import {renderBorder} from "./dashboard-border.js";
import {defaultHints,renderFooter} from "./dashboard-footer.js";
import {renderOutputPane} from "./dashboard-output.js";
import {renderRunView} from "./dashboard-run-view.js";
import {createComposerState,editComposer} from "./composer.js";
import {renderCompactStatsPane,renderStatsPane} from "./dashboard-stats.js";
import {createKeymap} from "./dashboard-keymap.js";
import {computeDashboardLayout} from "./dashboard-layout.js";
import {createStore} from "./dashboard-store.js";
import {createTerminalDriver} from "./dashboard-terminal.js";

const native=createRequire(import.meta.url)("./toolcraft-design-rust.node");
const primitives={
  undefined:()=>undefined,true:()=>true,false:()=>false,negativeInfinity:()=>-Infinity,
  object:()=>({}),array:()=>[],set:()=>new Set(),
  truthy:value=>!!value,nullish:value=>value==null,same:(a,b)=>a===b,
  lt:(a,b)=>a<b,gt:(a,b)=>a>b,ge:(a,b)=>a>=b,
  add:(a,b)=>a+b,sub:(a,b)=>a-b,mul:(a,b)=>a*b,mod:(a,b)=>a%b,
  max:(a,b)=>Math.max(a,b),min:(a,b)=>Math.min(a,b),
  optionalGet:(value,key)=>value?.[key],at:(value,key)=>value[key],
  assign:(value,key,item)=>{value[key]=item;},spread:value=>({...value}),
  invoke:(fn,receiver,...args)=>Reflect.apply(fn,receiver,args),
  // Array methods retain callback/getter order, species, sparse slots and receivers.
  index:(queue,getId)=>queue?.findIndex(item=>item.id===getId()),
  errorMessage:error=>error instanceof Error?error.message:String(error),
  queued:(number)=>`Message queued${number>0?` after plan ${number}`:""}`,
  draftError:(kind,message)=>`Could not queue ${kind}: ${message}`,
  now:()=>Date.now(),clearTimeout:id=>clearTimeout(id),
  stdin:()=>process.stdin,stdout:()=>process.stdout,
  logger:stdout=>createLogger(message=>{stdout.write(`${message}\n`);}),
  buffer:(width,height)=>new ScreenBuffer(width,height),monitor:createRenderPerformanceMonitor,
  composer:createComposerState,editComposer,keymap:createKeymap,hints:defaultHints,
  store:createStore,driver:createTerminalDriver,format:resolveOutputFormat,
  layout:computeDashboardLayout,border:renderBorder,context:renderContextPane,
  output:renderOutputPane,stats:renderStatsPane,compactStats:renderCompactStatsPane,
  footer:renderFooter,runView:renderRunView,diff,formatPerformance:formatRenderPerformance,plainTerminalText,
  emit(handlers,command){for(const handler of handlers)handler(command);},
  invalidOperation(){throw new TypeError("Invalid dashboard runtime operation");}
};

export function createDashboard(opts={}) {
  const state={opts};
  const policy=createComponentPolicy(native.designDashboardRuntimePolicy,{
    ...primitives,state:()=>state,
    plans:queue=>queue?.filter(item=>policy("isPlan",[item])),
    renderTimer:()=>setTimeout(render,16),
    subscribeStore(store,subscription){return store.onChange(()=>{policy("storeChange",[subscription]);});},
    subscribeKeypress:driver=>driver.onKeypress(event=>{policy("keypress",[event]);}),
    subscribeResize:driver=>driver.onResize(()=>{policy("resize",[]);}),
    activeId:run=>()=>run?.activePlanId,
    submissionId:submission=>()=>submission.afterPlanId,
    composerId:()=>()=>state.composer.afterPlanId,
    submit(submission){
      void (async()=>{
        try {
          await opts.onSubmit(submission);
          policy("submitSuccess",[submission]);
        } catch(error) {policy("submitError",[submission,error]);}
        finally {policy("submitFinally",[]);}
      })();
    }
  });
  function render(){policy("render",[]);}
  policy("create",[]);
  function start(){policy("start",[]);}
  function stop(){policy("stop",[]);}
  function appendOutput(item){policy("append",[item]);}
  function updateStats(stats){policy("update",[stats]);}
  function onCommand(handler){policy("onCommand",[handler]);}
  function destroy(){policy("destroy",[]);}
  return {start,stop,appendOutput,updateStats,onCommand,getPerformance:state.performanceMonitor.snapshot,destroy};
}
