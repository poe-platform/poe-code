import {invokeFeedback} from "./feedback.js";
export function renderNotice(notice,width){return invokeFeedback("notice",[notice,width]);}
export function createNotices({capacity,now=()=>performance.now()}) {
  invokeFeedback("validate",[capacity]);
  const notices=new Map();
  return {
    put(id,notice,durationMs=Infinity){return invokeFeedback("put",[notices,capacity,now,id,notice,durationMs]);},
    dismiss(id){notices.delete(id);},
    list(){return invokeFeedback("notices",[notices,now]);}
  };
}
