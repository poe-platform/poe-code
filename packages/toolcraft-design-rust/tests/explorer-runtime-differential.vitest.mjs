import {afterEach,expect,it,vi} from 'vitest';
import * as reference from '../../toolcraft-design/dist/explorer/runtime.js';
import * as native from '../dist/explorer-runtime.js';

const mock=vi.hoisted(()=>({driver:undefined}));
vi.mock('../../toolcraft-design/dist/terminal/driver.js',()=>({createTerminalDriver:options=>{mock.driver.trace.push(['driver',options]);return mock.driver;}}));
vi.mock('../dist/terminal-driver.js',()=>({createTerminalDriver:options=>{mock.driver.trace.push(['driver',options]);return mock.driver;}}));
vi.mock('node:fs',async importOriginal=>({...await importOriginal(),appendFileSync:(path,text)=>{mock.driver.trace.push(['trace',path,text]);}}));
const tty=Object.getOwnPropertyDescriptor(process.stdout,'isTTY');
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();if(tty)Object.defineProperty(process.stdout,'isTTY',tty);else delete process.stdout.isTTY;});

function driver(){
  const trace=[],events=new Set(),resizes=new Set();let size={cols:70,rows:14};
  const value={trace,frames:[],
    start(){trace.push(['start',this===value]);},stop(){trace.push(['stop',this===value]);},
    getSize(){trace.push(['size',this===value]);return size;},
    onEvent(fn){trace.push(['subscribe',this===value]);events.add(fn);return function(){trace.push(['unsubscribe',this!==undefined]);events.delete(fn);};},
    onResize(fn){trace.push(['resizeSubscribe',this===value]);resizes.add(fn);return function(){trace.push(['resizeUnsubscribe',this!==undefined]);resizes.delete(fn);};},
    writeFrame(frame){trace.push(['frame',frame,this===value]);this.frames.push(frame);},
    emit(event){for(const fn of events)fn(event);},
    resize(cols,rows){size={cols,rows};for(const fn of resizes)fn(size);},
    key(name,ctrl=false){this.emit({type:'key',name,ch:name.length===1?name:undefined,ctrl,alt:false,shift:false});}
  };return value;
}
function watched(value,trace,label){return new Proxy(value,{get(target,key,receiver){trace.push([label,String(key)]);return Reflect.get(target,key,receiver);}});}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
async function capture(run,scenario){
  vi.useFakeTimers();vi.setSystemTime(64000);
  Object.defineProperty(process.stdout,'isTTY',{configurable:true,value:true});
  const io=driver();mock.driver=io;const trace=io.trace;
  const rows=[{id:'a',title:'Alpha'},{id:'b',title:'Beta'}];
  const config={title:'Explorer 项目',mouse:true,initialRows:rows,rows:async function(){trace.push(['rows',this.rows===config.rows]);return rows;},detail:{items:async function(row,ctx){trace.push(['items',this===config.detail,row.id,ctx.width,ctx.height,ctx.signal.aborted]);return [{id:row.id,render(context){trace.push(['renderItem',this.id,context.row.id,context.width,context.height]);return `# ${row.title}\nDetails`;}}];}},actions:[]};
  await scenario({run,io,trace,config,rows,tick:()=>vi.advanceTimersByTimeAsync(40)});
  vi.clearAllTimers();vi.useRealTimers();return trace;
}
async function compare(scenario){expect(await capture(native.runExplorer,scenario)).toEqual(await capture(reference.runExplorer,scenario));}

it('runtime retains export shape and rejects before inspecting config without a TTY',async()=>{
  expect(Object.keys(native)).toEqual(Object.keys(reference));expect(native.runExplorer.length).toBe(reference.runExplorer.length);
  for(const run of [native.runExplorer,reference.runExplorer]){
    Object.defineProperty(process.stdout,'isTTY',{configurable:true,value:1});
    await expect(run(new Proxy({},{get(){throw 'config read';}}))).rejects.toThrow('explorer requires a TTY');
  }
});

it('runtime preserves startup, property reads, paste/wheel/key mapping, frames and teardown',async()=>{
  await compare(async({run,io,trace,config,tick})=>{
    const result=run(watched(config,trace,'config'));await tick();
    io.emit({type:'paste',text:'Be\r\nta'});await tick();io.key('escape');
    io.emit({type:'wheel',direction:'down'});await tick();
    io.key('tab');io.resize(120,16);await tick();io.key('c',true);
    trace.push(['result',await result]);await tick();
  });
});

it('runtime tracks async detail content, stale row loads, refresh and live reload callbacks',async()=>{
  await compare(async({run,io,trace,config,rows,tick})=>{
    const loads=[deferred(),deferred(),deferred()];let count=0,context,reload;
    config.rows=function(){trace.push(['load',count,this.rows===config.rows]);return loads[count++].promise;};
    const detail=deferred();config.detail.items=async function(row,ctx){reload=ctx.reloadDetail;trace.push(['detail',row.id,ctx.signal.aborted]);return [{id:row.id,render:()=>detail.promise}];};
    config.refresh=function(){trace.push(['refresh',this.refresh===config.refresh]);};
    config.actions=[{id:'capture',label:'Capture',accelerator:'e',handler(ctx){context=ctx;}}];
    const result=run(config);await tick();io.key('e',true);await tick();
    const first=context.refresh(),second=context.refresh();await Promise.resolve();
    loads[2].resolve([rows[1]]);await second;loads[1].resolve(rows);await first;
    loads[0].resolve(rows);detail.resolve('Async body');await tick();
    reload();await tick();context.reloadDetail('not-focused');await tick();
    io.key('c',true);trace.push(['result',await result]);
  });
});

it.each(['confirm','input','suspend','action-error','reorder-error'])('runtime preserves %s completion and cleanup',async kind=>{
  await compare(async({run,io,trace,config,tick})=>{
    const wait=deferred();let after=0;
    config.actions=[{id:'edit',label:'Edit',accelerator:'e',async handler(ctx){
      trace.push(['handler',this.id]);
      if(kind==='confirm')trace.push(['response',await ctx.confirm(watched({title:'Confirm title',message:'Continue?',confirmLabel:null,cancelLabel:'Cancel'},trace,'prompt'))]);
      if(kind==='input')trace.push(['response',await ctx.promptText(watched({title:'Input title',label:'Name',initialValue:'draft'},trace,'prompt'))]);
      if(kind==='suspend')trace.push(['response',await ctx.suspendAnd(()=>wait.promise)]);
      if(kind==='action-error')throw 'failure';
      ctx.toast('Saved');ctx.toast('Again','success');
      ctx.openModal({title:'Done',content:'Finished'});
      await wait.promise;
      trace.push(['cleanup']);ctx.exit(async()=>{await Promise.resolve();trace.push(['after',++after]);});
    }}];
    config.reorder={onReorder(ids,ctx){trace.push(['reorder',ids,ctx.movedId,this===config.reorder]);return Promise.reject('failure');}};
    const result=run(config);await tick();
    if(kind==='reorder-error')io.emit({type:'key',name:'down',ctrl:false,alt:false,shift:true});
    else io.key('e',true);
    await tick();
    if(kind==='confirm'||kind==='input'){io.key('c',true);await tick();}
    wait.resolve('resumed');await tick();
    if(kind==='action-error'||kind==='reorder-error')io.key('c',true);
    trace.push(['result',await result]);await tick();
  });
});

it('runtime preserves thrown values during startup and loading, and skips callbacks after stop',async()=>{
  for(const failure of ['config','start','rows'])for(const error of [null,undefined,Symbol('failure'),{failure:true}]){
    for(const run of [native.runExplorer,reference.runExplorer]){
      await capture(run,async({io,config})=>{
        if(failure==='config')Object.defineProperty(config,'title',{get(){throw error;}});
        if(failure==='start')io.start=()=>{throw error;};
        if(failure==='rows')config.rows=()=>{throw error;};
        let caught=false;try{await run(config);}catch(value){caught=true;expect(value).toBe(error);}expect(caught).toBe(true);
      });
    }
  }
});

it.each(['sync','async','thenable','invalid'])('runtime renders %s detail failures and expires toasts',async kind=>{
  await compare(async({run,io,trace,config,tick})=>{
    config.detail.items=async()=>[{id:'error',render(){
      if(kind==='sync')throw new Error('render failed');
      if(kind==='async')return Promise.reject('failed');
      if(kind==='thenable')return {then(_resolve,reject){reject(new Error('thenable failed'));return Promise.resolve();}};
      return 17;
    }}];
    config.actions=[{id:'toast',label:'Toast',accelerator:'e',handler(ctx){ctx.toast('Temporary');}}];
    const result=run(config);await tick();io.key('e',true);await tick();
    await vi.advanceTimersByTimeAsync(2501);io.key('c',true);trace.push(['result',await result]);
  });
});

it('runtime awaits pending content before after-exit and preserves rejection identity',async()=>{
  const sentinel={after:'failure'};
  await compare(async({run,io,trace,config,tick})=>{
    const content=deferred();let context;
    config.detail.items=async()=>[{id:'pending',render:()=>content.promise}];
    config.actions=[{id:'capture',label:'Capture',accelerator:'e',handler(ctx){context=ctx;}}];
    const result=run(config);let settled=false;
    const checked=result.then(()=>{throw Error('expected rejection');},error=>{expect(error).toBe(sentinel);settled=true;trace.push(['rejected']);});
    await tick();io.key('e',true);await tick();
    context.exit(()=>{trace.push(['after']);throw sentinel;});await tick();expect(settled).toBe(false);
    content.resolve('Too late');await checked;await tick();
  });
});

it('runtime suppresses terminal restart when exited during suspension',async()=>{
  await compare(async({run,io,trace,config,tick})=>{
    const wait=deferred();let context;
    config.actions=[{id:'edit',label:'Edit',accelerator:'e',async handler(ctx){context=ctx;trace.push(['value',await ctx.suspendAnd(()=>wait.promise)]);}}];
    const result=run(config);await tick();io.key('e',true);await tick();
    context.exit();await tick();wait.resolve('done');trace.push(['result',await result]);await tick();
  });
});

it('runtime rolls back only the latest failed reorder',async()=>{
  await compare(async({run,io,trace,config,rows,tick})=>{
    rows.push({id:'c',title:'Gamma'});const pending=[deferred(),deferred()];let calls=0;
    config.reorder={onReorder(ids,ctx){trace.push(['order',ids,ctx.movedId]);return pending[calls++].promise;}};
    const result=run(config);await tick();
    for(let index=0;index<2;index++){io.emit({type:'key',name:'down',ctrl:false,alt:false,shift:true});await tick();}
    pending[0].reject(new Error('old'));await tick();pending[1].reject(new Error('current'));await tick();
    io.key('c',true);trace.push(['result',await result]);
  });
});

it.each(['rows','refresh','detail','reorder'])('runtime preserves invalid %s callback diagnostics',async kind=>{
  await compare(async({run,io,trace,config,tick})=>{
    if(kind==='rows'){
      config.initialRows=[];config.rows=17;
      try{await run(config);}catch(error){trace.push(['error',error.message]);}
      return;
    }
    if(kind==='refresh'){
      config.refresh=17;config.actions=[{id:'refresh',label:'Refresh',accelerator:'e',handler:ctx=>ctx.refresh()}];
    }
    if(kind==='detail')config.detail.items=17;
    if(kind==='reorder')config.reorder={onReorder:17};
    const result=run(config);await tick();
    if(kind==='refresh')io.key('e',true);
    if(kind==='reorder')io.emit({type:'key',name:'down',ctrl:false,alt:false,shift:true});
    await tick();io.key('c',true);trace.push(['result',await result]);
  });
});

it('runtime captures its trace path and preserves timestamped input and frame records',async()=>{
  const old=process.env.POE_CODE_TUI_TRACE;
  try{
    await compare(async({run,io,trace,config,tick})=>{
      process.env.POE_CODE_TUI_TRACE='/virtual/explorer-trace';
      const result=run(config);process.env.POE_CODE_TUI_TRACE='/virtual/changed';
      await tick();io.key('down');await tick();io.key('c',true);await result;
      const records=trace.filter(entry=>entry[0]==='trace');
      expect(records.length).toBeGreaterThan(2);expect(records.every(entry=>entry[1]==='/virtual/explorer-trace')).toBe(true);
      expect(records.some(entry=>JSON.parse(entry[2]).type==='input')).toBe(true);
    });
  }finally{if(old===undefined)delete process.env.POE_CODE_TUI_TRACE;else process.env.POE_CODE_TUI_TRACE=old;}
});
