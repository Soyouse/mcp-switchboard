import { test, expect } from 'vitest';
import fc from 'fast-check';
import { planBascule, planRetour, urlDe, VARIABLE_JETON } from '../src/bascule-pure.js';

const client = () => ({ mcpServers: { crm: { type: 'stdio', command: 'node', args: ['C:/outils/crm/proxy.js'], env: { NODE_OPTIONS: '--max-semi-space-size=2' } }, nu: { command: 'python', args: ['x.py'] }, distant: { type: 'http', url: 'https://vps/mcp' } } });
const standard = () => ({ port: 47800, serveurs: {} });

test('basculer : le standard recoit la definition EXACTE, le client une adresse + le jeton en VARIABLE', () => {
  const p = planBascule(client(), standard(), ['crm']);
  expect(p.ok).toBe(true);
  expect(p.standard.serveurs.crm).toEqual({ command: 'node', args: ['C:/outils/crm/proxy.js'], env: { NODE_OPTIONS: '--max-semi-space-size=2' }, origine: client().mcpServers.crm });
  expect(p.client.mcpServers.crm).toEqual({ type: 'http', url: 'http://127.0.0.1:47800/mcp/crm', headers: { Authorization: `Bearer \${${VARIABLE_JETON}}` } });
  expect(JSON.stringify(p.client), 'jamais un jeton en clair').not.toMatch(/Bearer [0-9a-f]{16}/);
  expect(p.client.mcpServers.distant, 'les autres entrees intactes').toEqual(client().mcpServers.distant);
});

test('basculer : entree sans args ni env => listes vides cote standard ; cwd garde', () => {
  const c = { mcpServers: { a: { command: 'x', cwd: 'C:/w' } } };
  expect(planBascule(c, standard(), ['a']).standard.serveurs.a).toEqual({ command: 'x', args: [], env: {}, cwd: 'C:/w', origine: { command: 'x', cwd: 'C:/w' } });
});

test('basculer : refus NOMMES (inconnue, deja une adresse, sans commande, deja dans le standard)', () => {
  expect(planBascule(client(), standard(), ['absente'])).toEqual({ ok: false, raison: 'entree inconnue dans la config du client : "absente"' });
  expect(planBascule(client(), standard(), ['distant'])).toEqual({ ok: false, raison: `"distant" n'est pas un serveur stdio (deja une adresse)` });
  expect(planBascule({ mcpServers: { t: { type: 'sse' } } }, standard(), ['t'])).toEqual({ ok: false, raison: `"t" n'est pas un serveur stdio (deja une adresse)` });
  expect(planBascule({ mcpServers: { s: { type: 'stdio' } } }, standard(), ['s'])).toEqual({ ok: false, raison: `"s" n'a pas de commande` });
  expect(planBascule(client(), { port: 1, serveurs: { crm: {} } }, ['crm'])).toEqual({ ok: false, raison: '"crm" existe deja dans le standard' });
});

test('basculer ne modifie JAMAIS ses entrees (copies)', () => {
  const c = client();
  const s = standard();
  planBascule(c, s, ['crm']);
  expect(c).toEqual(client());
  expect(s).toEqual(standard());
});

test('revenir : remet l entree MOT POUR MOT et la retire du standard', () => {
  const b = planBascule(client(), standard(), ['crm', 'nu']);
  const r = planRetour(b.client, b.standard, ['crm', 'nu']);
  expect(r.ok).toBe(true);
  expect(r.client).toEqual(client());
  expect(r.standard).toEqual(standard());
});

test('revenir sans origine (config ecrite a la main) : reconstruit une entree stdio', () => {
  const s = { port: 47800, serveurs: { a: { command: 'x', args: ['1'], env: { K: 'v' }, cwd: 'C:/w' } } };
  const c = { mcpServers: { a: { type: 'http', url: urlDe(47800, 'a') } } };
  expect(planRetour(c, s, ['a']).client.mcpServers.a).toEqual({ type: 'stdio', command: 'x', args: ['1'], env: { K: 'v' }, cwd: 'C:/w' });
  const s2 = { port: 47800, serveurs: { a: { command: 'x', args: [], env: {} } } };
  expect(planRetour(c, s2, ['a']).client.mcpServers.a).toEqual({ type: 'stdio', command: 'x', args: [], env: {} });
});

test('revenir : refus NOMMES (absent du standard, client qui ne pointe pas vers le standard)', () => {
  expect(planRetour(client(), standard(), ['crm'])).toEqual({ ok: false, raison: `"crm" n'est pas dans le standard` });
  const s = { port: 47800, serveurs: { crm: { command: 'node' } } };
  expect(planRetour(client(), s, ['crm'])).toEqual({ ok: false, raison: `"crm" ne pointe pas vers le standard dans la config du client` });
  expect(planRetour({ mcpServers: {} }, s, ['crm'])).toEqual({ ok: false, raison: `"crm" ne pointe pas vers le standard dans la config du client` });
});

test('PROPERTY : basculer puis revenir = configuration de depart, a l identique', () => {
  const entree = fc.record({ type: fc.constantFrom(undefined, 'stdio'), command: fc.string({ minLength: 1 }), args: fc.option(fc.array(fc.string()), { nil: undefined }), env: fc.option(fc.dictionary(fc.string({ minLength: 1 }), fc.string()), { nil: undefined }) }, { requiredKeys: ['command'] });
  fc.assert(fc.property(fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), entree, { minKeys: 1 }), fc.integer({ min: 1, max: 65535 }), (serveurs, port) => {
    const c = { mcpServers: serveurs };
    const s = { port, serveurs: {} };
    const noms = Object.keys(serveurs);
    const b = planBascule(c, s, noms);
    expect(b.ok).toBe(true);
    const r = planRetour(b.client, b.standard, noms);
    expect(r.ok).toBe(true);
    expect(r.client).toEqual(c);
    expect(r.standard).toEqual(s);
  }));
});

test('configs incompletes : refus nommes, jamais une exception', () => {
  expect(planBascule({}, standard(), ['crm'])).toEqual({ ok: false, raison: 'entree inconnue dans la config du client : "crm"' });
  expect(planRetour(client(), { port: 1 }, ['crm'])).toEqual({ ok: false, raison: `"crm" n'est pas dans le standard` });
  expect(planRetour({}, { port: 1, serveurs: { crm: { command: 'n' } } }, ['crm'])).toEqual({ ok: false, raison: `"crm" ne pointe pas vers le standard dans la config du client` });
});

test('le jeton passe par la variable MCP_SWITCHBOARD_TOKEN (nom fige : les harnais la lisent)', () => {
  expect(VARIABLE_JETON).toBe('MCP_SWITCHBOARD_TOKEN');
  expect(planBascule(client(), standard(), ['crm']).client.mcpServers.crm.headers.Authorization).toBe('Bearer ${MCP_SWITCHBOARD_TOKEN}');
});

test('urlDe : adresse du standard (boucle locale par defaut, carte dediee si declaree)', () => {
  expect(urlDe(47800, 'crm')).toBe('http://127.0.0.1:47800/mcp/crm');
  expect(urlDe(47800, 'crm', '10.20.30.1')).toBe('http://10.20.30.1:47800/mcp/crm');
});

test('bascule et retour suivent l adresse DECLAREE du standard', () => {
  const s = { port: 47800, hote: '10.20.30.1', serveurs: {} };
  const b = planBascule(client(), s, ['crm']);
  expect(b.client.mcpServers.crm.url).toBe('http://10.20.30.1:47800/mcp/crm');
  expect(planRetour(b.client, b.standard, ['crm']).client).toEqual(client());
  expect(planRetour(b.client, { ...b.standard, hote: '127.0.0.1' }, ['crm']).ok, 'adresse changee depuis : refus nomme').toBe(false);
});
