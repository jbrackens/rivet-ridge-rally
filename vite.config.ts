import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

function readGit(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function buildSourceIdentity(): { commit: string; dirty: boolean } {
  const commit = readGit(['rev-parse', 'HEAD^{commit}']);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Error('Unable to derive a canonical Git commit for the runtime build identity.');
  }
  return {
    commit,
    dirty: readGit(['status', '--porcelain=v1', '--untracked-files=all']).length > 0,
  };
}

const sourceIdentity = buildSourceIdentity();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'development'),
    __RRR_BUILD_IDENTITY__: JSON.stringify(sourceIdentity),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600,
  },
});
