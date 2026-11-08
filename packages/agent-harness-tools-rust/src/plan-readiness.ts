import type {PlanReadiness} from "./plans.js";
import {native} from "./native.js";
export function formatPlanReadinessLabel(label:string,readiness:PlanReadiness):string{return native.harnessReadinessLabel(label,readiness==="ready");}
export function comparePlanReadiness(left:{readiness:PlanReadiness},right:{readiness:PlanReadiness}):number{
 const rightReady=right.readiness==="ready",leftReady=left.readiness==="ready";
 return native.harnessCompareReadiness(leftReady,rightReady);
}
