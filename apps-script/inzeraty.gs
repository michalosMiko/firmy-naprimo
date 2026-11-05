/**
 * Práce napřímo – pracovní inzeráty a úpravy karet podniků
 *
 * Skript patří do NEVEŘEJNÉ tabulky (Rozšíření → Apps Script) a nasazuje se jako
 * webová aplikace (Spustit jako: já, Přístup: kdokoli). Postup je v apps-script/NAVOD.md.
 *
 * Tok inzerátu:
 *   web (formulář na kartě podniku) → doPost → nový řádek v listu „Inzeráty“
 *   → podnik má e-mail v listu Podniky: pošle se mu potvrzovací odkaz (stav „čeká na e-mail“)
 *   → podnik e-mail nemá: stav „ověřit telefonem“, správce zavolá na telefon z karty
 *   → po potvrzení (doGet) stav „potvrzeno“ a správci přijde upozornění
 *   → správce v tabulce: menu Inzeráty → Schválit vybraný řádek → stav „aktivní“
 *
 * Úprava karty (formulář „Upravit údaje podniku“) jde stejnou cestou do listu „Úpravy karet“;
 * po schválení skript zapíše změněné údaje do listu Podniky (stav „zapsáno“).
 *
 * Další soubory ve stejném projektu (např. uchazeci.gs) se připojují přes háčky v doPost, doGet a onOpen.
 */

const CFG = {
  ADMIN: 'domecekcafe@gmail.com',      // kam chodí upozornění pro správce
  LIST_INZ: 'Inzeráty',
  LIST_UPR: 'Úpravy karet',
  LIST_POD: 'Podniky',
  WEB: 'https://pracenaprimo.cz',
  MAX_NA_PODNIK: 5,                     // kolik rozpracovaných + aktivních inzerátů smí mít jeden podnik
  MAX_ZA_HODINU: 30,                    // ochrana proti zahlcení: inzerátů za hodinu celkem
  PLATNOST: [14, 30, 60],               // povolené platnosti ve dnech
  MAX_POPIS: 2000,                      // nejvýš znaků v popisu práce (na webu INZ_MAX_POPIS)
};

const STAV = {
  EMAIL: 'čeká na e-mail',
  TELEFON: 'ověřit telefonem',
  POTVRZENO: 'potvrzeno',
  AKTIVNI: 'aktivní',
  ZAMITNUTO: 'zamítnuto',
  VYPRSELO: 'vypršelo',
  STAZENO: 'staženo',
  ZAPSANO: 'zapsáno',                   // jen u úprav karet: změny jsou v listu Podniky
};
const STAVY_ZIVE = [STAV.EMAIL, STAV.TELEFON, STAV.POTVRZENO, STAV.AKTIVNI];

/* Sloupce listu Inzeráty: [hlavička, klíč z formuláře nebo null]. Pořadí = pořadí v listu. */
const SL = [
  ['ID', null], ['Stav', null], ['Vytvořeno', null], ['Potvrzeno', null], ['Zveřejněno', null], ['Platí do', null],
  ['Podnik', 'podnik'], ['Adresa', 'adresa'], ['Lokalita', null], ['Řádek v Podniky', null],
  ['Ověřovací e-mail (z karty)', null], ['Telefon podniku (z karty)', null],
  ['Pozice', 'pozice'], ['Obor', 'obor'], ['Profese', 'profese'],
  ['Úvazek', 'uvazek'], ['Smlouva', 'smlouva'], ['Směny', 'smeny'],
  ['Mzda od', 'mzdaOd'], ['Mzda do', 'mzdaDo'], ['Mzda jednotka', 'mzdaJed'],
  ['Vzdělání', 'vzdelani'], ['Praxe', 'praxe'], ['Jazyky', 'jazyky'],
  ['Požadavky', 'pozadavky'], ['Nabízíme', 'nabizime'], ['Popis práce', 'popis'],
  ['Nástup', 'nastup'], ['Počet míst', 'mist'], ['Jak se ucházet', 'jak'],
  ['Telefon pro uchazeče', 'telUch'], ['E-mail pro uchazeče', 'mailUch'],
  ['Kontaktní osoba', 'osoba'], ['Funkce', 'funkce'], ['Zobrazit jméno', 'ukazJmeno'],
  ['Platnost (dní)', 'platnost'], ['Jazyk webu', 'lang'], ['Token', null], ['Poznámka správce', null],
];
const H = SL.map(x => x[0]);
const C = Object.fromEntries(H.map((h, i) => [h, i + 1])); // číslo sloupce podle hlavičky

/* Sloupce listu Úpravy karet. Třetí položka = hlavička v listu Podniky, kam se hodnota po schválení zapíše. */
const SL_UPR = [
  ['ID', null], ['Stav', null], ['Vytvořeno', null], ['Potvrzeno', null], ['Zapsáno', null],
  ['Podnik', 'podnik'], ['Adresa', 'adresa'], ['Řádek v Podniky', null],
  ['Ověřovací e-mail (z karty)', null], ['Telefon podniku (z karty)', null],
  ['Telefon', 'telefon', 'Telefon'], ['E-mail', 'email', 'E-mail pro aplikaci'], ['Web', 'web', 'Web'],
  ['Otevírací doba', 'hodiny', 'Otevírací doba'], ['Popis', 'popis', 'Popis'],
  ['Facebook', 'fb', 'Facebook'], ['Instagram', 'ig', 'Instagram'], ['TikTok', 'tt', 'TikTok'], ['Další odkaz', 'odkaz', 'Další odkaz'],
  ['Jméno', 'osoba'], ['Funkce', 'funkce'], ['Poznámka pro nás', 'poznamka'], ['Jazyk webu', 'lang'],
  ['Token', null], ['Poznámka správce', null],
];
const H_UPR = SL_UPR.map(x => x[0]);
const C_UPR = Object.fromEntries(H_UPR.map((h, i) => [h, i + 1]));
const UPR_POLE = SL_UPR.filter(x => x[2]);           // pole, která jdou do listu Podniky
const UPR_MAX_POPIS = 400;

/* ---------------- příjem z webu ---------------- */

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, err: 'Neplatná data.' }); }
  if (d.typ === 'uchazec' && typeof uchazecPost === 'function') return uchazecPost(d); // uchazeci.gs
  if (d.web2) return json({ ok: true, stav: 'email', mail: '' }); // past na roboty: tiše „projde“
  if (d.typ === 'uprava') return upr_post(d);

  const chyba = over(d);
  if (chyba) return json({ ok: false, err: chyba });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!limitHodina()) return json({ ok: false, err: 'Teď přichází moc požadavků najednou. Zkuste to prosím za hodinu.' });

    const sh = listInzeraty();
    const pod = najdiPodnik(d.podnik, d.adresa);
    if (pod) {
      const zive = sh.getLastRow() < 2 ? [] : sh.getRange(2, 1, sh.getLastRow() - 1, H.length).getValues()
        .filter(r => r[C['Řádek v Podniky'] - 1] === pod.radek && STAVY_ZIVE.includes(r[C['Stav'] - 1]));
      if (zive.length >= CFG.MAX_NA_PODNIK)
        return json({ ok: false, err: 'Tento podnik už má ' + zive.length + ' inzerátů. Napište nám prosím na ' + CFG.ADMIN + '.' });
    }

    const id = 'INZ-' + Utilities.formatDate(new Date(), 'Europe/Prague', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    const token = Utilities.getUuid().replace(/-/g, '');
    const mail = pod && platnyMail(pod.email) ? pod.email : '';
    const stav = mail ? STAV.EMAIL : STAV.TELEFON;

    const row = SL.map(([hl, k]) => {
      if (k) return cist(d[k]);
      switch (hl) {
        case 'ID': return id;
        case 'Stav': return stav;
        case 'Vytvořeno': return new Date();
        case 'Lokalita': return pod ? pod.lokalita : '';
        case 'Řádek v Podniky': return pod ? pod.radek : '';
        case 'Ověřovací e-mail (z karty)': return mail;
        case 'Telefon podniku (z karty)': return pod ? pod.telefon : '';
        case 'Token': return token;
        case 'Poznámka správce': return pod ? '' : 'Podnik nenalezen v listu Podniky – ověřit ručně.';
        default: return '';
      }
    });
    sh.appendRow(row);
    const r = sh.getLastRow();

    if (mail) {
      posliPotvrzeni(mail, d, id, token);
    } else {
      MailApp.sendEmail({
        to: CFG.ADMIN, name: 'Práce napřímo',
        subject: 'Inzerát k ověření telefonem: ' + d.podnik + ' – ' + d.pozice,
        htmlBody: '<p>Podnik <b>' + h(d.podnik) + '</b> (' + h(d.adresa) + ') nemá v databázi e-mail' + (pod ? '' : ' <b>a nebyl ani nalezen v listu Podniky</b>') + '.</p>' +
          '<p>Zavolej na telefon z karty: <b>' + h(pod ? pod.telefon : '–') + '</b> a ověř, že o inzerátu „' + h(d.pozice) + '“ vědí ' +
          '(podal ho ' + h(d.osoba) + (d.funkce ? ', ' + h(d.funkce) : '') + ').</p>' +
          '<p>Potom v tabulce: menu <b>Inzeráty → Schválit vybraný řádek</b>.</p><p>' + odkazNaRadek(r, CFG.LIST_INZ) + '</p>',
      });
    }
    return json({ ok: true, id: id, stav: mail ? 'email' : 'telefon', mail: mail ? maskuj(mail) : '' });
  } finally {
    lock.releaseLock();
  }
}

/* Kontrola povinných polí a rozumných hodnot. Vrací text chyby, nebo '' */
function over(d) {
  const povinne = { podnik: 'podnik', pozice: 'název pozice', obor: 'obor', profese: 'profese', uvazek: 'typ úvazku',
    smlouva: 'typ smlouvy', popis: 'popis práce', jak: 'jak se ucházet', osoba: 'kontaktní osoba', souhlas: 'souhlas' };
  for (const k in povinne) if (!d[k] || (Array.isArray(d[k]) && !d[k].length)) return 'Chybí: ' + povinne[k] + '.';
  if (!d.mzdaDohodou && !d.mzdaOd) return 'Vyplňte mzdu od, nebo zaškrtněte „dohodou“.';
  if (d.mzdaOd && d.mzdaDo && Number(d.mzdaDo) < Number(d.mzdaOd)) return 'Mzda „do“ je menší než „od“.';
  if (!d.telUch && !d.mailUch) return 'Vyplňte telefon nebo e-mail pro uchazeče.';
  if (d.mailUch && !platnyMail(d.mailUch)) return 'E-mail pro uchazeče nevypadá správně.';
  if (String(d.popis).length > CFG.MAX_POPIS) return 'Popis je moc dlouhý (max. ' + CFG.MAX_POPIS + ' znaků).';
  if (!CFG.PLATNOST.includes(Number(d.platnost))) d.platnost = 30;
  if (d.mzdaDohodou) { d.mzdaOd = ''; d.mzdaDo = ''; d.mzdaJed = 'dohodou'; }
  d.ukazJmeno = d.ukazJmeno ? 'ano' : 'ne';
  return '';
}

/* Hodnota z formuláře do buňky: pole → „a; b; c“, text oříznout, vzorce zneškodnit */
function cist(v) {
  if (v == null) return '';
  if (Array.isArray(v)) v = v.join('; ');
  v = String(v).trim().slice(0, 3000);
  if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v;
  return v;
}

/* ---------------- potvrzení z e-mailu ---------------- */

function doGet(e) {
  const p = e.parameter || {};
  if (p.a === 'smazat-uchazece' && typeof uchazecSmazatOdkaz === 'function') return uchazecSmazatOdkaz(p); // uchazeci.gs
  if (p.a !== 'potvrdit' || !p.id || !p.t) return stranka('Práce napřímo', 'Tady nic není.');
  if (String(p.id).indexOf('UPR-') === 0) return upr_potvrdit(p);
  const sh = listInzeraty();
  const r = najdiRadek(sh, p.id);
  if (!r) return stranka('Inzerát nenalezen', 'Odkaz je neplatný nebo byl inzerát smazán.');
  const v = sh.getRange(r, 1, 1, H.length).getValues()[0];
  if (v[C['Token'] - 1] !== p.t) return stranka('Neplatný odkaz', 'Odkaz nesouhlasí. Zkopírujte ho z e-mailu celý.');
  const stav = v[C['Stav'] - 1];
  if (stav !== STAV.EMAIL) return stranka('Už potvrzeno', 'Tento inzerát už je potvrzený (stav: ' + stav + ').');

  sh.getRange(r, C['Stav']).setValue(STAV.POTVRZENO);
  sh.getRange(r, C['Potvrzeno']).setValue(new Date());
  MailApp.sendEmail({
    to: CFG.ADMIN, name: 'Práce napřímo',
    subject: 'Inzerát potvrzen, čeká na schválení: ' + v[C['Podnik'] - 1] + ' – ' + v[C['Pozice'] - 1],
    htmlBody: '<p>Podnik potvrdil inzerát z e-mailu ' + h(v[C['Ověřovací e-mail (z karty)'] - 1]) + '.</p>' +
      '<p>Zkontroluj text a v tabulce dej <b>Inzeráty → Schválit vybraný řádek</b>.</p><p>' + odkazNaRadek(r, CFG.LIST_INZ) + '</p>',
  });
  return stranka('Děkujeme, inzerát je potvrzený',
    'Inzerát „' + v[C['Pozice'] - 1] + '“ teď rychle zkontrolujeme a zveřejníme. O zveřejnění vám pošleme e-mail.');
}

function posliPotvrzeni(mail, d, id, token) {
  const url = ScriptApp.getService().getUrl() + '?a=potvrdit&id=' + encodeURIComponent(id) + '&t=' + token;
  const mzda = d.mzdaDohodou ? 'dohodou' : [d.mzdaOd, d.mzdaDo].filter(Boolean).join(' – ') + ' ' + (d.mzdaJed || '');
  MailApp.sendEmail({
    to: mail, replyTo: CFG.ADMIN, name: 'Práce napřímo',
    subject: 'Potvrďte prosím pracovní inzerát: ' + d.pozice,
    htmlBody:
      '<p>Dobrý den,</p>' +
      '<p>na webu <a href="' + CFG.WEB + '">pracenaprimo.cz</a> chce <b>' + h(d.osoba) + '</b>' + (d.funkce ? ' (' + h(d.funkce) + ')' : '') +
      ' zveřejnit za podnik <b>' + h(d.podnik) + '</b> pracovní inzerát:</p>' +
      '<p style="padding:10px 14px;background:#DCEFEA;border-radius:10px"><b>' + h(d.pozice) + '</b><br>' + h(cist(d.uvazek)) + ' · ' + h(mzda) + '</p>' +
      '<p>Tento e-mail jsme poslali na adresu, kterou u vašeho podniku vedeme. Pokud o inzerátu víte, potvrďte ho:</p>' +
      '<p><a href="' + url + '" style="display:inline-block;background:#0F6B5C;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Potvrdit inzerát</a></p>' +
      '<p>Pokud o inzerátu nevíte, nic nedělejte. Bez potvrzení se nezveřejní.</p>' +
      '<p style="color:#666;font-size:13px">Práce napřímo · Michal Mamula · ' + CFG.ADMIN + '</p>',
  });
}

/* ---------------- správa v tabulce ---------------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Inzeráty')
    .addItem('Schválit vybraný řádek (inzerát nebo úprava karty)', 'schvalit')
    .addItem('Zamítnout vybraný řádek', 'zamitnout')
    .addItem('Stáhnout vybraný inzerát', 'stahnout')
    .addSeparator()
    .addItem('Připravit listy a denní kontrolu', 'nastavit')
    .addToUi();
  if (typeof uchazeciMenu === 'function') uchazeciMenu(); // uchazeci.gs
  if (typeof osl_koncepty === 'function') {               // osloveni.gs
    SpreadsheetApp.getUi().createMenu('Oslovení')
      .addItem('Zkušební e-mail sobě', 'osl_zkusebni')
      .addItem('Vytvořit koncepty v Gmailu', 'osl_koncepty')
      .addItem('Odeslat další dávku (20)', 'osl_odeslatDavku')
      .addItem('Aktualizovat stavy podle inzerátů', 'osl_aktualizuj')
      .addToUi();
  }
}

function schvalit() {
  const x = vybrany(); if (!x) return;
  if (x.sh.getName() === CFG.LIST_UPR) return upr_zapsat(x);
  const { sh, r, v } = x;
  const stav = v[C['Stav'] - 1];
  if (stav === STAV.AKTIVNI) return SpreadsheetApp.getUi().alert('Inzerát už je aktivní.');
  if (stav === STAV.EMAIL) {
    const ui = SpreadsheetApp.getUi();
    if (ui.alert('Podnik inzerát ještě nepotvrdil e-mailem. Schválit i tak (např. po telefonu)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }
  const dni = Number(v[C['Platnost (dní)'] - 1]) || 30;
  const doDne = new Date(Date.now() + dni * 864e5); // platí celý poslední den (v tabulce se ukazuje jen datum)
  sh.getRange(r, C['Stav']).setValue(STAV.AKTIVNI);
  sh.getRange(r, C['Zveřejněno']).setValue(new Date());
  sh.getRange(r, C['Platí do']).setValue(doDne);
  const komu = v[C['Ověřovací e-mail (z karty)'] - 1] || v[C['E-mail pro uchazeče'] - 1];
  if (platnyMail(komu)) {
    MailApp.sendEmail({
      to: komu, replyTo: CFG.ADMIN, name: 'Práce napřímo',
      subject: 'Inzerát je zveřejněný: ' + v[C['Pozice'] - 1],
      htmlBody: '<p>Dobrý den,</p><p>váš inzerát <b>' + h(v[C['Pozice'] - 1]) + '</b> je zveřejněný na ' +
        '<a href="' + CFG.WEB + '">pracenaprimo.cz</a> do ' + Utilities.formatDate(doDne, 'Europe/Prague', 'd. M. yyyy') + '.</p>' +
        '<p>Když místo obsadíte dřív nebo chcete něco změnit, odpovězte na tento e-mail.</p>' +
        '<p style="color:#666;font-size:13px">Práce napřímo · Michal Mamula</p>',
    });
  }
  SpreadsheetApp.getActive().toast('Inzerát ' + v[0] + ' je aktivní do ' + Utilities.formatDate(doDne, 'Europe/Prague', 'd. M. yyyy') + '.');
}

function zamitnout() { zmenStav(STAV.ZAMITNUTO); }
function stahnout() { zmenStav(STAV.STAZENO); }
function zmenStav(s) {
  const x = vybrany(); if (!x) return;
  if (s === STAV.STAZENO && x.sh.getName() !== CFG.LIST_INZ) return SpreadsheetApp.getUi().alert('Stáhnout jde jen inzerát.');
  x.sh.getRange(x.r, 2).setValue(s); // Stav je v obou listech ve sloupci B
  SpreadsheetApp.getActive().toast(x.v[0] + ': ' + s + '.');
}

/* Vybraný řádek v listu Inzeráty nebo Úpravy karet */
function vybrany() {
  const sh = SpreadsheetApp.getActiveSheet();
  const r = sh.getActiveRange() && sh.getActiveRange().getRow();
  const n = sh.getName();
  if ((n !== CFG.LIST_INZ && n !== CFG.LIST_UPR) || !r || r < 2) {
    SpreadsheetApp.getUi().alert('Otevři list „' + CFG.LIST_INZ + '“ nebo „' + CFG.LIST_UPR + '“ a klikni do řádku.');
    return null;
  }
  const w = n === CFG.LIST_UPR ? H_UPR.length : H.length;
  return { sh, r, v: sh.getRange(r, 1, 1, w).getValues()[0] };
}

/* Denně: aktivní inzeráty po datu „Platí do“ → vypršelo */
function denne() {
  const sh = listInzeraty();
  if (sh.getLastRow() < 2) return;
  const rng = sh.getRange(2, 1, sh.getLastRow() - 1, H.length);
  const v = rng.getValues(), now = new Date();
  v.forEach((row, i) => {
    const d = row[C['Platí do'] - 1];
    if (row[C['Stav'] - 1] === STAV.AKTIVNI && d instanceof Date && d < now) sh.getRange(i + 2, C['Stav']).setValue(STAV.VYPRSELO);
  });
}

/* Jednorázově: založí list s hlavičkou a výběrem stavů, denní kontrolu platnosti */
function nastavit() {
  const sh = listInzeraty();
  sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(2, C['Stav'], sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.values(STAV), true).build());
  ['Vytvořeno', 'Potvrzeno', 'Zveřejněno'].forEach(k => sh.getRange(2, C[k], sh.getMaxRows() - 1, 1).setNumberFormat('d. M. yyyy H:mm'));
  sh.getRange(2, C['Platí do'], sh.getMaxRows() - 1, 1).setNumberFormat('d. M. yyyy');
  const su = upr_list();
  su.getRange(1, 1, 1, H_UPR.length).setValues([H_UPR]).setFontWeight('bold');
  su.setFrozenRows(1);
  su.getRange(2, 2, su.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList([STAV.EMAIL, STAV.TELEFON, STAV.POTVRZENO, STAV.ZAPSANO, STAV.ZAMITNUTO], true).build());
  ['Vytvořeno', 'Potvrzeno', 'Zapsáno'].forEach(k => su.getRange(2, C_UPR[k], su.getMaxRows() - 1, 1).setNumberFormat('d. M. yyyy H:mm'));
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'denne'))
    ScriptApp.newTrigger('denne').timeBased().everyDays(1).atHour(3).inTimezone('Europe/Prague').create();
  SpreadsheetApp.getActive().toast('Listy Inzeráty a Úpravy karet jsou připravené.');
}

/* ---------------- pomocné ---------------- */

function listInzeraty() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.LIST_INZ);
  if (!sh) { sh = ss.insertSheet(CFG.LIST_INZ); sh.getRange(1, 1, 1, H.length).setValues([H]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

/* Najde podnik v listu Podniky podle názvu (jak ho ukazuje web) a adresy. Sloupce hledá podle hlaviček. */
function najdiPodnik(nazev, adresa) {
  const sh = SpreadsheetApp.getActive().getSheetByName(CFG.LIST_POD);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm);
  // hlavička přesně, nebo začátek hlavičky (např. „Název v aplikaci (vzorec, needitovat)“)
  const col = (j) => { const n = norm(j); let i = head.indexOf(n); if (i < 0) i = head.findIndex(x => x.startsWith(n + ' ')); return i; };
  const iNaz = [col('Název v aplikaci'), col('Název podniku')].filter(i => i >= 0);
  const iAdr = col('Adresa'), iTel = col('Telefon'), iLok = col('Lokalita');
  const iMail = [col('E-mail pro aplikaci'), col('E-mail')].filter(i => i >= 0); // nejdřív e-mail z karty, pak z rešerše
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  const n = norm(nazev), a = norm(adresa);
  for (let k = 0; k < vals.length; k++) {
    const r = vals[k];
    if (iNaz.some(i => norm(r[i]) === n) && (iAdr < 0 || norm(r[iAdr]) === a)) {
      const email = iMail.map(i => String(r[i]).split(/[,;\s]+/)[0]).find(platnyMail) || '';
      return { radek: k + 2, email: email, telefon: iTel >= 0 ? String(r[iTel]) : '', lokalita: iLok >= 0 ? r[iLok] : '' };
    }
  }
  return null;
}

function najdiRadek(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (ids[i][0] === id) return i + 2;
  return 0;
}

function odkazNaRadek(r, list) {
  const ss = SpreadsheetApp.getActive();
  return '<a href="' + ss.getUrl() + '#gid=' + ss.getSheetByName(list || CFG.LIST_INZ).getSheetId() + '&range=A' + r + '">Otevřít řádek ' + r + ' v tabulce</a>';
}

/* Ochrana proti zahlcení: nejvýš CFG.MAX_ZA_HODINU požadavků za hodinu. Vrací false, když je limit vyčerpaný. */
function limitHodina() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('hod') || 0);
  if (n >= CFG.MAX_ZA_HODINU) return false;
  cache.put('hod', String(n + 1), 3600);
  return true;
}

function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function platnyMail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim()); }
function maskuj(m) { const [u, d] = m.split('@'); return u.slice(0, 2) + '•••@' + d; }
function h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function stranka(nadpis, text) {
  return HtmlService.createHtmlOutput(
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<div style="font-family:system-ui,sans-serif;max-width:520px;margin:48px auto;padding:0 16px;line-height:1.5">' +
    '<h2 style="color:#0F6B5C">' + h(nadpis) + '</h2><p>' + h(text) + '</p>' +
    '<p><a href="' + CFG.WEB + '" style="color:#0F6B5C">Zpět na pracenaprimo.cz</a></p></div>').setTitle(nadpis);
}

/* ================= úpravy karet (formulář „Upravit údaje podniku“) ================= */

function upr_list() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(CFG.LIST_UPR);
  if (!sh) { sh = ss.insertSheet(CFG.LIST_UPR); sh.getRange(1, 1, 1, H_UPR.length).setValues([H_UPR]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}

function upr_post(d) {
  if (!d.podnik) return json({ ok: false, err: 'Chybí podnik.' });
  if (!d.osoba) return json({ ok: false, err: 'Chybí vaše jméno.' });
  if (!d.souhlas) return json({ ok: false, err: 'Chybí souhlas.' });
  if (!UPR_POLE.some(([, k]) => String(d[k] || '').trim())) return json({ ok: false, err: 'Nevyplnili jste žádný údaj.' });
  if (d.email && !platnyMail(d.email)) return json({ ok: false, err: 'E-mail nevypadá správně.' });
  if (String(d.popis || '').length > UPR_MAX_POPIS) return json({ ok: false, err: 'Popis je moc dlouhý (max. ' + UPR_MAX_POPIS + ' znaků).' });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!limitHodina()) return json({ ok: false, err: 'Teď přichází moc požadavků najednou. Zkuste to prosím za hodinu.' });
    const pod = najdiPodnik(d.podnik, d.adresa);
    const id = 'UPR-' + Utilities.formatDate(new Date(), 'Europe/Prague', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    const token = Utilities.getUuid().replace(/-/g, '');
    const mail = pod && platnyMail(pod.email) ? pod.email : '';
    const row = SL_UPR.map(([hl, k]) => {
      if (k) return cist(d[k]);
      switch (hl) {
        case 'ID': return id;
        case 'Stav': return mail ? STAV.EMAIL : STAV.TELEFON;
        case 'Vytvořeno': return new Date();
        case 'Řádek v Podniky': return pod ? pod.radek : '';
        case 'Ověřovací e-mail (z karty)': return mail;
        case 'Telefon podniku (z karty)': return pod ? pod.telefon : '';
        case 'Token': return token;
        case 'Poznámka správce': return pod ? '' : 'Podnik nenalezen v listu Podniky – ověřit ručně.';
        default: return '';
      }
    });
    const sh = upr_list();
    sh.appendRow(row);
    const r = sh.getLastRow();
    if (mail) {
      const url = ScriptApp.getService().getUrl() + '?a=potvrdit&id=' + encodeURIComponent(id) + '&t=' + token;
      MailApp.sendEmail({
        to: mail, replyTo: CFG.ADMIN, name: 'Práce napřímo',
        subject: 'Potvrďte prosím úpravu údajů: ' + d.podnik,
        htmlBody: '<p>Dobrý den,</p><p>na webu <a href="' + CFG.WEB + '">pracenaprimo.cz</a> chce <b>' + h(d.osoba) + '</b>' +
          (d.funkce ? ' (' + h(d.funkce) + ')' : '') + ' upravit údaje podniku <b>' + h(d.podnik) + '</b>:</p>' +
          upr_tabulka(d) +
          '<p>Tento e-mail jsme poslali na adresu, kterou u vašeho podniku vedeme. Pokud o úpravě víte, potvrďte ji:</p>' +
          '<p><a href="' + url + '" style="display:inline-block;background:#0F6B5C;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600">Potvrdit úpravu</a></p>' +
          '<p>Pokud o úpravě nevíte, nic nedělejte. Bez potvrzení se nic nezmění.</p>' +
          '<p style="color:#666;font-size:13px">Práce napřímo · Michal Mamula · ' + CFG.ADMIN + '</p>',
      });
    } else {
      MailApp.sendEmail({
        to: CFG.ADMIN, name: 'Práce napřímo',
        subject: 'Úprava karty k ověření telefonem: ' + d.podnik,
        htmlBody: '<p>Podnik <b>' + h(d.podnik) + '</b> (' + h(d.adresa) + ') nemá v databázi e-mail' + (pod ? '' : ' <b>a nebyl ani nalezen v listu Podniky</b>') + '.</p>' +
          '<p>Zavolej na telefon z karty: <b>' + h(pod ? pod.telefon : '–') + '</b> a ověř, že o úpravě vědí (poslal ji ' + h(d.osoba) + (d.funkce ? ', ' + h(d.funkce) : '') + ').</p>' +
          upr_tabulka(d) + '<p>Potom v tabulce: menu <b>Inzeráty → Schválit vybraný řádek</b>.</p><p>' + odkazNaRadek(r, CFG.LIST_UPR) + '</p>',
      });
    }
    return json({ ok: true, id: id, stav: mail ? 'email' : 'telefon', mail: mail ? maskuj(mail) : '' });
  } finally {
    lock.releaseLock();
  }
}

function upr_tabulka(d) {
  const radky = UPR_POLE.filter(([, k]) => String(d[k] || '').trim())
    .map(([hl, k]) => '<tr><td style="padding:4px 10px 4px 0;color:#666">' + h(hl) + '</td><td style="padding:4px 0"><b>' + h(d[k]) + '</b></td></tr>').join('');
  return '<table style="border-collapse:collapse;margin:8px 0 12px">' + radky + '</table>';
}

function upr_potvrdit(p) {
  const sh = upr_list();
  const r = najdiRadek(sh, p.id);
  if (!r) return stranka('Úprava nenalezena', 'Odkaz je neplatný nebo byla úprava smazána.');
  const v = sh.getRange(r, 1, 1, H_UPR.length).getValues()[0];
  if (v[C_UPR['Token'] - 1] !== p.t) return stranka('Neplatný odkaz', 'Odkaz nesouhlasí. Zkopírujte ho z e-mailu celý.');
  const stav = v[C_UPR['Stav'] - 1];
  if (stav !== STAV.EMAIL) return stranka('Už potvrzeno', 'Tato úprava už je potvrzená (stav: ' + stav + ').');
  sh.getRange(r, C_UPR['Stav']).setValue(STAV.POTVRZENO);
  sh.getRange(r, C_UPR['Potvrzeno']).setValue(new Date());
  MailApp.sendEmail({
    to: CFG.ADMIN, name: 'Práce napřímo',
    subject: 'Úprava karty potvrzena, čeká na schválení: ' + v[C_UPR['Podnik'] - 1],
    htmlBody: '<p>Podnik potvrdil úpravu údajů z e-mailu ' + h(v[C_UPR['Ověřovací e-mail (z karty)'] - 1]) + '.</p>' +
      '<p>Zkontroluj ji a v tabulce dej <b>Inzeráty → Schválit vybraný řádek</b>. Skript pak změny zapíše do listu Podniky.</p><p>' + odkazNaRadek(r, CFG.LIST_UPR) + '</p>',
  });
  return stranka('Děkujeme, úprava je potvrzená', 'Údaje podniku „' + v[C_UPR['Podnik'] - 1] + '“ teď zkontrolujeme a zapíšeme. Na webu se objeví nejpozději do druhého dne.');
}

/* Schválení úpravy: zapíše vyplněné a změněné údaje do listu Podniky. */
function upr_zapsat(x) {
  const { sh, r, v } = x;
  const ui = SpreadsheetApp.getUi();
  const stav = v[C_UPR['Stav'] - 1];
  if (stav === STAV.ZAPSANO) return ui.alert('Tahle úprava už je zapsaná.');
  if (stav === STAV.EMAIL && ui.alert('Podnik úpravu ještě nepotvrdil e-mailem. Zapsat i tak (např. po telefonu)?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const pod = najdiPodnik(v[C_UPR['Podnik'] - 1], v[C_UPR['Adresa'] - 1]);
  if (!pod) return ui.alert('Podnik „' + v[C_UPR['Podnik'] - 1] + '“ jsem v listu Podniky nenašel (název nebo adresa se mezitím změnily?). Zapiš změny ručně.');
  const ps = SpreadsheetApp.getActive().getSheetByName(CFG.LIST_POD);
  const head = ps.getRange(1, 1, 1, ps.getLastColumn()).getValues()[0].map(norm);
  const col = (j) => { const n = norm(j); let i = head.indexOf(n); if (i < 0) i = head.findIndex(t => t.startsWith(n + ' ')); return i + 1; };
  const radek = ps.getRange(pod.radek, 1, 1, head.length).getValues()[0];
  const zmeny = [];
  UPR_POLE.forEach(([hl, , cil]) => {
    let nove = String(v[C_UPR[hl] - 1] || '').trim();
    if (!nove) return;
    if (cil === 'Web') nove = nove.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
    const c = col(cil);
    if (c < 1) { zmeny.push(hl + ': CHYBÍ SLOUPEC „' + cil + '“'); return; }
    if (String(radek[c - 1]).trim() === nove) return;
    ps.getRange(pod.radek, c).setValue(nove);
    zmeny.push(hl);
  });
  const cZm = col('Co se změnilo');
  if (cZm > 0 && zmeny.length) {
    const dnes = Utilities.formatDate(new Date(), 'Europe/Prague', 'd. M. yyyy');
    const pred = String(radek[cZm - 1] || '').trim();
    ps.getRange(pod.radek, cZm).setValue((pred ? pred + ' | ' : '') + 'Upravil podnik ' + dnes + ' (' + v[0] + '): ' + zmeny.join(', '));
  }
  sh.getRange(r, C_UPR['Stav']).setValue(STAV.ZAPSANO);
  sh.getRange(r, C_UPR['Zapsáno']).setValue(new Date());
  const komu = v[C_UPR['Ověřovací e-mail (z karty)'] - 1] || v[C_UPR['E-mail'] - 1];
  if (zmeny.length && platnyMail(komu)) {
    MailApp.sendEmail({
      to: komu, replyTo: CFG.ADMIN, name: 'Práce napřímo',
      subject: 'Údaje podniku jsou upravené: ' + v[C_UPR['Podnik'] - 1],
      htmlBody: '<p>Dobrý den,</p><p>údaje podniku <b>' + h(v[C_UPR['Podnik'] - 1]) + '</b> na <a href="' + CFG.WEB + '">pracenaprimo.cz</a> jsme upravili (' +
        h(zmeny.join(', ')) + '). Na webu se změna ukáže nejpozději do druhého dne.</p>' +
        '<p>Hledáte lidi? Na kartě podniku je tlačítko „Přidat pracovní inzerát“. Inzerce je zatím zdarma.</p>' +
        '<p style="color:#666;font-size:13px">Práce napřímo · Michal Mamula</p>',
    });
  }
  const pozn = zmeny.some(z => z === 'Popis') ? ' Popis se změnil: anglický a ukrajinský překlad je potřeba upravit ručně.' : '';
  ui.alert(zmeny.length ? 'Zapsáno do Podniky, řádek ' + pod.radek + ': ' + zmeny.join(', ') + '.' + pozn : 'Žádný údaj se neliší od listu Podniky, nic se nezměnilo.');
}
