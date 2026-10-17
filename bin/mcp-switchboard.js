#!/usr/bin/env node
// mcp-switchboard — commandes de l'operateur.
//   installer            pose le service de l'OS (demarre a l'ouverture de session, relance s'il meurt) et le demarre
//   basculer <nom...>    fait passer ces entrees de ~/.mcp.json par le standard (sauvegarde avant), PUIS
//                        prouve que chaque outil rend la meme liste qu'en direct ; sinon retour automatique
//   revenir <nom...>     remet ces entrees en stdio, mot pour mot comme avant
//   etat                 sessions ouvertes et serveurs allumes, par outil
// Apres basculer/revenir : la synchro des harnais (Codex, Antigravity) se relance si elle existe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emplacements } from '../src/paths.js';
import { planService } from '../src/service-pure.js';
import { planBascule, planRetour, VARIABLE_JETON } from '../src/bascule-pure.js';
import { PORT_DEFAUT, HOTE_DEFAUT } from '../src/config-pure.js';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { config: fichierConfig, etat } = emplacements();
const FICHIER_CLIENT = path.join(os.homedir(), '.mcp.json');
const MAX_SAUVEGARDES = 10;

const lireJson = (f, defaut) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (e) { if (defaut !== undefined && e?.code === 'ENOENT') return defaut; throw new Error(`${f} illisible : ${e?.code || e?.message}`); } };
const ecrireJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + '\n'); fs.renameSync(tmp, f); };
const jeton = () => fs.readFileSync(path.join(etat, 'jeton'), 'utf8').trim();

/** Sauvegarde horodatee de ~/.mcp.json — L'ESPACE SE DECLARE : les MAX_SAUVEGARDES plus recentes seulement. */
function sauvegarder() {
  const dir = path.join(etat, 'sauvegardes');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `mcp.json.${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.copyFileSync(FICHIER_CLIENT, f);
  const tous = fs.readdirSync(dir).filter((n) => n.startsWith('mcp.json.')).sort();
  for (const vieux of tous.slice(0, Math.max(0, tous.length - MAX_SAUVEGARDES))) fs.rmSync(path.join(dir, vieux));
  return f;
}

/**
 * Arrete l'instance en cours (s'il y en a une) et attend sa MORT REELLE.
 * 🛑 Le temoin est le NOYAU : une socket ouverte vers le standard AVANT la demande d'arret ; elle se
 * ferme quand le process sort. Aucun delai suppose. Personne n'ecoute (ECONNREFUSED) => rien a arreter.
 * ⚠️ JAMAIS `schtasks /end` : il tue le lanceur et laisse node ORPHELIN, hors surveillance (mesure 17/10/2026).
 */
async function arreterInstance(port, hote) {
  const net = await import('node:net');
  const temoin = net.connect(port, hote);
  const ouvert = await new Promise((ok) => { temoin.once('connect', () => ok(true)); temoin.once('error', () => ok(false)); });
  if (!ouvert) return;
  const mort = new Promise((ok) => temoin.once('close', ok));
  temoin.on('error', () => { /* SILENCE: la fermeture brutale a la mort du process est le signal attendu */ });
  const r = await fetch(`http://${hote}:${port}/arreter`, { method: 'POST', headers: { Authorization: `Bearer ${jeton()}` } });
  if (r.status !== 202) throw new Error(`l'instance en cours refuse l'arret (HTTP ${r.status}) : ancienne version ? l'arreter a la main puis relancer`);
  const { ppid } = await r.json();
  await mort;
  // 🛑 WINDOWS : la socket temoin se ferme quand le standard ferme ses connexions, AVANT que son lanceur
  // (wscript) ait fini. Relancer la tache a cet instant est IGNORE (MultipleInstancesPolicy IgnoreNew : une
  // execution « tourne encore ») — MESURE 17/10/2026 : standard reste ETEINT, sans erreur nulle part.
  // ⇒ attendre la mort du LANCEUR par l'OS (`Wait-Process`, attente d'evenement du noyau, aucun delai).
  if (process.platform === 'win32' && Number.isInteger(ppid) && ppid > 0) {
    // Lanceur DEJA mort = cas normal (rien a attendre) : Wait-Process leve alors, d'ou try/catch + exit 0.
    execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `try { Wait-Process -Id ${ppid} -ErrorAction Stop } catch {}; exit 0`], { stdio: 'pipe', windowsHide: true });
  }
}

/**
 * Attend que le standard reponde a /sante. ⏱ DELAI DECLARE — motif DISTANT : le demarrage se passe dans un
 * AUTRE process lance par le planificateur, qui n'emet aucun evenement vers nous ; on INTERROGE donc,
 * borne a VERIF_ESSAIS x VERIF_PAS_MS (~15 s). Echec = refus nomme, jamais un succes suppose.
 */
const VERIF_ESSAIS = 60;
const VERIF_PAS_MS = 250;
async function attendreReponse(port, hote) {
  for (let i = 0; i < VERIF_ESSAIS; i++) {
    try {
      const r = await fetch(`http://${hote}:${port}/sante`, { headers: { Authorization: `Bearer ${jeton()}` } });
      if (r.ok) return await r.json();
    } catch { /* SILENCE: pas encore a l'ecoute, essai suivant (borne) */ }
    await new Promise((ok) => setTimeout(ok, VERIF_PAS_MS));
  }
  return null;
}

function synchroHarnais() {
  const sync = path.join(os.homedir(), '.codex', 'sync-mcps.js');
  if (!fs.existsSync(sync)) return;
  try { execFileSync(process.execPath, [sync], { stdio: 'inherit', env: { ...process.env, [VARIABLE_JETON]: jeton() } }); } catch { console.error('synchro des harnais en echec (voir ci-dessus)'); }
}

async function main([cmd, ...args]) {
  if (cmd === 'installer') {
    // Le jeton existe des l'installation (le standard le cree aussi a son premier lancement : meme fichier).
    fs.mkdirSync(etat, { recursive: true });
    const fj = path.join(etat, 'jeton');
    if (!fs.existsSync(fj)) { const { randomBytes } = await import('node:crypto'); fs.writeFileSync(fj, randomBytes(32).toString('hex'), { mode: 0o600 }); }
    if (!fs.existsSync(fichierConfig)) ecrireJson(fichierConfig, { port: PORT_DEFAUT, serveurs: {} });
    // L'instance en cours ecoute a l'adresse qu'elle a LUE au demarrage : celle du fichier, sauf si on vient
    // de la changer — d'ou l'adresse passee par l'option, sinon celle du fichier.
    const c0 = lireJson(fichierConfig);
    await arreterInstance(c0.port ?? PORT_DEFAUT, process.env.MCP_SWITCHBOARD_HOTE_COURANT || c0.hote || HOTE_DEFAUT);
    const plan = planService({ platform: process.platform, node: process.execPath, main: path.join(RACINE, 'src', 'main.js'), lanceur: path.join(RACINE, 'bin', 'sans-fenetre.vbs'), utilisateur: `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`, home: os.homedir(), uid: process.getuid?.() });
    const fichier = path.isAbsolute(plan.fichier) ? plan.fichier : path.join(etat, plan.fichier);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    if (plan.encodage === 'utf16le-bom') fs.writeFileSync(fichier, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plan.contenu, 'utf16le')]));
    else fs.writeFileSync(fichier, plan.contenu);
    for (const c of plan.commandes) {
      const a = c.map((x) => x.replace('{fichier}', fichier));
      try { execFileSync(a[0], a.slice(1), { stdio: 'pipe' }); } catch (e) { if (a[1] !== 'bootout') throw new Error(`${a.join(' ')} : ${String(e.stderr || e.message).trim()}`); }
    }
    // La variable du jeton, pour les harnais lances APRES (Claude Code la developpe dans ~/.mcp.json).
    if (process.platform === 'win32') execFileSync('setx', [VARIABLE_JETON, jeton()], { stdio: 'pipe' });
    else console.log(`A ajouter a l'environnement de ta session : export ${VARIABLE_JETON}=$(cat "${path.join(etat, 'jeton')}")`);
    // 🛑 « installe » ne s'ecrit QU'APRES une reponse reelle du standard (mesure 17/10/2026 : une relance
    // ignoree par le planificateur laissait le standard ETEINT pendant que l'installeur annoncait le succes).
    const cfgFin = lireJson(fichierConfig);
    const sante = await attendreReponse(cfgFin.port ?? PORT_DEFAUT, cfgFin.hote || HOTE_DEFAUT);
    if (!sante) throw new Error(`le service est pose mais le standard NE REPOND PAS sur ${cfgFin.hote || HOTE_DEFAUT}:${cfgFin.port ?? PORT_DEFAUT} — lire ${path.join(etat, 'switchboard.log')}`);
    console.log(`service installe, demarre et VERIFIE (${sante.sessions} session(s), ${fichier})`);
    return;
  }
  if (cmd === 'basculer' || cmd === 'revenir') {
    if (!args.length) throw new Error(`usage : mcp-switchboard ${cmd} <nom...>`);
    const client = lireJson(FICHIER_CLIENT);
    const standard = lireJson(fichierConfig, { port: PORT_DEFAUT, serveurs: {} });
    const plan = (cmd === 'basculer' ? planBascule : planRetour)(client, standard, args);
    if (!plan.ok) throw new Error(plan.raison);
    const sauvegarde = sauvegarder();
    // ORDRE : le standard connait le serveur AVANT que le client ne pointe dessus (et l'inverse au retour).
    if (cmd === 'basculer') { ecrireJson(fichierConfig, plan.standard); ecrireJson(FICHIER_CLIENT, plan.client); }
    else { ecrireJson(FICHIER_CLIENT, plan.client); ecrireJson(fichierConfig, plan.standard); }
    console.log(`${cmd} : ${args.join(', ')} (sauvegarde : ${sauvegarde})`);
    // Le standard relit MAINTENANT et dit ce qu'il connait : aucun delai suppose avant de verifier.
    const relu = await fetch(`http://${plan.standard.hote || HOTE_DEFAUT}:${plan.standard.port}/relire`, { method: 'POST', headers: { Authorization: `Bearer ${jeton()}` } }).then((r) => r.json()).catch((e) => ({ erreur: e?.message || String(e) }));
    if (relu.erreur) console.log(`  ⚠️ standard injoignable (${relu.erreur}) : il relira sa config a son prochain demarrage`);
    if (cmd === 'basculer') {
      // 🛑 PREUVE avant de garder la bascule : meme liste d'outils par le standard qu'en direct.
      // Difference ou verification impossible => RETOUR automatique en stdio, entree par entree.
      const { comparer } = await import('../src/verification.js');
      const { urlDe } = await import('../src/bascule-pure.js');
      const echecs = [];
      for (const nom of args) {
        const r = await comparer(plan.standard.serveurs[nom], urlDe(plan.standard.port, nom, plan.standard.hote), jeton());
        console.log(`  ${nom} : ${r.identique ? `identique (${r.direct} outils)` : `DIFFERENT — ${r.detail}`}`);
        if (!r.identique) echecs.push(nom);
      }
      if (echecs.length) {
        const retour = planRetour(lireJson(FICHIER_CLIENT), lireJson(fichierConfig), echecs);
        if (!retour.ok) throw new Error(`retour automatique impossible (${retour.raison}) : restaurer ${sauvegarde}`);
        ecrireJson(FICHIER_CLIENT, retour.client);
        ecrireJson(fichierConfig, retour.standard);
        console.log(`  retour automatique en stdio : ${echecs.join(', ')}`);
        process.exitCode = 1;
      }
    }
    synchroHarnais();
    return;
  }
  if (cmd === 'etat') {
    const cfg = lireJson(fichierConfig);
    const r = await fetch(`http://${cfg.hote || HOTE_DEFAUT}:${cfg.port}/sante`, { headers: { Authorization: `Bearer ${jeton()}` } });
    console.log(JSON.stringify(await r.json(), null, 2));
    return;
  }
  console.log('commandes : installer | basculer <nom...> | revenir <nom...> | etat');
  process.exitCode = 2;
}

main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
