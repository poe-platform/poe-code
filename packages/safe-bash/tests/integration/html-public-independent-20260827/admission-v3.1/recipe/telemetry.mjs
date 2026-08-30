import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync, readSync, writeSync } from "node:fs";
import { join } from "node:path";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export function fileHash(path) {
  const descriptor = openSync(path, "r"), buffer = Buffer.alloc(65536), hash = createHash("sha256");
  try {
    let count;
    while ((count = readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
  } finally { closeSync(descriptor); }
  return hash.digest("hex");
}
export function json(path, value) {
  const descriptor = openSync(path, "wx");
  try { writeSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}
export const readJson = path => JSON.parse(readFileSync(path, "utf8"));
export function journal(path) {
  const descriptor = openSync(path, "wx");
  return {
    append(value) { writeSync(descriptor, `${JSON.stringify({ at: new Date().toISOString(), ...value })}\n`); fsyncSync(descriptor); },
    close() { closeSync(descriptor); },
  };
}
export function memory(log, role, details = () => ({})) {
  const baseline = process.memoryUsage(), peaks = { ...baseline };
  let samples = 0, latest = baseline;
  function sample(phase) {
    latest = process.memoryUsage();
    for (const field of Object.keys(peaks)) peaks[field] = Math.max(peaks[field], latest[field]);
    samples++;
    const row = { type: "memory", role, pid: process.pid, ppid: process.ppid, phase, sample: samples, memory: latest, ...details() };
    log.append(row);
    return row;
  }
  log.append({ type: "baseline", role, pid: process.pid, ppid: process.ppid, memory: baseline });
  return { sample, snapshot: () => ({ baseline, fieldwisePeaks: { ...peaks }, latest, samples, fieldsUnit: "bytes", metric: "process.memoryUsage current samples; fieldwise maxima need not coincide" }) };
}
export function inventory(directory) {
  const files = {}, directories = [];
  function visit(relative) {
    for (const name of readdirSync(join(directory, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name, stat = lstatSync(join(directory, path));
      if (stat.isSymbolicLink()) throw new Error(`symlink forbidden: ${path}`);
      if (stat.isDirectory()) { directories.push(path); visit(path); }
      else if (stat.isFile()) files[path] = fileHash(join(directory, path));
      else throw new Error(`unsupported entry: ${path}`);
    }
  }
  visit("");
  return { files, directories };
}
export const errorRecord = error => ({ name: error.name, code: error.code ?? null, message: error.message, stack: error.stack, process: error.process ?? null });
