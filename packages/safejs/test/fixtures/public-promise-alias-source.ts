export const aliasSource = `export default async fixture => {
  const input = fixture === undefined ? incoming : fixture;
  const promiseAlias = input.primary === input.again;
  const first = await input.primary;
  const repeated = await input.primary;
  first.seen = true;
  const alias = await input.again;
  return {
    promiseAlias,
    value: first.value,
    sameHandle: first === repeated,
    sameAlias: first === alias,
    markerVisible: alias.seen === true
  };
};
`;
