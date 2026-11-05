/**
 * Práce napřímo – Hledám práci: formulář pro uchazeče
 *
 * Druhý soubor ve STEJNÉM projektu Apps Scriptu jako inzeraty.gs (sdílí pomocné funkce
 * h, json, norm, cist, platnyMail, stranka a CFG). Nasazení: apps-script/NAVOD-UCHAZECI.md.
 *
 * Tok:
 *   web (formulář „Hledám práci“) → doPost (typ: 'uchazec') → uchazecPost
 *   → řádek v neveřejném listu „Uchazeči“, životopis do soukromé složky na Disku správce
 *   → uchazeči hned odejde e-mail s tipy: kolik podniků jeho oboru je v jeho lokalitě,
 *     které z nich hledají lidi, aktivní inzeráty, odkaz na web s výběrem a jak podniky oslovit
 *   → v e-mailu je odkaz „smazat moje údaje“ (smaže řádek i životopis)
 *   → údaje se po 12 měsících samy smažou (denní kontrola)
 *
 * Údaje uchazečů NIKDY nejdou do veřejné tabulky.
 */

const UCFG = {
  LIST: 'Uchazeči',
  SLOZKA: 'Práce napřímo – životopisy (neveřejné)',
  MAX_CV_MB: 5,
  CV_TYPY: ['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.oasis.opendocument.text', 'image/jpeg', 'image/png'],
  MAX_ZA_HODINU: 40,        // přihlášek za hodinu celkem
  UCHOVAT_DNI: 365,         // pak se řádek i životopis smažou
  MAX_O_MNE: 1000,
  UPOZORNIT_SPRAVCE: true,  // krátký e-mail správci o každém novém uchazeči
  PRIKLADU: 8,              // kolik podniků, které hledají lidi, vypsat v e-mailu
};

const USTAV = { NOVY: 'nový', KONTAKTOVAN: 'kontaktován', NASEL: 'našel práci', NEAKTIVNI: 'neaktivní' };

/* Sloupce listu Uchazeči: [hlavička, klíč z formuláře nebo null] */
const USL = [
  ['ID', null], ['Stav', null], ['Vytvořeno', null], ['Smazat po', null],
  ['Jméno', 'jmeno'], ['E-mail', 'email'], ['Telefon', 'telefon'],
  ['Lokalita', 'lokalita'], ['Dojíždění', 'dojezd'],
  ['Obor', 'obor'], ['Profese', 'profese'], ['Další profese', 'dalsi'],
  ['Úvazek', 'uvazek'], ['Smlouva', 'smlouva'], ['Směny', 'smeny'], ['Nástup', 'nastup'],
  ['Praxe', 'praxe'], ['Vzdělání', 'vzdelani'], ['Jazyky', 'jazyky'], ['Mám', 'mam'],
  ['Mzda představa', 'mzda'], ['Mzda jednotka', 'mzdaJed'], ['O mně', 'omne'],
  ['Životopis', null], ['ID souboru', null],
  ['Upozornit na inzeráty', 'upozornit'], ['Jazyk webu', 'lang'],
  ['Podniků v lokalitě a oboru', null], ['Token', null], ['Poznámka správce', null],
];
const UH = USL.map(x => x[0]);
const UC = Object.fromEntries(UH.map((x, i) => [x, i + 1]));

/* ---------------- příjem z webu ---------------- */

function uchazecPost(d) {
  if (d.web2) return json({ ok: true, id: '', podniku: 0 }); // past na roboty
  const chyba = uchazecOver(d);
  if (chyba) return json({ ok: false, err: chyba });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cache = CacheService.getScriptCache();
    const n = Number(cache.get('uch-hod') || 0);
    if (n >= UCFG.MAX_ZA_HODINU) return json({ ok: false, err: 'Teď přichází moc přihlášek najednou. Zkuste to prosím za hodinu.' });
    const klicMail = 'uch-' + Utilities.base64EncodeWebSafe(norm(d.email)).slice(0, 200);
    if (cache.get(klicMail)) return json({ ok: false, err: 'Z tohoto e-mailu už jsme přihlášku dostali. Tipy jsme vám poslali, podívejte se prosím i do spamu.' });
    cache.put('uch-hod', String(n + 1), 3600);

    const id = 'UCH-' + Utilities.formatDate(new Date(), 'Europe/Prague', 'yyMMdd') + '-' + Utilities.getUuid().slice(0, 4).toUpperCase();
    const token = Utilities.getUuid().replace(/-/g, '');
    const smazatPo = new Date(); smazatPo.setDate(smazatPo.getDate() + UCFG.UCHOVAT_DNI);

    let cv = null;
    if (d.cv && d.cv.data) cv = ulozCv(d.cv, id, d.jmeno);

    const tipy = najdiTipy(d.lokalita, d.obor, d.profese);

    const lokText = lokalitaText(d.lokalita);
    const row = USL.map(([hl, k]) => {
      if (k === 'lokalita') return cist(lokText);
      if (k) return cist(d[k]);
      switch (hl) {
        case 'ID': return id;
        case 'Stav': return USTAV.NOVY;
        case 'Vytvořeno': return new Date();
        case 'Smazat po': return smazatPo;
        case 'Životopis': return cv ? cv.url : '';
        case 'ID souboru': return cv ? cv.id : '';
        case 'Podniků v lokalitě a oboru': return tipy.pocet;
        case 'Token': return token;
        default: return '';
      }
    });
    const sh = listUchazeci();
    sh.appendRow(row);
    const r = sh.getLastRow();

    posliTipy(d, id, token, tipy);
    cache.put(klicMail, '1', 21600); // stejný e-mail znovu nejdřív za 6 hodin

    if (UCFG.UPOZORNIT_SPRAVCE) {
      const ss = SpreadsheetApp.getActive();
      MailApp.sendEmail({
        to: CFG.ADMIN, name: 'Práce napřímo',
        subject: 'Nový uchazeč: ' + d.profese + ' – ' + lokText,
        htmlBody: '<p><b>' + h(d.jmeno) + '</b> hledá práci: ' + h(d.profese) + ' (' + h(d.obor) + '), ' + h(lokText) +
          (cv ? ', <b>se životopisem</b>' : '') + '.</p><p>Poslali jsme mu tipy (' + tipy.pocet + ' podniků v lokalitě a oboru).</p>' +
          '<p><a href="' + ss.getUrl() + '#gid=' + sh.getSheetId() + '&range=A' + r + '">Otevřít řádek ' + r + ' v tabulce</a></p>',
      });
    }
    return json({ ok: true, id: id, podniku: tipy.pocet, hledaji: tipy.hledaji.length, inzeratu: tipy.inzeraty.length });
  } finally {
    lock.releaseLock();
  }
}

function uchazecOver(d) {
  const povinne = { jmeno: 'jméno', email: 'e-mail', lokalita: 'lokalita', obor: 'obor', profese: 'profese', uvazek: 'typ úvazku', souhlas: 'souhlas' };
  for (const k in povinne) if (!d[k] || (Array.isArray(d[k]) && !d[k].length)) return 'Chybí: ' + povinne[k] + '.';
  if (!platnyMail(d.email)) return 'E-mail nevypadá správně.';
  if (String(d.omne || '').length > UCFG.MAX_O_MNE) return 'Text „O mně“ je moc dlouhý (max. ' + UCFG.MAX_O_MNE + ' znaků).';
  if (d.mzda && !/^\d{1,7}$/.test(String(d.mzda))) return 'Mzdu napište jen číslem.';
  if (d.cv && d.cv.data) {
    if (!UCFG.CV_TYPY.includes(d.cv.typ)) return 'Životopis nahrajte jako PDF, Word nebo fotku (JPG, PNG).';
    if (d.cv.data.length * 0.75 > UCFG.MAX_CV_MB * 1024 * 1024) return 'Životopis je větší než ' + UCFG.MAX_CV_MB + ' MB.';
  }
  d.upozornit = d.upozornit ? 'ano' : 'ne';
  return '';
}

/* Životopis do soukromé složky na Disku správce (nesdílí se s nikým). */
function ulozCv(cv, id, jmeno) {
  const pripona = (String(cv.nazev || '').match(/\.([a-z0-9]{2,5})$/i) || [, 'pdf'])[1].toLowerCase();
  const nazev = id + ' – ' + String(jmeno || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) + '.' + pripona;
  const blob = Utilities.newBlob(Utilities.base64Decode(cv.data), cv.typ, nazev);
  const f = slozkaCv().createFile(blob);
  return { id: f.getId(), url: f.getUrl() };
}

function slozkaCv() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('SLOZKA_CV');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* složka smazaná, založí se znovu */ } }
  const f = DriveApp.createFolder(UCFG.SLOZKA);
  f.setDescription('Životopisy z formuláře Hledám práci na pracenaprimo.cz. Neveřejné, nesdílet. Mažou se po 12 měsících.');
  p.setProperty('SLOZKA_CV', f.getId());
  return f;
}

/* ---------------- tipy podle lokality a oboru ---------------- */

/* Z listu Podniky spočítá podniky oboru v lokalitě (u celého obvodu „@Praha 4“ ve všech jeho lokalitách),
   vybere ty, které hledají lidi, a z listu Inzeráty aktivní inzeráty. Všechno jsou veřejné údaje karet. */
function najdiTipy(lokalita, obor, profese) {
  const ss = SpreadsheetApp.getActive();
  const lokality = lokalitySeznam(lokalita);
  const out = { pocet: 0, hledaji: [], inzeraty: [], lokality: lokality, obvod: lokalita[0] === '@' ? lokalita.slice(1) : '' };
  const sh = ss.getSheetByName(CFG.LIST_POD);
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm);
  const col = (j) => { const n = norm(j); let i = head.indexOf(n); if (i < 0) i = head.findIndex(x => x.startsWith(n + ' ')); return i; };
  const iLok = col('Lokalita'), iObor = col('Obor'), iNaz = col('Název v aplikaci'), iNaz2 = col('Název podniku'),
    iAdr = col('Adresa'), iHl = col('Hledá lidi'), iDruh = col('Druh (pro statistiku)');
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
  const lokN = lokality.map(norm), oborN = norm(obor), jine = !OBORY_PODNIKU.includes(obor);
  vals.forEach(r => {
    if (!lokN.includes(norm(r[iLok]))) return;
    if (!jine && norm(r[iObor]) !== oborN) return;
    const nazev = String((iNaz >= 0 && r[iNaz]) || r[iNaz2] || '').trim();
    if (!nazev) return;
    out.pocet++;
    const hl = iHl >= 0 ? String(r[iHl] || '').trim() : '';
    if (hl) out.hledaji.push({ nazev: nazev, adresa: String(r[iAdr] || ''), pozice: hl.split('|')[0].trim(), druh: iDruh >= 0 ? String(r[iDruh] || '') : '' });
  });
  // podniky, které hledají profesi uchazeče, dopředu
  const p = norm(profese).split(/[ /]+/).filter(x => x.length > 3);
  out.hledaji.sort((a, b) => sedi(b, p) - sedi(a, p));

  const si = ss.getSheetByName(CFG.LIST_INZ);
  if (si && si.getLastRow() > 1) {
    const iv = si.getRange(2, 1, si.getLastRow() - 1, H.length).getValues();
    iv.forEach(r => {
      if (r[C['Stav'] - 1] !== STAV.AKTIVNI) return;
      if (!lokN.includes(norm(r[C['Lokalita'] - 1]))) return;
      if (!jine && norm(r[C['Obor'] - 1]) !== oborN) return;
      out.inzeraty.push({ pozice: String(r[C['Pozice'] - 1]), podnik: String(r[C['Podnik'] - 1]), adresa: String(r[C['Adresa'] - 1]) });
    });
  }
  return out;
}
const OBORY_PODNIKU = ['Gastronomie', 'Obchod', 'Služby', 'Doprava', 'Průmysl', 'Zdravotnictví'];
function sedi(x, slova) { const t = norm(x.pozice + ' ' + x.druh); return slova.some(s => t.includes(s.slice(0, -1))) ? 1 : 0; }

function podniku(n) { return n === 1 ? 'podnik' : n > 1 && n < 5 ? 'podniky' : 'podniků'; }
function lokalitaText(l) { l = String(l || ''); return l[0] === '@' ? l.slice(1) + ' (celý obvod)' : l; }

/* „Praha - Nusle“ → [„Praha - Nusle“]; „@Praha 4“ → všechny lokality obvodu Praha 4 z listu Lokality */
function lokalitySeznam(lokalita) {
  if (lokalita[0] !== '@') return [lokalita];
  const sh = SpreadsheetApp.getActive().getSheetByName('Lokality');
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  const obv = norm(lokalita.slice(1));
  return v.filter(r => r[0] && (norm(r[8]) === obv || norm(r[9]) === obv)).map(r => String(r[0]));
}

/* ---------------- e-mail s tipy ---------------- */

function posliTipy(d, id, token, t) {
  const kde = d.lokalita[0] === '@' ? d.lokalita.slice(1) : String(d.lokalita).replace(/^Praha\s*-\s*/, '');
  const jeObor = OBORY_PODNIKU.includes(d.obor);
  const odkaz = CFG.WEB + '/?lokalita=' + encodeURIComponent(d.lokalita) + (jeObor ? '&obor=' + encodeURIComponent(d.obor) : '') + '&zdroj=uchazec-email';
  const smazat = ScriptApp.getService().getUrl() + '?a=smazat-uchazece&id=' + encodeURIComponent(id) + '&t=' + token;
  const zelena = 'display:inline-block;background:#0F6B5C;color:#fff;padding:11px 18px;border-radius:10px;text-decoration:none;font-weight:600';
  const box = 'padding:12px 14px;background:#DCEFEA;border-radius:10px';
  const tel = String(d.telefon || '').trim() || '[telefon]';
  const sablona = sablonaOsloveni(d, tel);

  let html = '<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:620px">' +
    '<p>Dobrý den, ' + h(String(d.jmeno).split(' ')[0]) + ',</p>' +
    '<p>děkujeme, že jste se zapsal/a na <a href="' + CFG.WEB + '">pracenaprimo.cz</a>. Hledáte práci jako <b>' + h(d.profese) + '</b> v lokalitě <b>' + h(kde) + '</b>. ' +
    'Nejrychleji ji najdete, když podniky oslovíte sami, napřímo. Tady je návod.</p>';

  html += '<h3 style="color:#0F6B5C">1. Podniky ve vašem okolí</h3>';
  if (t.pocet) {
    html += '<p style="' + box + '">V lokalitě ' + h(kde) + ' máme <b>' + t.pocet + ' ' + podniku(t.pocet) + (jeObor ? ' v oboru ' + h(d.obor) : '') + '</b>' +
      (t.hledaji.length ? ', z toho <b>' + t.hledaji.length + (t.hledaji.length > 1 && t.hledaji.length < 5 ? ' právě hledají' : ' právě hledá') + ' lidi</b>' : '') + '.</p>';
  } else {
    html += '<p style="' + box + '">Ve vaší lokalitě zatím v oboru ' + h(d.obor) + ' žádné podniky nemáme. Zkuste na webu vybrat sousední čtvrť nebo celý obvod.</p>';
  }
  html += '<p><a href="' + odkaz + '" style="' + zelena + '">Ukázat podniky na webu</a></p>' +
    '<p style="color:#555;font-size:14px">Odkaz otevře web s vaší lokalitou a oborem. Nahoře si můžete vybrat druh podniku (např. kavárna, restaurace) a na mapě vidíte, co je blízko. Podniky s nápisem <b>Hledá lidi</b> berou nové lidi právě teď.</p>';

  if (t.inzeraty.length) {
    html += '<p><b>Aktivní inzeráty v okolí:</b></p><ul>' + t.inzeraty.slice(0, UCFG.PRIKLADU).map(x =>
      '<li><b>' + h(x.pozice) + '</b> – ' + h(x.podnik) + (x.adresa ? ', ' + h(x.adresa) : '') + '</li>').join('') + '</ul>';
  }
  if (t.hledaji.length) {
    html += '<p><b>Podniky, které hledají lidi:</b></p><ul>' + t.hledaji.slice(0, UCFG.PRIKLADU).map(x =>
      '<li><b>' + h(x.nazev) + '</b>' + (x.adresa ? ', ' + h(x.adresa) : '') + (x.pozice ? ' – hledá: ' + h(x.pozice) : '') + '</li>').join('') + '</ul>' +
      (t.hledaji.length > UCFG.PRIKLADU ? '<p style="color:#555;font-size:14px">… a dalších ' + (t.hledaji.length - UCFG.PRIKLADU) + ' na webu.</p>' : '');
  }

  html += '<h3 style="color:#0F6B5C">2. Jak podniky oslovit</h3><ol>' +
    '<li><b>Vyberte si 10 až 15 podniků</b>, kam byste chtěl/a chodit. Na webu je dejte do <b>Moje</b> (hvězdička). Uvidíte, komu jste už volal/a nebo psal/a.</li>' +
    '<li><b>Zavolejte</b> mimo špičku. V gastru mezi 14 a 16 hodinou, v obchodě dopoledne. Zeptejte se na provozního nebo vedoucího. Telefon je na každé kartě.</li>' +
    '<li><b>Napište e-mail</b> se životopisem. Na kartě podniku klikněte na <b>Napsat</b>: otevře se e-mail s hotovým textem a názvem podniku. Můžete ho nahradit textem níže.</li>' +
    '<li><b>Přijďte osobně</b>, čistě oblečený/á, s vytištěným životopisem. Malé podniky to mají rády.</li>' +
    '<li><b>Po týdnu se připomeňte.</b> Krátký telefonát nebo e-mail. Většina lidí najde práci až na druhý pokus.</li></ol>';

  html += '<p><b>Text e-mailu, který můžete použít</b> (přepište části v [hranatých závorkách]):</p>' +
    '<pre style="white-space:pre-wrap;font-family:inherit;' + box + '">' + h(sablona) + '</pre>' +
    '<p>Další hotové texty na telefon, osobní návštěvu a otázky na pohovor najdete v <a href="' + CFG.WEB + '/#navody">Návodech</a>.</p>';

  html += '<h3 style="color:#0F6B5C">3. Životopis</h3>' +
    (d.cv && d.cv.data ? '<p>Životopis jsme dostali. Přikládejte ho ke každému e-mailu podniku, my ho podnikům sami neposíláme.</p>'
      : '<p>Životopis nemáte? V <a href="' + CFG.WEB + '/#navody">Návodech</a> je postup, jak si ho za 10 minut zdarma udělat s pomocí AI. Stačí jedna strana.</p>');

  html += '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">' +
    '<p style="color:#666;font-size:13px">Vaše údaje' + (d.cv && d.cv.data ? ' i životopis' : '') + ' máme uložené neveřejně a nikomu je nepředáváme. ' +
    'Po 12 měsících je sami smažeme. Číslo přihlášky: ' + h(id) + '.<br>' +
    'Chcete je smazat hned? <a href="' + smazat + '" style="color:#666">Smazat moje údaje</a>. ' +
    'Zásady: <a href="' + CFG.WEB + '/ochrana-udaju/" style="color:#666">ochrana údajů</a>.<br>' +
    'Práce napřímo · Michal Mamula · ' + CFG.ADMIN + '</p></div>';

  MailApp.sendEmail({ to: d.email, replyTo: CFG.ADMIN, name: 'Práce napřímo', subject: 'Jak najít práci jako ' + d.profese + ' v lokalitě ' + kde, htmlBody: html });
}

/* Text oslovení podle oboru a profese, předvyplněný údaji uchazeče. [podnik] doplní tlačítko Napsat na webu. */
function sablonaOsloveni(d, tel) {
  const jm = String(d.jmeno).trim();
  const prof = String(d.profese).toLowerCase();
  const praxe = d.praxe && !/bez praxe/i.test(d.praxe) ? 'Mám ' + String(d.praxe).toLowerCase() + ' praxe, naposledy jako [poslední pozice] v [poslední podnik].'
    : 'Zatím nemám velkou praxi, ale učím se rychle a nebojím se práce.';
  const brig = /brigád|sezón/i.test(cist(d.uvazek)) && !/plný/i.test(cist(d.uvazek));
  if (brig) return 'Předmět: Brigáda – ' + prof + '\n\nDobrý den,\n\nnehledáte do [podnik] brigádníka? Jsem ' + jm + ', hledám brigádu jako ' + prof +
    ' a bydlím kousek od vás. Můžu [kdy – např. pátek až neděle].\n\n' + praxe + '\n\nTelefon: ' + tel + '. Děkuji za odpověď.\n\n' + jm;
  return 'Předmět: ' + d.profese + ' – hledáte posilu?\n\nDobrý den,\n\nnehledáte do [podnik] posilu? Jmenuji se ' + jm + ', hledám práci jako ' + prof +
    ' a bydlím kousek od vás.\n\n' + praxe + '\n\nŽivotopis posílám v příloze. Rád/a se zastavím osobně, stačí napsat nebo zavolat na ' + tel +
    '.\n\nDěkuji a přeji hezký den\n' + jm;
}

/* ---------------- smazání z odkazu v e-mailu ---------------- */

function uchazecSmazatOdkaz(p) {
  const sh = listUchazeci();
  const r = najdiRadek(sh, p.id);
  if (!r) return stranka('Údaje už jsou smazané', 'Přihlášku jsme nenašli. Nejspíš už je smazaná.');
  const v = sh.getRange(r, 1, 1, UH.length).getValues()[0];
  if (v[UC['Token'] - 1] !== p.t) return stranka('Neplatný odkaz', 'Odkaz nesouhlasí. Zkopírujte ho z e-mailu celý, nebo nám napište na ' + CFG.ADMIN + '.');
  smazRadekUchazece(sh, r, v);
  return stranka('Údaje jsou smazané', 'Vaši přihlášku' + (v[UC['ID souboru'] - 1] ? ' i životopis' : '') + ' jsme smazali. Kdykoli se můžete zapsat znovu.');
}

function smazRadekUchazece(sh, r, v) {
  const fid = v[UC['ID souboru'] - 1];
  if (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) { /* soubor už neexistuje */ } }
  sh.deleteRow(r);
}

/* ---------------- správa v tabulce ---------------- */

/* Volá se z onOpen v inzeraty.gs */
function uchazeciMenu() {
  SpreadsheetApp.getUi().createMenu('Uchazeči')
    .addItem('Smazat vybraného uchazeče (i životopis)', 'smazatVybranehoUchazece')
    .addSeparator()
    .addItem('Připravit list Uchazeči a složku životopisů', 'nastavitUchazece')
    .addToUi();
}

function smazatVybranehoUchazece() {
  const ui = SpreadsheetApp.getUi();
  const sh = SpreadsheetApp.getActiveSheet();
  const r = sh.getActiveRange() && sh.getActiveRange().getRow();
  if (sh.getName() !== UCFG.LIST || !r || r < 2) return ui.alert('Otevři list „' + UCFG.LIST + '“ a klikni do řádku uchazeče.');
  const v = sh.getRange(r, 1, 1, UH.length).getValues()[0];
  if (ui.alert('Smazat uchazeče ' + v[UC['Jméno'] - 1] + ' (' + v[0] + ') včetně životopisu? Nejde to vrátit.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  smazRadekUchazece(sh, r, v);
  SpreadsheetApp.getActive().toast('Uchazeč ' + v[0] + ' je smazaný.');
}

/* Denně: uchazeči po datu „Smazat po“ se smažou i s životopisem */
function uchazeciDenne() {
  const sh = listUchazeci();
  if (sh.getLastRow() < 2) return;
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, UH.length).getValues(), now = new Date();
  for (let i = v.length - 1; i >= 0; i--) {
    const d = v[i][UC['Smazat po'] - 1];
    if (d instanceof Date && d < now) smazRadekUchazece(sh, i + 2, v[i]);
  }
}

/* Jednorázově: list s hlavičkou, složka na životopisy, denní mazání. Spustit ručně v editoru. */
function nastavitUchazece() {
  const sh = listUchazeci();
  sh.getRange(1, 1, 1, UH.length).setValues([UH]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange(2, UC['Stav'], sh.getMaxRows() - 1, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(Object.values(USTAV), true).build());
  sh.getRange(2, UC['Vytvořeno'], sh.getMaxRows() - 1, 1).setNumberFormat('d. M. yyyy H:mm');
  sh.getRange(2, UC['Smazat po'], sh.getMaxRows() - 1, 1).setNumberFormat('d. M. yyyy');
  slozkaCv();
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'uchazeciDenne'))
    ScriptApp.newTrigger('uchazeciDenne').timeBased().everyDays(1).atHour(4).inTimezone('Europe/Prague').create();
  try { SpreadsheetApp.getActive().toast('List Uchazeči a složka na životopisy jsou připravené.'); } catch (e) { }
}

function listUchazeci() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(UCFG.LIST);
  if (!sh) { sh = ss.insertSheet(UCFG.LIST); sh.getRange(1, 1, 1, UH.length).setValues([UH]).setFontWeight('bold'); sh.setFrozenRows(1); }
  return sh;
}
