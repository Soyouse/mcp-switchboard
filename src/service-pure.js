// service-pure.js — LE PLAN d'installation du standard comme SERVICE de l'OS. PUR (aucune I/O).
//
// 🛑 Le cycle de vie appartient a l'OS, jamais a un script maison (doctrine « ne pas reimplementer ») :
//   Windows : Planificateur de taches, declencheur OUVERTURE DE SESSION, InteractiveToken + LeastPrivilege
//             (aucun mot de passe, aucune elevation), RestartOnFailure (minimum officiel : PT1M),
//             lance via `wscript //B` + lanceur sans fenetre (exigence operateur : AUCUNE console visible).
//             ⚠️ XML en UTF-16 AVEC BOM, sinon « XML mal forme » alors que le XML est valide.
//   macOS   : LaunchAgent, RunAtLoad + KeepAlive (relance immediate par launchd).
//   Linux   : unite systemd --user, Restart=always.
// ⚠️ Chemin ABSOLU de node : le PATH d'un service n'est pas celui du terminal.

export const NOM_SERVICE = 'mcp-switchboard';

const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {{platform:string, node:string, main:string, lanceur?:string, utilisateur?:string, home:string, uid?:number}} o
 * @returns {{fichier:string, contenu:string, encodage:'utf16le-bom'|'utf8', commandes:string[][]}}
 */
export function planService(o) {
  if (o.platform === 'win32') {
    const args = `//B //Nologo "${o.lanceur}" "${o.node}" "${o.main}"`;
    const contenu = [
      '<?xml version="1.0" encoding="UTF-16"?>',
      '<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
      `  <RegistrationInfo><Description>${xmlEsc('Standard MCP : un serveur par fenetre, allume a la demande')}</Description></RegistrationInfo>`,
      // 2e declencheur : la tache elle-meme vient de FINIR EN ERREUR (evenement 201, ResultCode != 0) =>
      // relance IMMEDIATE. RestartOnFailure seul attend 1 min (minimum officiel), or Claude Code ne
      // retente une adresse que ~31 s (5 essais, doc officielle). Recette deja prouvee en production sur ce type de tache.
      // ⚠️ Le canal TaskScheduler/Operational doit etre ACTIF (il l'est sur ce poste depuis le 21/08/2026).
      `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${xmlEsc(o.utilisateur)}</UserId></LogonTrigger><EventTrigger><Enabled>true</Enabled><Subscription>${xmlEsc(`<QueryList><Query Id="0" Path="Microsoft-Windows-TaskScheduler/Operational"><Select Path="Microsoft-Windows-TaskScheduler/Operational">*[System[Provider[@Name='Microsoft-Windows-TaskScheduler'] and (EventID=201)]] and *[EventData[Data[@Name='TaskName']='\\${NOM_SERVICE}']] and *[EventData[Data[@Name='ResultCode']!='0']]</Select></Query></QueryList>`)}</Subscription></EventTrigger></Triggers>`,
      `  <Principals><Principal id="Author"><UserId>${xmlEsc(o.utilisateur)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
      '  <Settings>',
      '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
      '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
      '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
      '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
      '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>',
      '    <Enabled>true</Enabled>',
      '  </Settings>',
      `  <Actions Context="Author"><Exec><Command>wscript.exe</Command><Arguments>${xmlEsc(args)}</Arguments></Exec></Actions>`,
      '</Task>',
    ].join('\r\n');
    return { fichier: `${NOM_SERVICE}.xml`, contenu, encodage: 'utf16le-bom', commandes: [['schtasks', '/create', '/f', '/tn', NOM_SERVICE, '/xml', '{fichier}'], ['schtasks', '/run', '/tn', NOM_SERVICE]] };
  }
  if (o.platform === 'darwin') {
    const label = `com.${NOM_SERVICE}`;
    const contenu = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      `  <key>Label</key><string>${label}</string>`,
      `  <key>ProgramArguments</key><array><string>${xmlEsc(o.node)}</string><string>${xmlEsc(o.main)}</string></array>`,
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><true/>',
      '</dict></plist>',
    ].join('\n');
    return { fichier: `${o.home}/Library/LaunchAgents/${label}.plist`, contenu, encodage: 'utf8', commandes: [['launchctl', 'bootout', `gui/${o.uid}/${label}`], ['launchctl', 'bootstrap', `gui/${o.uid}`, '{fichier}']] };
  }
  const contenu = [
    '[Unit]',
    'Description=Standard MCP : un serveur par fenetre, allume a la demande',
    '',
    '[Service]',
    `ExecStart="${o.node}" "${o.main}"`,
    'Restart=always',
    'RestartSec=1',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
  return { fichier: `${o.home}/.config/systemd/user/${NOM_SERVICE}.service`, contenu, encodage: 'utf8', commandes: [['systemctl', '--user', 'daemon-reload'], ['systemctl', '--user', 'enable', '--now', NOM_SERVICE]] };
}
