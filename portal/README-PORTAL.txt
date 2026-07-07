Lumian Portal v5 — einfache interne Handy-App
==============================================

URL nach Upload:
https://www.lumianservices.ch/portal/

Wichtig:
- Das Portal ist in robots.txt blockiert und hat noindex/nofollow.
- Es ist eine einfache statische Web-App für GitHub Pages.
- Login/Passwort schützen lokal auf dem Gerät, sind aber keine echte Server-Security.
- Für echte Sicherheit später: Cloudflare Access, Firebase/Supabase Login oder Google Login.

Was neu ist in v5:
- Separates Portal-App-Icon und eigener PWA-Start unter /portal/.
- Button "Als App speichern" mit iPhone/Android Anleitung.
- Noah und Timo setzen beim ersten Login ihr eigenes Passwort.
- Passwortänderung im Setup.
- Passwort vergessen über Reset-Code im Setup.
- Face ID / Touch ID / Passkey kann pro Gerät im Setup aktiviert werden, wenn Browser und Handy es unterstützen.
- Leads, Jobs und Kunden sind klar getrennt:
  Lead = Anfrage.
  Job = geplanter/bestätigter Termin oder Auftrag.
  Kunde = automatisch nach erledigtem oder bezahltem Job.
- Bei Lead oder direktem Job wird sofort eine Lumian-Nr. erstellt, z.B. LM1001.
- Wenn ein direkter Job noch nicht erledigt ist, bleibt die Person als Lead/Kontakt geführt.
- Telefonnummern werden auf Schweizer Format geprüft.
- WhatsApp nutzt automatisch +41 ohne die erste 0.
- Wenn keine Telefonnummer vorhanden ist, erscheinen keine Anruf-/WhatsApp-Buttons.
- E-Mail-Felder werden validiert.
- "Reminder an Kunden" ist klar als Kunden-WhatsApp bezeichnet.
- Kalender-Button erzeugt eine .ics Datei für Apple/Google Kalender.
- Vorher/Nachher Fotos werden im Browser komprimiert.
- Mit Google Apps Script + Drive Folder ID werden Fotos beim Sync in Google Drive gespeichert.

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
