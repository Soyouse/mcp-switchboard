// bascule-pure.js — LE PLAN de bascule d'une entree MCP stdio vers le standard (et retour). PUR.
//
// 🛑 Une entree basculee GARDE tout ce qui la definissait (command, args, env, cwd) : c'est le standard
// qui la lancera, a l'identique. Dans la config du client ne reste qu'une adresse + l'en-tete du jeton.
// 🛑 Le jeton n'est JAMAIS ecrit en clair dans la config du client : `${VARIABLE}` (developpe par le
// harnais). Mesure 17/10/2026 : `~/.mcp.json` est suivi par git (depot prive) — un secret en clair y partirait.
// 🛑 Le retour est l'inverse EXACT : basculer puis revenir rend la configuration de depart (propriete testee).

// ⚠️ Nom rendu par une FONCTION : une litterale au niveau module s'evalue a l'import, hors de tout test,
// et Stryker la declare « survivante » sans l'avoir essayee (piege mesure du parc, 31/08/2026).
export const nomVariableJeton = () => 'MCP_SWITCHBOARD_TOKEN';
export const VARIABLE_JETON = nomVariableJeton();

/** @param {number} port @param {string} nom @param {string} [hote] adresse d'ecoute du standard (cf config-pure.hoteAdmis) */
export const urlDe = (port, nom, hote = '127.0.0.1') => `http://${hote}:${port}/mcp/${nom}`;

/**
 * @param {{mcpServers:Record<string, any>}} client  config du client (forme ~/.mcp.json)
 * @param {{port:number, serveurs:Record<string, any>}} standard  config du standard
 * @param {string[]} noms
 * @returns {{ok:true, client:object, standard:object} | {ok:false, raison:string}}
 */
export function planBascule(client, standard, noms, aide) {
  const c = structuredClone(client);
  const s = structuredClone(standard);
  for (const nom of noms) {
    const e = c.mcpServers?.[nom];
    if (!e) return { ok: false, raison: `entree inconnue dans la config du client : "${nom}"` };
    if (e.url || (e.type && e.type !== 'stdio')) return { ok: false, raison: `"${nom}" n'est pas un serveur stdio (deja une adresse)` };
    if (typeof e.command !== 'string') return { ok: false, raison: `"${nom}" n'a pas de commande` };
    if (s.serveurs[nom]) return { ok: false, raison: `"${nom}" existe deja dans le standard` };
    // `origine` = l'entree du client MOT POUR MOT : c'est elle que le retour remet (inverse EXACT).
    s.serveurs[nom] = { command: e.command, args: e.args || [], env: e.env || {}, ...(e.cwd ? { cwd: e.cwd } : {}), origine: e };
    c.mcpServers[nom] = { type: 'http', url: urlDe(s.port, nom, s.hote), headers: { Authorization: `Bearer \${${nomVariableJeton()}}` }, ...(aide ? { headersHelper: aide } : {}) };
  }
  return { ok: true, client: c, standard: s };
}

/**
 * Pose `headersHelper` sur CHAQUE entree du client qui pointe vers le standard (idempotent).
 * POURQUOI (mesure 07/11/2026) : un harnais lance depuis un environnement Windows qui a perdu les variables de
 * l'utilisateur (PATH > 2 047 caracteres, KB 2685893) n'a pas `MCP_SWITCHBOARD_TOKEN` ; Claude Code envoie alors
 * `${MCP_SWITCHBOARD_TOKEN}` tel quel (doc officielle) et TOUS les connecteurs rendent 401. `headersHelper`
 * (doc code.claude.com/docs/en/mcp, lue le 07/11/2026) est lance a chaque connexion, relance apres un 401, et
 * ses en-tetes remplacent les statiques du meme nom : il lit le jeton dans le FICHIER du standard, sans variable.
 * L'en-tete statique reste pour les harnais qui ignorent `headersHelper` (Codex, Antigravity).
 * @returns {{client:object, poses:string[]}}
 */
export function poserAide(client, standard, aide) {
  const c = structuredClone(client);
  const poses = [];
  for (const [nom, e] of Object.entries(c.mcpServers || {})) {
    if (e?.url === urlDe(standard.port, nom, standard.hote) && e.headersHelper !== aide) {
      e.headersHelper = aide;
      poses.push(nom);
    }
  }
  return { client: c, poses };
}

/**
 * Inverse exact de planBascule pour ces noms.
 * @returns {{ok:true, client:object, standard:object} | {ok:false, raison:string}}
 */
export function planRetour(client, standard, noms) {
  const c = structuredClone(client);
  const s = structuredClone(standard);
  for (const nom of noms) {
    const def = s.serveurs?.[nom];
    if (!def) return { ok: false, raison: `"${nom}" n'est pas dans le standard` };
    const e = c.mcpServers?.[nom];
    if (!e || e.url !== urlDe(s.port, nom, s.hote)) return { ok: false, raison: `"${nom}" ne pointe pas vers le standard dans la config du client` };
    c.mcpServers[nom] = def.origine ? def.origine : { type: 'stdio', command: def.command, args: def.args, env: def.env, ...(def.cwd ? { cwd: def.cwd } : {}) };
    delete s.serveurs[nom];
  }
  return { ok: true, client: c, standard: s };
}
