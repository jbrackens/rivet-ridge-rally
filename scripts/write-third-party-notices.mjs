import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const output = path.join(dist, 'THIRD_PARTY_NOTICES.txt');

const components = [
  {
    name: 'React',
    packageName: 'react',
    expectedVersion: '19.2.7',
    declaredLicense: 'MIT',
    use: 'Browser UI runtime',
    files: [{ label: 'LICENSE', source: 'node_modules/react/LICENSE' }],
  },
  {
    name: 'React DOM',
    packageName: 'react-dom',
    expectedVersion: '19.2.7',
    declaredLicense: 'MIT',
    use: 'Browser UI rendering runtime',
    files: [{ label: 'LICENSE', source: 'node_modules/react-dom/LICENSE' }],
  },
  {
    name: 'Scheduler',
    packageName: 'scheduler',
    expectedVersion: '0.27.0',
    declaredLicense: 'MIT',
    use: 'React DOM runtime dependency',
    files: [{ label: 'LICENSE', source: 'node_modules/scheduler/LICENSE' }],
  },
  {
    name: 'Three.js',
    packageName: 'three',
    expectedVersion: '0.185.1',
    declaredLicense: 'MIT',
    use: '3D renderer and runtime loaders',
    files: [{ label: 'LICENSE', source: 'node_modules/three/LICENSE' }],
  },
  {
    name: 'Zustand',
    packageName: 'zustand',
    expectedVersion: '5.0.14',
    declaredLicense: 'MIT',
    use: 'Browser application state',
    files: [{ label: 'LICENSE', source: 'node_modules/zustand/LICENSE' }],
  },
  {
    name: 'Zod',
    packageName: 'zod',
    expectedVersion: '4.4.3',
    declaredLicense: 'MIT',
    use: 'Runtime local-data validation',
    files: [{ label: 'LICENSE', source: 'node_modules/zod/LICENSE' }],
  },
  {
    name: 'Dexie',
    packageName: 'dexie',
    expectedVersion: '4.4.4',
    declaredLicense: 'Apache-2.0',
    use: 'IndexedDB persistence runtime',
    files: [
      { label: 'LICENSE', source: 'node_modules/dexie/LICENSE' },
      { label: 'NOTICE', source: 'node_modules/dexie/NOTICE' },
    ],
  },
  {
    name: 'Meshoptimizer',
    packageName: 'meshoptimizer',
    expectedVersion: '1.2.0',
    declaredLicense: 'MIT',
    use: 'Installed geometry encoder and runtime decoder embedded by Three.js (embedded decoder reports upstream build 1.1)',
    files: [{ label: 'LICENSE.md', source: 'node_modules/meshoptimizer/LICENSE.md' }],
  },
  {
    name: 'KTX-Parse',
    packageName: 'ktx-parse',
    expectedVersion: '1.1.0',
    declaredLicense: 'MIT',
    use: 'Installed KTX2 parser and runtime copy embedded by Three.js',
    files: [{ label: 'LICENSE', source: 'node_modules/ktx-parse/LICENSE' }],
  },
  {
    name: 'zstddec',
    version: '0.2.0',
    declaredLicense: 'MIT AND BSD-3-Clause',
    use: 'Zstandard decoder embedded by the Three.js KTX2 loader',
    files: [{
      label: 'LICENSE',
      source: 'docs/licenses/zstddec-0.2.0-LICENSE.txt',
      expectedSha256: '8d078b49fc02bd63c1beaf4ddc629a8b48e4ba6a435415408c8209e2a5c3aacf',
    }],
  },
  {
    name: 'Basis Universal transcoder',
    version: 'bundled with three@0.185.1',
    declaredLicense: 'Apache-2.0',
    use: 'Shipped KTX2 GPU texture transcoder',
    files: [
      { label: 'LICENSE', source: 'public/assets/transcoders/basis/LICENSE.txt' },
      { label: 'NOTICE', source: 'public/assets/transcoders/basis/NOTICE.txt' },
    ],
  },
];

function appendText(chunks, value) {
  chunks.push(Buffer.from(value, 'utf8'));
}

async function installedVersion(component) {
  if (!component.packageName) return component.version;
  const manifestPath = path.join(root, 'node_modules', component.packageName, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.version !== component.expectedVersion) {
    throw new Error(
      `${component.packageName} notice expects ${component.expectedVersion}, installed ${manifest.version ?? 'unknown'}`,
    );
  }
  return manifest.version;
}

await readdir(dist);

const chunks = [];
appendText(chunks, [
  'RIVET RIDGE RALLY',
  'THIRD-PARTY SOFTWARE NOTICES',
  '',
  'This distribution includes the components and complete license/notice texts below.',
  'Package versions are pinned and verified while this file is generated.',
  'The game\'s original code and assets are not licensed by this notice.',
  '',
].join('\n'));

for (const component of components) {
  const version = await installedVersion(component);
  appendText(chunks, `${'='.repeat(80)}\n`);
  appendText(chunks, `COMPONENT: ${component.name}\n`);
  appendText(chunks, `VERSION: ${version}\n`);
  appendText(chunks, `DECLARED LICENSE: ${component.declaredLicense}\n`);
  appendText(chunks, `USE: ${component.use}\n`);

  for (const file of component.files) {
    const contents = await readFile(path.join(root, file.source));
    if (contents.length === 0) throw new Error(`Empty notice source: ${file.source}`);
    const sourceSha256 = createHash('sha256').update(contents).digest('hex');
    if (file.expectedSha256 && sourceSha256 !== file.expectedSha256) {
      throw new Error(`Notice source hash mismatch: ${file.source}`);
    }
    appendText(chunks, `${'-'.repeat(80)}\n`);
    appendText(chunks, `FILE: ${file.label}\n`);
    appendText(chunks, `SOURCE: ${file.source}\n`);
    appendText(chunks, `${'-'.repeat(80)}\n`);
    chunks.push(contents);
    if (contents.at(-1) !== 0x0a) appendText(chunks, '\n');
    appendText(chunks, '\n');
  }
}

const notice = Buffer.concat(chunks);
await writeFile(output, notice);
const sha256 = createHash('sha256').update(notice).digest('hex');
console.log(`Third-party notices: ${notice.length} bytes`);
console.log(`SHA-256: ${sha256}`);
