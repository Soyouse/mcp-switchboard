// config-pure.js — VALIDATION de la configuration du standard. PUR, fails-closed, refus NOMMES.
//
// Forme : { "port": 47800, "serveurs": { "<nom>": { "command": "node", "args": [...], "env": {...}, "cwd": "..." } } }
// ⚠️ Le nom d'un serveur devient un segment d'URL (/mcp/<nom>) : alphabet ferme.

export const PORT_DEFAUT = 47800;
export const HOTE_DEFAUT = '127.0.0.1';
const NOM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * Adresse d'ECOUTE admise. 🛑 Le standard lance des outils qui portent des secrets : l'adresse EST la
 * frontiere. Admis : boucle locale 127/8, ou une adresse PRIVEE (10/8, 172.16/12, 192.168/16) — cas de la
 * carte dediee Windows en /32 (10.87.87.1, carte de bouclage Microsoft KM-TEST) : sous Windows, libuv coupe la
 * retransmission du SYN vers 127/8 et une rafale PERD des connexions (mesure sur un poste Windows 11, 2026-09-03 :
 * 2 061 echecs / 14 777 sur 127.0.0.1 contre 128 / 15 712 sur la carte, tous dans la bascule).
 * Refuses : 0.0.0.0 (toutes les interfaces), Tailscale 100.64/10, publique, et tout ce qui n'est pas IPv4.
 * @param {unknown} h
 */
export function hoteAdmis(h) {
  const m = typeof h === 'string' ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h) : null;
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((x) => x > 255)) return false;
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * Developpe `${VAR}` et `${VAR:-defaut}` comme Claude Code le fait dans `.mcp.json` (doc officielle MCP :
 * command, args, env). 🛑 Une entree basculee DOIT recevoir les MEMES valeurs qu'en stdio : sans ce
 * developpement, `"API_KEY": "${API_KEY:-}"` arrivait TEL QUEL au serveur (mesure 17/10/2026).
 * Variable absente SANS defaut = refus nomme (Claude Code refuse aussi la config dans ce cas).
 * @param {string} texte
 * @param {Record<string, string|undefined>} env
 * @returns {{ok:true, valeur:string}|{ok:false, raison:string}}
 */
export function developper(texte, env) {
  const motif = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
  // Refus decide AVANT tout remplacement : le remplacement ne rencontre donc jamais de cas manquant.
  const manquante = [...texte.matchAll(motif)].find((m) => env[m[1]] === undefined && m[2] === undefined);
  if (manquante) return { ok: false, raison: `variable d'environnement absente et sans valeur par defaut : ${manquante[1]}` };
  return { ok: true, valeur: texte.replace(motif, (_t, nom, defaut) => (env[nom] !== undefined ? /** @type {string} */ (env[nom]) : defaut)) };
}

/**
 * Definition PRETE A LANCER : chaque chaine developpee. Fonction TOTALE.
 * @param {{command:string, args:string[], env:Record<string,string>, cwd:string|null}} def
 * @param {Record<string, string|undefined>} env
 * @returns {{ok:true, def:{command:string, args:string[], env:Record<string,string>, cwd:string|null}}|{ok:false, raison:string}}
 */
export function definitionLancable(def, env) {
  const r = [def.command, ...def.args, ...Object.values(def.env)].map((m) => developper(m, env));
  const rCwd = def.cwd ? developper(def.cwd, env) : { ok: true, valeur: null };
  const ko = [...r, rCwd].find((x) => !x.ok);
  if (ko) return /** @type {{ok:false, raison:string}} */ (ko);
  const v = r.map((x) => /** @type {{valeur:string}} */ (x).valeur);
  const n = def.args.length;
  const cles = Object.keys(def.env);
  return { ok: true, def: { command: v[0], args: v.slice(1, 1 + n), env: Object.fromEntries(cles.map((k, i) => [k, v[1 + n + i]])), cwd: /** @type {{valeur:string|null}} */ (rCwd).valeur } };
}

/**
 * @param {unknown} cfg
 * @returns {{ok:true, config:{port:number, hote:string, serveurs:Record<string,{command:string, args:string[], env:Record<string,string>, cwd:string|null}>}} | {ok:false, raison:string}}
 */
export function verdictConfig(cfg) {
  const c = /** @type {{port?:unknown, hote?:unknown, serveurs?:unknown}} */ (cfg);
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, raison: 'la configuration doit etre un objet' };
  const port = c.port === undefined ? PORT_DEFAUT : c.port;
  if (!Number.isInteger(port) || /** @type {number} */ (port) < 1 || /** @type {number} */ (port) > 65535) return { ok: false, raison: `port invalide : ${String(c.port)}` };
  const hote = c.hote === undefined ? HOTE_DEFAUT : c.hote;
  if (!hoteAdmis(hote)) return { ok: false, raison: `adresse d'ecoute refusee : ${String(c.hote)} (boucle locale 127/8 ou adresse privee seulement)` };
  if (!c.serveurs || typeof c.serveurs !== 'object' || Array.isArray(c.serveurs)) return { ok: false, raison: '"serveurs" doit etre un objet' };
  /** @type {Record<string,{command:string, args:string[], env:Record<string,string>, cwd:string|null}>} */
  const serveurs = {};
  for (const [nom, s] of Object.entries(/** @type {Record<string, any>} */ (c.serveurs))) {
    if (!NOM.test(nom)) return { ok: false, raison: `nom de serveur invalide : "${nom}" (alphabet [A-Za-z0-9._-], 1..64)` };
    if (!s || typeof s !== 'object' || Array.isArray(s)) return { ok: false, raison: `serveur "${nom}" : doit etre un objet` };
    if (typeof s.command !== 'string' || !s.command) return { ok: false, raison: `serveur "${nom}" : "command" manquant` };
    const args = s.args === undefined ? [] : s.args;
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) return { ok: false, raison: `serveur "${nom}" : "args" doit etre une liste de chaines` };
    const env = s.env === undefined ? {} : s.env;
    if (!env || typeof env !== 'object' || Array.isArray(env) || !Object.values(env).every((v) => typeof v === 'string')) return { ok: false, raison: `serveur "${nom}" : "env" doit etre un objet de chaines` };
    if (s.cwd !== undefined && typeof s.cwd !== 'string') return { ok: false, raison: `serveur "${nom}" : "cwd" doit etre une chaine` };
    serveurs[nom] = { command: s.command, args: [...args], env: { ...env }, cwd: s.cwd ?? null };
  }
  return { ok: true, config: { port: /** @type {number} */ (port), hote: /** @type {string} */ (hote), serveurs } };
}
