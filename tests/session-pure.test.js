import { test, expect } from 'vitest';
import fc from 'fast-check';
import { nature, decouverteServable, decider, initPourClient, DECOUVERTE, NOTIF_CHANGEMENT } from '../src/session-pure.js';

const froid = (souvenir = null) => ({ vivant: false, souvenir });
const chaud = () => ({ vivant: true, souvenir: null });
const memo = () => ({ init: { protocolVersion: 'v', capabilities: { tools: {} } }, listes: { 'tools/list': { tools: [{ name: 't' }] } } });

test('nature : requete, notification, reponse, invalide', () => {
  expect(nature({ id: 1, method: 'm' })).toBe('requete');
  expect(nature({ id: 0, method: 'm' })).toBe('requete');
  expect(nature({ method: 'm' })).toBe('notification');
  expect(nature({ id: null, method: 'm' })).toBe('notification');
  expect(nature({ id: 1, result: {} })).toBe('reponse');
  expect(nature({ id: 1, error: {} })).toBe('reponse');
  expect(nature({ id: 1 })).toBe('invalide');
  expect(nature({ id: null, result: {} })).toBe('invalide');
  expect(nature({ method: 3 })).toBe('invalide');
  expect(nature(null)).toBe('invalide');
  expect(nature('x')).toBe('invalide');
});

test('decouverteServable : methodes de decouverte, premiere page seulement', () => {
  for (const m of DECOUVERTE) expect(decouverteServable({ method: m })).toBe(true);
  expect(decouverteServable({ method: 'tools/list', params: {} })).toBe(true);
  expect(decouverteServable({ method: 'tools/list', params: { cursor: null } })).toBe(true);
  expect(decouverteServable({ method: 'tools/list', params: { cursor: 'p2' } })).toBe(false);
  expect(decouverteServable({ method: 'tools/call' })).toBe(false);
});

test('ping : toujours repondu par le standard, a froid comme a chaud', () => {
  expect(decider({ id: 1, method: 'ping' }, froid())).toEqual({ action: 'repondre-ping' });
  expect(decider({ id: 1, method: 'ping' }, chaud())).toEqual({ action: 'repondre-ping' });
  expect(decider({ method: 'ping' }, froid()), 'une NOTIFICATION nommee ping n appelle aucune reponse').toEqual({ action: 'ignorer', raison: 'notification a froid' });
  expect(decider({ method: 'ping' }, chaud())).toEqual({ action: 'transmettre' });
});

test('a chaud : seule la NOTIFICATION initialized est ignoree (une requete de ce nom part)', () => {
  expect(decider({ id: 7, method: 'notifications/initialized' }, chaud())).toEqual({ action: 'transmettre' });
});

test('a froid sans aucun souvenir : une liste de decouverte allume (jamais d erreur)', () => {
  expect(decider({ id: 2, method: 'tools/list' }, froid(null))).toEqual({ action: 'allumer-puis-transmettre' });
});

test('a chaud : tout est transmis, sauf un second initialized', () => {
  expect(decider({ id: 2, method: 'tools/call' }, chaud())).toEqual({ action: 'transmettre' });
  expect(decider({ id: 2, result: {} }, chaud())).toEqual({ action: 'transmettre' });
  expect(decider({ method: 'notifications/cancelled' }, chaud())).toEqual({ action: 'transmettre' });
  expect(decider({ method: 'notifications/initialized' }, chaud())).toEqual({ action: 'ignorer', raison: 'initialized deja rejoue' });
});

test('a froid : notifications et reponses ignorees (rien a prevenir, rien d allume)', () => {
  expect(decider({ method: 'notifications/initialized' }, froid())).toEqual({ action: 'ignorer', raison: 'initialized rejoue a l allumage' });
  expect(decider({ method: 'notifications/cancelled' }, froid())).toEqual({ action: 'ignorer', raison: 'notification a froid' });
  expect(decider({ id: 3, result: {} }, froid())).toEqual({ action: 'ignorer', raison: 'reponse sans requete du serveur (a froid)' });
  expect(decider({ id: 3 }, froid())).toEqual({ action: 'ignorer', raison: 'message JSON-RPC invalide' });
});

test('a froid : initialize servi de memoire si souvenir, sinon le serveur s allume', () => {
  expect(decider({ id: 1, method: 'initialize' }, froid(memo()))).toEqual({ action: 'repondre-souvenir', resultat: memo().init, methode: 'initialize' });
  expect(decider({ id: 1, method: 'initialize' }, froid())).toEqual({ action: 'allumer-puis-transmettre' });
  expect(decider({ id: 1, method: 'initialize' }, froid({ listes: {} }))).toEqual({ action: 'allumer-puis-transmettre' });
});

test('a froid : liste de decouverte servie si memorisee ET premiere page, sinon allumage', () => {
  expect(decider({ id: 2, method: 'tools/list' }, froid(memo()))).toEqual({ action: 'repondre-souvenir', resultat: memo().listes['tools/list'], methode: 'tools/list' });
  expect(decider({ id: 2, method: 'prompts/list' }, froid(memo()))).toEqual({ action: 'allumer-puis-transmettre' });
  expect(decider({ id: 2, method: 'tools/list', params: { cursor: 'p2' } }, froid(memo()))).toEqual({ action: 'allumer-puis-transmettre' });
  expect(decider({ id: 2, method: 'tools/list' }, froid({ init: {} }))).toEqual({ action: 'allumer-puis-transmettre' });
});

test('a froid : toute autre requete allume le serveur', () => {
  expect(decider({ id: 4, method: 'tools/call', params: {} }, froid(memo()))).toEqual({ action: 'allumer-puis-transmettre' });
  expect(decider({ id: 4, method: 'resources/read' }, froid(memo()))).toEqual({ action: 'allumer-puis-transmettre' });
});

test('PROPERTY : decider est TOTALE (ne leve jamais, rend toujours une action connue)', () => {
  const actions = new Set(['repondre-souvenir', 'repondre-ping', 'ignorer', 'transmettre', 'allumer-puis-transmettre']);
  fc.assert(fc.property(fc.anything(), fc.boolean(), fc.option(fc.anything(), { nil: null }), (m, vivant, souvenir) => {
    let s = souvenir && typeof souvenir === 'object' ? souvenir : null;
    expect(actions.has(decider(m, { vivant, souvenir: s }).action)).toBe(true);
  }));
});

test('initPourClient : listChanged garanti sur chaque liste annoncee, rien d autre ne change', () => {
  const init = { protocolVersion: 'v', capabilities: { tools: { a: 1 }, prompts: {}, logging: {} }, serverInfo: { name: 's' } };
  expect(initPourClient(init)).toEqual({ protocolVersion: 'v', capabilities: { tools: { a: 1, listChanged: true }, prompts: { listChanged: true }, logging: {} }, serverInfo: { name: 's' } });
  expect(init.capabilities.tools, 'l original n est pas modifie').toEqual({ a: 1 });
  expect(initPourClient({ capabilities: { resources: { subscribe: true } } }).capabilities.resources).toEqual({ subscribe: true, listChanged: true });
  expect(initPourClient({}).capabilities).toEqual({});
  expect(initPourClient({ capabilities: 'x' }).capabilities).toEqual({});
  expect(initPourClient({ capabilities: { tools: null } }).capabilities).toEqual({ tools: null });
  expect(initPourClient({ capabilities: { tools: true } }).capabilities, 'une valeur non objet est laissee telle quelle').toEqual({ tools: true });
});

test('NOTIF_CHANGEMENT : une notification par liste de decouverte', () => {
  for (const m of DECOUVERTE) expect(NOTIF_CHANGEMENT[m]).toMatch(/^notifications\/.+\/list_changed$/);
  expect(NOTIF_CHANGEMENT['resources/templates/list']).toBe('notifications/resources/list_changed');
});
