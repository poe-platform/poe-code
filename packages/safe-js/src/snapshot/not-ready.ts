/** A live run may reach a later serializable yield without restoring native frames. */
export class SnapshotNotReadyError extends TypeError {}
