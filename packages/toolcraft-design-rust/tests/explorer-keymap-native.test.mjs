import assert from "node:assert/strict";
import {test} from "node:test";
import * as reference from "../../toolcraft-design/dist/explorer/keymap.js";

const action=(id,accelerator,label=id)=>({id,label,accelerator,handler(){}});
const config=(overrides={})=>({title:"Plans",rows:async()=>[],detail:{items:async()=>[]},actions:[],...overrides});
const events=[{},...['up','down','return','enter','home','end','pageup','pagedown','tab','escape','space','E'].flatMap(name=>[{}, {ctrl:true},{meta:true},{shift:true},{ctrl:true,shift:true}].map(modifiers=>({name,...modifiers}))),...['c','p','d','u','a','e','x','/'].map(ch=>({ch,ctrl:true}))];

test("explorer binding policy matches defaults, overrides, selection and action deduplication",async()=>{
  const native=await import("toolcraft-design-rust/explorer/keymap");
  assert.deepEqual(Object.keys(native),Object.keys(reference));
  for(const multiSelect of [undefined,true,false])for(const reorder of [undefined,{onReorder(){}}]){
    const cfg=config({multiSelect,reorder,actions:[action('edit','e')],detail:{items:async()=>[],actions:[action('edit','x')]}});
    for(const defaults of [{},{quit:['z'],cursorUp:[' Control+E ','up'],cursorDown:['UP','down'],help:['F1']}]){
      const actual=native.resolveBindings(cfg,defaults),expected=reference.resolveBindings(cfg,defaults);
      assert.deepEqual([...actual.bindings],[...expected.bindings]);assert.deepEqual([...actual.keysByTarget],[...expected.keysByTarget]);
      for(const event of events)assert.deepEqual(actual.resolve(event),expected.resolve(event));
      assert.deepEqual(native.keymapToHelp(cfg),reference.keymapToHelp(cfg));
      actual.bindings.set('custom',{type:'action',id:'injected'});
      assert.deepEqual(actual.resolve({name:'CUSTOM'}),{type:'action',id:'injected'});
    }
  }
});

test("explorer accelerator validation preserves error messages and precedence",async()=>{
  const native=await import("toolcraft-design-rust/explorer/keymap");
  for(const cfg of [
    config({actions:[{...action('old','c'),key:'o'}]}),config({actions:[{...action('old','e'),key:[]}]}),
    config({keybindOverrides:{quit:'q'}}),config({actions:[action('one','e'),action('two','E')]}),
    ...['c','u','d','p','edit','1','','É',null,Symbol('e')].map(key=>config({actions:[action('bad',key)]}))
  ])for(const name of ['resolveBindings','assertNoBareLetterBindings','assertAcceleratorsFree','keymapToHelp']){
    function capture(api){try{const value=api[name](cfg);return name==='resolveBindings'?{bindings:[...value.bindings]}:value;}catch(error){return {type:error.constructor.name,message:error.message};}}
    assert.deepEqual(capture(native),capture(reference),name);
  }
});

test("explorer bindings keep live getter order, method receivers, throws and reentrancy",async()=>{
  const native=await import("toolcraft-design-rust/explorer/keymap");
  function capture(api){
    const trace=[];
    const observe=value=>new Proxy(value,{get(target,key,receiver){if(typeof key==='string')trace.push(key);return Reflect.get(target,key,receiver);}});
    const cfg=observe(config({actions:[observe(action('edit','e',()=>"Edit"))]}));
    const defaults=observe({cursorUp:[' Control+E ']});
    const binding=api.resolveBindings(cfg,defaults);
    const event=observe({name:'E',ch:'e',ctrl:true,meta:false,shift:false});
    const target=binding.resolve(event);const help=api.keymapToHelp(cfg);
    return {trace,target,help};
  }
  assert.deepEqual(capture(native),capture(reference));
  const failure={reason:'getter'};
  assert.throws(()=>native.resolveBindings(Object.defineProperty(config(),"actions",{get(){throw failure;}})),value=>value===failure);
  let nested;
  native.resolveBindings(Object.defineProperty(config(),"multiSelect",{get(){nested=native.resolveBindings(config()).resolve({name:'up'});return false;}}));
  assert.deepEqual(nested,{type:'builtin',id:'cursorUp'});
});
