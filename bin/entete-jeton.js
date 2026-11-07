#!/usr/bin/env node
// entete-jeton.js — `headersHelper` de Claude Code : ecrit {"Authorization":"Bearer <jeton>"} sur la sortie.
// Le jeton est lu dans le FICHIER du standard (dossier d'etat de `paths.js`), JAMAIS dans une variable : un
// harnais lance depuis un environnement qui a perdu les variables de l'utilisateur (Windows, PATH trop long)
// garde ainsi ses connecteurs. Doc officielle : sortie = objet JSON de chaines, abandon apres 10 s.
// 🛑 Jeton absent ou vide = sortie 1 avec la raison sur la sortie d'erreur, jamais un en-tete vide.
import fs from 'node:fs';
import path from 'node:path';
import { emplacements } from '../src/paths.js';

const fichier = path.join(emplacements().etat, 'jeton');
let jeton = '';
try { jeton = fs.readFileSync(fichier, 'utf8').trim(); } catch (e) { console.error(`jeton illisible : ${fichier} (${e?.code || e?.message})`); process.exit(1); }
if (!jeton) { console.error(`jeton vide : ${fichier}`); process.exit(1); }
process.stdout.write(JSON.stringify({ Authorization: `Bearer ${jeton}` }));
