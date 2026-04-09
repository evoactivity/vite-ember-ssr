/**
 * Global setup for vitest — builds the library and test apps before tests run.
 *
 * Skips builds when the dist output is newer than all source files.
 * Builds test apps in parallel once the library is ready.
 */
import { execSync, exec } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat, readdir } from 'node:fs/promises';
import { availableParallelism } from 'node:os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const packagesRoot = resolve(__dirname, '../..');
const viteEmberSsrRoot = resolve(packagesRoot, 'vite-ember-ssr');
const monorepoLibRoot = resolve(packagesRoot, 'monorepo-lib');

const testApps = [
  {
    name: 'test-app',
    root: resolve(packagesRoot, 'test-app'),
    cmd: 'pnpm build:all',
    srcDirs: ['app'],
    distDir: 'dist',
  },
  {
    name: 'test-app-ssg',
    root: resolve(packagesRoot, 'test-app-ssg'),
    cmd: 'pnpm build',
    srcDirs: ['app'],
    distDir: 'dist',
  },
  {
    name: 'test-app-combined',
    root: resolve(packagesRoot, 'test-app-combined'),
    cmd: 'pnpm build:all',
    srcDirs: ['app'],
    distDir: 'dist',
  },
  {
    name: 'test-app-lazy-ssg',
    root: resolve(packagesRoot, 'test-app-lazy-ssg'),
    cmd: 'pnpm build',
    srcDirs: ['app'],
    distDir: 'dist',
  },
  {
    name: 'test-app-lazy-ssr',
    root: resolve(packagesRoot, 'test-app-lazy-ssr'),
    cmd: 'pnpm build:all',
    srcDirs: ['app'],
    distDir: 'dist',
  },
  {
    name: 'test-app-monorepo-ssg',
    root: resolve(packagesRoot, 'test-app-monorepo-ssg'),
    cmd: 'pnpm build',
    srcDirs: ['app'],
    distDir: 'dist',
    extraSrcDirs: [resolve(monorepoLibRoot, 'src')],
  },
  {
    name: 'test-app-monorepo-ssr',
    root: resolve(packagesRoot, 'test-app-monorepo-ssr'),
    cmd: 'pnpm build:all',
    srcDirs: ['app'],
    distDir: 'dist',
    extraSrcDirs: [resolve(monorepoLibRoot, 'src')],
  },
];

/**
 * Recursively find the newest mtime in a directory.
 */
async function newestMtime(dir) {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, await newestMtime(fullPath));
    } else {
      const s = await stat(fullPath);
      newest = Math.max(newest, s.mtimeMs);
    }
  }
  return newest;
}

/**
 * Find the newest file mtime inside a dist directory.
 * Returns 0 if the directory doesn't exist or is empty.
 */
async function newestDistMtime(dir) {
  try {
    await stat(dir);
  } catch {
    return 0; // dist doesn't exist
  }
  return newestMtime(dir);
}

/**
 * Check if a build is needed by comparing source mtimes against dist.
 */
async function needsBuild(root, srcDirs, distDir, extraSrcDirs = []) {
  const distPath = resolve(root, distDir);
  const distTime = await newestDistMtime(distPath);
  if (distTime === 0) return true; // no dist

  const allSrcDirs = [
    ...srcDirs.map((d) => resolve(root, d)),
    ...extraSrcDirs,
    // Also check vite config and package.json
  ];

  for (const srcDir of allSrcDirs) {
    const srcTime = await newestMtime(srcDir);
    if (srcTime > distTime) return true;
  }

  // Check config files that affect builds
  for (const configFile of [
    'vite.config.mjs',
    'vite.config.ts',
    'package.json',
  ]) {
    try {
      const s = await stat(resolve(root, configFile));
      if (s.mtimeMs > distTime) return true;
    } catch {
      // file doesn't exist, skip
    }
  }

  return false;
}

/**
 * Run a shell command as a promise.
 */
function runAsync(cmd, cwd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { cwd, maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`  ✗ Build failed in ${cwd}:\n${stderr || stdout}`);
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function setup() {
  // 1. Build the library first (all test apps depend on it)
  const libNeedsBuild = await needsBuild(viteEmberSsrRoot, ['src'], 'dist');

  if (libNeedsBuild) {
    console.log('\n  Building vite-ember-ssr library...');
    execSync('pnpm build', { cwd: viteEmberSsrRoot, stdio: 'pipe' });
  } else {
    console.log('\n  vite-ember-ssr library is up to date, skipping build.');
  }

  // 2. Determine which test apps need building
  const buildTasks = [];
  const skipTasks = [];

  for (const app of testApps) {
    let needs = libNeedsBuild; // if lib rebuilt, always rebuild apps
    if (!needs) {
      needs = await needsBuild(
        app.root,
        app.srcDirs,
        app.distDir,
        app.extraSrcDirs || [],
      );
    }

    if (needs) {
      buildTasks.push(app);
    } else {
      skipTasks.push(app);
    }
  }

  if (skipTasks.length > 0) {
    console.log(
      `  Skipping ${skipTasks.length} up-to-date app(s): ${skipTasks.map((a) => a.name).join(', ')}`,
    );
  }

  // 3. Build needed test apps with limited concurrency to avoid
  //    overwhelming CI runners (which typically have only 2 cores).
  if (buildTasks.length > 0) {
    const maxConcurrency = Math.min(
      buildTasks.length,
      Math.max(2, Math.floor(availableParallelism() / 2)),
    );
    console.log(
      `  Building ${buildTasks.length} app(s) (concurrency: ${maxConcurrency}): ${buildTasks.map((a) => a.name).join(', ')}...`,
    );

    const failures = [];
    let i = 0;
    async function next() {
      while (i < buildTasks.length) {
        const app = buildTasks[i++];
        const start = Date.now();
        try {
          await runAsync(app.cmd, app.root);
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`  ✓ ${app.name} (${elapsed}s)`);
        } catch (error) {
          failures.push(error);
        }
      }
    }

    await Promise.all(Array.from({ length: maxConcurrency }, () => next()));

    if (failures.length > 0) {
      throw new Error(
        `${failures.length} test app build(s) failed:\n${failures.map((f) => f.message).join('\n')}`,
      );
    }
  }

  console.log('  Build complete.\n');
}
