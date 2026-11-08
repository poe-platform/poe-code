import {invokeFeedback} from "./feedback.js";
export function createMetric({capacity,unit}) {
  invokeFeedback("validate",[capacity]);
  const state={values:Array(capacity).fill(null),count:0,cursor:0};
  return {
    push(value){return invokeFeedback("metricPush",[state,capacity,value]);},
    samples(){return Array.from({length:state.count},(_,i)=>state.values[(state.cursor-state.count+i+capacity)%capacity]);},
    render(width){return invokeFeedback("metricRender",[state,capacity,unit,width]);}
  };
}
