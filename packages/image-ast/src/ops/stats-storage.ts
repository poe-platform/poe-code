import type {ImageStats} from "../ast.js";
import type {ImageByteStorage,StoredRgbaImage} from "../codecs/png-storage.js";
import {defaultRuntime} from "@poe-code/compression";
import {Pixels} from "./storage-raster.js";
import {imageStatsSteps} from "./stats.js";

/** Scan caller-backed pixels with a fixed cache and histogram working set. */
export async function computeStoredImageStats(image:StoredRgbaImage,storage:ImageByteStorage,signal:AbortSignal):Promise<ImageStats> {
  signal.throwIfAborted();
  const pixels=new Pixels(image,storage,signal),steps=imageStatsSteps(image);
  let next=steps.next();
  while(!next.done) {
    signal.throwIfAborted();
    if(next.value===undefined) {await defaultRuntime.yieldTurn(signal);next=steps.next(0);}
    else next=steps.next(await pixels.pixel(next.value));
  }
  signal.throwIfAborted();
  return next.value;
}
