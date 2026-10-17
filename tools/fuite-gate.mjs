#!/usr/bin/env node
// fuite-gate.mjs — juge anti-fuite : TOUT fichier suivi (ou indexe) + le message de commit fourni.
//   node tools/fuite-gate.mjs                   fichiers suivis par git (+ indexes)
//   node tools/fuite-gate.mjs --message <f>     juge aussi un message de commit (hook commit-msg)
// Liste PERSONNELLE : fichier hors depot, `MCP_SWITCHBOARD_FUITES` ou `~/.config/mcp-switchboard/fuites.txt`
// (une chaine interdite par ligne). 🛑 Absente = AVERTI (motifs generiques seuls), jamais un silence.
// Sortie 1 = fuite (nommee, extrait masque pour les motifs personnels), 0 = propre.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fuites, lireListe } from './fuite-pure.js';

const racine = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const fichierListe = process.env.MCP_SWITCHBOARD_FUITES || path.join(os.homedir(), '.config', 'mcp-switchboard', 'fuites.txt');
let personnels = [];
if (fs.existsSync(fichierListe)) personnels = lireListe(fs.readFileSync(fichierListe, 'utf8'));
else process.stderr.write(`⚠️ liste personnelle absente (${fichierListe}) : seuls les motifs generiques sont juges\n`);

const suivis = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: racine, encoding: 'utf8' }).split('\0').filter(Boolean);
const rapport = [];
for (const rel of suivis) {
  if (rel === 'package-lock.json') continue; // genere par npm, aucune donnee d'auteur (registre public)
  const f = path.join(racine, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
  for (const x of fuites(fs.readFileSync(f, 'utf8'), personnels)) rapport.push(`${rel} : ${x.motif} « ${x.extrait} »`);
}
const i = process.argv.indexOf('--message');
if (i > 0) for (const x of fuites(fs.readFileSync(process.argv[i + 1], 'utf8'), personnels)) rapport.push(`message de commit : ${x.motif} « ${x.extrait} »`);
if (rapport.length) {
  process.stderr.write(`🛑 FUITE de donnee personnelle (depot PUBLIC) :\n  ${rapport.join('\n  ')}\n`);
  process.exitCode = 1;
} else process.stdout.write(`propre : ${suivis.length} fichiers, ${personnels.length} motif(s) personnel(s)\n`);
