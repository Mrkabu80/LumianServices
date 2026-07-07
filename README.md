# Lumian Services Website – Version 2.1

Diese Version basiert auf Version 2 und behält deren Farben, Background und Stil. Angepasst wurden nur die Punkte:

- grosser Logo-Hero oben statt Before/After-Bild
- auf Mobile kommt der Logo-Hero zuerst
- Story mit Noah und Timo und gemeinsamen Sprach-Tags
- Referral / Lumian Surprise deutlich prominenter und emotionaler
- Galerie als automatischer Slider
- saubere Ordnerstruktur für Galerie-Bilder
- Buchungsbereich ohne Online-Payment, mit WhatsApp-Anfrage und vorbereiteter Calendar-Option
- Impressum, Datenschutz und Buchungshinweise als separate Seiten

## Upload auf GitHub Pages

Den Inhalt dieses Ordners direkt in das GitHub Repository hochladen. Nicht den Ordner selbst und nicht nur die ZIP-Datei hochladen.

Wichtige Dateien:

- `index.html` – Startseite
- `styles.css` – Design
- `script.js` – Navigation, Buchungsformular, Galerie
- `assets/js/gallery-data.js` – Liste der Galerie-Bilder
- `impressum.html` – Impressum
- `datenschutz.html` – Datenschutz
- `buchung.html` – Buchungshinweise

## Rechtliche Platzhalter ersetzen

Vor Veröffentlichung bitte in diesen Dateien die Platzhalter ersetzen:

- `impressum.html`
- `datenschutz.html`
- `buchung.html` falls nötig

Suchen nach:

`Lumian Services`

`Wilhalde 8A, 5504 Othmarsingen, Schweiz`

## Cal.com oder Calendly einbinden

In `index.html` diese Stelle suchen:

```html
<div class="slot-box" data-calendar-url="">
```

Dann den Link einfügen, zum Beispiel:

```html
<div class="slot-box" data-calendar-url="https://cal.com/lumian-services/quick-check">
```

oder:

```html
<div class="slot-box" data-calendar-url="https://calendly.com/lumian-services/quick-check">
```

Sobald dort ein Link steht, öffnet der Button automatisch den Online-Kalender.

## Neue Bilder in der Galerie hinzufügen

1. Neues Bild in den Ordner hochladen:

`assets/img/gallery/`

2. Danach in `assets/js/gallery-data.js` einen neuen Eintrag ergänzen:

```js
{
  src: 'assets/img/gallery/08-neues-bild.jpg',
  title: 'Fensterreinigung',
  caption: 'Kurze Beschreibung des Bildes.'
}
```

Hinweis: GitHub Pages ist statisch. Ein Browser kann den Galerie-Ordner nicht automatisch auslesen. Deshalb ist die kleine Liste in `gallery-data.js` nötig.

## Telefon / WhatsApp

Aktuell gesetzt:

`+41 77 279 47 07`

WhatsApp-Link:

`41772794707`


Rechtliches aktualisiert:
- Impressum enthält Lumian Services, Inhaber Fares Aburok, Einzelunternehmen.
- Adresse steht im Impressum, nicht im Footer.
- Datenschutz verweist auf das Impressum und enthält die Kontakt-E-Mail.


v43: Fixed Google Apps Script syntax error caused by broken newline in join('\n') and added getOrCreateSheet_ helper.


## v73
- Ensured GOOGLE-APPS-SCRIPT.gs is syntactically complete at runSyncTest_.
- Calendar/Drive sync test function closes correctly and can be deployed in Apps Script.
