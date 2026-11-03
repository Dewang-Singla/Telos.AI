import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const excluded = new Set(['node_modules', '.next', '.git', '.vercel', '.supabase', '.aws', '.codex', '.agents', 'backups', 'coverage', 'test-results', 'playwright-report', '.cache', 'out', 'tmp', '.DS_Store', 'Thumbs.db']);
export function shouldInclude(name) {
  return !excluded.has(name) && !(name.startsWith('.env') && name !== '.env.example') && !/\.(pem|key|p12|pfx|log|tsbuildinfo|zip)$/i.test(name) && !/^(credentials|secrets)(\.|$)/i.test(name);
}
const table = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let n = 0; n < 8; n++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buffer) {
  let c = 0xffffffff;
  for (const b of buffer) c = table[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export function createZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const filename = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01, valid portable DOS date
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function verifyZip(zip) {
  const entries = [];
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    const data = zip.subarray(start, start + size);
    if (data.length !== size || crc32(data) !== zip.readUInt32LE(offset + 14)) throw new Error(`ZIP checksum failed: ${name}`);
    entries.push(name);
    offset = start + size;
  }
  if (zip.readUInt32LE(zip.length - 22) !== 0x06054b50 || entries.length !== zip.readUInt16LE(zip.length - 12)) throw new Error('Invalid ZIP directory');
  return entries;
}
export async function exportHandoff(root) {
  const files = [];
  async function walk(directory, prefix = '') {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!shouldInclude(item.name) || item.isSymbolicLink()) continue;
      const relative = prefix + item.name;
      if (item.isDirectory()) await walk(path.join(directory, item.name), relative + '/');
      else if (item.isFile()) files.push({ name: relative, data: await readFile(path.join(directory, item.name)) });
    }
  }
  await walk(root);
  const zip = createZip(files);
  const entries = verifyZip(zip);
  for (const name of ['package.json', 'README.md', 'PROJECT_STATUS.md', 'AI_HANDOFF.md', 'NEXT_STEPS.md', 'DEPLOYMENT.md', 'CHANGELOG.md', 'scripts/export-handoff.mjs']) {
    if (!entries.includes(name)) throw new Error(`Missing required source: ${name}`);
  }
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '');
  const destination = path.join(root, 'backups', `telos-handoff-${timestamp}.zip`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, zip, { flag: 'wx' });
  verifyZip(await readFile(destination));
  const sha256 = createHash('sha256').update(zip).digest('hex');
  await writeFile(destination + '.sha256', `${sha256}  ${path.basename(destination)}\n`);
  return { archive: destination, files: entries.length, bytes: zip.length, sha256, verified: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await exportHandoff(path.resolve(fileURLToPath(new URL('..', import.meta.url)))), null, 2));
}
