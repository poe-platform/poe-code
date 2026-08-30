export const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
export class Resources {
  disposals = [];
  releases = [];
  restorations = [];
  pending = [];
  own(value) { this.disposals.push(() => value.dispose()); return value; }
  restore(callback) { this.restorations.push(callback); }
  release(callback) { this.releases.push(callback); }
  track(promise) { this.pending.push(promise); void promise.catch(() => undefined); return promise; }
  async close() {
    const errors = [];
    for (const release of this.releases.reverse()) try { release(); } catch (error) { errors.push(error); }
    for (const restore of this.restorations.reverse()) try { restore(); } catch (error) { errors.push(error); }
    for (const dispose of this.disposals.reverse()) try { await dispose(); } catch (error) { errors.push(error); }
    const settled = await Promise.allSettled(this.pending);
    return { errors, pending: settled.map(value => value.status), disposed: true, settled: true };
  }
}
export async function executeRows(rows, body) {
  const observations = [];
  for (const row of rows) {
    const resources = new Resources();
    let error, details, failed = false;
    try { details = await body(row, resources); } catch (reason) { error = reason; failed = true; }
    const closure = await resources.close();
    const observation = { id: row.id, pass: !failed && closure.errors.length === 0, details, error: failed ? String(error?.stack ?? error) : null, cleanupErrors: closure.errors.map(String), disposed: closure.disposed, settled: closure.settled };
    observations.push(observation);
    emit({ observation });
  }
  const failed = observations.filter(row => !row.pass).map(row => row.id);
  emit({ summary: { cases: observations.length, pass: observations.length - failed.length, failed } });
  process.exitCode = failed.length ? 1 : 0;
  return observations;
}
