import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

const FIXTURE_NAME = 'release-manifest-fixture';
const FIXTURE_VERSION = '1.0.0-rc.2';
const FIXTURE_NPM_VERSION = '11.17.0';
const FIXTURE_SOURCE = 'tracked-fixture-source';
const FAKE_NPM_CLI = "import '../lib/runtime.mjs';\n";
const HOST_NPM_FIXTURE_BUILD = String.raw`
import { mkdir, rm, writeFile } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await writeFile('dist/THIRD_PARTY_NOTICES.txt', 'Fixture notices.\n');
await writeFile('dist/index.html', 'host-npm-fixture=ok\n');
`.trimStart();
const FAKE_NPM_RUNTIME = String.raw`
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const userConfig = process.env.npm_config_userconfig;
const globalConfig = process.env.npm_config_globalconfig;
if (process.env.npm_config_ignore_scripts !== 'false') process.exit(46);
if (!userConfig || !globalConfig || userConfig === globalConfig) process.exit(47);
try {
  if ((await readFile(userConfig, 'utf8')) !== '') process.exit(48);
  if ((await readFile(globalConfig, 'utf8')) !== '') process.exit(49);
} catch {
  process.exit(50);
}

const [command, ...args] = process.argv.slice(2);
if (command === '--version') {
  console.log('11.17.0');
  process.exit(0);
}

if (command === 'ci') {
  if (JSON.stringify(args) !== JSON.stringify(['--no-audit', '--no-fund'])) process.exit(41);
  if (!['0', '1'].includes(process.env.VITE_QA_MODE)) process.exit(42);
  await mkdir('node_modules', { recursive: true });
  await writeFile(path.join('node_modules', '.fixture-installed'), 'ci-ok\n');
  const mode = (await readFile('BUILD_MODE.txt', 'utf8')).trim();
  if (mode === 'ignored-after-ci') await writeFile('.env.ci', 'hostile ignored input\n');
  process.exit(0);
}

if (command === 'run' && JSON.stringify(args) === JSON.stringify(['build'])) {
  try {
    await access(path.join('node_modules', '.fixture-installed'));
  } catch {
    process.exit(43);
  }
  if (!['0', '1'].includes(process.env.VITE_QA_MODE) || process.env.NODE_ENV !== 'production') process.exit(44);

  const mode = (await readFile('BUILD_MODE.txt', 'utf8')).trim();
  const source = (await readFile('SOURCE.txt', 'utf8')).trim();
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist', { recursive: true });
  if (mode !== 'missing-notice') {
    await writeFile(path.join('dist', 'THIRD_PARTY_NOTICES.txt'), 'Fixture notices.\n');
  }
  let body = 'source=' + source + '\nci=ok\nqa=' + process.env.VITE_QA_MODE
    + '\nnodeEnv=' + process.env.NODE_ENV + '\n';
  if (process.env.VITE_QA_MODE === '1') body += '__RRR_QA__\n';
  if (mode === 'qa-marker') body += '__RRR_QA__\n';
  if (mode === 'performance-capture-marker') body += '__RRR_PERF_CAPTURE__\n';
  if (mode === 'product-performance-marker') body += '__RRR_PERFORMANCE__\n';
  if (mode === 'local-path') body += 'file:///Users/fixture/project\n';
  if (mode === 'source-path') body += await readFile('SOURCE_ROOT.txt', 'utf8');
  if (mode === 'worktree-path') body += process.cwd() + '\n';
  if (mode === 'temp-path') body += process.env.TMPDIR + '\n';
  if (mode === 'linux-path') body += 'file:///home/fixture/project\n';
  if (mode === 'windows-path') {
    body += 'file:///C:/Users/fixture/project\n';
  }
  if (mode === 'generic-file-api') {
    body += 'filename.startsWith("file://")\n';
    body += 'route=/home/account\n';
    body += 'pattern=\\\\Users\\\\\n';
  }
  if (mode === 'file-url') body += 'file:///opt/fixture/project\n';
  if (mode === 'private-key') body += '-----BEGIN PRIVATE KEY-----\nfixture\n';
  if (mode === 'live-token') body += 'ghp_' + 'A'.repeat(36) + '\n';
  if (mode === 'short-token-prefix-noise') body += 'binary-ish-noise=ghp_abcd\n';
  await writeFile(path.join('dist', 'index.html'), body);
  if (mode === 'source-map') await writeFile(path.join('dist', 'bundle.js.map'), '{}\n');
  if (mode === 'symlink') await symlink('../SOURCE.txt', path.join('dist', 'source-link'));
  if (mode === 'ignored-after-build') await writeFile('.env.build', 'hostile ignored input\n');
  if (mode === 'replace-tag-object') {
    execFileSync(
      'git',
      ['tag', '-f', '-a', 'v1.0.0-rc.2', '-m', 'replacement annotated tag', 'HEAD'],
      { stdio: 'ignore' },
    );
  }
  if (mode === 'mutate-npm-cli') {
    const npmCli = await readFile(process.argv[1], 'utf8');
    await writeFile(process.argv[1], npmCli + '\n// mutated during build\n');
  }
  if (mode === 'mutate-npm-implementation') {
    const implementationPath = fileURLToPath(import.meta.url);
    const implementation = await readFile(implementationPath, 'utf8');
    await writeFile(implementationPath, implementation + '\n// mutated during build\n');
  }
  process.exit(0);
}

process.exit(45);
`.trimStart();
const PREINSTALL_HOOK = String.raw`#!/usr/bin/env node
import { existsSync, writeFileSync } from 'node:fs';
if (existsSync('PREINSTALL_IGNORED.txt')) writeFileSync('.env.preinstall', 'hostile ignored input\n');
`;

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function treeMode(entryStat) {
  return Number(entryStat.mode & 0o7777n).toString(8).padStart(4, '0');
}

function updateTreeRecord(hash, fields) {
  for (const field of fields) {
    hash.update(String(field));
    hash.update('\0');
  }
}

async function fixtureNpmPackageProvenance(packageRoot) {
  const treeHash = createHash('sha256');
  let directoryCount = 0;
  let regularFileCount = 0;
  let symlinkCount = 0;
  let totalRegularFileBytes = 0;

  async function walk(absolute, relative) {
    const entryStat = await lstat(absolute, { bigint: true });
    const mode = treeMode(entryStat);
    if (entryStat.isDirectory()) {
      directoryCount += 1;
      updateTreeRecord(treeHash, ['D', relative, mode]);
      const entries = (await readdir(absolute, { withFileTypes: true })).toSorted(
        (left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
      );
      for (const entry of entries) {
        await walk(
          path.join(absolute, entry.name),
          relative === '.' ? entry.name : `${relative}/${entry.name}`,
        );
      }
    } else if (entryStat.isFile()) {
      const contents = await readFile(absolute);
      regularFileCount += 1;
      totalRegularFileBytes += contents.byteLength;
      updateTreeRecord(treeHash, ['F', relative, mode, contents.byteLength, sha256(contents)]);
    } else if (entryStat.isSymbolicLink()) {
      const target = await readlink(absolute, { encoding: 'buffer' });
      symlinkCount += 1;
      updateTreeRecord(treeHash, ['L', relative, mode, target.byteLength, sha256(target)]);
    } else {
      throw new Error(`Unexpected fake npm package entry: ${relative}`);
    }
  }

  await walk(packageRoot, '.');
  const packageJsonContents = await readFile(path.join(packageRoot, 'package.json'));
  return {
    treeFormat: 1,
    name: 'npm',
    version: FIXTURE_NPM_VERSION,
    cliRelativePath: 'bin/npm-cli.js',
    packageJsonSha256: sha256(packageJsonContents),
    directoryCount,
    regularFileCount,
    symlinkCount,
    totalRegularFileBytes,
    treeSha256: treeHash.digest('hex'),
  };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture({
  buildMode = 'valid',
  tagMode = 'annotated',
  nodeVersion = process.versions.node,
  packageManagerVersion = FIXTURE_NPM_VERSION,
  lockVersion = FIXTURE_VERSION,
  preinstallIgnored = false,
  sidecarDirectory = false,
} = {}) {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'rrr-release-manifest-'));
  const directory = path.join(fixtureRoot, 'repository');
  const npmPackageRoot = path.join(fixtureRoot, 'npm-package');
  await mkdir(directory, { recursive: true });
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await copyFile(
    new URL('./release-manifest.mjs', import.meta.url),
    path.join(directory, 'scripts', 'release-manifest.mjs'),
  );
  await mkdir(path.join(npmPackageRoot, 'bin'), { recursive: true });
  await mkdir(path.join(npmPackageRoot, 'lib'), { recursive: true });
  await mkdir(path.join(npmPackageRoot, 'node_modules', '.bin'), { recursive: true });
  await writeJson(path.join(npmPackageRoot, 'package.json'), {
    name: 'npm',
    version: FIXTURE_NPM_VERSION,
    type: 'module',
    bin: { npm: 'bin/npm-cli.js' },
  });
  await writeFile(path.join(npmPackageRoot, 'bin', 'npm-cli.js'), FAKE_NPM_CLI);
  await writeFile(path.join(npmPackageRoot, 'lib', 'runtime.mjs'), FAKE_NPM_RUNTIME);
  await symlink('../../lib/runtime.mjs', path.join(npmPackageRoot, 'node_modules', '.bin', 'runtime'));
  await mkdir(path.join(directory, '.githooks'), { recursive: true });
  await writeFile(path.join(directory, '.githooks', 'post-checkout'), PREINSTALL_HOOK);
  await chmod(path.join(directory, '.githooks', 'post-checkout'), 0o755);
  await writeJson(path.join(directory, 'package.json'), {
    name: FIXTURE_NAME,
    version: FIXTURE_VERSION,
    private: true,
    type: 'module',
    packageManager: `npm@${packageManagerVersion}`,
    scripts: { build: 'node scripts/host-npm-fixture-build.mjs' },
  });
  await writeJson(path.join(directory, 'package-lock.json'), {
    name: FIXTURE_NAME,
    version: lockVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: FIXTURE_NAME,
        version: lockVersion,
      },
    },
  });
  await writeFile(path.join(directory, '.node-version'), `${nodeVersion}\n`);
  await writeFile(
    path.join(directory, '.gitignore'),
    '/dist/\n/node_modules/\n.env.*\n/artifacts/release-manifest.json\n/artifacts/candidate-evidence/\n',
  );
  await writeFile(path.join(directory, 'README.md'), 'Release manifest fixture.\n');
  await writeFile(path.join(directory, 'scripts', 'host-npm-fixture-build.mjs'), HOST_NPM_FIXTURE_BUILD);
  await writeFile(path.join(directory, 'SOURCE.txt'), `${FIXTURE_SOURCE}\n`);
  await writeFile(path.join(directory, 'SOURCE_ROOT.txt'), `${await realpath(directory)}\n`);
  await writeFile(path.join(directory, 'BUILD_MODE.txt'), `${buildMode}\n`);
  await writeFile(
    path.join(directory, 'hostile-global.npmrc'),
    'ignore-scripts=true\nscript-shell=/definitely/not/a/release-shell\n',
  );
  if (preinstallIgnored) {
    await writeFile(path.join(directory, 'PREINSTALL_IGNORED.txt'), 'enabled\n');
  }

  git(directory, 'init', '-q');
  git(directory, 'config', 'user.name', 'Release Fixture');
  git(directory, 'config', 'user.email', 'release-fixture@example.invalid');
  git(directory, 'config', 'core.hooksPath', path.join(directory, '.githooks'));
  git(directory, 'add', '.');
  git(directory, 'commit', '-q', '-m', 'Fixture source');

  const expectedTag = `v${FIXTURE_VERSION}`;
  if (tagMode === 'annotated' || tagMode === 'misaligned') {
    git(directory, 'tag', '-a', expectedTag, '-m', expectedTag);
  } else if (tagMode === 'lightweight') git(directory, 'tag', expectedTag);
  else if (tagMode === 'wrong') git(directory, 'tag', '-a', 'v1.0.0-rc.1', '-m', 'wrong tag');
  if (tagMode === 'misaligned') {
    await writeFile(path.join(directory, 'AFTER_TAG.md'), 'Later clean commit.\n');
    git(directory, 'add', 'AFTER_TAG.md');
    git(directory, 'commit', '-q', '-m', 'Later source');
  }

  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'FOREIGN.txt'), 'stale foreign root artifact\n');
  await mkdir(path.join(directory, 'artifacts'), { recursive: true });
  const sidecar = path.join(directory, 'artifacts', 'release-manifest.json');
  if (sidecarDirectory) {
    await mkdir(sidecar, { recursive: true });
    await writeFile(path.join(sidecar, 'stale.txt'), 'stale manifest directory\n');
  } else {
    await writeFile(sidecar, 'stale manifest\n');
  }
  return directory;
}

function runManifest(
  directory,
  {
    npmExecPath = path.join(path.dirname(directory), 'npm-package', 'bin', 'npm-cli.js'),
    pathPrefix = null,
    profile = 'release',
  } = {},
) {
  const hostileConfig = path.join(directory, 'hostile-global.npmrc');
  const environment = {
    ...process.env,
    VITE_QA_MODE: '1',
    npm_config_globalconfig: hostileConfig,
    npm_config_userconfig: hostileConfig,
    npm_config_ignore_scripts: 'true',
  };
  if (npmExecPath === null) delete environment.npm_execpath;
  else environment.npm_execpath = npmExecPath;
  if (pathPrefix) environment.PATH = `${pathPrefix}${path.delimiter}${environment.PATH ?? ''}`;
  const profileArgs = profile === 'release' ? [] : ['--profile', profile];
  return spawnSync(process.execPath, ['scripts/release-manifest.mjs', ...profileArgs], {
    cwd: directory,
    encoding: 'utf8',
    env: environment,
  });
}

async function assertFailedClosed(directory, result, message, { preserveRootOutputs = false } = {}) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, message);
  if (preserveRootOutputs) {
    assert.equal(
      await readFile(path.join(directory, 'dist', 'FOREIGN.txt'), 'utf8'),
      'stale foreign root artifact\n',
    );
  } else {
    await assert.rejects(access(path.join(directory, 'artifacts', 'release-manifest.json')));
    await assert.rejects(access(path.join(directory, 'dist')));
  }
  const worktrees = git(directory, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1);
}

test('builds format-2 bytes from tracked source with the exact npm package in a detached checkout', async (t) => {
  const directory = await createFixture({ buildMode: 'generic-file-api' });
  t.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
  const hostileBin = await mkdtemp(path.join(tmpdir(), 'rrr-hostile-node-'));
  t.after(() => rm(hostileBin, { recursive: true, force: true }));
  await writeFile(
    path.join(hostileBin, 'node'),
    `#!/bin/sh\nif [ "$1" = "--eval" ]; then exit 97; fi\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
  );
  await chmod(path.join(hostileBin, 'node'), 0o755);

  const result = runManifest(directory, { pathPrefix: hostileBin });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(
    await readFile(path.join(directory, 'artifacts', 'release-manifest.json'), 'utf8'),
  );
  const packageLockContents = await readFile(path.join(directory, 'package-lock.json'));
  const npmPackageRoot = path.join(path.dirname(directory), 'npm-package');
  const npmCliContents = await readFile(path.join(npmPackageRoot, 'bin', 'npm-cli.js'));
  const npmPackage = await fixtureNpmPackageProvenance(npmPackageRoot);
  const nodeExecutableContents = await readFile(process.execPath);
  assert.equal(manifest.format, 2);
  assert.deepEqual(manifest.source, {
    commit: git(directory, 'rev-parse', 'HEAD^{commit}'),
    tag: `v${FIXTURE_VERSION}`,
    tagObject: git(directory, 'rev-parse', `refs/tags/v${FIXTURE_VERSION}`),
    tagObjectType: 'tag',
  });
  assert.deepEqual(manifest.toolchain, {
    node: process.versions.node,
    nodeExecutableSha256: sha256(nodeExecutableContents),
    npm: FIXTURE_NPM_VERSION,
    npmCliSha256: sha256(npmCliContents),
    npmPackage,
    platform: process.platform,
    arch: process.arch,
    packageLockSha256: sha256(packageLockContents),
  });
  assert.deepEqual(manifest.build, {
    source: 'detached-clean-git-worktree',
    installCommand: 'npm ci --no-audit --no-fund',
    buildCommand: 'npm run build',
    viteQaMode: '0',
    npmConfig: 'isolated-empty-user-and-global',
    installScripts: 'enabled',
  });
  assert.deepEqual(manifest.files.map((record) => record.path), [
    'THIRD_PARTY_NOTICES.txt',
    'index.html',
  ]);
  assert.deepEqual(manifest.compression, { algorithm: 'gzip', level: 9 });
  assert.equal(
    manifest.totalGzipBytes,
    manifest.files.reduce((sum, record) => sum + record.gzipBytes, 0),
  );
  for (const record of manifest.files) {
    const contents = await readFile(path.join(directory, 'dist', record.path));
    const gzipContents = gzipSync(contents, { level: 9 });
    assert.equal(record.gzipBytes, gzipContents.length);
    assert.equal(record.gzipSha256, sha256(gzipContents));
  }

  const builtIndex = await readFile(path.join(directory, 'dist', 'index.html'), 'utf8');
  assert.match(builtIndex, new RegExp(`source=${FIXTURE_SOURCE}`));
  assert.match(builtIndex, /ci=ok/);
  assert.match(builtIndex, /qa=0/);
  assert.match(builtIndex, /nodeEnv=production/);
  assert.match(builtIndex, /filename\.startsWith\("file:\/\/"\)/);
  assert.match(builtIndex, /route=\/home\/account/);
  assert.match(builtIndex, /pattern=\\\\Users\\\\/);
  await assert.rejects(access(path.join(directory, 'dist', 'FOREIGN.txt')));
  assert.equal(git(directory, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  const worktrees = git(directory, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1);
});

test('qualifies the installed npm package tree against a detached fixture', async (t) => {
  const npmExecPath = process.env.npm_execpath;
  assert.equal(
    typeof npmExecPath === 'string' && path.isAbsolute(npmExecPath),
    true,
    'test:release-manifest requires an absolute npm_execpath from npm run',
  );
  const directory = await createFixture();
  t.after(() => rm(path.dirname(directory), { recursive: true, force: true }));

  const result = runManifest(directory, { npmExecPath });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(await readFile(
    path.join(directory, 'artifacts', 'release-manifest.json'),
    'utf8',
  ));
  assert.equal(manifest.toolchain.npm, FIXTURE_NPM_VERSION);
  assert.equal(manifest.toolchain.npmPackage.name, 'npm');
  assert.equal(manifest.toolchain.npmPackage.version, FIXTURE_NPM_VERSION);
  assert.ok(manifest.toolchain.npmPackage.regularFileCount > 1);
  assert.ok(manifest.toolchain.npmPackage.totalRegularFileBytes > 0);
  assert.match(
    await readFile(path.join(directory, 'dist', 'index.html'), 'utf8'),
    /host-npm-fixture=ok/,
  );
});

test('builds a pre-tag visual candidate bound to the same complete npm package tree', async (t) => {
  const directory = await createFixture({ tagMode: 'none' });
  t.after(() => rm(path.dirname(directory), { recursive: true, force: true }));

  const result = runManifest(directory, { profile: 'visual-qa' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

  const manifest = JSON.parse(await readFile(
    path.join(directory, 'artifacts', 'candidate-evidence', 'visual', 'current', 'manifest.json'),
    'utf8',
  ));
  const npmPackageRoot = path.join(path.dirname(directory), 'npm-package');
  assert.equal(manifest.kind, 'visual-qa-candidate');
  assert.equal(manifest.format, 1);
  assert.equal(manifest.source.expectedVersionTagAtCommit, false);
  assert.equal(manifest.source.expectedVersionTagObject, null);
  assert.equal(manifest.source.expectedVersionTagObjectType, null);
  assert.deepEqual(manifest.toolchain.npmPackage, await fixtureNpmPackageProvenance(npmPackageRoot));
  assert.equal(await readFile(path.join(directory, 'dist', 'FOREIGN.txt'), 'utf8'), 'stale foreign root artifact\n');
});

test('allows short token-prefix coincidences that are not token-shaped', async (t) => {
  const directory = await createFixture({ buildMode: 'short-token-prefix-noise' });
  t.after(() => rm(path.dirname(directory), { recursive: true, force: true }));

  const result = runManifest(directory);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('rejects visual candidates captured after the expected annotated or lightweight tag', async (t) => {
  for (const tagMode of ['annotated', 'lightweight']) {
    await t.test(tagMode, async (subtest) => {
      const directory = await createFixture({ tagMode });
      subtest.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
      const result = runManifest(directory, { profile: 'visual-qa' });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /visual QA candidate must be captured before creating v1\.0\.0-rc\.2/,
      );
      await assert.rejects(access(
        path.join(directory, 'artifacts', 'candidate-evidence', 'visual', 'current'),
      ));
      assert.equal(await readFile(path.join(directory, 'dist', 'FOREIGN.txt'), 'utf8'), 'stale foreign root artifact\n');
    });
  }
});

test('rejects a symlinked release sidecar parent before touching outside files', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires host-specific privileges.');
    return;
  }
  const directory = await createFixture();
  t.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'rrr-release-outside-'));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsideSidecar = path.join(outsideDirectory, 'release-manifest.json');
  await writeFile(outsideSidecar, 'must remain untouched\n');
  await rm(path.join(directory, 'artifacts'), { recursive: true, force: true });
  await symlink(outsideDirectory, path.join(directory, 'artifacts'));
  git(directory, 'add', 'artifacts');
  git(directory, 'commit', '-m', 'Track symlinked artifact parent fixture');
  git(directory, 'tag', '-f', '-a', `v${FIXTURE_VERSION}`, '-m', `v${FIXTURE_VERSION}`);

  const result = runManifest(directory);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /release sidecar parent must not traverse symbolic links/);
  assert.equal(await readFile(outsideSidecar, 'utf8'), 'must remain untouched\n');
  assert.equal(await readFile(path.join(directory, 'dist', 'FOREIGN.txt'), 'utf8'), 'stale foreign root artifact\n');
});

test('fails closed for invalid provenance inputs', async (t) => {
  const scenarios = [
    {
      name: 'dirty tracked source',
      mutate: (directory) => writeFile(path.join(directory, 'README.md'), 'changed\n'),
      message: /Git working tree is not clean/,
    },
    {
      name: 'untracked source',
      mutate: (directory) => writeFile(path.join(directory, 'untracked.txt'), 'untracked\n'),
      message: /Git working tree is not clean/,
    },
    {
      name: 'lightweight release tag',
      fixture: { tagMode: 'lightweight' },
      message: /must be an annotated tag/,
    },
    {
      name: 'missing exact release tag',
      fixture: { tagMode: 'wrong' },
      message: /annotated tag v1\.0\.0-rc\.2 is missing/,
    },
    {
      name: 'release tag not at HEAD',
      fixture: { tagMode: 'misaligned' },
      message: /does not point to HEAD/,
    },
    {
      name: 'package-lock identity mismatch',
      fixture: { lockVersion: '1.0.0-rc.1' },
      message: /package-lock identity does not match package\.json/,
    },
    {
      name: 'Node pin mismatch',
      fixture: { nodeVersion: '0.0.0' },
      message: /does not match \.node-version/,
    },
    {
      name: 'missing npm_execpath',
      run: { npmExecPath: null },
      message: /npm_execpath must be an absolute path/,
    },
    {
      name: 'sidecar directory is preserved before root output replacement starts',
      fixture: { sidecarDirectory: true },
      run: { npmExecPath: null },
      message: /npm_execpath must be an absolute path/,
    },
    {
      name: 'relative npm_execpath',
      run: { npmExecPath: 'fake-npm-cli.mjs' },
      message: /npm_execpath must be an absolute path/,
    },
    {
      name: 'npm CLI version mismatch',
      fixture: { packageManagerVersion: '0.0.0' },
      message: /does not match packageManager/,
    },
    {
      name: 'non-exact npm declaration',
      fixture: { packageManagerVersion: '^11.17.0' },
      message: /packageManager must pin an exact npm version/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const directory = await createFixture(scenario.fixture);
      subtest.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
      if (scenario.mutate) await scenario.mutate(directory);
      const result = runManifest(directory, scenario.run);
      await assertFailedClosed(directory, result, scenario.message, { preserveRootOutputs: true });
    });
  }
});

test('fails closed on unexpected ignored detached-checkout inputs at every build phase', async (t) => {
  const scenarios = [
    {
      name: 'before install',
      fixture: { preinstallIgnored: true },
      message: /unexpected ignored checkout entry: \.env\.preinstall/,
    },
    {
      name: 'after npm ci',
      fixture: { buildMode: 'ignored-after-ci' },
      message: /unexpected ignored checkout entry: \.env\.ci/,
    },
    {
      name: 'after build',
      fixture: { buildMode: 'ignored-after-build' },
      message: /unexpected ignored checkout entry: \.env\.build/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const directory = await createFixture(scenario.fixture);
      subtest.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message, { preserveRootOutputs: true });
    });
  }
});

test('fails closed when exact tag or npm package provenance changes during build', async (t) => {
  const scenarios = [
    {
      name: 'annotated tag object replaced at the same commit',
      buildMode: 'replace-tag-object',
      message: /annotated tag v1\.0\.0-rc\.2 changed during the release build/,
    },
    {
      name: 'npm CLI mutated during build',
      buildMode: 'mutate-npm-cli',
      message: /exact npm CLI changed during the release build/,
      excludedMessage: /Source checkout working tree changed/,
    },
    {
      name: 'non-entry npm implementation mutated during build',
      buildMode: 'mutate-npm-implementation',
      message: /exact npm package tree changed during the release build/,
      excludedMessage: /Source checkout working tree changed/,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const directory = await createFixture({ buildMode: scenario.buildMode });
      subtest.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message, { preserveRootOutputs: true });
      if (scenario.excludedMessage) {
        assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, scenario.excludedMessage);
      }
    });
  }
});

test('fails closed for invalid isolated build outputs', async (t) => {
  const scenarios = [
    { buildMode: 'source-map', message: /source maps present: bundle\.js\.map/ },
    { buildMode: 'missing-notice', message: /THIRD_PARTY_NOTICES\.txt is missing/ },
    { buildMode: 'qa-marker', message: /QA runtime marker __RRR_QA__/ },
    { buildMode: 'performance-capture-marker', message: /injected performance capture marker __RRR_PERF_CAPTURE__/ },
    { buildMode: 'product-performance-marker', message: /product performance API marker __RRR_PERFORMANCE__/ },
    { buildMode: 'local-path', message: /absolute local file URL/ },
    { buildMode: 'source-path', message: /source checkout path/ },
    { buildMode: 'worktree-path', message: /detached release worktree path/ },
    { buildMode: 'temp-path', message: /temporary release directory path/ },
    { buildMode: 'linux-path', message: /absolute local file URL/ },
    { buildMode: 'windows-path', message: /absolute local file URL/ },
    { buildMode: 'file-url', message: /absolute local file URL/ },
    { buildMode: 'private-key', message: /PEM private-key header/ },
    { buildMode: 'live-token', message: /GitHub token ghp_/ },
    {
      buildMode: 'symlink',
      message: /non-regular dist entry: source-link/,
      preserveRootOutputs: true,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.buildMode, async (subtest) => {
      const directory = await createFixture({ buildMode: scenario.buildMode });
      subtest.after(() => rm(path.dirname(directory), { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message, {
        preserveRootOutputs: scenario.preserveRootOutputs === true,
      });
    });
  }
});
