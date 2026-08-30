export function eventTime(value) {
  if (typeof value !== 'string' || value.length > 80) return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*(Z|[+-]\d{2}:?\d{2})$/.exec(value);
  if (!match) return NaN;
  const [,year,month,day,hour,minute,second,fraction,zone] = match;
  const numeric = [year,month,day,hour,minute,second].map(Number);
  if (numeric[1]<1||numeric[1]>12||numeric[2]<1||numeric[2]>31||numeric[3]>23||numeric[4]>59||numeric[5]>59) return NaN;
  const base = Date.UTC(numeric[0],numeric[1]-1,numeric[2],numeric[3],numeric[4],numeric[5]);
  const date = new Date(base);
  if(date.getUTCFullYear()!==numeric[0]||date.getUTCMonth()!==numeric[1]-1||date.getUTCDate()!==numeric[2])return NaN;
  let offset=0;
  if(zone!=='Z'){const clean=zone.replace(':','');const hours=Number(clean.slice(1,3)),minutes=Number(clean.slice(3,5));if(hours>23||minutes>59)return NaN;offset=(hours*60+minutes)*60000*(zone[0]==='+'?1:-1);}
  return base-offset+Number('0.'+(fraction??'0'))*1000;
}
export function assessHeader(fields, plan) {
  const timestamp = eventTime(fields.captureTime);
  const predicates = {
    crashSchema309: String(fields.bugType)==='309',
    pidPresent: Object.hasOwn(fields,'pid'),
    pidInteger: Number.isSafeInteger(fields.pid),
    pidMatches: fields.pid===plan.pid,
    eventTimestampPresent: typeof fields.captureTime==='string',
    eventTimestampUnambiguous: Number.isFinite(timestamp),
    eventWithinAuthorizedWindow: Number.isFinite(timestamp)&&timestamp>=plan.started-120000&&timestamp<=plan.finished+120000
  };
  const matched = Object.values(predicates).every(Boolean);
  return {matched,predicates,failedPredicates:Object.entries(predicates).filter(([,pass])=>!pass).map(([name])=>name),...(matched?{eventTimestampField:'captureTime',eventTimestampMs:timestamp,imageClass:fields.procName==='node'?'NODE':fields.procName==='sandbox-exec'?'SANDBOX_EXEC':typeof fields.procName==='string'&&fields.procName.length?'OTHER_IMAGE':'MISSING_IMAGE',imageNamePresent:typeof fields.procName==='string'&&fields.procName.length>0,imagePathPresent:typeof fields.procPath==='string'&&fields.procPath.length>0}:{})};
}
export function processImagePath(value) {
  return typeof value==='string'&&value.length<=2048&&value.startsWith('/')&&!/[\x00-\x1f\x7f]/.test(value)?value:undefined;
}
