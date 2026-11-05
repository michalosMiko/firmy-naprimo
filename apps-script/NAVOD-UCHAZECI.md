# Hledám práci: nasazení formuláře pro uchazeče

Formulář „Hledám práci“ posílá přihlášky do stejného skriptu jako inzeráty. Skript uloží uchazeče do neveřejného listu **Uchazeči**, životopis do soukromé složky na tvém Disku a uchazeči hned pošle e-mail s podniky v jeho lokalitě a návodem, jak je oslovit. Nasazení zabere asi 5 minut.

List **Uchazeči** s hlavičkou už v neveřejné tabulce je (založil ho Claude).

## 1. Přidat soubor do skriptu

1. Otevři **neveřejnou** tabulku → **Rozšíření → Apps Script**.
2. V souboru `Kód.gs` nahraď obsah novou verzí `apps-script/inzeraty.gs` (ta obsahuje i napojení na uchazeče).
3. Vlevo u **Soubory** klikni na **+** → **Skript** a pojmenuj ho `uchazeci`.
4. Smaž v něm vše a vlož celý obsah souboru `apps-script/uchazeci.gs`. Ulož (Ctrl+S).

## 2. Povolit Disk a připravit složku

1. Nahoře vyber funkci **nastavitUchazece** a klikni na **Spustit**.
2. Google se znovu zeptá na oprávnění, protože skript teď ukládá životopisy na Disk.
   Postup je stejný jako minule: **Zkontrolovat oprávnění** → účet → **Rozšířené → Přejít na … (nebezpečné)** → **Vybrat vše** → **Pokračovat**.
3. Dole se objeví „Provádění bylo dokončeno“. Na Disku teď máš složku **Práce napřímo – životopisy (neveřejné)**. Nikomu ji nesdílej.

## 3. Nová verze webové aplikace

1. **Implementovat → Spravovat implementace**.
2. Klikni na **tužku**, u **Verze** vyber **Nová verze** a dej **Implementovat**.
3. Adresa `/exec` zůstává stejná, na webu se nic nemění.

Napiš pak Claudovi „skript je nasazený“. Zapne formulář na webu (`UCHAZEC_ZAPNUTO = true` v `index.html`) a pošleš si zkušební přihlášku na svůj e-mail.

## Jak to pak funguje

- Na webu se v režimu **Hledám práci** pod seznamem podniků a v **Návodech** ukáže pozvánka **Zapsat se**. Formulář jde otevřít i přímo odkazem `https://pracenaprimo.cz/#hledam-praci` (hodí se na letáky nebo sociální sítě).
- Uchazeči hned přijde e-mail „Jak najít práci jako … v lokalitě …“: kolik podniků jeho oboru v lokalitě máme, které hledají lidi, aktivní inzeráty, tlačítko na web s jeho lokalitou a oborem, 5 kroků jak podniky oslovit a hotový text e-mailu s jeho jménem a telefonem.
- Tobě přijde krátké upozornění „Nový uchazeč“ s odkazem na řádek. Vypnout jde v `UCFG.UPOZORNIT_SPRAVCE` nahoře v `uchazeci.gs`.
- Ve sloupci **Stav** si můžeš značit: nový / kontaktován / našel práci / neaktivní.

## Ochrana údajů

- Údaje a životopisy jsou jen v neveřejné tabulce a na tvém Disku. Do veřejné tabulky nic nejde.
- Po 12 měsících se řádek i životopis samy smažou (kontrola každou noc ve 4:00).
- Uchazeč může údaje smazat hned odkazem v e-mailu. Když o smazání požádá e-mailem: klikni do jeho řádku a dej menu **Uchazeči → Smazat vybraného uchazeče (i životopis)**.
- Zásady ochrany údajů mají nový bod 9 „Hledám práci“.

## Dobré vědět

- **Limit e-mailů:** Gmail pošle ze skriptu asi 100 e-mailů denně a inzeráty i uchazeči ho sdílejí. Každý uchazeč = 2 e-maily (jemu a tobě). Když jich bude hodně, vypni upozornění pro sebe.
- **Ochrana:** nejvýš 40 přihlášek za hodinu, ze stejného e-mailu nejvýš jedna za 6 hodin. Životopis nejvýš 5 MB (PDF, Word, JPG, PNG).
- Zaškrtávátko „Pošlete mi e-mail, když se objeví inzerát“ se zatím jen ukládá. Rozesílání přidáme s fází 2 inzerátů.
