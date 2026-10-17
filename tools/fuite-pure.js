// fuite-pure.js — LA DECISION « ce texte fuit-il une donnee personnelle ? ». PUR.
//
// 🛑 DEPOT PUBLIC : une fuite est IRREVERSIBLE (clone, cache, index). Deux familles de motifs :
//   ① GENERIQUES, publies ici : ce qui designe une PERSONNE ou une MACHINE quel que soit l'auteur
//      (e-mail, dossier personnel des 3 OS, adresse et nom d'hote Tailscale).
//   ② PERSONNELS, JAMAIS publies : lus dans un fichier LOCAL hors git (cf tools/fuite-gate.mjs). Les publier
//      serait la fuite elle-meme.
// ⚠️ Exceptions = liste FERMEE ci-dessous, chacune avec sa raison (adresse documentaire, exemple RFC).

/** Motifs generiques : [nom, regex]. */
export function motifsGeneriques() {
  return [
    ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
    ['dossier personnel Windows', /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}[A-Za-z0-9._-]+/gi],
    ['dossier personnel macOS', /\/Users\/[A-Za-z0-9._-]+/g],
    ['dossier personnel Linux', /\/home\/[A-Za-z0-9._-]+/g],
    ['adresse Tailscale (100.64/10)', /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g],
    ['nom d\'hote Tailscale', /\b[a-z0-9-]+\.tail[0-9a-f]{6}\.ts\.net\b/gi],
  ];
}

/** Occurrences ADMISES (exemples documentaires), chacune justifiee. */
export function admis() {
  return [
    ['noreply@anthropic.com', 'ligne Co-Authored-By imposee par le harnais, adresse generique'],
    ['/Users/runner', 'dossier du runner GitHub Actions (CI), aucune personne'],
    ['/home/runner', 'dossier du runner GitHub Actions (CI), aucune personne'],
    ['/Users/a', 'exemple de test (utilisateur fictif a une lettre)'],
    ['/home/a', 'exemple de test (utilisateur fictif a une lettre)'],
    ['/home/h', 'exemple de test (dossier fictif)'],
    ['100.64.0.1', 'premiere adresse de la plage Tailscale, exemple de refus dans les tests'],
  ];
}

/**
 * Trouve les fuites d'un texte. Fonction TOTALE.
 * @param {string} texte
 * @param {string[]} personnels motifs PERSONNELS (chaines litterales, insensibles a la casse), hors depot
 * @returns {Array<{motif:string, extrait:string}>}
 */
export function fuites(texte, personnels = []) {
  const s = String(texte ?? '');
  const ok = new Set(admis().map(([v]) => v.toLowerCase()));
  const trouve = [];
  for (const [nom, re] of motifsGeneriques()) {
    for (const m of s.matchAll(re)) if (!ok.has(m[0].toLowerCase())) trouve.push({ motif: nom, extrait: m[0] });
  }
  const bas = s.toLowerCase();
  for (const p of personnels) {
    const q = String(p).trim().toLowerCase();
    if (q && bas.includes(q)) trouve.push({ motif: 'motif personnel (liste locale)', extrait: q.replace(/./g, (c, i) => (i < 2 ? c : '•')) });
  }
  return trouve;
}

/**
 * Lit une liste locale (une entree par ligne, `#` = commentaire). Fonction TOTALE.
 * @param {string} texte
 */
export function lireListe(texte) {
  return String(texte ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}
