// LES GATES DU DEPOT (depot PUBLIC). Chacun a son volet negatif : un juge jamais vu rouge ne prouve rien.
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const suivis = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: RACINE, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const juge = () => spawnSync(process.execPath, [path.join(RACINE, 'tools', 'fuite-gate.mjs')], { cwd: RACINE, encoding: 'utf8' });

test('GATE fuite : le depot est propre', () => {
  const r = juge();
  expect(r.status, r.stderr).toBe(0);
});

test('GATE fuite — volet negatif : un fichier qui fuit (non suivi, non ignore) fait ROUGIR', () => {
  const sonde = path.join(RACINE, 'sonde-fuite.tmp.md');
  fs.writeFileSync(sonde, 'contact : jean' + '@' + 'exemple.fr\n');
  try {
    const r = juge();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('sonde-fuite.tmp.md : e-mail');
  } finally { fs.rmSync(sonde, { force: true }); }
});

test('GATE CI = UNE commande locale : le workflow ne lance que `npm ci` puis `npm run ci`', () => {
  const wf = fs.readFileSync(path.join(RACINE, '.github', 'workflows', 'ci.yml'), 'utf8');
  const runs = [...wf.matchAll(/^\s*-\s*run:\s*(.+)$/gm)].map((m) => m[1].trim());
  expect(runs).toEqual(['npm ci', 'npm run ci']);
  const scripts = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).scripts;
  expect(scripts.ci, 'la commande existe').toBeTruthy();
  expect(scripts['ci:clean-clone'], 'la preuve clone vierge existe').toBeTruthy();
  expect(scripts.prepare, 'les hooks git sont actives a l installation').toBe('git config core.hooksPath .githooks');
});

test('GATE arborescence : tout fichier de code est catalogue, et tout fichier catalogue existe', () => {
  const arbo = fs.readFileSync(path.join(RACINE, 'ARBORESCENCE.md'), 'utf8');
  const code = suivis().filter((f) => /^(src|bin|tools|tests|\.githooks)\//.test(f) && !f.endsWith('.tmp.md'));
  const absents = code.filter((f) => !arbo.includes('`' + f + '`'));
  expect(absents, 'a cataloguer dans ARBORESCENCE.md').toEqual([]);
  const cites = [...arbo.matchAll(/`((?:src|bin|tools|tests|\.githooks)\/[^`]+)`/g)].map((m) => m[1]);
  expect(cites.length, 'anti-vacuite : le catalogue cite des fichiers').toBeGreaterThan(10);
  expect(cites.filter((c) => !fs.existsSync(path.join(RACINE, c))), 'cites mais absents').toEqual([]);
});

test('GATE mutation : aucun fichier suivi ne garde l instrumentation Stryker (run interrompu = tests verts, source corrompue)', () => {
  const marque = ['stry', 'MutAct_'].join('');
  const sales = suivis().filter((f) => /\.(m?js|cjs)$/.test(f) && fs.existsSync(path.join(RACINE, f)) && fs.readFileSync(path.join(RACINE, f), 'utf8').includes(marque));
  expect(sales).toEqual([]);
});

test('GATE hooks : pre-commit (fuite), commit-msg (fuite du message), pre-push (suite complete) presents', () => {
  const lire = (n) => fs.readFileSync(path.join(RACINE, '.githooks', n), 'utf8');
  expect(lire('pre-commit')).toContain('tools/fuite-gate.mjs');
  expect(lire('commit-msg')).toMatch(/tools\/fuite-gate\.mjs --message "\$1"/);
  expect(lire('pre-push')).toContain('npm run ci');
});
