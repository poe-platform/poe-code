import { Client, Capacity } from "../client.js";
import type { Descriptor, Hit } from "../protocol.js";

let tail = Promise.resolve();
let waiting = 0;
const sessions = new Map<string, Client>();
export const observations = { active: 0, peak: 0, completed: 0, created: 0, terminated: 0, peakWaiting: 0, idleWorkers: 0 };
export async function workerHits(regex: RegExp, text: string, all: boolean): Promise<Hit[]> {
  if (waiting >= 8) throw new Error("TEST_QUEUE_CAP");
  waiting++;
  observations.peakWaiting = Math.max(observations.peakWaiting, waiting);
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  waiting--;
  observations.active++;
  observations.peak = Math.max(observations.peak, observations.active);
  try {
    const key = JSON.stringify([regex.source, regex.flags]);
    let client = sessions.get(key);
    if (!client) {
      if (sessions.size >= 4) throw new Error("TEST_SESSION_CAP");
      const flags: Descriptor["flags"] = regex.unicode ? regex.ignoreCase ? "gui" : "gu" : regex.ignoreCase ? "gi" : "g";
      client = new Client([{ source: regex.source, flags }], new Capacity());
      sessions.set(key, client);
    }
    return (await client.batch([{ text, all }])).hits[0]!;
  }
  finally {
    observations.completed++;
    observations.active--;
    observations.idleWorkers = sessions.size;
    release();
  }
}
export async function disposeAdapter(): Promise<void> {
  await tail;
  for (const client of sessions.values()) {
    await client.dispose();
    observations.created += client.metrics.created;
    observations.terminated += client.metrics.terminated;
  }
  sessions.clear();
  observations.idleWorkers = 0;
}
