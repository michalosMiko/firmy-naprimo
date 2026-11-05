/**
 * Práce napřímo – oslovení podniků (inzerát zdarma za kontrolu a doplnění karty)
 *
 * Patří do STEJNÉHO Apps Script projektu jako inzeraty.gs, jako nový soubor osloveni.gs.
 * Všechno má předponu osl_ / OSL_, aby se nepletlo s inzeraty.gs.
 *
 * List „Oslovení“ (neveřejná tabulka): A = řádek v Podniky, B–H se počítají vzorcem
 * z listu Podniky (název, adresa, druh, e-mail, tři odkazy). Ručně se mění jen J „Stav“
 * a L „Poznámka“. Řádek se pošle jen ve stavu „připraveno“.
 *
 * Funkce (menu Inzeráty → Oslovení, nebo spustit z editoru):
 *   osl_zkusebni()     pošle e-mail pro vybraný řádek (nebo první „připraveno“) JEN správci
 *   osl_koncepty()     vytvoří v Gmailu koncepty pro další dávku, nic neodešle
 *   osl_odeslatDavku() po potvrzení odešle další dávku (OSL.DAVKA e-mailů)
 *   osl_aktualizuj()   podle listu Inzeráty přepne stav na „podal inzerát“
 */

const OSL = {
  ADMIN: 'domecekcafe@gmail.com',
  JMENO: 'Michal Mamula',
  LIST: 'Oslovení',
  LIST_POD: 'Podniky',
  LIST_INZ: 'Inzeráty',
  DAVKA: 20,            // kolik e-mailů najednou
  REZERVA: 30,          // kolik denních e-mailů nechat pro inzeráty (potvrzovací e-maily)
  LOKALITA: 'ze Žižkova',  // "Uchazeči ___ a okolí"
};

const OSL_ST = {
  PRIPRAVENO: 'připraveno', KONCEPT: 'koncept', ODESLANO: 'odesláno',
  INZERAT: 'podal inzerát', CHYBA: 'chyba',
};

/* Sloupce listu Oslovení (1 = A) */
const OSL_C = { RADEK: 1, NAZEV: 2, ADRESA: 3, DRUH: 4, MAIL: 5, KARTA: 6, INZ: 7, UPR: 8, KAMPAN: 9, STAV: 10, KDY: 11, POZN: 12 };

/* ---------- veřejné funkce ---------- */

function osl_zkusebni() {
  const sh = osl_list();
  let r = sh.getActiveRange() && sh.getActiveRange().getRow();
  if (SpreadsheetApp.getActiveSheet().getName() !== OSL.LIST || !r || r < 2) r = osl_dalsi(sh, 1)[0];
  if (!r) return osl_alert('V listu Oslovení není žádný řádek ve stavu „připraveno“.');
  const z = osl_zaznam(sh, r);
  const m = osl_email(z);
  MailApp.sendEmail({ to: OSL.ADMIN, name: 'Práce napřímo', subject: '[TEST] ' + m.predmet, body: m.text, htmlBody: m.html });
  osl_alert('Zkušební e-mail pro „' + z.nazev + '“ odešel jen tobě (' + OSL.ADMIN + '). Podniku nic neodešlo.');
}

function osl_koncepty() {
  const sh = osl_list();
  const radky = osl_dalsi(sh, OSL.DAVKA);
  if (!radky.length) return osl_alert('Nic ve stavu „připraveno“.');
  radky.forEach(r => {
    const z = osl_zaznam(sh, r);
    const chyba = osl_kontrola(z);
    if (chyba) return osl_stav(sh, r, OSL_ST.CHYBA, chyba);
    const m = osl_email(z);
    GmailApp.createDraft(z.mail, m.predmet, m.text, { htmlBody: m.html, name: 'Práce napřímo', replyTo: OSL.ADMIN });
    osl_stav(sh, r, OSL_ST.KONCEPT, 'koncept v Gmailu ' + osl_ted());
  });
  osl_alert('Hotovo: ' + radky.length + ' konceptů v Gmailu (složka Koncepty). Odešleš je ručně, stav pak přepni na „odesláno“.');
}

function osl_odeslatDavku() {
  const sh = osl_list();
  const zbyva = MailApp.getRemainingDailyQuota() - OSL.REZERVA;
  if (zbyva <= 0) return osl_alert('Dnes už zbývá jen ' + MailApp.getRemainingDailyQuota() + ' e-mailů, nechávám je pro inzeráty. Zkus to zítra.');
  const radky = osl_dalsi(sh, Math.min(OSL.DAVKA, zbyva));
  if (!radky.length) return osl_alert('Nic ve stavu „připraveno“.');
  const ui = SpreadsheetApp.getUi();
  const jmena = radky.map(r => '• ' + sh.getRange(r, OSL_C.NAZEV).getDisplayValue()).join('\n');
  if (ui.alert('Odeslat ' + radky.length + ' e-mailů?', jmena, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  const odeslane = osl_odeslaneMaily(sh);
  let n = 0;
  radky.forEach(r => {
    const z = osl_zaznam(sh, r);
    const chyba = osl_kontrola(z) || (odeslane.has(z.mail.toLowerCase()) ? 'na tento e-mail už odešlo' : '');
    if (chyba) return osl_stav(sh, r, OSL_ST.CHYBA, chyba);
    const m = osl_email(z);
    try {
      MailApp.sendEmail({ to: z.mail, replyTo: OSL.ADMIN, name: 'Práce napřímo', subject: m.predmet, body: m.text, htmlBody: m.html });
    } catch (e) { return osl_stav(sh, r, OSL_ST.CHYBA, String(e.message || e)); }
    odeslane.add(z.mail.toLowerCase());
    osl_stav(sh, r, OSL_ST.ODESLANO);
    osl_zapisDoPodniku(z);
    n++;
  });
  osl_alert('Odesláno ' + n + ' z ' + radky.length + '. Chyby (pokud jsou) mají stav „chyba“ a důvod v Poznámce.');
}

function osl_aktualizuj() {
  const ss = SpreadsheetApp.getActive();
  const inz = ss.getSheetByName(OSL.LIST_INZ);
  if (!inz || inz.getLastRow() < 2) return osl_alert('List Inzeráty je prázdný.');
  const hl = inz.getRange(1, 1, 1, inz.getLastColumn()).getValues()[0];
  const cR = hl.findIndex(x => String(x).indexOf('Řádek v Podniky') === 0);
  const cS = hl.findIndex(x => String(x) === 'Stav');
  if (cR < 0) return osl_alert('V listu Inzeráty chybí sloupec „Řádek v Podniky“.');
  const sNe = ['zamítnuto', 'staženo'];
  const sInz = new Set(inz.getRange(2, 1, inz.getLastRow() - 1, hl.length).getValues()
    .filter(x => x[cR] && sNe.indexOf(String(x[cS])) < 0).map(x => String(x[cR])));
  const sh = osl_list();
  const v = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), OSL_C.POZN).getValues();
  let n = 0;
  v.forEach((x, i) => {
    if (x[0] && sInz.has(String(x[0])) && x[OSL_C.STAV - 1] !== OSL_ST.INZERAT) {
      sh.getRange(i + 2, OSL_C.STAV).setValue(OSL_ST.INZERAT); n++;
    }
  });
  osl_alert('Podaný inzerát u ' + n + ' dalších podniků.');
}

/* ---------- text e-mailu ---------- */

function osl_email(z) {
  const predmet = z.nazev + ' na pracenaprimo.cz: pracovní inzerát zdarma';
  const odstavce = [
    'Dobrý den,',
    'jmenuji se ' + OSL.JMENO + ' a provozuji pracenaprimo.cz, mapu pražských podniků, kde lidé hledají práci přímo u provozoven ve svém okolí, bez agentur. Váš podnik ' + z.nazev + ' (' + z.adresa + ') na ní už je, základní údaje jsem převzal z veřejných zdrojů.',
    'Chtěl bych vás poprosit o spolupráci: zkontrolujte prosím údaje na vaší kartě a doplňte, co chybí, třeba Facebook, Instagram nebo otevírací dobu. Jako poděkování si u nás můžete zdarma vystavit pracovní inzerát. Uchazeči ' + OSL.LOKALITA + ' a okolí ho uvidí přímo u vašeho podniku na mapě.',
  ];
  const odkazy = [
    ['Upravit a doplnit údaje na kartě', z.upr],
    ['Přidat pracovní inzerát zdarma', z.inz],
    ['Jak karta vypadá teď', z.karta],
  ];
  const za = [
    'Nic se neplatí a nezakládá se žádný účet. Každou změnu i inzerát potvrdíte odkazem, který přijde na tuto adresu (' + z.mail + '), aby za vás nemohl nic podat nikdo cizí.',
    'Pokud o nabídku nestojíte, odpovězte prosím „ne“ a už vám psát nebudu. Kdybyste chtěli kartu z mapy úplně odebrat, napište to do odpovědi a smažu ji.',
  ];
  const en = 'English: your business is listed on pracenaprimo.cz, a map of Prague businesses where people look for jobs directly. Please check or complete your card (social media, opening hours) and, as a thank-you, post a job ad for free: ' + z.upr + ' · ' + z.inz + '. Not interested? Just reply "no".';
  const podpis = ['Děkuji a přeji hezký den', OSL.JMENO, 'pracenaprimo.cz · ' + OSL.ADMIN];

  const text = odstavce.join('\n\n') + '\n\n' +
    odkazy.map(o => o[0] + ':\n' + o[1]).join('\n\n') + '\n\n' +
    za.join('\n\n') + '\n\n' + podpis.join('\n') + '\n\n---\n' + en;

  const a = (t, u) => '<a href="' + osl_h(u) + '" style="color:#0F6B5C;font-weight:600">' + osl_h(t) + '</a>';
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#1d1d1d;max-width:600px">' +
    odstavce.map(p => '<p>' + osl_h(p) + '</p>').join('') +
    '<ul style="padding-left:20px">' + odkazy.map(o => '<li style="margin:6px 0">' + a(o[0], o[1]) + '</li>').join('') + '</ul>' +
    za.map(p => '<p>' + osl_h(p) + '</p>').join('') +
    '<p>' + podpis.map(osl_h).join('<br>') + '</p>' +
    '<p style="color:#666;font-size:13px;border-top:1px solid #ddd;padding-top:8px">' + osl_h(en) + '</p></div>';
  return { predmet, text, html };
}

/* ---------- pomocné ---------- */

function osl_list() {
  const sh = SpreadsheetApp.getActive().getSheetByName(OSL.LIST);
  if (!sh) throw new Error('Chybí list „' + OSL.LIST + '“.');
  return sh;
}

function osl_dalsi(sh, kolik) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const st = sh.getRange(2, OSL_C.STAV, n, 1).getValues();
  const out = [];
  for (let i = 0; i < n && out.length < kolik; i++) if (st[i][0] === OSL_ST.PRIPRAVENO) out.push(i + 2);
  return out;
}

function osl_zaznam(sh, r) {
  const v = sh.getRange(r, 1, 1, OSL_C.POZN).getDisplayValues()[0];
  return { radek: v[0], nazev: v[1], adresa: v[2], druh: v[3], mail: String(v[4]).trim(), karta: v[5], inz: v[6], upr: v[7], kampan: v[8] };
}

function osl_kontrola(z) {
  if (!z.nazev) return 'chybí název (řádek v Podniky nesedí?)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(z.mail)) return 'neplatný e-mail';
  const pod = SpreadsheetApp.getActive().getSheetByName(OSL.LIST_POD);
  const r = Number(z.radek);
  const stav = String(pod.getRange(r, 18).getValue());   // R „Stav oslovení“
  if (stav && stav !== 'Neosloveno' && stav.indexOf('Osloveno e-mailem') !== 0) return 'v Podniky je stav oslovení „' + stav + '“';
  return '';
}

function osl_odeslaneMaily(sh) {
  const n = sh.getLastRow() - 1;
  const v = sh.getRange(2, 1, Math.max(n, 1), OSL_C.STAV).getDisplayValues();
  return new Set(v.filter(x => x[OSL_C.STAV - 1] === OSL_ST.ODESLANO).map(x => String(x[OSL_C.MAIL - 1]).toLowerCase()));
}

function osl_stav(sh, r, stav, pozn) {
  sh.getRange(r, OSL_C.STAV).setValue(stav);
  if (stav === OSL_ST.ODESLANO) sh.getRange(r, OSL_C.KDY).setValue(new Date());
  if (pozn) sh.getRange(r, OSL_C.POZN).setValue(pozn);
}

/* Podniky: R Stav oslovení, S Datum kontaktu, T Komu jsem volal / psal, U Poznámka k oslovení */
function osl_zapisDoPodniku(z) {
  const pod = SpreadsheetApp.getActive().getSheetByName(OSL.LIST_POD);
  const r = Number(z.radek);
  const u = pod.getRange(r, 21).getValue();
  pod.getRange(r, 18, 1, 4).setValues([[
    'Osloveno e-mailem', new Date(), z.mail,
    (u ? u + ' | ' : '') + 'Kampaň „' + z.kampan + '“: inzerát zdarma za doplnění karty',
  ]]);
}

function osl_ted() { return Utilities.formatDate(new Date(), 'Europe/Prague', 'd. M. yyyy H:mm'); }
function osl_alert(t) { SpreadsheetApp.getUi().alert(t); }
function osl_h(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
