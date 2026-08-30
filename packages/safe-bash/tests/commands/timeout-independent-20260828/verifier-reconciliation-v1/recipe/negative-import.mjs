let rejection;
try { await import(process.env.NEGATIVE_TARGET); } catch (error) { rejection = error; }
const observation = {
  classification: 'new-targeted-import-diagnosis', target: process.env.NEGATIVE_LABEL,
  caught: rejection !== undefined, productAcceptance: false,
  error: rejection === undefined ? null : {
    name: rejection.name, code: rejection.code, message: rejection.message,
    stack: rejection.stack, actual: rejection.actual, expected: rejection.expected,
    operator: rejection.operator, generatedMessage: rejection.generatedMessage,
    ownPropertyNames: Object.getOwnPropertyNames(rejection),
  },
};
console.log(JSON.stringify(observation));
if (rejection === undefined) process.exitCode = 1;
