// session-pure.js — LA DECISION de ce que fait une session pour chaque message du client. PUR.
//
// 🛑 LE CONTRAT DU STANDARD, EN UNE PHRASE : une fenetre (= une session MCP) obtient SON PROPRE
// serveur, exactement comme si elle l'avait lance elle-meme en stdio — mais ce serveur n'est
// allume qu'au premier message qui EXIGE un serveur vivant. Tant qu'elle ne fait que se presenter
// (handshake + listes de decouverte), le standard repond avec le SOUVENIR de ce que ce meme
// serveur a deja repondu, mot pour mot.
//
// ⚠️ NE JAMAIS partager un serveur entre deux sessions : c'est ce qui garantit le comportement
// d'avant (etat, connexions, pauses propres a chaque fenetre). L'economie vient de ce qui ne
// s'allume PAS, jamais de ce qui est partage.

/** Methodes de DECOUVERTE servables de memoire (reponse identique pour une meme commande). */
export const DECOUVERTE = Object.freeze(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);
/** Notification de changement associee a chaque liste de decouverte. */
export const NOTIF_CHANGEMENT = Object.freeze({
  'tools/list': 'notifications/tools/list_changed',
  'prompts/list': 'notifications/prompts/list_changed',
  'resources/list': 'notifications/resources/list_changed',
  'resources/templates/list': 'notifications/resources/list_changed',
});

/**
 * Nature d'un message JSON-RPC venant du client. Fonction TOTALE.
 * @param {unknown} m
 * @returns {'requete'|'notification'|'reponse'|'invalide'}
 */
export function nature(m) {
  const x = /** @type {{id?:unknown, method?:unknown, result?:unknown, error?:unknown}} */ (m);
  if (!x) return 'invalide'; // une valeur primitive n'a ni `method` ni `id` : elle finit « invalide » plus bas
  const aId = x.id !== undefined && x.id !== null;
  if (typeof x.method === 'string') return aId ? 'requete' : 'notification';
  if (aId && ('result' in x || 'error' in x)) return 'reponse';
  return 'invalide';
}

/**
 * Une requete de decouverte servable de memoire : methode connue ET premiere page (aucun curseur).
 * Une page suivante depend d'un curseur emis par un serveur VIVANT : jamais de memoire.
 * @param {{method?:string, params?:{cursor?:unknown}}} m
 */
export function decouverteServable(m) {
  return DECOUVERTE.includes(/** @type {string} */ (m.method)) && (m.params?.cursor ?? null) === null;
}

/**
 * Que faire de ce message ? Fonction TOTALE.
 * @param {unknown} m le message du client
 * @param {{vivant:boolean, souvenir:{init?:object, listes?:Record<string,object>}|null}} etat
 *   `vivant` = un serveur tourne (ou demarre) pour CETTE session ; `souvenir` = ce que la meme commande a deja repondu.
 * @returns {{action:'repondre-souvenir', resultat:object, methode:string}
 *   | {action:'repondre-ping'}
 *   | {action:'retenir-init'}
 *   | {action:'ignorer', raison:string}
 *   | {action:'transmettre'}
 *   | {action:'allumer-puis-transmettre'}}
 */
export function decider(m, etat) {
  const n = nature(m);
  if (n === 'invalide') return { action: 'ignorer', raison: 'message JSON-RPC invalide' };
  const x = /** @type {{method?:string, params?:object}} */ (m);
  if (n === 'requete' && x.method === 'ping') return { action: 'repondre-ping' };
  if (etat.vivant) {
    // Le handshake du client a deja ete rejoue au serveur ; un second `initialized` serait un doublon.
    if (n === 'notification' && x.method === 'notifications/initialized') return { action: 'ignorer', raison: 'initialized deja rejoue' };
    return { action: 'transmettre' };
  }
  // ── A FROID : aucun serveur pour cette session ──
  if (n === 'notification') {
    // `initialized` sera rejoue a l'allumage ; toute autre notification ne concerne aucune requete
    // en cours (aucune n'a ete relayee) et un serveur neuf refera son propre handshake.
    return { action: 'ignorer', raison: x.method === 'notifications/initialized' ? 'initialized rejoue a l allumage' : 'notification a froid' };
  }
  if (n === 'reponse') return { action: 'ignorer', raison: 'reponse sans requete du serveur (a froid)' };
  if (x.method === 'initialize') {
    return etat.souvenir?.init ? { action: 'repondre-souvenir', resultat: etat.souvenir.init, methode: 'initialize' } : { action: 'allumer-puis-transmettre' };
  }
  if (decouverteServable(x)) {
    const r = etat.souvenir?.listes?.[/** @type {string} */ (x.method)];
    if (r) return { action: 'repondre-souvenir', resultat: r, methode: /** @type {string} */ (x.method) };
  }
  return { action: 'allumer-puis-transmettre' };
}

/**
 * Le resultat d'`initialize` tel qu'il part au client depuis le souvenir : on garantit
 * `listChanged` sur chaque liste annoncee, pour que la confrontation au vivant puisse corriger un
 * souvenir perime (sans ce drapeau, le client ignorerait la notification).
 * @param {object} init
 */
export function initPourClient(init) {
  const r = /** @type {{capabilities?:Record<string, unknown>}} */ (structuredClone(init));
  const caps = r.capabilities && typeof r.capabilities === 'object' ? r.capabilities : {};
  for (const cle of ['tools', 'prompts', 'resources']) {
    const c = caps[cle];
    if (c && typeof c === 'object') caps[cle] = { ...c, listChanged: true };
  }
  r.capabilities = caps;
  return r;
}
