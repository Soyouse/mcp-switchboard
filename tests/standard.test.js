// Le STANDARD de bout en bout : vrai serveur HTTP, vrai client du SDK officiel (meme transport que
// Claude Code / Codex / Gemini), vrai process stdio (faux-serveur.js). Aucun double en memoire.
// Ce qui est prouve ici est ce que l'operateur a demande : « ca marche comme aujourd'hui », en moins lourd.
import { test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { creerStandard } from '../src/serveur.js';
import { ouvrirSouvenir } from '../src/souvenir.js';

const FAUX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'faux-serveur.js');
const JETON = 'jeton-de-test';
let dir, port, standard, journal, clients;

const portLibre = () => new Promise((ok) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const demarres = () => (fs.existsSync(path.join(dir, 'compteur')) ? fs.readFileSync(path.join(dir, 'compteur'), 'utf8').trim().split('\n').filter(Boolean) : []);
const vivant = (pid) => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
const attendre = async (cond, ms = 10000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('condition jamais vraie'); await new Promise((r) => setTimeout(r, 50)); } };

async function monter({ graceMs = 60000, serveurs } = {}) {
  port = await portLibre();
  const config = {
    port,
    serveurs: serveurs || { faux: { command: process.execPath, args: [FAUX], env: { FAUX_COMPTEUR: path.join(dir, 'compteur'), FAUX_OUTILS_FICHIER: path.join(dir, 'outils.json') }, cwd: null } },
  };
  journal = [];
  const log = (l) => journal.push(l);
  standard = creerStandard(config, { jeton: JETON, souvenir: ouvrirSouvenir(dir, log), log, graceMs });
  await standard.ecouter();
}

async function connecter(nom = 'faux', jeton = JETON) {
  const c = new Client({ name: 'test-client', version: '1' });
  const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${nom}`), { requestInit: { headers: { Authorization: `Bearer ${jeton}` } } });
  await c.connect(t);
  clients.push(c);
  return { c, t };
}
const appel = async (c, name = 'compteur', args = {}) => JSON.parse((await c.callTool({ name, arguments: args })).content[0].text);

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-')); clients = []; });
afterEach(async () => {
  for (const c of clients) await c.close().catch(() => {});
  await standard?.arreter();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('premiere fenetre (aucun souvenir) : le serveur s allume, outils et appel identiques au stdio', async () => {
  await monter();
  const { c } = await connecter();
  expect(demarres().length, 'sans souvenir, le handshake allume le serveur (comme avant)').toBe(1);
  expect((await c.listTools()).tools.map((t) => t.name)).toEqual(['compteur']);
  expect(c.getInstructions(), 'le serveur a vu le VRAI client').toBe('client=test-client');
  expect((await appel(c)).etat).toBe(1);
});

test('fenetre suivante (souvenir present) : AUCUN serveur allume tant qu aucun outil n est appele', async () => {
  await monter();
  await (await connecter()).c.listTools();
  const avant = demarres().length;
  const { c } = await connecter();
  expect((await c.listTools()).tools.map((t) => t.name), 'la liste vient du souvenir, mot pour mot').toEqual(['compteur']);
  expect(c.getInstructions(), 'les instructions aussi').toBe('client=test-client');
  expect(demarres().length, 'rien de neuf allume').toBe(avant);
  expect((await appel(c)).etat, 'le premier appel allume SON serveur et repond').toBe(1);
  expect(demarres().length).toBe(avant + 1);
});

test('ISOLATION : deux fenetres = deux serveurs, chacune son propre etat (jamais partage)', async () => {
  await monter();
  const a = (await connecter()).c;
  const b = (await connecter()).c;
  const ra = await appel(a);
  const rb = await appel(b);
  expect(ra.pid).not.toBe(rb.pid);
  expect([ra.etat, rb.etat], 'chaque fenetre voit SON compteur').toEqual([1, 1]);
  expect((await appel(a)).etat).toBe(2);
});

test('4 fenetres en parallele, chacune un appel lent : aucune n attend les autres', async () => {
  await monter();
  const cs = [];
  for (let i = 0; i < 4; i++) cs.push((await connecter()).c);
  const t0 = Date.now();
  const r = await Promise.all(cs.map((c) => appel(c, 'lent', { ms: 800 })));
  expect(new Set(r.map((x) => x.pid)).size).toBe(4);
  expect(Date.now() - t0, 'en parallele (4 x 800 ms en serie depasserait 3 s)').toBeLessThan(3000);
});

test('souvenir PERIME : la liste vivante differente est corrigee et le client prevenu (list_changed)', async () => {
  fs.writeFileSync(path.join(dir, 'outils.json'), JSON.stringify([{ name: 'compteur', inputSchema: { type: 'object' } }]));
  await monter();
  await (await connecter()).c.listTools();
  fs.writeFileSync(path.join(dir, 'outils.json'), JSON.stringify([{ name: 'compteur', inputSchema: { type: 'object' } }, { name: 'nouveau', inputSchema: { type: 'object' } }]));
  const { c } = await connecter();
  let prevenu = false;
  c.setNotificationHandler(ToolListChangedNotificationSchema, () => { prevenu = true; });
  expect((await c.listTools()).tools.map((t) => t.name), 'avant usage : le souvenir').toEqual(['compteur']);
  await appel(c);
  await attendre(() => prevenu);
  expect((await c.listTools()).tools.map((t) => t.name), 'apres : la liste VIVANTE').toEqual(['compteur', 'nouveau']);
});

test('fenetre fermee proprement (DELETE) : son serveur est arrete', async () => {
  await monter();
  const { c, t } = await connecter();
  const { pid } = await appel(c);
  await t.terminateSession();
  await attendre(() => !vivant(pid));
  expect(standard.sessions.size).toBe(0);
});

test('fenetre partie SANS rien dire : apres le delai de grace, session et serveur termines', async () => {
  await monter({ graceMs: 300 });
  const { c, t } = await connecter();
  const { pid } = await appel(c);
  await t.close(); // ferme les flux sans DELETE (= Claude Code / Gemini, mesure 17/10/2026)
  await attendre(() => !vivant(pid));
  expect(standard.sessions.size).toBe(0);
});

test('serveur qui plante : la requete recoit une ERREUR, la suivante le relance et marche', async () => {
  await monter();
  const { c } = await connecter();
  const avant = (await appel(c)).pid;
  await expect(c.callTool({ name: 'mourir', arguments: {} })).rejects.toThrow(/arrete/);
  await attendre(() => !vivant(avant));
  const apres = await appel(c);
  expect(apres.pid).not.toBe(avant);
  expect(apres.etat, 'etat neuf, comme un serveur relance').toBe(1);
});

test('commande introuvable : l appel recoit l erreur NOMMEE, jamais un silence', async () => {
  fs.writeFileSync(path.join(dir, 'outils.json'), '[]');
  await monter({ serveurs: { casse: { command: 'commande-qui-n-existe-pas-xyz', args: [], env: {}, cwd: null } } });
  const c = new Client({ name: 'test-client', version: '1' });
  const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/casse`), { requestInit: { headers: { Authorization: `Bearer ${JETON}` } } });
  clients.push(c);
  await expect(c.connect(t)).rejects.toThrow(/introuvable|ENOENT|allumer/);
});

test('lancement qui ECHOUE apres coup (chemin absolu inexistant) : erreur nommee immediate, jamais une attente', async () => {
  // Voie du noyau, identique sur les 3 OS : spawn accepte, puis 'error' ENOENT sans 'exit' (doc Node).
  // MESURE 17/10/2026 sous Linux : sans traitement de 'error', la fenetre attendait 60 s une reponse fantome.
  await monter({ serveurs: { mort: { command: path.join(dir, 'inexistant', 'serveur.exe'), args: [], env: {}, cwd: null } } });
  const c = new Client({ name: 'test-client', version: '1' });
  const t = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/mort`), { requestInit: { headers: { Authorization: `Bearer ${JETON}` } } });
  clients.push(c);
  const t0 = Date.now();
  await expect(c.connect(t)).rejects.toThrow(/lancement impossible|ENOENT/);
  expect(Date.now() - t0, 'refus immediat').toBeLessThan(5000);
});

test('SECURITE : sans jeton, faux jeton ou origine etrangere => refuse', async () => {
  await monter();
  const url = `http://127.0.0.1:${port}/mcp/faux`;
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  expect((await fetch(url, { method: 'POST', headers: h, body: init })).status).toBe(401);
  expect((await fetch(url, { method: 'POST', headers: { ...h, authorization: 'Bearer faux' }, body: init })).status).toBe(401);
  expect((await fetch(url, { method: 'POST', headers: { ...h, authorization: `Bearer ${JETON}`, origin: 'https://site-malveillant.example' }, body: init })).status).toBe(403);
  expect(demarres().length, 'aucune requete refusee n a allume quoi que ce soit').toBe(0);
});

test('${VAR} de la definition developpes comme Claude Code avant le lancement', async () => {
  process.env.SB_TEST_DIR = dir;
  try {
    await monter({ serveurs: { faux: { command: process.execPath, args: [FAUX], env: { FAUX_COMPTEUR: '${SB_TEST_DIR}/compteur', FAUX_OUTILS_FICHIER: '${SB_ABSENTE:-' + path.join(dir, 'outils.json') + '}' }, cwd: null } } });
    const { c } = await connecter();
    await appel(c);
    expect(demarres().length, 'le compteur a ete ecrit au chemin DEVELOPPE').toBeGreaterThan(0);
  } finally { delete process.env.SB_TEST_DIR; }
});

test('/relire rend la liste APRES relecture, /arreter repond PUIS appelle l arret', async () => {
  let relu = 0, arrete = 0;
  port = await portLibre();
  const config = { port, serveurs: { faux: { command: process.execPath, args: [FAUX], env: {}, cwd: null } } };
  standard = creerStandard(config, { jeton: JETON, souvenir: ouvrirSouvenir(dir, () => {}), log: () => {}, surRelire: () => { relu++; config.serveurs.ajoute = config.serveurs.faux; }, surArret: () => { arrete++; } });
  await standard.ecouter();
  const h = { authorization: `Bearer ${JETON}` };
  const r = await fetch(`http://127.0.0.1:${port}/relire`, { method: 'POST', headers: h });
  expect(await r.json()).toEqual({ serveurs: ['faux', 'ajoute'] });
  expect(relu).toBe(1);
  const a = await fetch(`http://127.0.0.1:${port}/arreter`, { method: 'POST', headers: h });
  expect(a.status).toBe(202);
  expect((await a.json()).pid).toBe(process.pid);
  await attendre(() => arrete === 1);
  expect((await fetch(`http://127.0.0.1:${port}/relire`, { method: 'POST' })).status, 'sans jeton : refuse').toBe(401);
});

test('adresse d ecoute DECLAREE (hote) : le standard y ecoute et accepte ce Host', async () => {
  port = await portLibre();
  standard = creerStandard({ port, hote: '127.0.0.2', serveurs: {} }, { jeton: JETON, souvenir: ouvrirSouvenir(dir, () => {}), log: () => {} });
  try { await standard.ecouter(); } catch (e) { if (e?.code === 'EADDRNOTAVAIL') return; throw e; } // OS sans 127/8 complet (macOS) : rien a prouver ici
  const r = await fetch(`http://127.0.0.2:${port}/sante`, { headers: { authorization: `Bearer ${JETON}` } });
  expect(r.status).toBe(200);
});

test('session inconnue (ex. standard redemarre) => 404, le client peut recommencer', async () => {
  await monter();
  const r = await fetch(`http://127.0.0.1:${port}/mcp/faux`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${JETON}`, 'mcp-session-id': 'inconnue' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  expect(r.status).toBe(404);
});
