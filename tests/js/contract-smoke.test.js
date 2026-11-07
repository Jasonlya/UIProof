import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('project package metadata is valid', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)));
  assert.equal(packageJson.name, 'uiproof');
  assert.equal(packageJson.private, true);
  assert.match(packageJson.scripts.test, /node --test/);
});
