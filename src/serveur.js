// serveur.js — le STANDARD : une adresse HTTP locale, une session par fenetre, un serveur par session.
//
// Route : POST|GET|DELETE  http://127.0.0.1:<port>/mcp/<nom>   (transport Streamable HTTP du SDK officiel)
//         GET              http://127.0.0.1:<port>/sante       (etat, pour la mesure)
//
// 🛑 SECURITE (spec MCP 2025-06-18, « Security Warning ») : ecoute 127.0.0.1 SEULEMENT · Host et Origin
// valides par le SDK (anti DNS-rebinding) · jeton porteur exige sur CHAQUE requete (comparaison a temps
// constant). Un site web ouvert dans un navigateur ne peut donc rien appeler.
//
// 🛑 FIN D'UNE FENETRE — MESURE le 17/10/2026, ne pas re-deviner :
//   Codex 0.146 envoie DELETE en partant ⇒ fin immediate (onsessionclosed du SDK).
//   Claude Code 2.1.302 et Gemini CLI 0.15.3 partent SANS rien dire, et leur flux GET restait
//   ESTABLISHED cote serveur sans un octet. Avec `setKeepAlive` sur la socket du flux GET, le NOYAU
//   detecte le depart a l'instant (mesure : fermeture vue a 29,62 s, sortie du client a 29,6 s).
//   ⇒ plus AUCUNE activite (ni flux GET, ni requete en cours) ⇒ DELAI DE GRACE ⇒ fin de session (cf `suivre`).
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Session } from './session.js';

export const KEEPALIVE_MS = 3000; // delai du NOYAU avant sa premiere sonde TCP (pas une minuterie a nous)
// ⏱ DELAI DECLARE — motif INDECIDABLE : un flux GET qui tombe peut etre une fenetre fermee OU un
// client qui va le rouvrir ; personne ne le sait. Passe ce delai sans nouveau flux ni requete : fin.
export const GRACE_MS = 30000;
const MAX_CORPS = 4 * 1024 * 1024;

/**
 * @param {{port:number, serveurs:Record<string, any>}} config
 * @param {{jeton:string, souvenir:any, log:(l:string)=>void, graceMs?:number, surArret?:()=>void, surRelire?:()=>void}} o
 */
export function creerStandard(config, o) {
  const graceMs = o.graceMs ?? GRACE_MS; // injectable pour les tests ; la prod garde GRACE_MS
  /** @type {Map<string, {transport:StreamableHTTPServerTransport, session:Session, grace:NodeJS.Timeout|null, actifs:number}>} */
  const sessions = new Map();
  const attendu = Buffer.from(`Bearer ${o.jeton}`);
  const ip = config.hote || '127.0.0.1';
  const hotes = [...new Set([`${ip}:${config.port}`, `127.0.0.1:${config.port}`, `localhost:${config.port}`])];
  const origines = hotes.map((h) => `http://${h}`);

  async function finir(id, motif) {
    const e = sessions.get(id);
    if (!e) return;
    sessions.delete(id);
    if (e.grace) clearTimeout(e.grace);
    o.log(`[${e.session.nom}] fin de session ${id.slice(0, 8)} (${motif})`);
    await e.session.terminer();
    try { await e.transport.close(); } catch { /* SILENCE: transport deja ferme */ }
  }

  // 🛑 UNE SESSION VIT TANT QU'ELLE A DE L'ACTIVITE : un flux GET ouvert OU une requete en cours.
  // Activite tombee a zero => delai de grace ; toute nouvelle requete l'annule. MESURE le 17/10/2026 :
  // une fenetre fermee AVANT d'ouvrir son flux GET laissait sinon sa session (et son serveur) vivre a
  // jamais — la regle « flux GET ferme » seule ne voyait pas ce cas.
  function suivre(id, e, res) {
    e.actifs++;
    if (e.grace) { clearTimeout(e.grace); e.grace = null; }
    res.on('close', () => {
      e.actifs--;
      if (e.actifs === 0 && sessions.get(id) === e) e.grace = setTimeout(() => finir(id, 'aucune activite'), graceMs);
    });
  }

  const repondre = (res, code, corps) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(corps)); };

  const srv = http.createServer(async (req, res) => {
    try {
      const auth = Buffer.from(String(req.headers.authorization || ''));
      if (auth.length !== attendu.length || !timingSafeEqual(auth, attendu)) return repondre(res, 401, { error: 'jeton absent ou faux' });
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname === '/sante') {
        const parServeur = {};
        for (const { session } of sessions.values()) {
          const s = (parServeur[session.nom] ??= { sessions: 0, allumes: 0 });
          s.sessions++;
          if (session.enfant) s.allumes++;
        }
        return repondre(res, 200, { sessions: sessions.size, parServeur });
      }
      // ARRET PROPRE demande par l'installeur (jeton exige, comme partout) : c'est le standard lui-meme
      // qui arrete ses serveurs puis sort. ⚠️ JAMAIS « tuer le process du port » : sous Windows, arreter
      // la tache planifiee tue le lanceur et laisse node ORPHELIN (mesure 17/10/2026).
      // RELECTURE DEMANDEE (basculer/revenir) : la reponse rend la liste APRES relecture — l'appelant n'a
      // aucun delai a deviner avant de verifier (la surveillance de fichier, elle, arrive quand elle arrive).
      if (url.pathname === '/relire' && req.method === 'POST') {
        o.surRelire?.();
        return repondre(res, 200, { serveurs: Object.keys(config.serveurs) });
      }
      if (url.pathname === '/arreter' && req.method === 'POST') {
        // L'arret part APRES l'envoi complet de la reponse ('finish') : arreter avant coupait la
        // connexion et l'installeur recevait « fetch failed » (mesure 17/10/2026).
        res.on('finish', () => o.surArret?.());
        // `ppid` = le lanceur (wscript sous Windows) : c'est SA fin qui clot l'execution de la tache.
        return repondre(res, 202, { arret: true, pid: process.pid, ppid: process.ppid });
      }
      const m = url.pathname.match(/^\/mcp\/([A-Za-z0-9._-]+)$/);
      if (!m || !config.serveurs[m[1]]) return repondre(res, 404, { error: 'serveur inconnu' });
      const nom = m[1];

      let corps;
      if (req.method === 'POST') {
        let texte = '';
        for await (const morceau of req) {
          texte += morceau;
          if (texte.length > MAX_CORPS) return repondre(res, 413, { error: 'corps trop gros' });
        }
        try { corps = JSON.parse(texte); } catch { return repondre(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON invalide' } }); }
      }

      // Le NOYAU sonde chaque socket : un client parti sans rien dire est vu des la sonde suivante.
      req.socket.setKeepAlive(true, KEEPALIVE_MS);
      const sid = req.headers['mcp-session-id'];
      if (typeof sid === 'string') {
        const e = sessions.get(sid);
        // Spec : session inconnue => 404, le client DOIT recommencer par un initialize (ex. apres un redemarrage du standard).
        if (!e || e.session.nom !== nom) return repondre(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Session not found' } });
        suivre(sid, e, res);
        return await e.transport.handleRequest(req, res, corps);
      }

      // Pas de session : seul un initialize en ouvre une. Le SDK refuse le reste (400 « Server not initialized »).
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts: hotes,
        allowedOrigins: origines,
        onsessioninitialized: (id) => {
          const e = { transport, session, grace: null, actifs: 0 };
          sessions.set(id, e);
          suivre(id, e, res); // la requete initialize elle-meme compte comme activite
          o.log(`[${nom}] nouvelle session ${id.slice(0, 8)} (${corps?.params?.clientInfo?.name || '?'})`);
        },
        onsessionclosed: (id) => finir(id, 'DELETE du client'),
      });
      const session = new Session(nom, config.serveurs[nom], {
        envoyer: (msg, opts) => { transport.send(/** @type {any} */ (msg), opts).catch((err) => o.log(`[${nom}] envoi au client : ${err?.message || err}`)); },
      }, o.souvenir, o.log);
      transport.onmessage = (msg) => session.depuisClient(/** @type {object} */ (msg));
      // `server/discover` (revision 2026-07-28) arrive AVANT initialize chez Claude Code 2.1.302 : le SDK
      // repond 400 « Server not initialized » et le client poursuit par initialize (mesure 17/10/2026).
      // Ce refus est le comportement NORMAL d'un serveur SDK 1.x : pas une panne, donc pas journalise.
      transport.onerror = (err) => { if (!/Server not initialized/.test(String(err?.message))) o.log(`[${nom}] transport : ${err?.message || err}`); };
      await transport.start();
      await transport.handleRequest(req, res, corps);
    } catch (err) {
      o.log(`requete : ${err?.stack || err}`);
      if (!res.headersSent) repondre(res, 500, { error: 'erreur interne' });
    }
  });
  srv.on('clientError', (_e, s) => s.destroy());

  return {
    srv,
    sessions,
    ecouter: () => new Promise((ok, ko) => { srv.once('error', ko); srv.listen(config.port, ip, () => ok(undefined)); }),
    async arreter() {
      await Promise.all([...sessions.keys()].map((id) => finir(id, 'arret du standard')));
      // `close` attend la fin de CHAQUE connexion : un flux GET ou un keep-alive le bloquerait a jamais.
      await new Promise((ok) => { srv.close(() => ok(undefined)); srv.closeAllConnections(); });
    },
  };
}
