import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const output = path.join(root, 'artifacts', 'release-manifest.json');
const requiredNotice = 'THIRD_PARTY_NOTICES.txt';
const forbiddenByteSequences = [
  { label: 'QA runtime marker __RRR_QA__', value: Buffer.from('__RRR_QA__') },
  { label: 'absolute local /Users/ path', value: Buffer.from('/Users/') },
];

function compareNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort(compareNames)) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

await rm(output, { force: true });
const files = await walk(dist);
const relativePaths = files.map((absolute) => path.relative(dist, absolute).split(path.sep).join('/'));
if (!relativePaths.includes(requiredNotice)) {
  throw new Error(`Release guard failed: dist/${requiredNotice} is missing`);
}

const sourceMaps = relativePaths.filter((relative) => relative.toLowerCase().endsWith('.map'));
if (sourceMaps.length > 0) {
  throw new Error(`Release guard failed: source maps present: ${sourceMaps.join(', ')}`);
}

const records = [];
for (const [index, absolute] of files.entries()) {
  const contents = await readFile(absolute);
  const relative = relativePaths[index];
  for (const forbidden of forbiddenByteSequences) {
    if (contents.includes(forbidden.value)) {
      throw new Error(`Release guard failed: ${forbidden.label} found in dist/${relative}`);
    }
  }
  records.push({
    path: relative,
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}

const aggregate = createHash('sha256');
for (const record of records) aggregate.update(`${record.sha256}  ${record.path}\n`);

const packageManifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (typeof packageManifest.version !== 'string' || packageManifest.version.length === 0) {
  throw new Error('Release guard failed: package version is missing');
}

const manifest = {
  product: 'RIVET RIDGE RALLY',
  version: packageManifest.version,
  format: 1,
  totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
  fileCount: records.length,
  aggregateSha256: aggregate.digest('hex'),
  files: records,
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Release manifest: ${records.length} files, ${manifest.totalBytes} bytes`);
console.log(`Aggregate SHA-256: ${manifest.aggregateSha256}`);
