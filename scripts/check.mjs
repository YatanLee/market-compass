import { access, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const roots = ['src', 'test', 'public', 'fixtures'];
const files = [];
const requiredFiles = [
  'src/server.mjs',
  'public/index.html',
  'public/app.mjs',
  'public/csv.mjs',
  'public/styles.css',
  'fixtures/demo-data.mjs',
];

async function collectJavaScript(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Required directory is missing: ${directory}`);
    }
    throw error;
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectJavaScript(path);
    } else if (entry.isFile() && /\.(?:mjs|cjs|js)$/.test(entry.name)) {
      files.push(path);
    }
  }
}

for (const root of roots) {
  await collectJavaScript(root);
}

for (const requiredFile of requiredFiles) {
  try {
    await access(requiredFile);
  } catch {
    throw new Error(`Required application file is missing: ${requiredFile}`);
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Syntax check passed for ${files.length} JavaScript file(s).`);
