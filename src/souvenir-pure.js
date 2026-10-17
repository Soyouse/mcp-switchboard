// souvenir-pure.js — LA DECISION du souvenir de handshake. PUR.
//
// Le souvenir = ce qu'un serveur a DEJA repondu a `initialize` et aux listes de decouverte, pour
// une commande donnee. Le standard le rejoue a une fenetre qui s'ouvre, sans allumer le serveur.
// ⚠️ CLE = tout ce qui peut changer la reponse : nom du serveur, commande, args, env, cwd, version
// de protocole demandee. L'env porte des secrets : la cle n'en garde qu'une EMPREINTE (sha256 fourni
// par l'appelant — ce module ne fait pas d'I/O ni de crypto).
// ⚠️ L'ESPACE SE DECLARE : au plus `max` entrees, eviction de la plus anciennement ecrite.

export const MAX_ENTREES_DEFAUT = 64;
export const VERSION_FORMAT = 1;

/**
 * Matiere de la cle (a hacher par l'appelant). Fonction TOTALE, ordre des cles d'env normalise.
 * @param {string} nom
 * @param {{command?:unknown, args?:unknown, env?:Record<string,unknown>, cwd?:unknown}} def
 * @param {unknown} protocolVersion
 */
export function matiereCle(nom, def, protocolVersion) {
  const d = def || {};
  const env = d.env && typeof d.env === 'object' ? Object.keys(d.env).sort().map((k) => [k, /** @type {any} */ (d.env)[k]]) : [];
  return JSON.stringify([nom, d.command ?? null, d.args ?? null, env, d.cwd ?? null, protocolVersion ?? null]);
}

/**
 * Entrees valides d'un document lu sur disque. Document douteux = aucun souvenir.
 * @param {unknown} doc
 * @returns {Array<{cle:string, init?:object, listes?:Record<string,object>}>}
 */
export function entreesValides(doc) {
  const d = /** @type {{version?:unknown, entrees?:unknown}} */ (doc);
  if (!d || d.version !== VERSION_FORMAT || !Array.isArray(d.entrees)) return [];
  return d.entrees.filter(
    (e) =>
      !!e &&
      typeof e.cle === 'string' &&
      (e.init === undefined || (!!e.init && typeof e.init === 'object' && !Array.isArray(e.init))) &&
      (e.listes === undefined || (!!e.listes && typeof e.listes === 'object' && !Array.isArray(e.listes)))
  );
}

/** @param {unknown} doc @param {string} cle */
export function lire(doc, cle) {
  return entreesValides(doc).find((e) => e.cle === cle) || null;
}

/**
 * Ecrit `init` et/ou une liste sous `cle` (fusion), l'entree passe en DERNIERE ; plafond `max`.
 * @param {unknown} doc
 * @param {string} cle
 * @param {{init?:object, liste?:{methode:string, resultat:object}}} patch
 * @param {number} [max]
 */
export function ecrire(doc, cle, patch, max = MAX_ENTREES_DEFAUT) {
  const borne = Number.isInteger(max) && max > 0 ? max : MAX_ENTREES_DEFAUT;
  const entrees = entreesValides(doc);
  const ancienne = entrees.find((e) => e.cle === cle) || {};
  const nouvelle = { ...ancienne, cle };
  if (patch.init) nouvelle.init = patch.init;
  if (patch.liste) nouvelle.listes = { ...(ancienne.listes || {}), [patch.liste.methode]: patch.liste.resultat };
  return { version: VERSION_FORMAT, entrees: [...entrees.filter((e) => e.cle !== cle), nouvelle].slice(-borne) };
}

/** Deux reponses identiques, telles que servies (ordre compris). @param {unknown} a @param {unknown} b */
export function identiques(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
