// enfant.js — le serveur MCP stdio d'UNE session : lancement, messages, arret de TOUT son arbre.
//
// ⚠️ ARRET = l'arbre entier, jamais le seul process : un serveur lance souvent ses propres enfants
// (proxy node -> backend python). Doc Node : tuer un parent ne tue PAS ses petits-enfants.
//   Windows : `taskkill /PID <pid> /T /F` (outil de l'OS) · POSIX : groupe de process (`detached`) + kill(-pid).
//   On attend l'evenement 'exit' (le noyau), jamais un delai.
// ⚠️ stderr est DRAINE (sinon un serveur bavard bloque sur un tube plein) dans un tampon BORNE
// (STDERR_MAX), vide dans le journal seulement si le serveur meurt sans qu'on l'ait demande.
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { definitionLancable } from './config-pure.js';

export const STDERR_MAX = 16 * 1024;
export const ARRET_FORCE_MS = 5000;

/**
 * Resout une commande nue en chemin absolu sous Windows (PATH + PATHEXT), pour lancer SANS shell.
 * ⚠️ Un .cmd/.bat exigerait un shell et ses regles de citation : REFUS NOMME, jamais un shell implicite.
 * @param {string} commande
 * @returns {{ok:true, chemin:string}|{ok:false, raison:string}}
 */
export function resoudreWindows(commande, env = process.env) {
  if (path.isAbsolute(commande) || commande.includes('/') || commande.includes('\\')) return { ok: true, chemin: commande };
  const exts = (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const aExt = path.extname(commande) !== '';
  for (const dir of (env.PATH || env.Path || '').split(';').filter(Boolean)) {
    for (const ext of aExt ? [''] : exts) {
      const p = path.join(dir, commande + ext);
      // ⚠️ `lstat`, JAMAIS `existsSync`/`stat` : un ALIAS D'APPLICATION Windows (WindowsApps\python.exe) est un
      // point d'analyse que `stat` refuse (EACCES) — existsSync repondait « absent » pour un python qui se
      // lance tres bien (mesure 17/10/2026, seo-agency). `lstat` lit l'entree sans la suivre.
      try { fs.lstatSync(p); } catch { continue; /* SILENCE: absent de ce dossier du PATH, on essaie le suivant */ }
      if (/\.(cmd|bat)$/i.test(p)) return { ok: false, raison: `"${commande}" est un script ${path.extname(p)} : indiquer le binaire .exe (lancement sans shell)` };
      return { ok: true, chemin: p };
    }
  }
  return { ok: false, raison: `commande introuvable dans le PATH : "${commande}"` };
}

/**
 * @param {{command:string, args:string[], env:Record<string,string>, cwd:string|null}} def
 * @param {{surMessage:(m:object)=>void, surFin:(code:number|null, signal:string|null, voulu:boolean, raison?:string)=>void, log:(l:string)=>void, nom:string}} o
 */
export function lancerEnfant(brut, o) {
  const win = process.platform === 'win32';
  // ${VAR} developpes comme Claude Code (cf config-pure.definitionLancable) ; refus nomme si absente.
  const prete = definitionLancable(brut, process.env);
  if (!prete.ok) throw new Error(prete.raison);
  const def = prete.def;
  let commande = def.command;
  if (win) {
    const r = resoudreWindows(def.command, { ...process.env, ...def.env });
    if (!r.ok) throw new Error(r.raison);
    commande = r.chemin;
  }
  const child = spawn(commande, def.args, {
    // ⚠️ Sans `cwd` declare : le dossier PERSONNEL, jamais celui du standard (une tache planifiee demarre
    // dans C:\Windows\System32 : un serveur qui ecrirait en relatif y echouerait, ou pire y reussirait).
    cwd: def.cwd || os.homedir(),
    env: { ...process.env, ...def.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: !win, // POSIX : groupe propre => kill(-pid) atteint tout l'arbre
  });
  let voulu = false;
  let fini = false;
  let tampon = '';
  let stderr = '';
  let finir;
  const finie = new Promise((res) => { finir = res; });
  // UNE seule fin, quelle que soit la voie (idempotent) : 'exit' du noyau, OU echec de LANCEMENT.
  const terminer = (code, signal, raison) => {
    if (fini) return;
    fini = true;
    finir();
    o.surFin(code, signal, voulu, raison);
    if (!voulu && stderr) o.log(`[${o.nom}] stderr avant la mort : ${stderr.slice(-2000)}`);
  };
  child.on('exit', (code, signal) => terminer(code, signal));
  // 🛑 Echec de LANCEMENT (commande introuvable, droits) : doc Node — « 'exit' may or may not fire after an
  // error ». MESURE 17/10/2026 sous Linux : il ne vient PAS, et la fenetre attendait sa reponse 60 s pour
  // rien (Windows passait par resoudreWindows et ne voyait jamais ce cas). Sans pid = jamais lance = FIN.
  child.on('error', (e) => {
    o.log(`[${o.nom}] lancement : ${e?.code || e?.message || e}`);
    if (child.pid === undefined) terminer(null, null, `lancement impossible : ${e?.code || e?.message || e}`);
  });
  child.stdin.on('error', () => { /* SILENCE: tube ferme par un enfant qui meurt ; 'exit' le signale */ });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    tampon += d;
    let i;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, i).trim();
      tampon = tampon.slice(i + 1);
      if (!ligne) continue;
      try { o.surMessage(JSON.parse(ligne)); } catch { o.log(`[${o.nom}] ligne stdout non JSON ignoree : ${ligne.slice(0, 200)}`); }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-STDERR_MAX); });

  return {
    pid: child.pid,
    /** @param {object} m */
    envoyer(m) {
      if (fini || !child.stdin.writable) return false;
      child.stdin.write(JSON.stringify(m) + '\n');
      return true;
    },
    /** Arrete TOUT l'arbre et attend la mort reelle. Idempotent. */
    async arreter() {
      if (fini) return;
      voulu = true;
      try {
        if (win) await new Promise((res) => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => res()));
        else {
          process.kill(-/** @type {number} */ (child.pid), 'SIGTERM');
          // ⏱ DELAI DECLARE — motif INDECIDABLE : un process qui ignore SIGTERM est-il en train de
          // finir proprement ou fige ? Personne ne le sait. Passe ARRET_FORCE_MS, SIGKILL (non ignorable).
          const t = setTimeout(() => { try { process.kill(-/** @type {number} */ (child.pid), 'SIGKILL'); } catch { /* SILENCE: deja mort */ } }, ARRET_FORCE_MS);
          finie.then(() => clearTimeout(t));
        }
      } catch (e) {
        o.log(`[${o.nom}] arret : ${e?.code || e?.message || e}`);
      }
      await finie;
    },
  };
}
