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


V9 Sicherheit / Reset-Code
--------------------------
- Noah und Timo haben jeweils einen eigenen Reset-Code.
- Der Code wird unter Setup > Login & Sicherheit als "Dein persönlicher Reset-Code" geändert.
- Wenn Noah seinen Code ändert, ändert sich Timos Code nicht.
- Standard-Codes bei ganz neuem Portal:
  - Noah: Noah-Reset-2026
  - Timo: Timo-Reset-2026
- JSON Backup = komplette lokale Sicherung der Portal-Daten auf diesem Gerät.
- Backup importieren und Lokale Daten löschen verlangen Face ID/Touch ID oder Passwortbestätigung.


V10 Workflow-Klarstellung
-------------------------
- Kundenliste zeigt Kunden jetzt direkt alphabetisch; keine extra Taste nötig.
- Leads sind durchsuchbar nach Name, Ort, Telefon und Lumian-Nr.
- Jobs können aus bestehendem Lead/Kunden erstellt werden: im Job-Dialog oben Name oder LM-Nr. suchen und auswählen.
- + Job erstellen ohne Auswahl erstellt eine neue Person als Lead; Kunde wird sie erst bei Erledigt/Bezahlt.
- Kunden können zusätzlich manuell erfasst oder per CSV importiert werden.
- WhatsApp-Buttons erscheinen nur für Schweizer Mobilnummern. Wenn die Nummer nicht bei WhatsApp registriert ist, zeigt WhatsApp trotzdem eine Meldung; das kann die App nicht vorher prüfen. Für nicht-mobile Nummern bleibt Anrufen/SMS.


V11 Buchhaltung
---------------
- Neuer Tab "Buchhaltung".
- Erledigte/bezahlte Jobs werden automatisch als Einnahmen gerechnet.
- Manuelle Einnahmen können mit Zeitraum von/bis ergänzt werden, z.B. bisherige Einnahmen vor Portal-Nutzung.
- Ausgaben können mit Datum, Kategorie, Bezeichnung und Betrag erfasst werden.
- Übersicht pro Woche, Monat, Jahr oder eigenem Zeitraum.
- Einfache Grafik für Einnahmen, Ausgaben und groben Gewinn.
- Kundenaktivität zeigt Job-Anzahl, Umsatz im Zeitraum und Kunden, bei denen man nachfassen kann.
- Buchhaltung kann als Excel-kompatible CSV exportiert werden.


V12 Benutzerrechte & Buchhaltung Bearbeitung
--------------------------------------------
- Noah und Timo sind Admins.
- Neue Mitarbeiter können unter Setup > Benutzer & Rechte erstellt werden.
- Mitarbeiter sehen nur Übersicht, Leads, Jobs und Kunden.
- Buchhaltung, Bonus, Google/Drive, Backup und globale Einstellungen bleiben Admins vorbehalten.
- Bei Jobs kann "Zuständig" nun aus allen aktiven Benutzern gewählt werden.
- In der Buchhaltung wird angezeigt, wer einen manuellen Einnahmen- oder Ausgabeneintrag erstellt hat.
- Manuelle Einnahmen und Ausgaben können nachträglich bearbeitet oder gelöscht werden.
- Bearbeiten/Löschen ist nur für den Ersteller möglich und verlangt Face ID/Touch ID oder Passwortbestätigung.
- Die Jahresansicht ist im Zeitraum-Filter "Dieses Jahr" enthalten.


V13 Responsiveness + Portal App Icon
------------------------------------
- Portal-only home-screen icon updated to the 3D LS Portal icon.
- Public website favicon/app icon is not changed.
- Portal manifest now starts at /portal/?v=13 to reduce old icon/cache issues.
- Responsive layout improved for iPhone, Android, tablet, and laptop:
  - horizontal safe navigation for many tabs
  - better bottom navigation on mobile
  - better forms/cards/buttons on small screens
  - finance/accounting layout improved on desktop and mobile


V14 Final polish
----------------
- Portal logo, portal favicon and home-screen icon now use the uploaded LS PORTAL icon.
- Leads now use WhatsApp instead of SMS.
- Buchhaltung cards show clearer creator/responsible info.
- Setup / Login & Sicherheit spacing and paddings improved.
- Additional overall polish for portal feel and responsiveness.
