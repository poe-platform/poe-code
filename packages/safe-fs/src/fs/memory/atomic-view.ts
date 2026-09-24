import type { FileStat, FileSystem } from "../../contracts/filesystem.js";

/** Internal authority: inspections and stock mutations share one JavaScript turn. */
export interface MemoryAtomicView {
  stat(path: string): FileStat | undefined;
  names(path: string): readonly string[];
}
const views = new WeakMap<FileSystem, { view: MemoryAtomicView; intact: () => boolean }>();
export function registerMemoryAtomicView(fs: FileSystem, view: MemoryAtomicView, intact: () => boolean): void {
  views.set(fs, { view, intact });
}
export function memoryAtomicView(fs: FileSystem): MemoryAtomicView | undefined {
  const registered = views.get(fs);
  return registered?.intact() ? registered.view : undefined;
}
