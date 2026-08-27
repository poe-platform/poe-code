export function bind(api) {
  return {
    ...api,
    HistoryModel: class extends api.HistoryModel {
      build(plan, localTail = true) {
        return super.build(plan, localTail === true ? 'LOCAL-TAIL-HYPOTHESIS' : localTail === false ? 'FINITE-PERMISSIVE' : localTail);
      }
    },
  };
}
