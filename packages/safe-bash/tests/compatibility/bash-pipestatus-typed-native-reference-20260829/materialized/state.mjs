export function completion(row){return row.exit===true&&row.close===true&&row.group?.state==='absent'&&row.signal===null&&row.stop===null&&row.errors.length===0&&Array.isArray(row.capture)&&row.capture.length===2&&row.capture.every(item=>item.flush&&item.size&&item.hash&&item.close)&&row.filesVerified===true&&row.receiptPublished===true;}
export function cleanupTimes(firstStop,termMs=2000,killMs=1000){return {termAt:firstStop,killAt:firstStop+termMs,endAt:firstStop+termMs+killMs};}
export function deadlineAdmission(now,deadline,caseMs=3000,termMs=2000,killMs=1000,tailMs=60000){return now+caseMs+termMs+killMs+tailMs<=deadline;}
export class ManagedLedger{
 constructor(max=80,peak=6){this.max=max;this.peak=peak;this.starts=1;this.active=1;this.peakCharged=1;this.confirmedStarts=1;this.activeConfirmed=1;this.peakConfirmed=1;this.confirmedRoles={owner:1};this.roles={owner:1};this.sourceForkReservations=0;}
 enter(role){if(!['case','control'].includes(role)||this.starts+1>this.max||this.active+1>this.peak)throw Error('MANAGED_ADMISSION_CAP');this.starts++;this.active++;this.roles[role]=(this.roles[role]??0)+1;this.peakCharged=Math.max(this.peakCharged,this.active);}
 confirm(role){this.confirmedStarts++;this.activeConfirmed++;this.confirmedRoles[role]=(this.confirmedRoles[role]??0)+1;this.peakConfirmed=Math.max(this.peakConfirmed,this.activeConfirmed);if(this.confirmedStarts>this.starts)throw Error('UNADMITTED_SPAWN');}
 retire(confirmed=false){if(this.active<2)throw Error('RETIREMENT_UNDERFLOW');this.active--;if(confirmed)this.activeConfirmed--; }
}
export function creditObservation(row,storage,completed){
 if(!completion(row))throw Error('OBSERVATION_INELIGIBLE');
 storage.checkTime();
 storage.record({event:'OBSERVATION_READY_FOR_CREDIT',id:row.id});
 storage.checkTime();
 return completed+1;
}
