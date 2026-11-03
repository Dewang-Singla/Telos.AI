import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldInclude, createZip, verifyZip, crc32 } from './export-handoff.mjs';

test('excludes private environment, credentials, generated output and nested metadata', () => {
  for (const name of ['.env', '.env.local', '.env.production', '.env.local.bak', 'credentials.json', 'secrets.txt', 'private.key', 'certificate.pem', 'node_modules', 'backups', '.git', '.aws', '.codex']) assert.equal(shouldInclude(name), false, name);
  for (const name of ['.env.example', 'package-lock.json', 'src', 'supabase', 'README.md']) assert.equal(shouldInclude(name), true, name);
});
test('ZIP roundtrip verifies UTF-8 paths and rejects damaged contents', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const zip = createZip([{ name: 'src/hello.ts', data: Buffer.from('hello') }, { name: 'docs/नमस्ते.md', data: Buffer.from('Telos') }]);
  assert.deepEqual(verifyZip(zip), ['src/hello.ts', 'docs/नमस्ते.md']);
  zip[30 + Buffer.byteLength('src/hello.ts')] ^= 1;
  assert.throws(() => verifyZip(zip), /checksum/);
});
