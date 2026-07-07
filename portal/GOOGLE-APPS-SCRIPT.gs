/**
 * Lumian Services Mini-CRM backend for Google Sheets + Google Drive.
 *
 * Setup:
 * 1) Create a Google Sheet named "Lumian Portal".
 * 2) Extensions -> Apps Script.
 * 3) Paste this whole file.
 * 4) Deploy -> New deployment -> Web app.
 * Execute as: Me
 * Who has access: Anyone with the link
 * 5) Copy the Web App URL into Lumian Portal -> Einstellungen.
 * 6) Create/paste a Google Drive folder ID for photos in the portal settings.
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'websiteLead') return saveWebsiteLead_(payload.lead || {});
    if (payload.action === 'resetAll') return resetAll_(payload.confirm || '');
    if (payload.action !== 'syncFull') return json_({ ok: false, error: 'Unknown action' });

    var state = payload.state || {};
    var settings = state.settings || {};
    var folderId = settings.driveFolderId || '1LByFV1zXcBrfbgGV1BjbAwKAcRBEJKQr';
    var photoFolder = null;
    state.photoSyncLog = [];

    if (folderId) {
      try {
        photoFolder = DriveApp.getFolderById(folderId);
        state.photoSyncLog.push(['', '', '', '', 'Drive Hauptordner OK: ' + photoFolder.getName(), new Date().toISOString()]);
      } catch (driveErr) {
        state.photoSyncLog.push(['', '', '', '', 'Drive Fehler: Ordner nicht gefunden oder keine Berechtigung für ID ' + folderId + ' · ' + String(driveErr), new Date().toISOString()]);
      }
    } else {
      state.photoSyncLog.push(['', '', '', '', 'Kein Drive Folder ID in Einstellungen gesetzt.', new Date().toISOString()]);
    }

    if (photoFolder && state.jobs) {
      state.jobs = state.jobs.map(function(job) {
        try {
          job.beforePhoto = savePhoto_(photoFolder, state, job, job.beforePhoto, 'before');
        } catch (beforeErr) {
          job.beforePhoto = markPhotoError_(job.beforePhoto, beforeErr);
          state.photoSyncLog.push([job.id || '', job.personId || '', 'before', '', 'Fehler: ' + String(beforeErr), new Date().toISOString()]);
        }
        try {
          job.afterPhoto = savePhoto_(photoFolder, state, job, job.afterPhoto, 'after');
        } catch (afterErr) {
          job.afterPhoto = markPhotoError_(job.afterPhoto, afterErr);
          state.photoSyncLog.push([job.id || '', job.personId || '', 'after', '', 'Fehler: ' + String(afterErr), new Date().toISOString()]);
        }
        return job;
      });
    }

    // Calendar sync must still run even when Drive fails.
    syncCalendar_(state, settings);

    writeSheets_(state);
    saveState_(state, photoFolder);
    return json_({ ok: true, savedAt: new Date().toISOString(), photoSyncLog: state.photoSyncLog || [], calendarSyncLog: state.calendarSyncLog || [] });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}



function emptyState_() {
  var now = new Date().toISOString();
  return {
    version: 8,
    createdAt: now,
    updatedAt: now,
    users: [],
    settings: {},
    counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 },
    people: [],
    leads: [],
    jobs: [],
    rewards: [],
    finance: { manualIncome: [], expenses: [] },
    audit: []
  };
}

function resetAll_(confirmText) {
  if (confirmText !== 'RESET-LUMIAN-PORTAL') {
    return json_({ ok: false, error: 'Reset confirmation missing' });
  }
  var state = emptyState_();
  writeSheets_(state);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var website = getOrCreateSheet_(ss, 'Website Leads', [
    'websiteLeadKey','createdAt','leadId','lumianNr','name','phone','Strasse/Nr','PLZ/Ort','service','desiredDate','referral','message','source','status'
  ]);
  website.clearContents();
  website.appendRow(['websiteLeadKey','createdAt','leadId','lumianNr','name','phone','Strasse/Nr','PLZ/Ort','service','desiredDate','referral','message','source','status']);

  PropertiesService.getScriptProperties().setProperty('LUMIAN_STATE', JSON.stringify(state));
  return json_({ ok: true, resetAt: new Date().toISOString() });
}


function normalizeAppointmentInput_(value) {
  var raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw + 'T09:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
  return '';
}

function saveWebsiteLead_(lead) {
  var now = lead.createdAt || new Date().toISOString();
  var state = loadState_() || {
    version: 8,
    createdAt: now,
    updatedAt: now,
    users: [],
    settings: {},
    counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 },
    people: [],
    leads: [],
    jobs: [],
    rewards: [],
    finance: { manualIncome: [], expenses: [] },
    audit: []
  };

  state.counters = state.counters || {};
  state.counters.nextPerson = state.counters.nextPerson || 1001;
  state.counters.nextLead = state.counters.nextLead || 1;
  state.people = state.people || [];
  state.leads = state.leads || [];
  state.jobs = state.jobs || [];
  state.rewards = state.rewards || [];
  state.finance = state.finance || { manualIncome: [], expenses: [] };
  state.audit = state.audit || [];

  var key = String(lead.websiteLeadKey || '').trim();
  if (key && state.leads.some(function(l) { return l.websiteLeadKey === key; })) {
    return json_({ ok: true, duplicate: true, savedAt: new Date().toISOString() });
  }

  var referral = cleanCode_(lead.referral || '');
  var personId = 'LM' + (state.counters.nextPerson++);
  var leadId = 'L' + String(state.counters.nextLead++).padStart(4, '0');
  var source = referral ? 'Website Empfehlung' : 'Website Anfrage';

  var person = {
    id: personId,
    status: 'lead',
    name: lead.name || '',
    phone: lead.phone || '',
    email: '',
    address: lead.address || lead.place || '',
    place: lead.place || '',
    source: source,
    referredById: referral,
    createdAt: now,
    createdBy: 'website',
    customerSince: ''
  };

  var notes = [
    lead.desiredDate ? ('Wunsch-Termin: ' + lead.desiredDate) : '',
    lead.message ? ('Beschreibung: ' + lead.message) : ''
  ].filter(Boolean).join('\n');

  var leadObj = {
    id: leadId,
    personId: personId,
    service: lead.service || '',
    source: source,
    expectedValue: '',
    appointmentAt: normalizeAppointmentInput_(lead.desiredDate || ''),
    referredById: referral,
    status: 'Offen',
    createdAt: now,
    createdBy: 'website',
    notes: notes,
    websiteLeadKey: key
  };

  state.people.push(person);
  state.leads.push(leadObj);
  state.audit.push({ at: now, by: 'website', reason: 'website lead created ' + leadId });
  state.updatedAt = new Date().toISOString();

  writeSheets_(state);
  saveState_(state, null);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = getOrCreateSheet_(ss, 'Website Leads', [
    'websiteLeadKey','createdAt','leadId','lumianNr','name','phone','address','place','service','desiredDate','referral','message','source','status'
  ]);
  sheet.appendRow([
    key, now, leadId, personId, lead.name || '', lead.phone || '', lead.address || '', lead.place || '', lead.service || '',
    lead.desiredDate || '', referral, lead.message || '', source, 'Offen'
  ]);

  return json_({ ok: true, leadId: leadId, personId: personId, savedAt: new Date().toISOString() });
}

function cleanCode_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}


function doGet(e) {
  var action = (e.parameter.action || '').toLowerCase();
  var callback = e.parameter.callback || 'callback';
  if (action === 'load') {
    var state = loadState_();
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify({ ok: true, state: state }) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (action === 'websiteleads') {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify({ ok: true, leads: readWebsiteLeads_() }) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_({ ok: true, message: 'Lumian Portal backend is running.' });
}



function normalizeWebsiteLeadRow_(obj) {
  obj.address = obj.address || obj['Strasse/Nr'] || obj['StrasseNr'] || obj['Adresse'] || '';
  obj.place = obj.place || obj['PLZ/Ort'] || obj['PLZOrt'] || obj['Ort'] || '';
  return obj;
}

function readWebsiteLeads_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Website Leads');
  if (!sheet) return [];
  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) return [];
  var headers = values[0].map(function(h) { return String(h || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return String(cell || '').trim() !== ''; });
  }).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i] instanceof Date ? row[i].toISOString() : row[i]; });
    return normalizeWebsiteLeadRow_(obj);
  });
}

function savePhoto_(rootFolder, state, job, photo, type) {
  if (!photo) return photo;
  if (photo.url && !photo.dataUrl) return photo;
  if (!photo.dataUrl) return photo;

  var match = String(photo.dataUrl).match(/^data:(image\/[-+a-z0-9.]+);base64,(.+)$/i);
  if (!match) return photo;

  var customerFolder = getOrCreateCustomerFolder_(rootFolder, state, job);
  var ext = match[1].split('/')[1] || 'jpg';
  ext = ext.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (ext === 'jpeg' || !ext) ext = 'jpg';

  var safeJobId = sanitizeDriveName_(job.id || 'job');
  var filename = safeJobId + '_' + type + '.' + ext;
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, match[1], filename);

  var existing = customerFolder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var file = customerFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  if (state.photoSyncLog) state.photoSyncLog.push([job.id || '', job.personId || '', type, filename, 'gespeichert in ' + customerFolder.getName(), new Date().toISOString()]);

  return {
    type: type,
    name: filename,
    url: 'https://drive.google.com/uc?export=view&id=' + file.getId(),
    driveUrl: file.getUrl(),
    fileId: file.getId(),
    folderName: customerFolder.getName(),
    folderId: customerFolder.getId(),
    createdAt: new Date().toISOString(),
    uploadedBy: 'Google Apps Script'
  };
}

function markPhotoError_(photo, err) {
  photo = photo || {};
  photo.error = String(err || 'Unbekannter Drive Fehler');
  photo.errorAt = new Date().toISOString();
  return photo;
}

function parseCalendarId_(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';
  var match = raw.match(/\/calendar\/ical\/([^\/]+)\/(?:public|private)\//i) || raw.match(/ical\/([^\/]+)\//i);
  if (match && match[1]) return decodeURIComponent(match[1]);
  return raw;
}

function dateFromAppointment_(value) {
  var raw = String(value || '').trim();
  if (!raw) return null;
  var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)?(?:(\d{2}):(\d{2}))?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 9), Number(m[5] || 0), 0);
  }
  var d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

function calendarEventForJob_(calendar, job, start) {
  if (job.calendarEventId) {
    try {
      var existing = calendar.getEventById(job.calendarEventId);
      if (existing) return existing;
    } catch (e) {}
  }
  try {
    var from = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    var to = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    var found = calendar.getEvents(from, to, { search: String(job.id || '') });
    if (found && found.length) return found[0];
  } catch (e2) {}
  return null;
}

function syncCalendar_(state, settings) {
  settings = settings || {};
  var calendarId = parseCalendarId_(settings.calendarId || '');
  if (!calendarId) return;

  var calendar = null;
  var rows = [];
  try {
    calendar = calendarId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calendarId);
  } catch (e) {
    rows.push(['', '', '', '', '', 'Kalender nicht gefunden/keine Schreibberechtigung: ' + calendarId + ' (iCal ist nur lesbar; Apps Script braucht Zugriff zum Schreiben)' + ' · ' + String(e)]);
    state.calendarSyncLog = rows;
    return;
  }
  if (!calendar) {
    rows.push(['', '', '', '', '', 'Kalender nicht gefunden/keine Schreibberechtigung: ' + calendarId + ' (iCal ist nur lesbar; Apps Script braucht Zugriff zum Schreiben)']);
    state.calendarSyncLog = rows;
    return;
  }

  var jobs = state.jobs || [];
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var person = findPerson_(state, job.personId) || {};
    var status = String(job.status || '');
    var start = dateFromAppointment_(job.appointmentAt || '');

    try {
      if (!start) {
        if (job.calendarEventId) {
          var oldEvent = calendar.getEventById(job.calendarEventId);
          if (oldEvent) oldEvent.deleteEvent();
        }
        job.calendarEventId = '';
        job.calendarSyncedAt = '';
        job.calendarSyncStatus = 'kein Termin';
        rows.push([job.id || '', job.personId || '', '', '', '', 'kein Termin']);
        continue;
      }

      if (isCancelledJob_(job)) {
        if (job.calendarEventId) {
          var cancelledEvent = calendar.getEventById(job.calendarEventId);
          if (cancelledEvent) cancelledEvent.deleteEvent();
        }
        job.calendarEventId = '';
        job.calendarSyncedAt = new Date().toISOString();
        job.calendarSyncStatus = 'abgesagt - Kalendereintrag entfernt';
        rows.push([job.id || '', job.personId || '', job.appointmentAt || '', '', job.calendarSyncedAt, job.calendarSyncStatus]);
        continue;
      }

      var end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      var address = [person.address || '', person.place || ''].filter(Boolean).join(', ');
      var title = 'Lumian: ' + (person.name || job.personId || 'Kunde') + ' - ' + (job.service || 'Reinigung') + ' [' + (job.id || '') + ']';
      var description = [
        'Job: ' + (job.id || ''),
        'Lumian-Nr.: ' + (person.id || job.personId || ''),
        'Kunde: ' + (person.name || ''),
        'Telefon: ' + (person.phone || ''),
        'Service: ' + (job.service || ''),
        'Betrag: CHF ' + (job.amount || ''),
        'Status: ' + (job.status || ''),
        job.notes ? ('Notizen: ' + job.notes) : ''
      ].filter(Boolean).join('\n');

      var event = calendarEventForJob_(calendar, job, start);
      if (event) {
        event.setTitle(title);
        event.setTime(start, end);
        event.setLocation(address);
        event.setDescription(description);
      } else {
        event = calendar.createEvent(title, start, end, { location: address, description: description });
      }
      job.calendarEventId = event.getId();
      job.calendarSyncedAt = new Date().toISOString();
      job.calendarSyncStatus = 'synchronisiert';
      rows.push([job.id || '', job.personId || '', job.appointmentAt || '', job.calendarEventId || '', job.calendarSyncedAt, job.calendarSyncStatus]);
    } catch (err) {
      job.calendarSyncStatus = 'Fehler: ' + String(err);
      rows.push([job.id || '', job.personId || '', job.appointmentAt || '', job.calendarEventId || '', new Date().toISOString(), job.calendarSyncStatus]);
    }
  }
  state.calendarSyncLog = rows;
}

function getOrCreateCustomerFolder_(rootFolder, state, job) {
  var person = findPerson_(state, job && job.personId);
  var folderName = sanitizeDriveName_((person && person.id) || (job && job.personId) || 'ohne-kundennummer');
  var folders = rootFolder.getFoldersByName(folderName);
  if (folders.hasNext()) return folders.next();
  return rootFolder.createFolder(folderName);
}

function findPerson_(state, personId) {
  var people = (state && state.people) || [];
  for (var i = 0; i < people.length; i++) {
    if (String(people[i].id || '') === String(personId || '')) return people[i];
  }
  return null;
}

function sanitizeDriveName_(value) {
  var safe = String(value || '').trim();
  safe = safe.replace(/[\\/:*?"<>|#%{}~&]/g, '-').replace(/\s+/g, ' ').trim();
  if (!safe) safe = 'ohne-name';
  return safe.slice(0, 80);
}

function saveState_(state, folder) {
  var json = JSON.stringify(state);
  if (folder) {
    var filename = 'lumian-portal-state.json';
    var files = folder.getFilesByName(filename);
    while (files.hasNext()) files.next().setTrashed(true);
    folder.createFile(filename, json, 'application/json');
  }
  PropertiesService.getScriptProperties().setProperty('LUMIAN_STATE', json);
}

function loadState_() {
  var raw = PropertiesService.getScriptProperties().getProperty('LUMIAN_STATE') || '';
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeSheets_(state) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeSheet_(ss, 'People', ['LumianNr','Status','Name','Phone','Email','Strasse/Nr','PLZ/Ort','Source','ReferredBy','CreatedAt','CreatedBy','CustomerSince'], (state.people || []).map(function(p) {
    return [p.id,p.status,p.name,p.phone,p.email,p.address,p.place,p.source,p.referredById,p.createdAt,p.createdBy,p.customerSince];
  }));
  writeSheet_(ss, 'Leads', ['LeadId','LumianNr','Service','Source','ExpectedValue','AppointmentAt','ReferredBy','Status','CreatedAt','CreatedBy','Notes'], (state.leads || []).map(function(l) {
    return [l.id,l.personId,l.service,l.source,l.expectedValue,l.appointmentAt,l.referredById,l.status,l.createdAt,l.createdBy,l.notes];
  }));
  writeSheet_(ss, 'Jobs', ['JobId','LumianNr','LeadId','Service','AppointmentAt','Amount','Status','PaidAt','CompletedAt','CalendarEventId','CalendarSyncedAt','CalendarStatus','AssignedTo','Source','ReferredBy','BeforePhoto','AfterPhoto','CreatedAt','CreatedBy','Notes'], (state.jobs || []).map(function(j) {
    return [j.id,j.personId,j.leadId,j.service,j.appointmentAt,j.amount,j.status,j.paidAt || '',j.completedAt || '',j.calendarEventId || '',j.calendarSyncedAt || '',j.calendarSyncStatus || '',j.assignedTo,j.source,j.referredById,photoLink_(j.beforePhoto),photoLink_(j.afterPhoto),j.createdAt,j.createdBy,j.notes];
  }));
  writePhotosSheet_(ss, state);
  writePhotoSyncSheet_(ss, state);
  writeCalendarSyncSheet_(ss, state);
  writeSheet_(ss, 'Rewards', ['RewardId','CustomerId','FromCustomerId','JobId','Amount','Status','CreatedAt','CreatedBy'], (state.rewards || []).map(function(r) {
    return [r.id,r.customerId,r.fromPersonId,r.jobId,r.amount,r.status,r.createdAt,r.createdBy];
  }));

  var finance = calculateFinance_(state);
  writeSheet_(ss, 'Finance Summary', ['Kennzahl','CHF','Info'], [
    ['Bezahlte Jobs', finance.paidJobsTotal, finance.paidJobsCount + ' kassierte Jobs'],
    ['Manuell ergänzt', finance.manualIncomeTotal, finance.manualIncomeCount + ' Eintrag(e)'],
    ['Voraussichtlich', finance.forecastTotal, finance.forecastJobsCount + ' Job(s) + ' + finance.forecastLeadsCount + ' Lead(s)'],
    ['Ausgaben', finance.expenseTotal, finance.expenseCount + ' Kostenposition(en)'],
    ['Gewinn', finance.paidJobsTotal + finance.manualIncomeTotal - finance.expenseTotal, 'bezahlte Einnahmen minus Ausgaben']
  ]);

  writeSheet_(ss, 'Finance Manual Income', ['IncomeId','Title','From','To','Amount','Notes','CreatedAt','CreatedBy'], ((state.finance && state.finance.manualIncome) || []).map(function(x) {
    return [x.id,x.title,x.from,x.to,x.amount,x.notes,x.createdAt,x.createdBy];
  }));
  writeSheet_(ss, 'Finance Expenses', ['ExpenseId','Date','Category','Title','Amount','Notes','CreatedAt','CreatedBy'], ((state.finance && state.finance.expenses) || []).map(function(x) {
    return [x.id,x.date,x.category,x.title,x.amount,x.notes,x.createdAt,x.createdBy];
  }));

  writeSheet_(ss, 'Settings', ['Key','Value'], Object.keys(state.settings || {}).map(function(k) {
    return [k, state.settings[k]];
  }));
}


function writeCalendarSyncSheet_(ss, state) {
  var rows = state.calendarSyncLog || [];
  if (!rows.length) {
    rows = (state.jobs || []).map(function(j) {
      return [j.id || '', j.personId || '', j.appointmentAt || '', j.calendarEventId || '', j.calendarSyncedAt || '', j.calendarSyncStatus || ''];
    });
  }
  writeSheet_(ss, 'Calendar Sync', ['JobId','LumianNr','AppointmentAt','CalendarEventId','SyncedAt','Status'], rows);
}

function writePhotoSyncSheet_(ss, state) {
  var rows = state.photoSyncLog || [];
  writeSheet_(ss, 'Photo Sync', ['JobId','LumianNr','Type','FileName','Status','SyncedAt'], rows);
}

function writePhotosSheet_(ss, state) {
  var rows = [];
  var jobs = state.jobs || [];
  for (var i = 0; i < jobs.length; i++) {
    var j = jobs[i];
    var p = findPerson_(state, j.personId) || {};
    if (j.beforePhoto) rows.push([j.id, j.personId, p.name || '', 'before', j.beforePhoto.name || '', j.beforePhoto.url || '', j.beforePhoto.folderName || '', j.beforePhoto.createdAt || '']);
    if (j.afterPhoto) rows.push([j.id, j.personId, p.name || '', 'after', j.afterPhoto.name || '', j.afterPhoto.url || '', j.afterPhoto.folderName || '', j.afterPhoto.createdAt || '']);
  }
  writeSheet_(ss, 'Photos', ['JobId','LumianNr','Customer','Type','FileName','DriveUrl','Folder','UploadedAt'], rows);
}

function amountValue_(value) {
  if (typeof value === 'number') return isFinite(value) ? value : 0;
  var s = String(value || '').trim();
  if (!s) return 0;
  s = s.replace(/CHF/ig, '').replace(/Fr\.?/ig, '').replace(/'/g, '').replace(/\s/g, '').replace(/[^0-9,.\-]/g, '');
  var lastComma = s.lastIndexOf(',');
  var lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '.');
  }
  var n = Number(s);
  return isFinite(n) ? n : 0;
}

function isPaidJob_(job) {
  var status = String((job && job.status) || '').toLowerCase();
  return status === 'bezahlt' || status.indexOf('bezahlt') >= 0 || !!(job && job.paidAt);
}

function isCancelledJob_(job) {
  var status = String((job && job.status) || '').toLowerCase();
  return status === 'abgesagt' || status.indexOf('abgesagt') >= 0;
}

function calculateFinance_(state) {
  var jobs = state.jobs || [];
  var leads = state.leads || [];
  var finance = state.finance || { manualIncome: [], expenses: [] };
  var paidJobs = jobs.filter(function(j) { return isPaidJob_(j); });
  var forecastJobs = jobs.filter(function(j) { return !isPaidJob_(j) && !isCancelledJob_(j) && amountValue_(j.amount) > 0; });
  var forecastLeads = leads.filter(function(l) {
    var status = String(l.status || '');
    return ['Job erstellt','Job erledigt / Zahlung offen','Kunde geworden','Verloren'].indexOf(status) < 0 && amountValue_(l.expectedValue) > 0;
  });
  var manualIncome = finance.manualIncome || [];
  var expenses = finance.expenses || [];

  return {
    paidJobsCount: paidJobs.length,
    paidJobsTotal: paidJobs.reduce(function(sum, j) { return sum + amountValue_(j.amount); }, 0),
    manualIncomeCount: manualIncome.length,
    manualIncomeTotal: manualIncome.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0),
    forecastJobsCount: forecastJobs.length,
    forecastLeadsCount: forecastLeads.length,
    forecastTotal: forecastJobs.reduce(function(sum, j) { return sum + amountValue_(j.amount); }, 0) + forecastLeads.reduce(function(sum, l) { return sum + amountValue_(l.expectedValue); }, 0),
    expenseCount: expenses.length,
    expenseTotal: expenses.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0)
  };
}

function photoLink_(photo) {
  if (!photo) return '';
  return photo.driveUrl || photo.url || photo.fileId || photo.name || '';
}

function writeSheet_(ss, name, headers, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  sh.autoResizeColumns(1, headers.length);
}


function getOrCreateSheet_(ss, name, headers) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (headers && headers.length) {
    var existing = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn() || headers.length)).getValues()[0];
    var hasHeader = existing.some(function(cell) { return String(cell || '').trim() !== ''; });
    if (!hasHeader) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    }
  }
  return sh;
}


function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}