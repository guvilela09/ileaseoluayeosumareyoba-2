import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the application scripts do not expose a portal demo launcher', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(packageJson.scripts, 'local'), false);
});

test('the backend no longer advertises or creates demo sessions', async () => {
  const appSource = await readFile(new URL('../../backend/app.py', import.meta.url), 'utf8');
  assert.equal(appSource.includes('/api/preview/session'), false);
  assert.equal(appSource.includes('seed_preview'), false);
});
