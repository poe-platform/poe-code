export function observePythonJspiUnhandledErrors(scope) {
  const errors = [];
  const listener = event => {
    const reason = event.type === 'unhandledrejection' ? event.reason : event.error ?? event.message;
    errors.push({type:event.type, reason:String(reason)});
  };
  scope.addEventListener('unhandledrejection', listener);
  scope.addEventListener('error', listener);
  return {
    snapshot() { return errors.map(error => ({...error})); },
    dispose() {
      scope.removeEventListener('unhandledrejection', listener);
      scope.removeEventListener('error', listener);
    },
  };
}
