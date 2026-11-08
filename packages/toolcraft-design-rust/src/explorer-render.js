import {createRequire} from 'node:module';
import {createComponentPolicy} from './component-host.js';
import {computeExplorerLayout} from './explorer-layout.js';
import {REGION_ALL,REGION_DETAIL,REGION_FOOTER,REGION_HEADER,REGION_LIST,REGION_MODAL} from './explorer-state.js';
import {getExplorerStyles} from './explorer-theme.js';
import {renderDetail} from './explorer-detail.js';
import {renderFooter} from './explorer-footer.js';
import {renderHeader} from './explorer-header.js';
import {renderList} from './explorer-list.js';
import {renderModal} from './explorer-modal.js';
import {fitToWidth} from './explorer-text.js';
const native=createRequire(import.meta.url)('./toolcraft-design-rust.node');
const regions=[[REGION_HEADER,renderHeader],[REGION_LIST,renderList],[REGION_DETAIL,renderDetail],[REGION_FOOTER,renderFooter],[REGION_MODAL,(state,screen)=>renderModal(state,screen)]];
const policy=createComponentPolicy(native.designExplorerRenderPolicy,{
  undefined:()=>undefined,null:()=>null,object:()=>({}),all:()=>REGION_ALL,modalMask:()=>REGION_MODAL,
  assign:(value,key,item)=>{Object.defineProperty(value,key,{value:item,writable:true,enumerable:true,configurable:true});},
  same:(a,b)=>a===b,le:(a,b)=>a<=b,subtract:(a,b)=>a-b,max:Math.max,and:(a,b)=>a&b,
  template:(left,middle,right)=>`${left}${middle}${right}`,
  layout:computeExplorerLayout,styles:getExplorerStyles,fit:fitToWidth,modal:renderModal,
  walk(state,screen,layout,dirty){for(const [region,render]of regions)policy('region',[region,render,state,screen,layout,dirty]);},
  render:(render,state,screen,layout)=>render(state,screen,layout),
  clear(method,receiver,rect){if(typeof method!=='function')throw new TypeError('screen.clearRect is not a function');return Reflect.apply(method,receiver,[rect]);},
  put(method,receiver,...args){if(typeof method!=='function')throw new TypeError('screen.put is not a function');return Reflect.apply(method,receiver,args);},
  invalidOperation(){throw new TypeError('Invalid explorer render operation');}
});
export function renderExplorer(state,screen){policy('render',[state,screen]);}
export {renderDetail,renderFooter,renderHeader,renderList,renderModal};
