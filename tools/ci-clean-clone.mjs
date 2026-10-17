#!/usr/bin/env node
// ci-clean-clone.mjs — rejoue la CI sur un CLONE VIERGE local (`npm run ci:clean-clone`).
// Pourquoi : le poste de dev ment (node_modules deja la, fichiers non suivis). Un worktree detache ne
// materialise QUE les fichiers suivis ; `npm ci` s'y fait DEDANS.
// 🛑 JAMAIS de jonction/lien vers un dossier du depot vivant : `git worktree remove --force` suivrait le lien.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const racine = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-clone-vierge-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let code = 1;
try {
  execFileSync('git', ['worktree', 'add', '--detach', dir, 'HEAD'], { cwd: racine, stdio: 'inherit' });
  const opts = { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' };
  const a = spawnSync(npm, ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], opts);
  code = a.status === 0 ? spawnSync(npm, ['run', 'ci'], opts).status ?? 1 : a.status ?? 1;
} finally {
  try { execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: racine, stdio: 'inherit' }); } catch { fs.rmSync(dir, { recursive: true, force: true }); }
}
console.log(code === 0 ? '✓ CI verte sur un clone vierge' : `✗ CI ROUGE sur un clone vierge (code ${code})`);
process.exitCode = code;
