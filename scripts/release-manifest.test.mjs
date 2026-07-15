import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const FIXTURE_NAME = 'release-manifest-fixture';
const FIXTURE_VERSION = '1.0.0-rc.2';
const FIXTURE_NPM_VERSION = '11.17.0';
const FIXTURE_SOURCE = 'tracked-fixture-source';
const FAKE_NPM_CLI = String.raw`
import { execFileSync } from 'node:child_process';
import { access, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const userConfig = process.env.npm_config_userconfig;
const globalConfig = process.env.npm_config_globalconfig;
if (process.env.npm_config_ignore_scripts !== 'false') process.exit(46);
if (!userConfig || !globalConfig || userConfig !== globalConfig) process.exit(47);
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
  if (process.env.VITE_QA_MODE !== '0') process.exit(42);
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
  if (process.env.VITE_QA_MODE !== '0' || process.env.NODE_ENV !== 'production') process.exit(44);

  const mode = (await readFile('BUILD_MODE.txt', 'utf8')).trim();
  const source = (await readFile('SOURCE.txt', 'utf8')).trim();
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist', { recursive: true });
  if (mode !== 'missing-notice') {
    await writeFile(path.join('dist', 'THIRD_PARTY_NOTICES.txt'), 'Fixture notices.\n');
  }
  let body = 'source=' + source + '\nci=ok\nqa=' + process.env.VITE_QA_MODE
    + '\nnodeEnv=' + process.env.NODE_ENV + '\n';
  if (mode === 'qa-marker') body += '__RRR_QA__\n';
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
  if (mode === 'live-token') body += 'ghp_fixture_high_confidence_token_prefix\n';
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
  const directory = await mkdtemp(path.join(tmpdir(), 'rrr-release-manifest-'));
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await copyFile(
    new URL('./release-manifest.mjs', import.meta.url),
    path.join(directory, 'scripts', 'release-manifest.mjs'),
  );
  await writeFile(path.join(directory, 'fake-npm-cli.mjs'), FAKE_NPM_CLI);
  await mkdir(path.join(directory, '.githooks'), { recursive: true });
  await writeFile(path.join(directory, '.githooks', 'post-checkout'), PREINSTALL_HOOK);
  await chmod(path.join(directory, '.githooks', 'post-checkout'), 0o755);
  await writeJson(path.join(directory, 'package.json'), {
    name: FIXTURE_NAME,
    version: FIXTURE_VERSION,
    private: true,
    type: 'module',
    packageManager: `npm@${packageManagerVersion}`,
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
    '/dist/\n/node_modules/\n.env.*\n/artifacts/release-manifest.json\n',
  );
  await writeFile(path.join(directory, 'README.md'), 'Release manifest fixture.\n');
  await writeFile(path.join(directory, 'SOURCE.txt'), `${FIXTURE_SOURCE}\n`);
  await writeFile(path.join(directory, 'SOURCE_ROOT.txt'), `${directory}\n`);
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
  { npmExecPath = path.join(directory, 'fake-npm-cli.mjs'), pathPrefix = null } = {},
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
  return spawnSync(process.execPath, ['scripts/release-manifest.mjs'], {
    cwd: directory,
    encoding: 'utf8',
    env: environment,
  });
}

async function assertFailedClosed(directory, result, message) {
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, message);
  await assert.rejects(access(path.join(directory, 'artifacts', 'release-manifest.json')));
  await assert.rejects(access(path.join(directory, 'dist')));
  const worktrees = git(directory, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1);
}

test('builds format-2 bytes from tracked source with the exact npm CLI in a detached checkout', async (t) => {
  const directory = await createFixture({ buildMode: 'generic-file-api' });
  t.after(() => rm(directory, { recursive: true, force: true }));
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
  const npmCliContents = await readFile(path.join(directory, 'fake-npm-cli.mjs'));
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

  const builtIndex = await readFile(path.join(directory, 'dist', 'index.html'), 'utf8');
  assert.match(builtIndex, new RegExp(`source=${FIXTURE_SOURCE}`));
  assert.match(builtIndex, /ci=ok/);
  assert.match(builtIndex, /qa=0/);
  assert.match(builtIndex, /nodeEnv=production/);
  assert.match(builtIndex, /filename\.startsWith\("file:\/\/"\)/);
  assert.match(builtIndex, /route=\/home\/account/);
  assert.match(builtIndex, /pattern=\\Users\\/);
  await assert.rejects(access(path.join(directory, 'dist', 'FOREIGN.txt')));
  assert.equal(git(directory, 'status', '--porcelain=v1', '--untracked-files=all'), '');
  const worktrees = git(directory, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '));
  assert.equal(worktrees.length, 1);
});

test('rejects a symlinked release sidecar parent before touching outside files', async (t) => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires host-specific privileges.');
    return;
  }
  const directory = await createFixture();
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outsideDirectory = await mkdtemp(path.join(tmpdir(), 'rrr-release-outside-'));
  t.after(() => rm(outsideDirectory, { recursive: true, force: true }));
  const outsideSidecar = path.join(outsideDirectory, 'release-manifest.json');
  await writeFile(outsideSidecar, 'must remain untouched\n');
  await rm(path.join(directory, 'artifacts'), { recursive: true, force: true });
  await symlink(outsideDirectory, path.join(directory, 'artifacts'));

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
      name: 'sidecar directory is removed before a later failure',
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
      subtest.after(() => rm(directory, { recursive: true, force: true }));
      if (scenario.mutate) await scenario.mutate(directory);
      const result = runManifest(directory, scenario.run);
      await assertFailedClosed(directory, result, scenario.message);
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
      subtest.after(() => rm(directory, { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message);
    });
  }
});

test('fails closed when exact tag or npm CLI provenance changes during build', async (t) => {
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
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (subtest) => {
      const directory = await createFixture({ buildMode: scenario.buildMode });
      subtest.after(() => rm(directory, { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message);
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
    { buildMode: 'local-path', message: /absolute local file URL/ },
    { buildMode: 'source-path', message: /source checkout path/ },
    { buildMode: 'worktree-path', message: /detached release worktree path/ },
    { buildMode: 'temp-path', message: /temporary release directory path/ },
    { buildMode: 'linux-path', message: /absolute local file URL/ },
    { buildMode: 'windows-path', message: /absolute local file URL/ },
    { buildMode: 'file-url', message: /absolute local file URL/ },
    { buildMode: 'private-key', message: /PEM private-key header/ },
    { buildMode: 'live-token', message: /GitHub token prefix ghp_/ },
    { buildMode: 'symlink', message: /non-regular dist entry: source-link/ },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.buildMode, async (subtest) => {
      const directory = await createFixture({ buildMode: scenario.buildMode });
      subtest.after(() => rm(directory, { recursive: true, force: true }));
      const result = runManifest(directory);
      await assertFailedClosed(directory, result, scenario.message);
    });
  }
});
