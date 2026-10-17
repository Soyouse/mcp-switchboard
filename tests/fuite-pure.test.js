// Decision anti-fuite (tools/fuite-pure.js), mutee. ⚠️ Les exemples fautifs sont FABRIQUES a l'execution
// (concatenation) : ecrits en clair, ce fichier serait lui-meme denonce par le juge qu'il teste.
import { test, expect } from 'vitest';
import { fuites, lireListe, motifsGeneriques, admis } from '../tools/fuite-pure.js';

const A = '@';
const noms = (r) => r.map((x) => x.motif);
const ip4 = (b, c) => ['100', b, c, c].join('.');

test('motifs generiques : e-mail, dossiers personnels des 3 OS, Tailscale (adresse et nom d hote)', () => {
  expect(noms(fuites(`ecrire a jean${A}exemple.fr`))).toEqual(['e-mail']);
  const win = ['C:', 'Users', 'jean'].join('\\');
  expect(fuites(win + '\\x')[0]).toEqual({ motif: 'dossier personnel Windows', extrait: win });
  // Forme ECHAPPEE (JSON, chaine JS) : separateur double avant ET apres `Users`, chacun seul.
  expect(noms(fuites(['C:', 'Users\\jean'].join('\\\\')))).toEqual(['dossier personnel Windows']);
  expect(noms(fuites(['C:\\Users', 'jean'].join('\\\\')))).toEqual(['dossier personnel Windows']);
  expect(noms(fuites('c:' + '/users/jean'))).toEqual(['dossier personnel Windows']);
  expect(noms(fuites('/Us' + 'ers/jean/x'))).toEqual(['dossier personnel macOS']);
  expect(noms(fuites('/ho' + 'me/jean/x'))).toEqual(['dossier personnel Linux']);
  for (const ip of [ip4(64, 1), ip4(99, 2), ip4(100, 3), ip4(127, 4), ip4(110, 5), ip4(64, 123)]) expect(noms(fuites('ip ' + ip)), ip).toEqual(['adresse Tailscale (100.64/10)']);
  for (const ip of ['100.63.1.1', '100.128.1.1', '10.64.1.1', '1100.64.1.1']) expect(noms(fuites('ip ' + ip)), ip).toEqual([]);
  expect(noms(fuites('machine.tail' + '1a2b3c.ts.net'))).toEqual(["nom d'hote Tailscale"]);
  expect(fuites('aucune donnee personnelle ici, 127.0.0.1 et 10.20.30.1')).toEqual([]);
});

test('exceptions ADMISES, chacune justifiee ; seule l exception exacte passe', () => {
  for (const [v, raison] of admis()) {
    expect(raison.length, v).toBeGreaterThan(10);
    expect(fuites(`x ${v} x`), v).toEqual([]);
  }
  // Les valeurs admises RECOPIEES (jamais relues dans admis() : une entree videe passerait sinon).
  for (const v of ['noreply' + A + 'anthropic.com', '/Users/runner', '/home/runner', '/Users/a', '/home/a', '/home/h', ['100', '64', '0', '1'].join('.')]) expect(fuites(`x ${v} x`), v).toEqual([]);
  expect(noms(fuites(`autre${A}anthropic.com`))).toEqual(['e-mail']);
  expect(noms(fuites('/Us' + 'ers/ab'))).toEqual(['dossier personnel macOS']);
  expect(noms(fuites(['100', '64', '0', '2'].join('.')))).toEqual(['adresse Tailscale (100.64/10)']);
  expect(fuites('NOREPLY' + A + 'ANTHROPIC.COM')).toEqual([]);
});

test('motifs PERSONNELS : insensibles a la casse, extrait MASQUE (le rapport ne republie pas le secret)', () => {
  expect(fuites('Bonjour DUPONT', ['dupont'])).toEqual([{ motif: 'motif personnel (liste locale)', extrait: 'du••••' }]);
  expect(fuites('rien', ['dupont'])).toEqual([]);
  expect(fuites('x', ['', '   '])).toEqual([]);
  expect(fuites('a b', [' a '])).toEqual([{ motif: 'motif personnel (liste locale)', extrait: 'a' }]);
});

test('fonction TOTALE : entree absente ou non chaine', () => {
  expect(fuites(undefined)).toEqual([]);
  expect(fuites(null)).toEqual([]);
  expect(fuites(42)).toEqual([]);
  expect(fuites(undefined, ['stryker'])).toEqual([]);
  expect(fuites('stryker was here')).toEqual([]);
});

test('lireListe : une entree par ligne, commentaires et vides ignores', () => {
  expect(lireListe('# titre\r\n dupont \n\nmartin\n#x')).toEqual(['dupont', 'martin']);
  expect(lireListe(undefined)).toEqual([]);
});

test('les motifs generiques sont NOMMES et globaux (sinon une seule occurrence serait vue)', () => {
  for (const [nom, re] of motifsGeneriques()) {
    expect(nom.length).toBeGreaterThan(3);
    expect(re.global, nom).toBe(true);
  }
  expect(fuites(`a${A}b.fr c${A}d.fr`).length).toBe(2);
});
