#!/usr/bin/env node
// main.js — point d'entree du standard. Lit la config (refus nomme), le jeton, puis ecoute.
// ⚠️ UNE seule instance par poste, decidee par le NOYAU : port deja pris (EADDRINUSE) => une
// instance tourne deja => sortie 0, sans rien toucher. Jamais de fichier verrou.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { emplacements } from './paths.js';
import { ouvrirJournal } from './journal.js';
import { ouvrirSouvenir } from './souvenir.js';
import { verdictConfig } from './config-pure.js';
import { creerStandard } from './serveur.js';

const { config: fichierConfig, etat } = emplacements();
const log = ouvrirJournal(etat);

/** Jeton porteur : cree une fois (aleatoire 256 bits), relu ensuite. Fichier lisible du seul utilisateur. */
export function jetonDe(dossier) {
  const f = path.join(dossier, 'jeton');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch { /* SILENCE: absent au premier lancement, cree ci-dessous */ }
  const j = randomBytes(32).toString('hex');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(f, j, { mode: 0o600 });
  return j;
}

async function demarrer() {
  let brut;
  // ⚠️ BOM retire : PowerShell 5.1 en ecrit un en UTF-8, et JSON.parse le refuse (mesure 17/10/2026).
  try { brut = JSON.parse(fs.readFileSync(fichierConfig, 'utf8').replace(/^﻿/, '')); } catch (e) {
    log(`configuration illisible (${fichierConfig}) : ${e?.code || e?.message}`);
    process.exitCode = 1;
    return;
  }
  const v = verdictConfig(brut);
  if (!v.ok) { log(`configuration REFUSEE : ${v.raison}`); process.exitCode = 1; return; }
  // `surArret` : arret DEMANDE (installeur) => sortie 0, donc la tache ne se relance pas toute seule.
  const standard = creerStandard(v.config, { jeton: jetonDe(etat), souvenir: ouvrirSouvenir(etat, log), log, surArret: () => stop('demande /arreter'), surRelire: () => relire() });
  try {
    await standard.ecouter();
  } catch (e) {
    if (e?.code === 'EADDRINUSE') { log(`port ${v.config.port} deja pris : une instance tourne deja, sortie`); return; }
    throw e;
  }
  log(`standard en ecoute sur ${v.config.hote}:${v.config.port} (${Object.keys(v.config.serveurs).length} serveurs)`);
  // 🛑 RELECTURE A CHAUD : l'OS REVEILLE (fs.watch sur le DOSSIER, le fichier est remplace par rename),
  // le CONTENU DECIDE (texte identique => rien). Config invalide => IGNOREE, l'ancienne reste (refus nomme).
  // Les sessions ouvertes gardent leur serveur ; un serveur ajoute est disponible pour les suivantes.
  // ⚠️ Le port ne change pas a chaud (les clients pointent dessus) : il exige un redemarrage, dit au journal.
  let dernier = JSON.stringify(brut);
  const relire = () => {
    let b;
    try { b = JSON.parse(fs.readFileSync(fichierConfig, 'utf8').replace(/^﻿/, '')); } catch { return; /* ecriture en cours : le rename suivant reveillera */ }
    const texte = JSON.stringify(b);
    if (texte === dernier) return;
    const nv = verdictConfig(b);
    if (!nv.ok) { log(`nouvelle configuration REFUSEE (l'ancienne reste) : ${nv.raison}`); return; }
    dernier = texte;
    if (nv.config.port !== v.config.port || nv.config.hote !== v.config.hote) log(`changement d'adresse (${v.config.hote}:${v.config.port} -> ${nv.config.hote}:${nv.config.port}) ignore a chaud : relancer le service (mcp-switchboard installer)`);
    for (const k of Object.keys(v.config.serveurs)) if (!(k in nv.config.serveurs)) delete v.config.serveurs[k];
    Object.assign(v.config.serveurs, nv.config.serveurs);
    log(`configuration relue : ${Object.keys(v.config.serveurs).join(', ') || '(aucun serveur)'}`);
  };
  try {
    fs.watch(path.dirname(fichierConfig), { persistent: false }, (_ev, nom) => { if (!nom || nom === path.basename(fichierConfig)) relire(); });
  } catch (e) { log(`surveillance de la configuration impossible (${e?.code}) : redemarrer le service apres chaque changement`); }
  async function stop(motif) { log(`arret (${motif})`); await standard.arreter(); process.exit(0); }
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

process.on('uncaughtException', (e) => log(`uncaughtException : ${e?.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandledRejection : ${e?.stack || e}`));
try { await demarrer(); } catch (e) { log(`demarrage : ${e?.stack || e}`); process.exitCode = 1; }
