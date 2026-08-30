import assert from 'node:assert/strict';

const maximumFixtureBytes = 1048576;

function count(value) {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= 100001);
  return value;
}

function anchorLines(amount) {
  return '- &a 0\n'.repeat(count(amount));
}

function aliasDocument(amount) {
  return `[&a 0${', *a'.repeat(count(amount))}]\n`;
}

export function materializeRecipe(recipe) {
  let text;
  switch (recipe.kind) {
    case 'quoted-repeat':
      assert.equal(recipe.unit, '🙂');
      text = `"${recipe.unit.repeat(count(recipe.count))}"\n`;
      break;
    case 'anchor-reuse-lines':
      text = anchorLines(recipe.count);
      break;
    case 'two-documents-anchor-reuse':
      text = `${anchorLines(recipe.countEach)}---\n${anchorLines(recipe.countEach)}`;
      break;
    case 'two-documents-aliases':
      text = `${aliasDocument(recipe.first)}---\n${aliasDocument(recipe.second)}`;
      break;
    case 'explicit-null-documents':
      text = '---\n'.repeat(count(recipe.count));
      break;
    case 'plain-implicit-key':
      assert.equal(recipe.unit, '🙂');
      text = `${recipe.unit.repeat(count(recipe.count))}: 0\n`;
      break;
    default:
      throw new Error(`Unknown preparation recipe: ${recipe.kind}`);
  }
  const bytes = Buffer.from(text, 'utf8');
  assert(bytes.byteLength <= maximumFixtureBytes);
  return bytes;
}
