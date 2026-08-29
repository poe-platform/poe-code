export function finalize({primaryPresent, primary, census, publish}) {
  const state = {primaryPresent, primary, secondaryPresent: false, secondary: [], sampledWorkPresent: false, sampledWork: undefined, publicationAttempted: false, publicationSucceeded: false};
  const retain = (phase, reason) => {
    if (state.primaryPresent) {
      state.secondaryPresent = true;
      state.secondary.push({phase, present: true, reason});
    } else {
      state.primaryPresent = true;
      state.primary = reason;
    }
  };
  try {
    state.sampledWork = census();
    state.sampledWorkPresent = true;
  } catch (reason) {
    retain('final-census', reason);
  }
  state.publicationAttempted = true;
  try {
    publish(state);
    state.publicationSucceeded = true;
  } catch (reason) {
    retain('terminal-publication', reason);
  }
  return state;
}
