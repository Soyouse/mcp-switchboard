// session.js — UNE fenetre (session MCP) et SON serveur, allume a la demande. Execute session-pure.js.
//
// 🛑 INVARIANTS (chacun porte par un test) :
//  ① jamais deux sessions sur le meme serveur (un enfant PAR session, cree ici, tue ici) ;
//  ② a froid, aucune requete du client ne part dans le vide : soit le souvenir repond, soit le
//     serveur s'allume et la requete attend son tour (file d'attente), dans l'ordre d'arrivee ;
//  ③ a l'allumage, le handshake ORIGINAL du client est rejoue au serveur (memes params, meme
//     clientInfo) : le serveur voit exactement ce qu'il aurait vu en stdio ;
//  ④ apres une reponse servie de memoire, la liste VIVANTE est confrontee ; differente =>
//     souvenir reecrit + notification `list_changed` au client (il re-tire la liste) ;
//  ⑤ le serveur meurt tout seul => la prochaine requete le relance (rejoue le handshake) ;
//     les requetes en vol recoivent une ERREUR, jamais un silence.
import { decider, initPourClient, NOTIF_CHANGEMENT, nature } from './session-pure.js';
import { identiques } from './souvenir-pure.js';
import { lancerEnfant } from './enfant.js';

const PREFIXE = '__sb_'; // ids des requetes INTERNES (rejeu du handshake, confrontation) : jamais vus du client

export class Session {
  /**
   * @param {string} nom
   * @param {{command:string, args:string[], env:Record<string,string>, cwd:string|null}} def
   * @param {{envoyer:(m:object, o?:{relatedRequestId?:string|number})=>void}} versClient
   * @param {ReturnType<import('./souvenir.js').ouvrirSouvenir>} souvenir
   * @param {(l:string)=>void} log
   */
  constructor(nom, def, versClient, souvenir, log) {
    this.nom = nom;
    this.def = def;
    this.versClient = versClient;
    this.souvenir = souvenir;
    this.log = log;
    this.paramsInit = null; // params de l'initialize du client (rejoues a l'allumage)
    this.enfant = null;
    this.pret = false; // handshake rejoue et accepte par le serveur
    this.file = []; // messages du client en attente du serveur
    this.enVol = new Map(); // id client -> {methode, progressToken}
    this.internes = new Map(); // id interne -> (reponse) => void
    this.servis = new Map(); // methode servie de memoire -> resultat (a confronter)
    this.seq = 0;
    this.close = false;
  }

  cle() {
    return this.souvenir.cle(this.nom, this.def, this.paramsInit?.protocolVersion);
  }

  /** @param {object} m message JSON-RPC du client */
  depuisClient(m) {
    if (this.close) return;
    const x = /** @type {any} */ (m);
    if (x.method === 'initialize' && x.params) this.paramsInit = x.params;
    const memo = this.paramsInit ? this.souvenir.lire(this.cle()) : null;
    const d = decider(m, { vivant: this.enfant !== null, souvenir: memo });
    switch (d.action) {
      case 'repondre-ping':
        return this.versClient.envoyer({ jsonrpc: '2.0', id: x.id, result: {} }, { relatedRequestId: x.id });
      case 'repondre-souvenir': {
        const resultat = d.methode === 'initialize' ? initPourClient(d.resultat) : d.resultat;
        if (d.methode !== 'initialize') this.servis.set(d.methode, d.resultat);
        return this.versClient.envoyer({ jsonrpc: '2.0', id: x.id, result: resultat }, { relatedRequestId: x.id });
      }
      case 'ignorer':
        return;
      case 'allumer-puis-transmettre':
        if (!this.enfant) this.motifAllumage = x.method || '?';
        if (!this.allumer()) {
          // Jamais un silence : la requete recoit l'erreur de lancement, nommee.
          if (nature(m) === 'requete') this.versClient.envoyer({ jsonrpc: '2.0', id: x.id, error: { code: -32603, message: `impossible d'allumer le serveur "${this.nom}" : ${this.derniereErreur}` } }, { relatedRequestId: x.id });
          return;
        }
        return this.transmettre(m);
      case 'transmettre':
        return this.transmettre(m);
    }
  }

  /** @param {object} m */
  transmettre(m) {
    const x = /** @type {any} */ (m);
    if (nature(m) === 'requete') this.enVol.set(x.id, { methode: x.method, progressToken: x.params?._meta?.progressToken });
    // L'initialize du client EST le handshake : s'il arrive alors que le serveur s'allume pour lui,
    // il part tel quel (pas de rejeu, pas de doublon).
    if (x.method === 'initialize') { this.initDuClient = true; return this.enfant?.envoyer(m); }
    if (!this.pret) return void this.file.push(m);
    this.enfant?.envoyer(m);
  }

  /** @returns {boolean} vrai si un serveur tourne (deja ou maintenant) */
  allumer() {
    if (this.enfant) return true;
    this.pret = false;
    this.initDuClient = false;
    try {
      this.enfant = lancerEnfant(this.def, {
        nom: this.nom,
        log: this.log,
        surMessage: (m) => this.depuisServeur(m),
        surFin: (code, signal, voulu, raison) => this.finEnfant(code, signal, voulu, raison),
      });
    } catch (e) {
      this.derniereErreur = e?.message || String(e);
      this.log(`[${this.nom}] impossible d'allumer : ${this.derniereErreur}`);
      this.enfant = null;
      return false;
    }
    // Le MOTIF (la requete qui exige un serveur vivant) est journalise : c'est lui qui dit pourquoi une
    // fenetre qui « n'utilise rien » a quand meme allume un outil.
    this.log(`[${this.nom}] allume (pid ${this.enfant.pid}) pour ${this.motifAllumage || '?'}`);
    // ③ Rejeu du handshake, SAUF si l'initialize du client est lui-meme ce qui allume (il partira).
    queueMicrotask(() => {
      if (this.initDuClient || !this.enfant) return;
      const params = this.paramsInit || { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-switchboard', version: '1' } };
      this.requeteInterne('initialize', params, (r) => {
        if (r.error) {
          // Handshake refuse : les requetes en file recoivent l'erreur, le serveur est arrete.
          this.log(`[${this.nom}] handshake refuse : ${JSON.stringify(r.error).slice(0, 300)}`);
          for (const q of this.file) if (nature(q) === 'requete') this.versClient.envoyer({ jsonrpc: '2.0', id: /** @type {any} */ (q).id, error: { code: -32603, message: `le serveur "${this.nom}" a refuse le handshake : ${r.error.message || ''}` } }, { relatedRequestId: /** @type {any} */ (q).id });
          this.file = [];
          this.enfant?.arreter();
          return;
        }
        this.souvenir.ecrire(this.cle(), { init: r.result });
        this.enfant?.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
        this.ouvrir();
        this.confronter();
      });
    });
    return true;
  }

  ouvrir() {
    this.pret = true;
    const f = this.file;
    this.file = [];
    for (const m of f) this.enfant?.envoyer(m);
  }

  /** @param {string} methode @param {object} params @param {(r:any)=>void} rappel */
  requeteInterne(methode, params, rappel) {
    const id = `${PREFIXE}${++this.seq}`;
    this.internes.set(id, rappel);
    this.enfant?.envoyer({ jsonrpc: '2.0', id, method: methode, params });
  }

  // ④ Confrontation des listes servies de memoire avec la reponse VIVANTE.
  confronter() {
    for (const [methode, servi] of this.servis) {
      this.requeteInterne(methode, {}, (r) => {
        if (!r.result) return;
        this.souvenir.ecrire(this.cle(), { liste: { methode, resultat: r.result } });
        if (!identiques(r.result, servi)) {
          this.log(`[${this.nom}] souvenir PERIME pour ${methode} => reecrit + ${NOTIF_CHANGEMENT[methode]}`);
          this.versClient.envoyer({ jsonrpc: '2.0', method: NOTIF_CHANGEMENT[methode] });
        }
      });
    }
    this.servis.clear();
  }

  /** @param {object} m message JSON-RPC du serveur */
  depuisServeur(m) {
    const x = /** @type {any} */ (m);
    const n = nature(m);
    if (n === 'reponse' && typeof x.id === 'string' && x.id.startsWith(PREFIXE)) {
      const rappel = this.internes.get(x.id);
      this.internes.delete(x.id);
      return rappel?.(x);
    }
    if (n === 'reponse') {
      const v = this.enVol.get(x.id);
      this.enVol.delete(x.id);
      if (v?.methode === 'initialize' && x.result) {
        this.souvenir.ecrire(this.cle(), { init: x.result });
        this.initDuClient = false;
        // `initialized` part AVANT la reponse au client : celui du client arrivera ensuite et sera
        // ignore (decider : « deja rejoue »), donc le serveur le recoit une seule fois.
        this.enfant?.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
        this.ouvrir();
        return this.versClient.envoyer({ ...x, result: initPourClient(x.result) }, { relatedRequestId: x.id });
      }
      if (v && x.result && ['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list'].includes(v.methode)) {
        this.souvenir.ecrire(this.cle(), { liste: { methode: v.methode, resultat: x.result } });
      }
      return this.versClient.envoyer(m, { relatedRequestId: x.id });
    }
    // Notification ou requete du serveur vers le client : rattachee a la requete qui l'a provoquee
    // quand on le sait (progression par jeton, ou une seule requete en vol), sinon flux general.
    let lie;
    const jeton = x.params?.progressToken;
    if (jeton !== undefined) for (const [id, v] of this.enVol) if (v.progressToken === jeton) lie = id;
    if (lie === undefined && this.enVol.size === 1) lie = [...this.enVol.keys()][0];
    this.versClient.envoyer(m, lie === undefined ? undefined : { relatedRequestId: lie });
  }

  /** @param {number|null} code @param {string|null} signal @param {boolean} voulu @param {string} [raison] */
  finEnfant(code, signal, voulu, raison) {
    this.enfant = null;
    this.pret = false;
    this.internes.clear();
    if (!voulu) this.log(`[${this.nom}] serveur mort tout seul (code ${code}, signal ${signal}) : la prochaine requete le relancera`);
    // ⑤ Jamais un silence : chaque requete en vol (ou en file) recoit une erreur nommee.
    const perdues = [...this.enVol.keys(), ...this.file.filter((m) => nature(m) === 'requete').map((m) => /** @type {any} */ (m).id)];
    this.enVol.clear();
    this.file = [];
    if (voulu) return;
    const message = raison ? `impossible d'allumer le serveur "${this.nom}" : ${raison}` : `le serveur "${this.nom}" s'est arrete pendant la requete (code ${code})`;
    for (const id of new Set(perdues)) this.versClient.envoyer({ jsonrpc: '2.0', id, error: { code: -32603, message } }, { relatedRequestId: id });
  }

  async terminer() {
    if (this.close) return;
    this.close = true;
    const e = this.enfant;
    if (e) await e.arreter();
  }
}
