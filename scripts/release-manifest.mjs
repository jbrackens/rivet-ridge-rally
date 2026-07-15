import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const root = process.cwd();
const dist = path.join(root, 'dist');
const output = path.join(root, 'artifacts', 'release-manifest.json');
const execFileAsync = promisify(execFile);
const requiredNotice = 'THIRD_PARTY_NOTICES.txt';

function releaseForbiddenByteSequences(sourceRoot, temporaryRoot, releaseWorktreePath) {
  const entries = [
    { label: 'source checkout path', value: sourceRoot },
    { label: 'source checkout file URL', value: pathToFileURL(sourceRoot).href },
    { label: 'detached release worktree path', value: releaseWorktreePath },
    { label: 'detached release worktree file URL', value: pathToFileURL(releaseWorktreePath).href },
    { label: 'temporary release directory path', value: temporaryRoot },
    { label: 'temporary release directory file URL', value: pathToFileURL(temporaryRoot).href },
    { label: 'QA runtime marker __RRR_QA__', value: '__RRR_QA__' },
    { label: 'absolute local file URL', value: 'file:///Users/' },
    { label: 'absolute local file URL', value: 'file:///home/' },
    { label: 'absolute local file URL', value: 'file:///opt/' },
    { label: 'absolute local file URL', value: 'file:///tmp/' },
    { label: 'absolute local file URL', value: 'file:///var/folders/' },
    { label: 'absolute local file URL', value: 'file:///C:/Users/' },
    { label: 'PEM private-key header', value: '-----BEGIN PRIVATE KEY-----' },
    { label: 'encrypted PEM private-key header', value: '-----BEGIN ENCRYPTED PRIVATE KEY-----' },
    { label: 'RSA PEM private-key header', value: '-----BEGIN RSA PRIVATE KEY-----' },
    { label: 'EC PEM private-key header', value: '-----BEGIN EC PRIVATE KEY-----' },
    { label: 'OpenSSH private-key header', value: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    { label: 'PGP private-key header', value: '-----BEGIN PGP PRIVATE KEY BLOCK-----' },
    { label: 'GitHub token prefix ghp_', value: 'ghp_' },
    { label: 'GitHub fine-grained token prefix github_pat_', value: 'github_pat_' },
    { label: 'OpenAI project token prefix sk-proj-', value: 'sk-proj-' },
    { label: 'OpenAI service-account token prefix sk-svcacct-', value: 'sk-svcacct-' },
    { label: 'Slack bot token prefix xoxb-', value: 'xoxb-' },
    { label: 'Slack user token prefix xoxp-', value: 'xoxp-' },
    { label: 'Stripe live secret prefix sk_live_', value: 'sk_live_' },
    { label: 'Stripe restricted live key prefix rk_live_', value: 'rk_live_' },
    { label: 'GitLab personal access token prefix glpat-', value: 'glpat-' },
  ];
  const seen = new Set();
  return entries
    .filter(({ value }) => {
      if (typeof value !== 'string' || value.length === 0 || seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .map(({ label, value }) => ({ label, value: Buffer.from(value) }));
}

function compareNames(left, right) {
  if (left.name < right.name) return -1;
  if (left.name > right.name) return 1;
  return 0;
}

function sha256(contents) {
  return createHash('sha256').update(contents).digest('hex');
}

function relativePath(base, absolute) {
  return path.relative(base, absolute).split(path.sep).join('/') || '.';
}

function isContainedPath(parent, child) {
  const childRelativePath = path.relative(parent, child);
  return childRelativePath === ''
    || (!path.isAbsolute(childRelativePath)
      && childRelativePath !== '..'
      && !childRelativePath.startsWith(`..${path.sep}`));
}

async function assertNoSymlinkAncestors(parent, child, label) {
  if (!isContainedPath(parent, child)) {
    throw new Error(`Release guard failed: ${label} escaped the source checkout`);
  }
  const childRelativePath = path.relative(parent, child);
  let current = parent;
  for (const segment of childRelativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release guard failed: ${label} must not traverse symbolic links`);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function git(args, failureMessage, cwd = root) {
  try {
    const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return result.stdout.trim();
  } catch {
    throw new Error(`Release guard failed: ${failureMessage}`);
  }
}

async function gitRaw(args, failureMessage, cwd = root) {
  try {
    const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return result.stdout;
  } catch {
    throw new Error(`Release guard failed: ${failureMessage}`);
  }
}

async function runNpm(npmExecPath, args, cwd, environment, failureMessage) {
  try {
    return await execFileAsync(process.execPath, [npmExecPath, ...args], {
      cwd,
      env: environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch {
    throw new Error(`Release guard failed: ${failureMessage}`);
  }
}

function fileStatIdentity(fileStat) {
  return [
    fileStat.dev,
    fileStat.ino,
    fileStat.mode,
    fileStat.nlink,
    fileStat.uid,
    fileStat.gid,
    fileStat.rdev,
    fileStat.size,
    fileStat.mtimeNs,
    fileStat.ctimeNs,
    fileStat.birthtimeNs,
  ].join(':');
}

async function inspectNpmCli(npmExecPath) {
  const npmCliStat = await stat(npmExecPath, { bigint: true });
  if (!npmCliStat.isFile()) {
    throw new Error('Release guard failed: npm_execpath does not identify a regular file');
  }
  return {
    statIdentity: fileStatIdentity(npmCliStat),
    sha256: sha256(await readFile(npmExecPath)),
  };
}

async function assertNpmCliUnchanged(npmExecPath, expected) {
  let current;
  try {
    current = await inspectNpmCli(npmExecPath);
  } catch {
    throw new Error('Release guard failed: exact npm CLI changed during the release build');
  }
  if (current.statIdentity !== expected.statIdentity || current.sha256 !== expected.sha256) {
    throw new Error('Release guard failed: exact npm CLI changed during the release build');
  }
}

async function inspectNodeExecutable(nodeExecPath) {
  let executableStat;
  let executableContents;
  try {
    executableStat = await stat(nodeExecPath, { bigint: true });
    executableContents = await readFile(nodeExecPath);
  } catch {
    throw new Error('Release guard failed: resolved build Node executable is unavailable');
  }
  if (!executableStat.isFile()) {
    throw new Error('Release guard failed: resolved build Node executable is not a regular file');
  }
  return {
    statIdentity: fileStatIdentity(executableStat),
    sha256: sha256(executableContents),
  };
}

async function inspectResolvedBuildNode(environment) {
  let result;
  try {
    result = await execFileAsync(
      'node',
      ['--eval', 'process.stdout.write(JSON.stringify({ execPath: process.execPath, version: process.versions.node }))'],
      { env: environment, encoding: 'utf8' },
    );
  } catch {
    throw new Error('Release guard failed: isolated PATH could not resolve the build Node executable');
  }

  let reported;
  try {
    reported = JSON.parse(result.stdout);
  } catch {
    throw new Error('Release guard failed: resolved build Node identity is invalid');
  }
  if (
    typeof reported.execPath !== 'string'
    || !path.isAbsolute(reported.execPath)
    || typeof reported.version !== 'string'
    || reported.version.length === 0
  ) {
    throw new Error('Release guard failed: resolved build Node identity is invalid');
  }

  const executableIdentity = await inspectNodeExecutable(reported.execPath);
  return {
    execPath: reported.execPath,
    version: reported.version,
    ...executableIdentity,
  };
}

async function assertResolvedBuildNodeUnchanged(environment, expected) {
  const current = await inspectResolvedBuildNode(environment);
  if (
    current.execPath !== expected.execPath
    || current.version !== expected.version
    || current.statIdentity !== expected.statIdentity
    || current.sha256 !== expected.sha256
  ) {
    throw new Error('Release guard failed: resolved build Node executable changed during the release build');
  }
}

async function walkRegularFiles(directory, base = directory) {
  const directoryStat = await lstat(directory);
  if (!directoryStat.isDirectory()) {
    throw new Error(`Release guard failed: non-directory dist entry: ${relativePath(base, directory)}`);
  }

  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort(compareNames)) {
    const absolute = path.join(directory, entry.name);
    const entryStat = await lstat(absolute);
    if (entryStat.isDirectory()) files.push(...await walkRegularFiles(absolute, base));
    else if (entryStat.isFile()) files.push(absolute);
    else {
      throw new Error(
        `Release guard failed: non-regular dist entry: ${relativePath(base, absolute)}`,
      );
    }
  }
  return files;
}

function releaseEnvironment(tempRoot) {
  const tempDirectory = path.join(tempRoot, 'tmp');
  return {
    PATH: [path.dirname(process.execPath), process.env.PATH ?? '']
      .filter(Boolean)
      .join(path.delimiter),
    HOME: path.join(tempRoot, 'home'),
    TMPDIR: tempDirectory,
    TMP: tempDirectory,
    TEMP: tempDirectory,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    CI: '1',
    VITE_QA_MODE: '0',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_production: 'false',
    npm_config_ignore_scripts: 'false',
    npm_config_cache: path.join(tempRoot, 'npm-cache'),
    npm_config_userconfig: path.join(tempRoot, 'empty.npmrc'),
    npm_config_globalconfig: path.join(tempRoot, 'empty.npmrc'),
  };
}

async function assertSourceCheckout(directory, commit, label) {
  const checkoutHead = await git(
    ['rev-parse', 'HEAD^{commit}'],
    `${label} HEAD commit is unavailable`,
    directory,
  );
  if (checkoutHead !== commit) {
    throw new Error(`Release guard failed: ${label} HEAD changed during the release build`);
  }
  const checkoutStatus = await git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    `${label} working tree could not be inspected`,
    directory,
  );
  if (checkoutStatus.length > 0) {
    throw new Error(`Release guard failed: ${label} working tree changed during the release build`);
  }
}

async function assertReleaseTagUnchanged(tagReference, expectedTag, tagObject, tagType, commit) {
  const currentTagObject = await git(
    ['rev-parse', tagReference],
    `annotated tag ${expectedTag} cannot be revalidated`,
  );
  const currentTagType = await git(
    ['cat-file', '-t', currentTagObject],
    `annotated tag ${expectedTag} cannot be revalidated`,
  );
  const currentTaggedCommit = await git(
    ['rev-parse', `${currentTagObject}^{commit}`],
    `annotated tag ${expectedTag} cannot be revalidated`,
  );
  if (
    currentTagObject !== tagObject
    || currentTagType !== tagType
    || currentTaggedCommit !== commit
  ) {
    throw new Error(`Release guard failed: annotated tag ${expectedTag} changed during the release build`);
  }
}

async function assertDetachedCheckout(directory, commit, label, allowedIgnoredRoots) {
  const checkoutHead = await git(
    ['rev-parse', 'HEAD^{commit}'],
    `${label} HEAD commit is unavailable`,
    directory,
  );
  if (checkoutHead !== commit) {
    throw new Error(`Release guard failed: ${label} HEAD changed during the release build`);
  }

  const statusEntries = (await gitRaw(
    ['status', '--porcelain=v1', '-z', '--ignored', '--untracked-files=normal'],
    `${label} working tree could not be inspected`,
    directory,
  )).split('\0').filter(Boolean);
  for (const entry of statusEntries) {
    const status = entry.slice(0, 2);
    const entryPath = entry.slice(3).replace(/\/$/, '');
    if (status !== '!!') {
      throw new Error(`Release guard failed: ${label} working tree changed during the release build`);
    }
    const allowed = allowedIgnoredRoots.some(
      (allowedRoot) => entryPath === allowedRoot || entryPath.startsWith(`${allowedRoot}/`),
    );
    if (!allowed) {
      throw new Error(`Release guard failed: unexpected ignored checkout entry: ${entryPath}`);
    }
  }
}

async function readReleaseInputs(directory) {
  const packageContents = await readFile(path.join(directory, 'package.json'));
  const packageLockContents = await readFile(path.join(directory, 'package-lock.json'));
  const nodeVersionContents = await readFile(path.join(directory, '.node-version'));
  return {
    packageContents,
    packageLockContents,
    nodeVersionContents,
    packageManifest: JSON.parse(packageContents.toString('utf8')),
    packageLock: JSON.parse(packageLockContents.toString('utf8')),
    pinnedNodeVersion: nodeVersionContents.toString('utf8').trim(),
  };
}

function validateReleaseInputs(inputs) {
  const { packageManifest, packageLock } = inputs;
  if (typeof packageManifest.name !== 'string' || packageManifest.name.length === 0) {
    throw new Error('Release guard failed: package name is missing');
  }
  if (typeof packageManifest.version !== 'string' || packageManifest.version.length === 0) {
    throw new Error('Release guard failed: package version is missing');
  }
  const packageManagerMatch = /^npm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(
    packageManifest.packageManager ?? '',
  );
  if (!packageManagerMatch) {
    throw new Error('Release guard failed: packageManager must pin an exact npm version');
  }
  const lockRoot = packageLock.packages?.[''];
  if (
    packageLock.name !== packageManifest.name
    || packageLock.version !== packageManifest.version
    || lockRoot?.name !== packageManifest.name
    || lockRoot?.version !== packageManifest.version
  ) {
    throw new Error('Release guard failed: package-lock identity does not match package.json');
  }
  return packageManagerMatch[1];
}

async function assertReleaseInputsUnchanged(directory, expected, label) {
  const current = await readReleaseInputs(directory);
  if (
    !current.packageContents.equals(expected.packageContents)
    || !current.packageLockContents.equals(expected.packageLockContents)
    || !current.nodeVersionContents.equals(expected.nodeVersionContents)
  ) {
    throw new Error(`Release guard failed: ${label} release inputs changed during the release build`);
  }
}

async function removeRootOutputs() {
  await assertNoSymlinkAncestors(root, path.dirname(output), 'release sidecar parent');
  let cleanupFailure = null;
  for (const target of [output, dist]) {
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      cleanupFailure ??= new Error('Release guard failed: stale release output cleanup failed');
    }
  }
  if (cleanupFailure) throw cleanupFailure;
}

async function cleanupTemporaryWorktree(tempRoot, worktreePath, worktreeAdded) {
  let cleanupFailure = null;
  if (worktreeAdded) {
    try {
      await git(
        ['worktree', 'remove', '--force', worktreePath],
        'temporary release worktree could not be removed',
      );
    } catch {
      // Removing the directory and pruning below is the fallback for a
      // partially registered or otherwise unavailable worktree.
    }
  }
  try {
    await rm(tempRoot, { recursive: true, force: true });
  } catch {
    cleanupFailure = new Error('Release guard failed: temporary release directory cleanup failed');
  }
  try {
    await git(['worktree', 'prune'], 'temporary release worktree metadata cleanup failed');
  } catch (error) {
    cleanupFailure ??= error;
  }
  if (cleanupFailure) throw cleanupFailure;
}

let tempRoot = null;
let worktreePath = null;
let worktreeAdded = false;
let releaseComplete = false;
let releaseFailure = null;
let completeRelease = null;

try {
  await removeRootOutputs();
  const workingTreeStatus = await git(
    ['status', '--porcelain=v1', '--untracked-files=all'],
    'Git working tree could not be inspected',
  );
  if (workingTreeStatus.length > 0) {
    throw new Error('Release guard failed: Git working tree is not clean');
  }

  const commit = await git(['rev-parse', 'HEAD^{commit}'], 'Git HEAD commit is unavailable');
  await assertSourceCheckout(root, commit, 'Source checkout');

  tempRoot = await mkdtemp(path.join(tmpdir(), 'rivet-ridge-release-'));
  worktreePath = path.join(tempRoot, 'source');
  await mkdir(path.join(tempRoot, 'home'), { recursive: true });
  await mkdir(path.join(tempRoot, 'tmp'), { recursive: true });
  await mkdir(path.join(tempRoot, 'npm-cache'), { recursive: true });
  await writeFile(path.join(tempRoot, 'empty.npmrc'), '');
  const environment = releaseEnvironment(tempRoot);

  await git(
    ['worktree', 'add', '--detach', worktreePath, commit],
    'detached release worktree could not be created',
  );
  worktreeAdded = true;
  await assertDetachedCheckout(worktreePath, commit, 'Detached release checkout', []);

  const releaseInputs = await readReleaseInputs(worktreePath);
  const pinnedNpmVersion = validateReleaseInputs(releaseInputs);
  const { packageManifest, packageLockContents, pinnedNodeVersion } = releaseInputs;
  if (pinnedNodeVersion !== process.versions.node) {
    throw new Error(
      `Release guard failed: Node ${process.versions.node} does not match .node-version ${pinnedNodeVersion}`,
    );
  }

  const expectedTag = `v${packageManifest.version}`;
  const tagReference = `refs/tags/${expectedTag}`;
  const tagObject = await git(
    ['rev-parse', tagReference],
    `annotated tag ${expectedTag} is missing`,
  );
  const tagType = await git(
    ['cat-file', '-t', tagObject],
    `annotated tag ${expectedTag} is missing`,
  );
  if (tagType !== 'tag') {
    throw new Error(`Release guard failed: ${expectedTag} must be an annotated tag`);
  }
  const taggedCommit = await git(
    ['rev-parse', `${tagObject}^{commit}`],
    `annotated tag ${expectedTag} cannot be resolved`,
  );
  if (taggedCommit !== commit) {
    throw new Error(`Release guard failed: annotated tag ${expectedTag} does not point to HEAD`);
  }

  const npmExecPath = process.env.npm_execpath;
  if (!npmExecPath || !path.isAbsolute(npmExecPath)) {
    throw new Error('Release guard failed: npm_execpath must be an absolute path');
  }
  const npmCliIdentity = await inspectNpmCli(npmExecPath);
  const npmCliSha256 = npmCliIdentity.sha256;
  const processNodeIdentity = await inspectNodeExecutable(process.execPath);
  const buildNodeIdentity = await inspectResolvedBuildNode(environment);
  if (buildNodeIdentity.version !== pinnedNodeVersion) {
    throw new Error(
      `Release guard failed: resolved build Node ${buildNodeIdentity.version} does not match .node-version ${pinnedNodeVersion}`,
    );
  }
  if (
    buildNodeIdentity.statIdentity !== processNodeIdentity.statIdentity
    || buildNodeIdentity.sha256 !== processNodeIdentity.sha256
  ) {
    throw new Error('Release guard failed: isolated PATH did not resolve the current Node executable');
  }
  const nodeExecutableSha256 = buildNodeIdentity.sha256;

  const npmVersionResult = await runNpm(
    npmExecPath,
    ['--version'],
    root,
    environment,
    'the exact npm CLI could not report its version',
  );
  await assertNpmCliUnchanged(npmExecPath, npmCliIdentity);
  const actualNpmVersion = npmVersionResult.stdout.trim();
  if (actualNpmVersion !== pinnedNpmVersion) {
    throw new Error(
      `Release guard failed: npm ${actualNpmVersion} does not match packageManager npm@${pinnedNpmVersion}`,
    );
  }

  await runNpm(
    npmExecPath,
    ['ci', '--no-audit', '--no-fund'],
    worktreePath,
    environment,
    'isolated npm ci failed',
  );
  await assertNpmCliUnchanged(npmExecPath, npmCliIdentity);
  await assertResolvedBuildNodeUnchanged(environment, buildNodeIdentity);
  await assertDetachedCheckout(
    worktreePath,
    commit,
    'Detached release checkout after npm ci',
    ['node_modules'],
  );
  await assertReleaseInputsUnchanged(worktreePath, releaseInputs, 'Detached release checkout');
  await runNpm(
    npmExecPath,
    ['run', 'build'],
    worktreePath,
    { ...environment, NODE_ENV: 'production', VITE_QA_MODE: '0' },
    'isolated non-QA npm run build failed',
  );
  await assertNpmCliUnchanged(npmExecPath, npmCliIdentity);
  await assertResolvedBuildNodeUnchanged(environment, buildNodeIdentity);

  await assertDetachedCheckout(
    worktreePath,
    commit,
    'Detached release checkout after build',
    ['node_modules', 'dist'],
  );
  await assertReleaseInputsUnchanged(worktreePath, releaseInputs, 'Detached release checkout');
  await assertSourceCheckout(root, commit, 'Source checkout');
  await assertReleaseTagUnchanged(tagReference, expectedTag, tagObject, tagType, commit);

  const isolatedDist = path.join(worktreePath, 'dist');
  await walkRegularFiles(isolatedDist);
  await cp(isolatedDist, dist, {
    recursive: true,
    dereference: false,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
  });

  const files = await walkRegularFiles(dist);
  const relativePaths = files.map((absolute) => relativePath(dist, absolute));
  if (!relativePaths.includes(requiredNotice)) {
    throw new Error(`Release guard failed: dist/${requiredNotice} is missing`);
  }

  const sourceMaps = relativePaths.filter((relative) => relative.toLowerCase().endsWith('.map'));
  if (sourceMaps.length > 0) {
    throw new Error(`Release guard failed: source maps present: ${sourceMaps.join(', ')}`);
  }

  const forbiddenByteSequences = releaseForbiddenByteSequences(root, tempRoot, worktreePath);
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
      sha256: sha256(contents),
    });
  }

  const aggregate = createHash('sha256');
  for (const record of records) aggregate.update(`${record.sha256}  ${record.path}\n`);

  const manifest = {
    product: 'RIVET RIDGE RALLY',
    version: packageManifest.version,
    format: 2,
    source: {
      commit,
      tag: expectedTag,
      tagObject,
      tagObjectType: tagType,
    },
    toolchain: {
      node: buildNodeIdentity.version,
      nodeExecutableSha256,
      npm: actualNpmVersion,
      npmCliSha256,
      platform: process.platform,
      arch: process.arch,
      packageLockSha256: sha256(packageLockContents),
    },
    build: {
      source: 'detached-clean-git-worktree',
      installCommand: 'npm ci --no-audit --no-fund',
      buildCommand: 'npm run build',
      viteQaMode: '0',
      npmConfig: 'isolated-empty-user-and-global',
      installScripts: 'enabled',
    },
    totalBytes: records.reduce((sum, record) => sum + record.bytes, 0),
    fileCount: records.length,
    aggregateSha256: aggregate.digest('hex'),
    files: records,
  };

  await assertNoSymlinkAncestors(root, path.dirname(output), 'release sidecar parent');
  await mkdir(path.dirname(output), { recursive: true });
  await assertNoSymlinkAncestors(root, path.dirname(output), 'release sidecar parent');
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  await assertDetachedCheckout(
    worktreePath,
    commit,
    'Detached release checkout at completion',
    ['node_modules', 'dist'],
  );
  await assertReleaseInputsUnchanged(worktreePath, releaseInputs, 'Detached release checkout');
  await assertSourceCheckout(root, commit, 'Source checkout');
  await assertReleaseTagUnchanged(tagReference, expectedTag, tagObject, tagType, commit);
  await assertNpmCliUnchanged(npmExecPath, npmCliIdentity);
  await assertResolvedBuildNodeUnchanged(environment, buildNodeIdentity);
  completeRelease = async () => {
    await assertSourceCheckout(root, commit, 'Source checkout');
    await assertReleaseTagUnchanged(tagReference, expectedTag, tagObject, tagType, commit);
    await assertNpmCliUnchanged(npmExecPath, npmCliIdentity);
    await assertResolvedBuildNodeUnchanged(environment, buildNodeIdentity);
    console.log(`Release manifest: ${records.length} files, ${manifest.totalBytes} bytes`);
    console.log(`Aggregate SHA-256: ${manifest.aggregateSha256}`);
    console.log(`Source: ${manifest.source.tag} (${manifest.source.commit})`);
    console.log(`Toolchain: Node ${manifest.toolchain.node}, npm ${manifest.toolchain.npm}`);
    releaseComplete = true;
  };
} catch (error) {
  releaseFailure = error;
}

if (tempRoot && worktreePath) {
  try {
    await cleanupTemporaryWorktree(tempRoot, worktreePath, worktreeAdded);
  } catch (error) {
    releaseFailure ??= error;
  }
}

if (!releaseFailure && completeRelease) {
  try {
    await completeRelease();
  } catch (error) {
    releaseFailure = error;
  }
}

if (!releaseComplete || releaseFailure) {
  try {
    await removeRootOutputs();
  } catch (error) {
    releaseFailure ??= error;
  }
  throw releaseFailure ?? new Error('Release guard failed: release manifest generation did not complete');
}
