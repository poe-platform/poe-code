import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {getTheme} from './theme.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const policy=createComponentPolicy(native.designExplorerThemePolicy,{
  theme:getTheme,object:()=>({}),true:()=>true,spread:value=>({...value}),
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},at:(value,key)=>value[key],
  template:(open,text,close)=>`${open}${text}${close}`,
  badge:theme=>({badge:(text,tone)=>policy('badge',[theme,text,tone])}).badge,
  matchHighlight:theme=>({matchHighlight:text=>policy('match',[theme,text])}).matchHighlight,
  invoke(fn,receiver,text,message){if(typeof fn!=='function')throw new TypeError(message);return Reflect.apply(fn,receiver,[text]);},
  invalidOperation(){throw new TypeError('Invalid explorer theme operation');}
});
export function getExplorerTheme(){return policy('theme',[]);}
export function getExplorerStyles(){return policy('styles',[]);}
