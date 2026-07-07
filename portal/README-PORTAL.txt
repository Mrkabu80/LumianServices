Lumian Portal v6 — SEO + internes Portal
=========================================

URL nach Upload:
https://www.lumianservices.ch/portal/

Wichtig:
- Das öffentliche SEO der Lumian Website bleibt enthalten.
- Das Portal ist in robots.txt blockiert und hat noindex/nofollow.
- Es ist eine einfache statische Web-App für GitHub Pages.
- Login/Passwort schützen lokal auf dem Gerät, sind aber keine echte Server-Security.
- Für echte Sicherheit später: Cloudflare Access, Firebase/Supabase Login oder Google Login.

Neu in v6:
- Dark Theme wieder verbessert, näher an der besseren früheren Version.
- Login-Screen nutzt das originale Lumian Logo auf hellem Logo-Feld.
- Desktop/Web-Ansicht verbessert: Tabs, Buttons, Importbereiche und Karten sind besser nutzbar.
- Mobile-App-Ansicht bleibt optimiert.
- Kunden-Import ergänzt.
- Lead-Import ergänzt.
- Excel-kompatible CSV-Vorlagen direkt im Portal herunterladbar.
- Import ist unter Leads, Kunden und Setup verfügbar.
- Bei Import ohne Lumian-Nr. wird automatisch LM1001, LM1002 usw. generiert.
- Wenn eine Lumian-Nr. in der Importdatei steht, wird sie übernommen, sofern sie frei ist oder aktualisiert den bestehenden Datensatz.
- Schweizer Telefonnummern und E-Mail-Adressen werden beim Import geprüft.

Ablauf im Portal:
- Lead = Anfrage, noch kein bestätigter Auftrag.
- Job = Termin, Besichtigung oder Reinigung ist geplant/bestätigt.
- Kunde = automatisch nach erledigtem oder bezahltem Job.
- Auch ein direkt erstellter Job erzeugt zuerst eine Person mit Lumian-Nr.; solange der Job nicht erledigt/bezahlt ist, bleibt sie als Lead/Kontakt geführt.

Import Kunden:
1. Portal -> Kunden -> Vorlage herunterladen.
2. Datei in Excel oder Numbers öffnen.
3. Kunden einfüllen.
4. Als CSV speichern.
5. Portal -> Kunden importieren.

Kunden-Spalten:
LumianNr; Name; Telefon; Email; Adresse; Ort; Quelle; EmpfohlenVon; KundeSeit; Notizen

Import Leads:
1. Portal -> Leads -> Vorlage herunterladen.
2. Leads einfüllen.
3. Als CSV speichern.
4. Portal -> Leads importieren.

Lead-Spalten:
Name; Telefon; Email; Adresse; Ort; Service; Quelle; Betrag; Termin; EmpfohlenVon; Notizen

Google Sheet/Drive Setup:
1. Google Sheet erstellen, z.B. "Lumian Portal".
2. Extensions / Erweiterungen -> Apps Script.
3. Inhalt aus /portal/GOOGLE-APPS-SCRIPT.gs komplett einfügen.
4. Deploy -> New deployment -> Web App.
5. Execute as: Me.
6. Access: Anyone with the link.
7. Web App URL kopieren.
8. Im Portal -> Setup -> Google Apps Script Web App URL einfügen.
9. Optional Google Drive Ordner erstellen und Folder ID einfügen.
10. Auf Noah/Timo Handy: Sync senden / Cloud laden nutzen.

Empfehlungssystem:
- Jede Person bekommt sofort eine Lumian-Nr.
- Diese Lumian-Nr. ist später auch der Empfehlungs-Code.
- Empfehlungslink wird automatisch erzeugt:
  https://www.lumianservices.ch/?ref=LM1001#booking
- Bonusbetrag und Mindestauftrag sind im Setup änderbar.
- WhatsApp-Texte sind im Setup komplett anpassbar.

Passwort vergessen:
- Im Login auf "Passwort vergessen?" klicken.
- Benutzer wählen.
- Reset-Code eingeben.
- Neues Passwort setzen.
- Den Reset-Code kann man im Setup ändern.

Biometrie:
- Erst normal einloggen.
- Setup -> "Face ID / Touch ID auf diesem Gerät aktivieren".
- Danach kann der Benutzer auf diesem Gerät mit Biometrie entsperren.
- Es funktioniert nur unter HTTPS und nicht in jedem Browser gleich gut.


v8 Hinweis: Nach Upload alte Portal-App vom Home-Screen löschen und neu hinzufügen. Falls altes Design bleibt: Safari/Chrome Cache leeren oder einmal /portal/?v=8 öffnen.
