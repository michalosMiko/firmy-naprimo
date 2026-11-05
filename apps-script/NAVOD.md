# Pracovní inzeráty: nasazení skriptu (fáze 1)

Skript `inzeraty.gs` přijímá inzeráty z formuláře na webu, posílá potvrzovací e-mail podniku a přidává do neveřejné tabulky menu **Inzeráty** pro schvalování. Nasazení zabere asi 10 minut a dělá se jednou.

## 1. Vložit skript do neveřejné tabulky

1. Otevři **neveřejnou** tabulku (ta s listem Podniky).
2. Menu **Rozšíření → Apps Script**.
3. Vlevo nahoře přejmenuj projekt na `Inzeráty`.
4. V souboru `Kód.gs` smaž vše a vlož celý obsah souboru `apps-script/inzeraty.gs`.
5. Ulož (ikona diskety nebo Ctrl+S).

## 2. Připravit list a povolit přístup

1. Nahoře vyber funkci **nastavit** a klikni na **Spustit**.
2. Google se zeptá na oprávnění. Klikni na **Zkontrolovat oprávnění**, vyber svůj účet,
   pak **Rozšířené → Přejít na Inzeráty (nebezpečné)** a **Povolit**.
   (Varování se ukazuje u každého vlastního skriptu. Skript běží jen pod tvým účtem.)
3. V tabulce vznikne list **Inzeráty** s hlavičkou a každou noc ve 3:00 se spustí kontrola, která vypršelé inzeráty přepne na „vypršelo“.

## 3. Zveřejnit skript jako webovou aplikaci

1. Vpravo nahoře **Nasadit → Nová implementace**.
2. U „Vyberte typ“ (ozubené kolo) zvol **Webová aplikace**.
3. Popis: `Inzeráty v1`. **Spustit jako: Já**. **Kdo má přístup: Kdokoli**.
4. **Nasadit** a zkopíruj **URL webové aplikace** (končí `/exec`).
5. Pošli mi tu adresu. Doplním ji do webu (`INZERAT_URL` v `index.html`) a tlačítko „Přidat pracovní inzerát“ se objeví na kartách.

## Jak se pak inzeráty schvalují

Po znovunačtení tabulky přibude nahoře menu **Inzeráty**.

| Stav | Co to znamená | Co uděláš |
| --- | --- | --- |
| čeká na e-mail | podnik dostal potvrzovací odkaz | nic, čekáš |
| ověřit telefonem | podnik nemá e-mail v databázi (nebo nebyl nalezen) | zavoláš na telefon z karty, pak **Schválit** |
| potvrzeno | podnik klikl na odkaz, přišel ti e-mail | zkontroluješ text, pak **Schválit** |
| aktivní | inzerát platí do data ve sloupci „Platí do“ | nic |
| zamítnuto / staženo / vypršelo | inzerát se nezobrazuje | nic |

Schválení: klikni do řádku inzerátu v listu Inzeráty → **Inzeráty → Schválit vybraný inzerát**. Skript doplní datum zveřejnění a platnosti a pošle podniku e-mail, že je inzerát venku.

Ve fázi 1 se aktivní inzeráty na webu ještě neukazují. Zobrazení na kartě a stránku Inzeráty přidá fáze 2.

## Dobré vědět

- **Limit e-mailů:** běžný Gmail pošle ze skriptu asi 100 e-mailů denně. Na začátek to stačí.
- **Ochrana:** jeden podnik smí mít nejvýš 5 rozpracovaných a aktivních inzerátů a celkem přijde nejvýš 30 inzerátů za hodinu. Obojí jde změnit nahoře ve skriptu v `CFG`.
- **Úprava skriptu:** po změně kódu dej **Nasadit → Spravovat implementace → tužka → Verze: Nová verze → Nasadit**. Adresa `/exec` zůstane stejná.
- **Test:** na webu otevři kartu podniku bez e-mailu a pošli zkušební inzerát. Měl by ti přijít e-mail „Inzerát k ověření telefonem“. Pak ho v tabulce **Zamítni**.
