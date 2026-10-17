import { test, expect } from 'vitest';
import fc from 'fast-check';
import { matiereCle, entreesValides, lire, ecrire, identiques, MAX_ENTREES_DEFAUT, VERSION_FORMAT } from '../src/souvenir-pure.js';
import { verdictConfig, hoteAdmis, developper, definitionLancable, PORT_DEFAUT } from '../src/config-pure.js';
import { emplacements } from '../src/paths.js';
import { planService, NOM_SERVICE } from '../src/service-pure.js';

const doc = (entrees) => ({ version: VERSION_FORMAT, entrees });

// ── souvenir ──
test('matiereCle : tout ce qui change la reponse, env trie, rien d autre', () => {
  const def = () => ({ command: 'node', args: ['a'], env: { B: '2', A: '1' }, cwd: 'C:/w' });
  const k = matiereCle('crm', def(), 'v1');
  expect(k).toBe(JSON.stringify(['crm', 'node', ['a'], [['A', '1'], ['B', '2']], 'C:/w', 'v1']));
  expect(matiereCle('crm', { ...def(), env: { A: '1', B: '2' } }, 'v1'), 'ordre des cles d env sans effet').toBe(k);
  expect(matiereCle('autre', def(), 'v1')).not.toBe(k);
  expect(matiereCle('crm', { ...def(), env: { A: '1', B: '3' } }, 'v1')).not.toBe(k);
  expect(matiereCle('crm', { ...def(), cwd: null }, 'v1')).not.toBe(k);
  expect(matiereCle('crm', def(), 'v2')).not.toBe(k);
  expect(matiereCle('x', undefined, undefined)).toBe(JSON.stringify(['x', null, null, [], null, null]));
  expect(matiereCle('x', { env: 'pas un objet' }, 'v')).toBe(JSON.stringify(['x', null, null, [], null, 'v']));
});

test('entreesValides : document douteux = aucun souvenir', () => {
  for (const d of [null, 3, [], {}, { version: 2, entrees: [] }, { version: VERSION_FORMAT }]) expect(entreesValides(d)).toEqual([]);
  const ok = { cle: 'k', init: { a: 1 }, listes: { 'tools/list': {} } };
  expect(entreesValides({ version: VERSION_FORMAT + 1, entrees: [ok] }), 'format inconnu ignore').toEqual([]);
  expect(entreesValides(doc([null, { cle: 1 }, { cle: 'a', init: [] }, { cle: 'b', init: null }, { cle: 'b2', init: 'x' }, { cle: 'c', listes: [] }, { cle: 'd', listes: null }, { cle: 'e', listes: 'x' }, { cle: 'nue' }, ok]))).toEqual([{ cle: 'nue' }, ok]);
});

test('lire : par cle, sinon null', () => {
  const d = doc([{ cle: 'a', init: { x: 1 } }]);
  expect(lire(d, 'a')).toEqual({ cle: 'a', init: { x: 1 } });
  expect(lire(d, 'b')).toBeNull();
  expect(lire(null, 'a')).toBeNull();
});

test('ecrire : fusion init + listes, derniere ecrite en dernier, plafond', () => {
  let d = ecrire(null, 'a', { init: { i: 1 } });
  expect(d).toEqual({ version: VERSION_FORMAT, entrees: [{ cle: 'a', init: { i: 1 } }] });
  d = ecrire(d, 'b', { liste: { methode: 'tools/list', resultat: { tools: [] } } });
  d = ecrire(d, 'a', { liste: { methode: 'tools/list', resultat: { tools: [1] } } });
  d = ecrire(d, 'a', { liste: { methode: 'prompts/list', resultat: { prompts: [] } } });
  expect(d.entrees).toEqual([{ cle: 'b', listes: { 'tools/list': { tools: [] } } }, { cle: 'a', init: { i: 1 }, listes: { 'tools/list': { tools: [1] }, 'prompts/list': { prompts: [] } } }]);
  expect(ecrire(d, 'c', {}, 1).entrees).toEqual([{ cle: 'c' }]);
  expect(ecrire(d, 'a', { init: { i: 2 } }).entrees.at(-1).init).toEqual({ i: 2 });
});

test('ecrire : plafond invalide => defaut, jamais illimite', () => {
  let d = null;
  for (let i = 0; i < MAX_ENTREES_DEFAUT + 2; i++) d = ecrire(d, `k${i}`, {}, 0);
  expect(d.entrees.length).toBe(MAX_ENTREES_DEFAUT);
  expect(ecrire(d, 'z', {}, 2.5).entrees.length).toBe(MAX_ENTREES_DEFAUT);
  expect(ecrire(d, 'z', {}, -3).entrees.length).toBe(MAX_ENTREES_DEFAUT);
});

test('PROPERTY souvenir : borne, sans doublon, derniere ecriture lisible', () => {
  fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom('a', 'b', 'c', 'd'), fc.integer()), { minLength: 1, maxLength: 30 }), fc.integer({ min: 1, max: 3 }), (ecritures, max) => {
    let d = null;
    for (const [k, v] of ecritures) d = ecrire(d, k, { init: { v } }, max);
    const cles = d.entrees.map((e) => e.cle);
    expect(cles.length).toBeLessThanOrEqual(max);
    expect(new Set(cles).size).toBe(cles.length);
    expect(lire(d, ecritures.at(-1)[0]).init).toEqual({ v: ecritures.at(-1)[1] });
  }));
});

test('identiques : ordre compris', () => {
  expect(identiques([1, 2], [1, 2])).toBe(true);
  expect(identiques([1, 2], [2, 1])).toBe(false);
  expect(identiques(undefined, null)).toBe(true);
  expect(identiques([], null)).toBe(false);
});

// ── config ──
test('verdictConfig : forme valide normalisee', () => {
  expect(verdictConfig({ serveurs: { crm: { command: 'node' } } })).toEqual({ ok: true, config: { port: PORT_DEFAUT, hote: '127.0.0.1', serveurs: { crm: { command: 'node', args: [], env: {}, cwd: null } } } });
  expect(verdictConfig({ port: 1, hote: '10.87.87.1', serveurs: { 'a.b-c_9': { command: 'x', args: ['1'], env: { K: 'v' }, cwd: 'C:/w', origine: {} } } }).config).toEqual({ port: 1, hote: '10.87.87.1', serveurs: { 'a.b-c_9': { command: 'x', args: ['1'], env: { K: 'v' }, cwd: 'C:/w' } } });
  expect(verdictConfig({ port: 65535, serveurs: {} }).ok).toBe(true);
});

test('verdictConfig : refus NOMMES', () => {
  // `ok:false` ET le motif : un refus qui dirait ok:true serait une config ACCEPTEE.
  const r = (c) => { const v = verdictConfig(c); expect(v.ok).toBe(false); return v.raison; };
  expect(r('texte')).toBe('la configuration doit etre un objet');
  expect(r({ serveurs: 'x' })).toBe('"serveurs" doit etre un objet');
  expect(r({ serveurs: null })).toBe('"serveurs" doit etre un objet');
  expect(r({ serveurs: { s: 'x' } })).toBe('serveur "s" : doit etre un objet');
  expect(r({ serveurs: { s: null } })).toBe('serveur "s" : doit etre un objet');
  expect(r({ serveurs: { s: { command: 3 } } })).toBe('serveur "s" : "command" manquant');
  expect(r({ serveurs: { s: { command: 'a', env: 'x' } } })).toBe('serveur "s" : "env" doit etre un objet de chaines');
  expect(r(null)).toBe('la configuration doit etre un objet');
  expect(r([])).toBe('la configuration doit etre un objet');
  expect(r({ port: 0, serveurs: {} })).toBe('port invalide : 0');
  expect(r({ hote: '0.0.0.0', serveurs: {} })).toBe("adresse d'ecoute refusee : 0.0.0.0 (boucle locale 127/8 ou adresse privee seulement)");
  expect(r({ hote: 3, serveurs: {} })).toBe("adresse d'ecoute refusee : 3 (boucle locale 127/8 ou adresse privee seulement)");
  expect(r({ port: 65536, serveurs: {} })).toBe('port invalide : 65536');
  expect(r({ port: 1.5, serveurs: {} })).toBe('port invalide : 1.5');
  expect(r({})).toBe('"serveurs" doit etre un objet');
  expect(r({ serveurs: [] })).toBe('"serveurs" doit etre un objet');
  expect(r({ serveurs: { '-x': { command: 'a' } } })).toBe('nom de serveur invalide : "-x" (alphabet [A-Za-z0-9._-], 1..64)');
  expect(r({ serveurs: { ['a'.repeat(65)]: { command: 'a' } } })).toMatch(/^nom de serveur invalide/);
  expect(r({ serveurs: { s: [] } })).toBe('serveur "s" : doit etre un objet');
  expect(r({ serveurs: { s: {} } })).toBe('serveur "s" : "command" manquant');
  expect(r({ serveurs: { s: { command: '' } } })).toBe('serveur "s" : "command" manquant');
  expect(r({ serveurs: { s: { command: 'a', args: 'x' } } })).toBe('serveur "s" : "args" doit etre une liste de chaines');
  expect(r({ serveurs: { s: { command: 'a', args: [1] } } })).toBe('serveur "s" : "args" doit etre une liste de chaines');
  expect(r({ serveurs: { s: { command: 'a', env: [] } } })).toBe('serveur "s" : "env" doit etre un objet de chaines');
  expect(r({ serveurs: { s: { command: 'a', env: null } } })).toBe('serveur "s" : "env" doit etre un objet de chaines');
  expect(r({ serveurs: { s: { command: 'a', env: { K: 1 } } } })).toBe('serveur "s" : "env" doit etre un objet de chaines');
  expect(r({ serveurs: { s: { command: 'a', cwd: 3 } } })).toBe('serveur "s" : "cwd" doit etre une chaine');
});

test('developper : ${VAR} et ${VAR:-defaut} comme Claude Code, absente sans defaut = refus nomme', () => {
  expect(developper('a ${X} b', { X: '1' })).toEqual({ ok: true, valeur: 'a 1 b' });
  expect(developper('${X:-def}', {})).toEqual({ ok: true, valeur: 'def' });
  expect(developper('${X:-}', {})).toEqual({ ok: true, valeur: '' });
  expect(developper('${X:-def}', { X: '' }), 'definie mais vide : la valeur gagne').toEqual({ ok: true, valeur: '' });
  expect(developper('${X}${Y}', { X: 'a', Y: 'b' })).toEqual({ ok: true, valeur: 'ab' });
  expect(developper('sans variable $X ${1A}', {})).toEqual({ ok: true, valeur: 'sans variable $X ${1A}' });
  expect(developper('${ABSENTE}', {})).toEqual({ ok: false, raison: "variable d'environnement absente et sans valeur par defaut : ABSENTE" });
  expect(developper('${A_9}', { A_9: 'z' })).toEqual({ ok: true, valeur: 'z' });
});

test('definitionLancable : chaque chaine developpee a sa place, refus propage', () => {
  const def = () => ({ command: '${BIN:-node}', args: ['${D}/a.js', 'x'], env: { K: '${KEY:-}', L: 'lit' }, cwd: '${D}' });
  expect(definitionLancable(def(), { D: 'C:/w', KEY: 's' })).toEqual({ ok: true, def: { command: 'node', args: ['C:/w/a.js', 'x'], env: { K: 's', L: 'lit' }, cwd: 'C:/w' } });
  expect(definitionLancable({ ...def(), cwd: null }, { D: 'C:/w' })).toEqual({ ok: true, def: { command: 'node', args: ['C:/w/a.js', 'x'], env: { K: '', L: 'lit' }, cwd: null } });
  expect(definitionLancable(def(), {})).toEqual({ ok: false, raison: "variable d'environnement absente et sans valeur par defaut : D" });
  expect(definitionLancable({ command: 'n', args: [], env: {}, cwd: null }, {})).toEqual({ ok: true, def: { command: 'n', args: [], env: {}, cwd: null } });
});

test('hoteAdmis : boucle locale et privees seulement (l adresse EST la frontiere)', () => {
  for (const ok of ['127.0.0.1', '127.255.255.254', '10.87.87.1', '10.0.0.0', '172.16.0.1', '172.31.255.255', '192.168.1.10']) expect(hoteAdmis(ok), ok).toBe(true);
  for (const ko of ['0.0.0.0', '100.64.0.1', '8.8.8.8', '172.15.0.1', '172.32.0.1', '192.167.1.1', '192.169.1.1', '11.0.0.1', '126.0.0.1', '128.0.0.1', '9.0.0.1', '256.0.0.1', '10.256.0.1', '10.0.256.1', '10.0.0.256', '10.0.0', 'localhost', '::1', ' 127.0.0.1', '127.0.0.1 ', '1270.0.0.1', '', null, undefined, 127, ['127.0.0.1'], { toString: () => '127.0.0.1' }, '11.20.0.1', '193.20.1.1', '193.168.1.1']) expect(hoteAdmis(ko), String(ko)).toBe(false);
});

// ── chemins ──
test('emplacements : Windows, macOS, Linux, surcharges', () => {
  expect(emplacements({ platform: 'win32', env: { APPDATA: 'C:\\R', LOCALAPPDATA: 'C:\\L' }, home: 'C:\\h' })).toEqual({ config: 'C:\\R\\mcp-switchboard\\switchboard.json', etat: 'C:\\L\\mcp-switchboard' });
  expect(emplacements({ platform: 'win32', env: {}, home: 'C:\\h' })).toEqual({ config: 'C:\\h\\AppData\\Roaming\\mcp-switchboard\\switchboard.json', etat: 'C:\\h\\AppData\\Local\\mcp-switchboard' });
  expect(emplacements({ platform: 'darwin', env: {}, home: '/Users/a' })).toEqual({ config: '/Users/a/Library/Application Support/mcp-switchboard/switchboard.json', etat: '/Users/a/Library/Application Support/mcp-switchboard' });
  expect(emplacements({ platform: 'linux', env: {}, home: '/home/a' })).toEqual({ config: '/home/a/.config/mcp-switchboard/switchboard.json', etat: '/home/a/.local/state/mcp-switchboard' });
  expect(emplacements({ platform: 'linux', env: { XDG_CONFIG_HOME: '/c', XDG_STATE_HOME: '/s' }, home: '/home/a' })).toEqual({ config: '/c/mcp-switchboard/switchboard.json', etat: '/s/mcp-switchboard' });
  expect(emplacements({ platform: 'linux', env: { MCP_SWITCHBOARD_CONFIG: '/x.json', MCP_SWITCHBOARD_STATE: '/e' }, home: '/h' })).toEqual({ config: '/x.json', etat: '/e' });
});

// ── service ──
// Le CONTRAT est le fichier exact que recoit l'OS : fige ici en entier (relu contre les formats officiels le 17/10/2026).
test('planService : fichiers EXACTS pour les 3 OS', () => {
  expect(planService({ platform: 'win32', node: 'C:\\n\\node.exe', main: 'C:\\sb\\src\\main.js', lanceur: 'C:\\sb\\bin\\sans-fenetre.vbs', utilisateur: 'PC\\utilisateur', home: 'C:\\h' }).contenu).toBe("<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n<Task version=\"1.4\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n  <RegistrationInfo><Description>Standard MCP : un serveur par fenetre, allume a la demande</Description></RegistrationInfo>\r\n  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>PC\\utilisateur</UserId></LogonTrigger><EventTrigger><Enabled>true</Enabled><Subscription>&lt;QueryList&gt;&lt;Query Id=&quot;0&quot; Path=&quot;Microsoft-Windows-TaskScheduler/Operational&quot;&gt;&lt;Select Path=&quot;Microsoft-Windows-TaskScheduler/Operational&quot;&gt;*[System[Provider[@Name='Microsoft-Windows-TaskScheduler'] and (EventID=201)]] and *[EventData[Data[@Name='TaskName']='\\mcp-switchboard']] and *[EventData[Data[@Name='ResultCode']!='0']]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription></EventTrigger></Triggers>\r\n  <Principals><Principal id=\"Author\"><UserId>PC\\utilisateur</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>\r\n  <Settings>\r\n    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>\r\n    <Enabled>true</Enabled>\r\n  </Settings>\r\n  <Actions Context=\"Author\"><Exec><Command>wscript.exe</Command><Arguments>//B //Nologo &quot;C:\\sb\\bin\\sans-fenetre.vbs&quot; &quot;C:\\n\\node.exe&quot; &quot;C:\\sb\\src\\main.js&quot;</Arguments></Exec></Actions>\r\n</Task>");
  expect(planService({ platform: 'darwin', node: '/usr/local/bin/node', main: '/sb/src/main.js', home: '/Users/a', uid: 501 }).contenu).toBe("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n  <key>Label</key><string>com.mcp-switchboard</string>\n  <key>ProgramArguments</key><array><string>/usr/local/bin/node</string><string>/sb/src/main.js</string></array>\n  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n</dict></plist>");
  expect(planService({ platform: 'linux', node: '/usr/bin/node', main: '/sb/src/main.js', home: '/home/a' }).contenu).toBe("[Unit]\nDescription=Standard MCP : un serveur par fenetre, allume a la demande\n\n[Service]\nExecStart=\"/usr/bin/node\" \"/sb/src/main.js\"\nRestart=always\nRestartSec=1\n\n[Install]\nWantedBy=default.target\n");
  expect(planService({ platform: 'darwin', node: 'a"<&>b', main: 'm', home: '/h', uid: 1 }).contenu).toContain('<string>a&quot;&lt;&amp;&gt;b</string>');
  expect(planService({ platform: 'darwin', node: 'n', main: 'm', home: '/h', uid: 1 }).encodage).toBe('utf8');
  expect(planService({ platform: 'linux', node: 'n', main: 'm', home: '/h' }).encodage).toBe('utf8');
});
test('planService Windows : tache a l ouverture de session, sans elevation, relance, sans fenetre, UTF-16', () => {
  const p = planService({ platform: 'win32', node: 'C:\\n\\node.exe', main: 'C:\\sb\\src\\main.js', lanceur: 'C:\\sb\\bin\\sans-fenetre.vbs', utilisateur: 'PC\\utilisateur', home: 'C:\\h' });
  expect(p.encodage).toBe('utf16le-bom');
  expect(p.fichier).toBe(`${NOM_SERVICE}.xml`);
  for (const morceau of ['<LogonTrigger><Enabled>true</Enabled><UserId>PC\\utilisateur</UserId>', '<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>', '<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>', '<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>', '<Command>wscript.exe</Command>', '//B //Nologo &quot;C:\\sb\\bin\\sans-fenetre.vbs&quot; &quot;C:\\n\\node.exe&quot; &quot;C:\\sb\\src\\main.js&quot;', 'encoding="UTF-16"']) expect(p.contenu).toContain(morceau);
  expect(p.commandes).toEqual([['schtasks', '/create', '/f', '/tn', NOM_SERVICE, '/xml', '{fichier}'], ['schtasks', '/run', '/tn', NOM_SERVICE]]);
  expect(planService({ platform: 'win32', node: 'n', main: 'm', lanceur: 'l', utilisateur: 'A&B<x>', home: 'h' }).contenu).toContain('<UserId>A&amp;B&lt;x&gt;</UserId>');
});

test('planService macOS : LaunchAgent RunAtLoad + KeepAlive', () => {
  const p = planService({ platform: 'darwin', node: '/usr/local/bin/node', main: '/sb/src/main.js', home: '/Users/a', uid: 501 });
  expect(p.fichier).toBe('/Users/a/Library/LaunchAgents/com.mcp-switchboard.plist');
  for (const morceau of ['<key>Label</key><string>com.mcp-switchboard</string>', '<string>/usr/local/bin/node</string><string>/sb/src/main.js</string>', '<key>RunAtLoad</key><true/>', '<key>KeepAlive</key><true/>']) expect(p.contenu).toContain(morceau);
  expect(p.commandes).toEqual([['launchctl', 'bootout', 'gui/501/com.mcp-switchboard'], ['launchctl', 'bootstrap', 'gui/501', '{fichier}']]);
});

test('planService Linux : unite systemd --user Restart=always', () => {
  const p = planService({ platform: 'linux', node: '/usr/bin/node', main: '/sb/src/main.js', home: '/home/a' });
  expect(p.fichier).toBe('/home/a/.config/systemd/user/mcp-switchboard.service');
  for (const morceau of ['ExecStart="/usr/bin/node" "/sb/src/main.js"', 'Restart=always', 'RestartSec=1', 'WantedBy=default.target']) expect(p.contenu).toContain(morceau);
  expect(p.commandes).toEqual([['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', NOM_SERVICE]]);
});
