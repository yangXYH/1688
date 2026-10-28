#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relPath) {
  return JSON.parse(await fs.readFile(path.join(root, relPath), 'utf8'));
}

async function read(relPath) {
  return fs.readFile(path.join(root, relPath), 'utf8');
}

async function listRootFiles() {
  return fs.readdir(root);
}

const pkg = await readJson('package.json');
const changelog = await read('CHANGELOG.md');
const rootFiles = await listRootFiles();

const version = pkg.version;
const releaseHeading = new RegExp(`^## \\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
const failures = [];

if (!releaseHeading.test(changelog)) {
  failures.push(`CHANGELOG.md missing release heading for package version ${version}.`);
}

if (!pkg.files?.includes('CHANGELOG.md')) {
  failures.push('package.json files must include CHANGELOG.md.');
}

if (!pkg.scripts?.['release-check']) {
  failures.push('package.json missing script: release-check.');
}

// Inspect npm's actual archive selection so web dependencies cannot silently
// disappear when the files allowlist or ignore rules change.
const packed = spawnSync(process.platform === 'win32' ? 'npm.cmd pack --dry-run --json --ignore-scripts' : 'npm',
  process.platform === 'win32' ? [] : ['pack', '--dry-run', '--json', '--ignore-scripts'],
  { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', windowsHide: true, timeout: 30000 });
if (packed.error || packed.status !== 0) {
  failures.push(`npm pack check failed: ${packed.error?.message || packed.stderr}`);
} else {
  try {
    const paths = new Set(JSON.parse(packed.stdout)[0].files.map((file) => file.path));
    for (const file of ['web/index.html', 'web/app.js', 'web/style.css', 'scripts/web-ui.mjs', 'scripts/web-export.mjs', 'scripts/web-cell-images.mjs']) {
      if (!paths.has(file)) failures.push(`npm archive missing workbench file: ${file}.`);
    }
  } catch (error) {
    failures.push(`Could not read npm pack file list: ${error.message}`);
  }
}
if (pkg.bin?.['1688-ui'] !== 'scripts/web-ui.mjs') {
  failures.push('package.json missing runnable 1688-ui bin.');
}

const npmReadmeCandidates = rootFiles
  .filter((name) => /^README(?:\..+)?$/i.test(name))
  .filter((name) => name !== 'README.md');

if (npmReadmeCandidates.length > 0) {
  failures.push(
    `Root README siblings can override npm's default README.md: ${npmReadmeCandidates.join(', ')}. ` +
      'Use a non-matching name such as README_zh-CN.md or move translations under docs/.',
  );
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Release metadata looks good for ${pkg.name}@${version}.`);
