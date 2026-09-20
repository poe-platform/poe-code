import path from 'node:path';
export function writeWalk(target,home){const boundary=path.dirname(path.resolve(home)),walk=[];let current=path.resolve(target);while(current!==boundary){walk.push(current);const parent=path.dirname(current);if(parent===current)break;current=parent;}return walk;}
