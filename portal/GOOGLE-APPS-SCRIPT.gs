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

var DEFAULT_DRIVE_FOLDER_ID = '1LByFV1zXcBrfbgGV1BjbAwKAcRBEJKQr';
var DEFAULT_BACKUP_FOLDER_ID = '1gCHjA3CKET8fPjYkc80_6rC4zIL7isy4';
var DEFAULT_CALENDAR_ID = 'lumianservices@gmail.com';
var DEFAULT_ACTIVITY_LOG_SHEET_ID = '1ILtC4pdsIpS4RcGTeoo_bi_inG44J1uvpQXgUSH6aI4';

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return json_({ ok: false, error: 'Sync ist gerade belegt. Bitte in einigen Sekunden erneut versuchen.' });
  }

  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action === 'websiteLead') return saveWebsiteLead_(payload.lead || {});
    if (payload.action === 'resetAll') return resetAll_(payload.confirm || '');
    if (payload.action === 'appendActivityLog') return appendActivityLog_(payload.entries || [], payload.by || '');
    if (payload.action === 'goLiveReset') return goLiveReset_(payload.confirm || '', payload.backupFolderId || '');
    if (payload.action !== 'syncFull') return json_({ ok: false, error: 'Unknown action' });
    return syncFull_(payload);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (releaseErr) {}
  }
}

function syncFull_(payload) {
  var incoming = normalizeStateForMerge_(payload.state || emptyState_());
  var current = normalizeStateForMerge_(loadState_() || emptyState_());
  var state = mergeStates_(current, incoming, payload.by || '');
  var settings = state.settings || {};
  settings.driveFolderId = settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
  settings.backupFolderId = settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID;
  settings.calendarId = settings.calendarId || DEFAULT_CALENDAR_ID;
  state.settings = settings;
  state.lastSyncRunId = payload.syncRunId || ('sync-' + new Date().getTime());
  var activityResult = appendActivityLogEntries_(payload.activityLog || [], payload.by || '', state.lastSyncRunId);

  var folderId = settings.driveFolderId;
  var photoFolder = null;
  state.photoSyncLog = [];
  state.syncDiagnostics = [];
  state.syncDiagnostics.push(['Sync ID', state.lastSyncRunId || '', '', '']);
  state.syncDiagnostics.push(['Activity Log Sheet ID', DEFAULT_ACTIVITY_LOG_SHEET_ID || '', activityResult.ok ? ('OK: ' + activityResult.count + ' Eintrag(e) geschrieben') : 'FEHLER', activityResult.error || '']);
  state.syncDiagnostics.push(['Sync gestartet', new Date().toISOString(), '', '']);
  state.syncDiagnostics.push(['Merge-Modus', 'aktiv', 'Cloud + Gerät werden pro ID zusammengeführt', '']);
  state.syncDiagnostics.push(['Drive Folder ID', folderId || '', '', '']);
  state.syncDiagnostics.push(['Backup Folder ID', settings.backupFolderId || '', '', '']);
  state.syncDiagnostics.push(['Calendar ID input', settings.calendarId || '', 'parsed: ' + parseCalendarId_(settings.calendarId || DEFAULT_CALENDAR_ID), '']);
  state.syncDiagnostics.push(['Jobs mit lokalen Fotos', countLocalPhotoJobs_(state), '', '']);
  state.syncDiagnostics.push(['Jobs mit Termin', countAppointmentJobs_(state), '', '']);

  if (folderId) {
    try {
      photoFolder = DriveApp.getFolderById(folderId);
      state.photoSyncLog.push(['', '', '', '', 'Drive Hauptordner OK: ' + photoFolder.getName(), new Date().toISOString()]);
      state.syncDiagnostics.push(['Drive Zugriff', 'OK', photoFolder.getName(), photoFolder.getUrl()]);
    } catch (driveErr) {
      state.photoSyncLog.push(['', '', '', '', 'Drive Fehler: Ordner nicht gefunden oder keine Berechtigung für ID ' + folderId + ' · ' + String(driveErr), new Date().toISOString()]);
      state.syncDiagnostics.push(['Drive Zugriff', 'FEHLER', folderId, String(driveErr)]);
    }
  } else {
    state.photoSyncLog.push(['', '', '', '', 'Kein Drive Folder ID in Einstellungen gesetzt.', new Date().toISOString()]);
    state.syncDiagnostics.push(['Drive Zugriff', 'FEHLT', '', 'Keine Folder ID gesetzt']);
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

  // Website content uses the same Drive main folder and creates its own WebsiteMedia subfolder automatically.
  try {
    state.websiteContent = saveWebsiteContentMedia_(photoFolder, state.websiteContent || {});
  } catch (contentErr) {
    state.syncDiagnostics.push(['Website Inhalte', 'FEHLER', '', String(contentErr)]);
  }

  // Calendar sync must still run even when Drive fails.
  syncCalendar_(state, settings);

  writeSheets_(state);
  saveState_(state, photoFolder);
  return json_({ ok: true, savedAt: new Date().toISOString(), syncRunId: state.lastSyncRunId || '', photoSyncLog: state.photoSyncLog || [], calendarSyncLog: state.calendarSyncLog || [] });
}




function emptyState_() {
  var now = new Date().toISOString();
  return {
    version: 10,
    createdAt: now,
    updatedAt: now,
    users: [],
    settings: {},
    counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 },
    people: [],
    leads: [],
    jobs: [],
    rewards: [],
    dataGeneration: '',
    goLiveLocked: false,
    finance: { manualIncome: [], expenses: [] },
    websiteContent: { values: {}, media: {}, gallery: [], updatedAt: '', updatedBy: '' },
    audit: []
  };
}

function resetAll_(confirmText) {
  if (confirmText !== 'RESET-LUMIAN-PORTAL') {
    return json_({ ok: false, error: 'Reset confirmation missing' });
  }
  var current = normalizeStateForMerge_(loadState_() || emptyState_());
  createBackupSnapshot_(current, 'before-full-reset');
  appendActivityLogEntries_([{ timestamp: new Date().toISOString(), userId: 'system', userName: 'System', action: 'Kompletter Cloud-Reset', area: 'Setup', objectId: '', description: 'Cloud State wurde komplett zurückgesetzt.', deviceId: 'apps-script', deviceLabel: 'Apps Script', portalMode: current.portalMode || '', source: 'server' }], 'system', 'reset-all');
  var state = emptyState_();
  state.settings = { backupFolderId: DEFAULT_BACKUP_FOLDER_ID, driveFolderId: DEFAULT_DRIVE_FOLDER_ID, calendarId: DEFAULT_CALENDAR_ID };
  writeSheets_(state);
  clearWebsiteLeadSheet_();
  saveState_(state, null);
  createBackupSnapshot_(state, 'after-full-reset');
  return json_({ ok: true, resetAt: new Date().toISOString() });
}

function goLiveReset_(confirmText, backupFolderId) {
  if (confirmText !== 'START-PRODUCTION') {
    return json_({ ok: false, error: 'Produktiv confirmation missing' });
  }
  var current = normalizeStateForMerge_(loadState_() || emptyState_());
  var hasOperationalData = (current.people || []).length || (current.leads || []).length || (current.jobs || []).length || (current.rewards || []).length || ((current.finance || {}).manualIncome || []).length || ((current.finance || {}).expenses || []).length;
  if (current.portalMode === 'production' && !hasOperationalData) {
    return json_({ ok: false, error: 'Produktivbetrieb ist aktiv und alle Testdaten sind bereits gelöscht. Der Löschvorgang ist dauerhaft gesperrt.', alreadyProduction: true });
  }
  var warnings = [];
  current.settings = current.settings || {};
  current.settings.backupFolderId = String(backupFolderId || current.settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID).trim() || DEFAULT_BACKUP_FOLDER_ID;
  try { createBackupSnapshot_(current, 'before-go-live-reset'); }
  catch (backupErr) { warnings.push('Sicherungsbackup konnte nicht erstellt werden: ' + String(backupErr)); }
  var now = new Date().toISOString();
  var generation = 'production-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000000);
  var clean = emptyState_();
  clean.version = current.version || 10;
  clean.createdAt = current.createdAt || now;
  clean.updatedAt = now;
  clean.portalMode = 'production';
  clean.goLiveAt = now;
  clean.dataGeneration = generation;
  clean.goLiveLocked = true;
  clean.users = current.users || [];
  clean.websiteContent = current.websiteContent || { values: {}, media: {}, gallery: [], updatedAt: '', updatedBy: '' };
  clean.settings = current.settings || {};
  clean.settings.driveFolderId = clean.settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
  clean.settings.backupFolderId = clean.settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID;
  clean.settings.calendarId = clean.settings.calendarId || DEFAULT_CALENDAR_ID;
  clean.counters = { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 };
  clean.people = [];
  clean.leads = [];
  clean.jobs = [];
  clean.rewards = [];
  clean.finance = { manualIncome: [], expenses: [] };
  clean.audit = [];
  try {
    var cleanJson = JSON.stringify(stateForStorage_(clean));
    saveStateToSheet_(cleanJson);
    try { PropertiesService.getScriptProperties().setProperty('LUMIAN_STATE', cleanJson.slice(0, 8000)); } catch (propertyErr) {}
  } catch (saveErr) {
    return json_({ ok: false, error: 'Cloud-State konnte nicht gespeichert werden: ' + String(saveErr) });
  }
  try { saveLatestBackup_(stateForStorage_(clean)); } catch (latestBackupErr) { warnings.push('Latest-Backup konnte nicht aktualisiert werden: ' + String(latestBackupErr)); }
  try { writeSheets_(clean); } catch (sheetErr) { warnings.push('Google-Sheets konnten nicht vollständig geleert werden: ' + String(sheetErr)); }
  try { clearWebsiteLeadSheet_(); } catch (leadErr) { warnings.push('Website-Leads konnten nicht vollständig geleert werden: ' + String(leadErr)); }
  try { createBackupSnapshot_(clean, 'after-go-live-reset'); } catch (afterBackupErr) { warnings.push('Abschlussbackup konnte nicht erstellt werden: ' + String(afterBackupErr)); }
  try { appendActivityLogEntries_([{ timestamp: now, userId: 'system', userName: 'System', action: 'Testdaten gelöscht & Produktivbetrieb gestartet', area: 'Setup', objectId: '', description: 'Go-Live Reset: Testdaten gelöscht, Einstellungen/Benutzer/Website-Inhalte behalten.', deviceId: 'apps-script', deviceLabel: 'Apps Script', portalMode: 'production', source: 'server' }], 'system', 'go-live-reset'); }
  catch (activityErr) { warnings.push('Aktivitätsprotokoll konnte nicht geschrieben werden: ' + String(activityErr)); }
  return json_({ ok: true, resetAt: now, mode: 'production', dataGeneration: generation, locked: true, warnings: warnings });
}

function clearWebsiteLeadSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var headers = ['websiteLeadKey','createdAt','leadId','lumianNr','name','phone','Strasse/Nr','PLZ/Ort','service','desiredDate','referral','message','source','status'];
  var website = getOrCreateSheet_(ss, 'Website Leads', headers);
  website.clearContents();
  website.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
}

function backupNow_(backupFolderId) {
  var state = normalizeStateForMerge_(loadState_() || emptyState_());
  state.settings = state.settings || {};
  if (backupFolderId) state.settings.backupFolderId = backupFolderId;
  var file = createBackupSnapshot_(state, 'manual');
  saveLatestBackup_(stateForStorage_(state));
  if (!file) return json_({ ok: false, error: 'Backup-Ordner nicht erreichbar oder nicht beschreibbar.' });
  appendActivityLogEntries_([{ timestamp: new Date().toISOString(), userId: 'system', userName: 'System', action: 'Drive-Backup erstellt', area: 'Backup', objectId: file.getId(), description: file.getName(), deviceId: 'apps-script', deviceLabel: 'Apps Script', portalMode: state.portalMode || '', source: 'server' }], 'system', 'backup-now');
  return json_({ ok: true, backupAt: new Date().toISOString(), fileName: file.getName() });
}

function listBackups_(backupFolderId) {
  try {
    var state = normalizeStateForMerge_(loadState_() || emptyState_());
    var settings = state.settings || {};
    var folderId = String(backupFolderId || settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID || '').trim();
    if (!folderId) return json_({ ok: false, error: 'Keine Backup Folder ID vorhanden.' });
    var folder = DriveApp.getFolderById(folderId);
    var files = folder.getFiles();
    var out = [];
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      if (name !== 'lumian-portal-latest.json' && !/^lumian-portal-.*\.json$/.test(name)) continue;
      var created = f.getDateCreated();
      out.push({
        id: f.getId(),
        name: name,
        createdAt: created ? created.toISOString() : '',
        createdTs: created ? created.getTime() : 0,
        size: f.getSize(),
        sizeLabel: Math.max(1, Math.round((f.getSize() || 0) / 1024)) + ' KB'
      });
    }
    out.sort(function(a, b) { return (b.createdTs || 0) - (a.createdTs || 0); });
    out = out.slice(0, 80).map(function(x) { delete x.createdTs; return x; });
    return json_({ ok: true, backupFolderId: folderId, backups: out });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function restoreBackup_(fileId, confirmText, backupFolderId) {
  if (confirmText !== 'RESTORE-LUMIAN-BACKUP') {
    return json_({ ok: false, error: 'Restore confirmation missing' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return json_({ ok: false, error: 'Restore ist gerade belegt. Bitte in einigen Sekunden erneut versuchen.' });
  }
  try {
    var current = normalizeStateForMerge_(loadState_() || emptyState_());
    current.settings = current.settings || {};
    var folderId = String(backupFolderId || current.settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID || '').trim();
    if (!folderId) throw new Error('Keine Backup Folder ID vorhanden.');
    if (!fileId) throw new Error('Keine Backup Datei ausgewählt.');
    var folder = DriveApp.getFolderById(folderId);
    var file = DriveApp.getFileById(fileId);
    var parentOk = false;
    var parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) parentOk = true;
    }
    if (!parentOk) throw new Error('Die Datei liegt nicht im eingestellten Backup-Ordner.');

    current.settings.backupFolderId = folderId;
    createBackupSnapshot_(current, 'before-restore-backup');

    var content = file.getBlob().getDataAsString('UTF-8');
    var restored = normalizeStateForMerge_(JSON.parse(content || '{}'));
    restored.settings = restored.settings || {};
    restored.settings.driveFolderId = restored.settings.driveFolderId || current.settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
    restored.settings.backupFolderId = restored.settings.backupFolderId || folderId || DEFAULT_BACKUP_FOLDER_ID;
    restored.settings.calendarId = restored.settings.calendarId || current.settings.calendarId || DEFAULT_CALENDAR_ID;
    restored.updatedAt = new Date().toISOString();
    restored.audit = restored.audit || [];
    restored.audit.push({ at: restored.updatedAt, by: 'system', reason: 'Backup wiederhergestellt: ' + file.getName() });

    writeSheets_(restored);
    saveState_(restored, null);
    createBackupSnapshot_(restored, 'after-restore-backup');
    appendActivityLogEntries_([{ timestamp: restored.updatedAt, userId: 'system', userName: 'System', action: 'Drive-Backup wiederhergestellt', area: 'Backup', objectId: file.getId(), description: file.getName(), deviceId: 'apps-script', deviceLabel: 'Apps Script', portalMode: restored.portalMode || '', source: 'server' }], 'system', 'restore-backup');
    return json_({ ok: true, restoredAt: restored.updatedAt, fileName: file.getName(), state: restored });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (releaseErr) {}
  }
}

function normalizeStateForMerge_(s) {
  var base = emptyState_();
  s = s || {};
  var out = JSON.parse(JSON.stringify(s));
  out.version = out.version || base.version;
  out.createdAt = out.createdAt || base.createdAt;
  out.updatedAt = out.updatedAt || '';
  out.portalMode = out.portalMode || 'test';
  out.goLiveAt = out.goLiveAt || '';
  out.dataGeneration = out.dataGeneration || '';
  out.goLiveLocked = out.goLiveLocked === true;
  out.settings = out.settings || {};
  out.settings.driveFolderId = out.settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
  out.settings.backupFolderId = out.settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID;
  out.settings.calendarId = out.settings.calendarId || DEFAULT_CALENDAR_ID;
  out.users = Array.isArray(out.users) ? out.users : [];
  out.counters = out.counters || {};
  out.counters.nextPerson = Number(out.counters.nextPerson || 1001);
  out.counters.nextLead = Number(out.counters.nextLead || 1);
  out.counters.nextJob = Number(out.counters.nextJob || 1);
  out.counters.nextReward = Number(out.counters.nextReward || 1);
  out.counters.nextFinance = Number(out.counters.nextFinance || 1);
  out.people = Array.isArray(out.people) ? out.people : [];
  out.leads = Array.isArray(out.leads) ? out.leads : [];
  out.jobs = Array.isArray(out.jobs) ? out.jobs : [];
  out.rewards = Array.isArray(out.rewards) ? out.rewards : [];
  out.finance = out.finance || { manualIncome: [], expenses: [] };
  out.finance.manualIncome = Array.isArray(out.finance.manualIncome) ? out.finance.manualIncome : [];
  out.finance.expenses = Array.isArray(out.finance.expenses) ? out.finance.expenses : [];
  out.websiteContent = out.websiteContent || { values:{}, media:{}, gallery:[], updatedAt:'', updatedBy:'' };
  out.websiteContent.values = out.websiteContent.values || {};
  out.websiteContent.media = out.websiteContent.media || {};
  out.websiteContent.gallery = Array.isArray(out.websiteContent.gallery) ? out.websiteContent.gallery : [];
  out.audit = Array.isArray(out.audit) ? out.audit : [];
  return out;
}

function recordStamp_(item) {
  if (!item) return 0;
  var raw = item.deletedAt || item.updatedAt || item.createdAt || '';
  var t = raw ? new Date(raw).getTime() : 0;
  return isFinite(t) ? t : 0;
}

function mergeRecordArrays_(currentArr, incomingArr) {
  var map = {};
  function put(item) {
    if (!item || !item.id) return;
    var id = String(item.id);
    var old = map[id];
    if (!old || recordStamp_(item) >= recordStamp_(old)) {
      var merged = {};
      if (old) {
        for (var k in old) if (Object.prototype.hasOwnProperty.call(old, k)) merged[k] = old[k];
      }
      for (var j in item) if (Object.prototype.hasOwnProperty.call(item, j)) merged[j] = item[j];
      map[id] = merged;
    }
  }
  (currentArr || []).forEach(put);
  (incomingArr || []).forEach(put);
  var out = [];
  for (var key in map) if (Object.prototype.hasOwnProperty.call(map, key)) out.push(map[key]);
  return out;
}

function userRecordStamp_(user) {
  user = user || {};
  return new Date(user.updatedAt || user.createdAt || 0).getTime() || 0;
}

function userAccessStamp_(user) {
  user = user || {};
  if (user.accessUpdatedAt) return new Date(user.accessUpdatedAt).getTime() || 0;
  return isUserLoginActive_(user) ? 0 : userRecordStamp_(user);
}

function isUserLoginActive_(user) {
  return !!user && user.active !== false && user.loginEnabled !== false && user.employmentActive !== false;
}

function copyObject_(source) {
  var out = {};
  source = source || {};
  for (var key in source) if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
  return out;
}

function mergeUserObjects_(older, newer) {
  var out = copyObject_(older);
  newer = newer || {};
  for (var key in newer) if (Object.prototype.hasOwnProperty.call(newer, key)) out[key] = newer[key];
  return out;
}

function mergeUsers_(currentUsers, incomingUsers) {
  var currentMap = {};
  var incomingMap = {};
  var ids = {};
  (currentUsers || []).forEach(function(u) { if (u && u.id) { currentMap[String(u.id)] = u; ids[String(u.id)] = true; } });
  (incomingUsers || []).forEach(function(u) { if (u && u.id) { incomingMap[String(u.id)] = u; ids[String(u.id)] = true; } });
  var out = [];
  for (var id in ids) {
    if (!Object.prototype.hasOwnProperty.call(ids, id)) continue;
    var current = currentMap[id];
    var incoming = incomingMap[id];
    if (!current) { out.push(copyObject_(incoming)); continue; }
    if (!incoming) { out.push(copyObject_(current)); continue; }

    var currentStamp = userRecordStamp_(current);
    var incomingStamp = userRecordStamp_(incoming);
    var merged = currentStamp > incomingStamp ? mergeUserObjects_(incoming, current) : mergeUserObjects_(current, incoming);

    // Access state is merged independently from profile, password and biometric
    // updates. A stale device cannot undo an admin deactivation simply because
    // it changed a password later while offline.
    var currentAccessStamp = userAccessStamp_(current);
    var incomingAccessStamp = userAccessStamp_(incoming);
    var accessSource;
    if (currentAccessStamp > incomingAccessStamp) accessSource = current;
    else if (incomingAccessStamp > currentAccessStamp) accessSource = incoming;
    else if (!isUserLoginActive_(current) && isUserLoginActive_(incoming)) accessSource = current;
    else if (!isUserLoginActive_(incoming) && isUserLoginActive_(current)) accessSource = incoming;
    else accessSource = currentStamp > incomingStamp ? current : incoming;

    merged.employmentActive = accessSource.employmentActive !== false;
    merged.loginEnabled = accessSource.loginEnabled !== false;
    merged.active = accessSource.active !== false && merged.loginEnabled && merged.employmentActive;
    merged.accessUpdatedAt = accessSource.accessUpdatedAt || merged.accessUpdatedAt || '';
    if (!isUserLoginActive_(accessSource)) {
      merged.credentialId = '';
      merged.credentialUserHandle = '';
    }
    out.push(merged);
  }
  return out;
}

function mergeSettings_(currentSettings, incomingSettings) {
  var out = {};
  currentSettings = currentSettings || {};
  incomingSettings = incomingSettings || {};
  for (var k in currentSettings) if (Object.prototype.hasOwnProperty.call(currentSettings, k)) out[k] = currentSettings[k];
  for (var j in incomingSettings) {
    if (Object.prototype.hasOwnProperty.call(incomingSettings, j) && incomingSettings[j] !== '' && incomingSettings[j] !== null && incomingSettings[j] !== undefined) out[j] = incomingSettings[j];
  }
  out.driveFolderId = out.driveFolderId || DEFAULT_DRIVE_FOLDER_ID;
  out.backupFolderId = out.backupFolderId || DEFAULT_BACKUP_FOLDER_ID;
  out.calendarId = out.calendarId || DEFAULT_CALENDAR_ID;
  return out;
}

function maxCounters_(a, b) {
  a = a || {}; b = b || {};
  return {
    nextPerson: Math.max(Number(a.nextPerson || 1001), Number(b.nextPerson || 1001)),
    nextLead: Math.max(Number(a.nextLead || 1), Number(b.nextLead || 1)),
    nextJob: Math.max(Number(a.nextJob || 1), Number(b.nextJob || 1)),
    nextReward: Math.max(Number(a.nextReward || 1), Number(b.nextReward || 1)),
    nextFinance: Math.max(Number(a.nextFinance || 1), Number(b.nextFinance || 1))
  };
}

function mergeStates_(current, incoming, userId) {
  current = normalizeStateForMerge_(current);
  incoming = normalizeStateForMerge_(incoming);
  var now = new Date().toISOString();
  var merged = emptyState_();
  merged.version = Math.max(Number(current.version || 8), Number(incoming.version || 8));
  merged.createdAt = current.createdAt || incoming.createdAt || now;
  merged.updatedAt = now;
  merged.portalMode = (current.portalMode === 'production' || incoming.portalMode === 'production') ? 'production' : (incoming.portalMode || current.portalMode || 'test');
  merged.goLiveAt = current.goLiveAt || incoming.goLiveAt || '';
  merged.dataGeneration = current.dataGeneration || incoming.dataGeneration || '';
  merged.goLiveLocked = current.goLiveLocked === true || incoming.goLiveLocked === true || merged.portalMode === 'production';
  merged.settings = mergeSettings_(current.settings, incoming.settings);
  merged.users = mergeUsers_(current.users, incoming.users);
  merged.counters = maxCounters_(current.counters, incoming.counters);
  merged.people = mergeRecordArrays_(current.people, incoming.people);
  merged.leads = mergeRecordArrays_(current.leads, incoming.leads);
  merged.jobs = mergeRecordArrays_(current.jobs, incoming.jobs);
  merged.rewards = mergeRecordArrays_(current.rewards, incoming.rewards);
  merged.finance = {
    manualIncome: mergeRecordArrays_(current.finance.manualIncome, incoming.finance.manualIncome),
    expenses: mergeRecordArrays_(current.finance.expenses, incoming.finance.expenses)
  };
  var currentContentTime = new Date((current.websiteContent && current.websiteContent.updatedAt) || 0).getTime() || 0;
  var incomingContentTime = new Date((incoming.websiteContent && incoming.websiteContent.updatedAt) || 0).getTime() || 0;
  merged.websiteContent = JSON.parse(JSON.stringify(incomingContentTime >= currentContentTime ? (incoming.websiteContent || {}) : (current.websiteContent || {})));
  merged.audit = (current.audit || []).concat(incoming.audit || []).slice(-400);
  if (current.dataGeneration && incoming.dataGeneration !== current.dataGeneration) {
    merged.dataGeneration = current.dataGeneration;
    merged.portalMode = current.portalMode || 'production';
    merged.goLiveAt = current.goLiveAt || merged.goLiveAt;
    merged.goLiveLocked = true;
    merged.counters = current.counters;
    merged.people = current.people;
    merged.leads = current.leads;
    merged.jobs = current.jobs;
    merged.rewards = current.rewards;
    merged.finance = current.finance;
  }
  if (userId) merged.audit.push({ at: now, by: userId, reason: 'cloud merge sync' });
  return merged;
}

function backupFolderIdFromState_(state) {
  var settings = (state && state.settings) || {};
  return String(settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID || '').trim();
}

function backupFileName_(reason) {
  var stamp = new Date().toISOString().replace(/[:.]/g, '-');
  var safeReason = String(reason || 'backup').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40);
  return 'lumian-portal-' + stamp + '-' + safeReason + '.json';
}

function saveLatestBackup_(cleanState) {
  try {
    var folderId = backupFolderIdFromState_(cleanState);
    if (!folderId) return null;
    var folder = DriveApp.getFolderById(folderId);
    var json = JSON.stringify(cleanState || {});
    var latestName = 'lumian-portal-latest.json';
    var files = folder.getFilesByName(latestName);
    while (files.hasNext()) files.next().setTrashed(true);
    return folder.createFile(latestName, json, 'application/json');
  } catch (e) {
    return null;
  }
}

function createBackupSnapshot_(state, reason) {
  try {
    var clean = stateForStorage_(state || emptyState_());
    var folderId = backupFolderIdFromState_(clean);
    if (!folderId) return null;
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(backupFileName_(reason), JSON.stringify(clean), 'application/json');
    cleanupOldBackups_(folder, 80);
    return file;
  } catch (e) {
    return null;
  }
}

function createAutoBackupIfDue_(cleanState) {
  try {
    var props = PropertiesService.getScriptProperties();
    var last = Number(props.getProperty('LUMIAN_LAST_BACKUP_TS') || 0);
    var now = new Date().getTime();
    if (!last || now - last > 6 * 60 * 60 * 1000) {
      createBackupSnapshot_(cleanState, 'auto');
      props.setProperty('LUMIAN_LAST_BACKUP_TS', String(now));
    }
  } catch (e) {}
}

function cleanupOldBackups_(folder, keep) {
  try {
    var files = folder.getFiles();
    var arr = [];
    while (files.hasNext()) {
      var f = files.next();
      if (/^lumian-portal-.*\.json$/.test(f.getName()) && f.getName() !== 'lumian-portal-latest.json') {
        arr.push(f);
      }
    }
    arr.sort(function(a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
    for (var i = keep; i < arr.length; i++) arr[i].setTrashed(true);
  } catch (e) {}
}



function normalizeAppointmentInput_(value) {
  var raw = String(value || '').trim();
  var m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2,'0') + '-' + String(m[1]).padStart(2,'0') + 'T' + String(m[4] || '09').padStart(2,'0') + ':' + (m[5] || '00');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw + 'T09:00';
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return raw.slice(0, 16);
  return '';
}

function saveWebsiteLead_(lead) {
  var now = lead.createdAt || new Date().toISOString();
  var state = loadState_() || {
    version: 10,
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
  appendActivityLogEntries_([{ timestamp: now, userId: 'website', userName: 'Website', action: 'Website-Lead erstellt', area: 'Leads', objectId: leadId, description: (lead.name || '') + ' / ' + (lead.phone || '') + ' / ' + (lead.service || ''), deviceId: 'website-form', deviceLabel: 'Website Formular', portalMode: state.portalMode || '', source: 'website' }], 'website', 'website-lead');
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
  e = e || { parameter: {} };
  var action = String((e.parameter && e.parameter.action) || '').toLowerCase();
  var callback = String((e.parameter && e.parameter.callback) || 'callback').replace(/[^a-zA-Z0-9_$\.]/g, '');
  if (action === 'load') {
    var state = loadState_();
    return jsonp_(callback, { ok: true, state: state });
  }
  if (action === 'websiteleads') {
    return jsonp_(callback, { ok: true, leads: readWebsiteLeads_() });
  }
  if (action === 'websitecontent') {
    var contentState = loadState_() || {};
    return jsonp_(callback, { ok: true, content: contentState.websiteContent || { values:{}, media:{}, gallery:[] }, updatedAt: new Date().toISOString() });
  }
  if (action === 'syncdiagnostics') {
    return jsonp_(callback, { ok: true, diagnostics: getSyncDiagnostics_(), at: new Date().toISOString() });
  }
  if (action === 'testsync') {
    return jsonp_(callback, { ok: true, test: runSyncTest_(e.parameter || {}), at: new Date().toISOString() });
  }
  if (action === 'backupnow') {
    var backupFolderId = String((e.parameter && e.parameter.backupFolderId) || '');
    var backupResult = JSON.parse(backupNow_(backupFolderId).getContent());
    return jsonp_(callback, backupResult);
  }
  if (action === 'listbackups') {
    var listBackupFolderId = String((e.parameter && e.parameter.backupFolderId) || '');
    var listResult = JSON.parse(listBackups_(listBackupFolderId).getContent());
    return jsonp_(callback, listResult);
  }
  if (action === 'restorebackup') {
    var restoreFileId = String((e.parameter && e.parameter.fileId) || '');
    var restoreConfirm = String((e.parameter && e.parameter.confirm) || '');
    var restoreBackupFolderId = String((e.parameter && e.parameter.backupFolderId) || '');
    var restoreResult = JSON.parse(restoreBackup_(restoreFileId, restoreConfirm, restoreBackupFolderId).getContent());
    return jsonp_(callback, restoreResult);
  }
  if (action === 'golivereset') {
    var goLiveConfirm = String((e.parameter && e.parameter.confirm) || '');
    var goLiveBackupFolderId = String((e.parameter && e.parameter.backupFolderId) || '');
    var goLiveResult = JSON.parse(goLiveReset_(goLiveConfirm, goLiveBackupFolderId).getContent());
    return jsonp_(callback, goLiveResult);
  }
  if (action === 'resetall') {
    var confirmText = String((e.parameter && e.parameter.confirm) || '');
    var result = JSON.parse(resetAll_(confirmText).getContent());
    return jsonp_(callback, result);
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

function countLocalPhotoJobs_(state) {
  var count = 0;
  ((state && state.jobs) || []).forEach(function(j) {
    if ((j.beforePhoto && j.beforePhoto.dataUrl) || (j.afterPhoto && j.afterPhoto.dataUrl)) count++;
  });
  return count;
}

function countAppointmentJobs_(state) {
  var count = 0;
  ((state && state.jobs) || []).forEach(function(j) {
    if (j && j.appointmentAt && !isCancelledJob_(j)) count++;
  });
  return count;
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
  var shareNote = '';
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (shareErr) {
    // Some Google accounts/domains block public file sharing. The file is still saved;
    // the owner can still open it in Drive, but the thumbnail link may not be public.
    shareNote = ' · Hinweis: Public Sharing nicht gesetzt: ' + String(shareErr);
  }

  if (state.photoSyncLog) state.photoSyncLog.push([job.id || '', job.personId || '', type, filename, 'gespeichert in ' + customerFolder.getName() + shareNote, new Date().toISOString()]);

  return {
    type: type,
    name: filename,
    url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200',
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1200',
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
  var swiss = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
  if (swiss) {
    return new Date(Number(swiss[3]), Number(swiss[2]) - 1, Number(swiss[1]), Number(swiss[4] || 9), Number(swiss[5] || 0), 0);
  }
  var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|\s)?(?:(\d{2}):(\d{2}))?/);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 9), Number(m[5] || 0), 0);
  }
  var d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

function calendarSearchWindow_() {
  var now = new Date();
  return { from: new Date(now.getFullYear() - 2, 0, 1), to: new Date(now.getFullYear() + 3, 11, 31) };
}

function findCalendarEventsForJob_(calendar, job) {
  var events = [];
  if (!job || !job.id) return events;
  if (job.calendarEventId) {
    try {
      var existing = calendar.getEventById(job.calendarEventId);
      if (existing) events.push(existing);
    } catch (e) {}
  }
  try {
    var win = calendarSearchWindow_();
    var found = calendar.getEvents(win.from, win.to, { search: String(job.id || '') }) || [];
    for (var i = 0; i < found.length; i++) {
      var duplicate = false;
      for (var j = 0; j < events.length; j++) {
        try { if (events[j].getId() === found[i].getId()) duplicate = true; } catch (ignore) {}
      }
      if (!duplicate) events.push(found[i]);
    }
  } catch (e2) {}
  return events;
}

function calendarEventForJob_(calendar, job) {
  var events = findCalendarEventsForJob_(calendar, job);
  var keep = events.length ? events[0] : null;
  for (var i = 1; i < events.length; i++) {
    try { events[i].deleteEvent(); } catch (e) {}
  }
  return keep;
}

function deleteCalendarEventsForJob_(calendar, job) {
  var events = findCalendarEventsForJob_(calendar, job);
  for (var i = 0; i < events.length; i++) {
    try { events[i].deleteEvent(); } catch (e) {}
  }
  return events.length;
}

function syncCalendar_(state, settings) {
  settings = settings || {};
  var calendarId = parseCalendarId_(settings.calendarId || DEFAULT_CALENDAR_ID);
  if (!calendarId) calendarId = DEFAULT_CALENDAR_ID;

  var calendar = null;
  var rows = [];
  try {
    calendar = calendarId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calendarId);
  } catch (e) {
    rows.push(['', '', '', '', '', 'Kalender nicht gefunden/keine Schreibberechtigung: ' + calendarId + ' · iCal ist nur lesbar; Apps Script braucht Schreibzugriff auf den Kalender. Prüfe: Script läuft als Konto mit Zugriff oder Kalender ist mit Änderungen freigegeben. Fehler: ' + String(e)]);
    state.calendarSyncLog = rows;
    if (state.syncDiagnostics) state.syncDiagnostics.push(['Kalender Zugriff', 'FEHLER', calendarId, String(e)]);
    return;
  }
  if (!calendar) {
    rows.push(['', '', '', '', '', 'Kalender nicht gefunden/keine Schreibberechtigung: ' + calendarId + ' · iCal ist nur lesbar; Apps Script braucht Schreibzugriff auf diesen Kalender.']);
    state.calendarSyncLog = rows;
    if (state.syncDiagnostics) state.syncDiagnostics.push(['Kalender Zugriff', 'FEHLER', calendarId, 'CalendarApp.getCalendarById returned null']);
    return;
  }
  if (state.syncDiagnostics) state.syncDiagnostics.push(['Kalender Zugriff', 'OK', calendarId, calendar.getName()]);

  var jobs = state.jobs || [];
  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var person = findPerson_(state, job.personId) || {};
    var status = String(job.status || '');
    var start = dateFromAppointment_(job.appointmentAt || '');

    try {
      if (!start) {
        deleteCalendarEventsForJob_(calendar, job);
        job.calendarEventId = '';
        job.calendarSyncedAt = '';
        job.calendarSyncStatus = 'kein Termin';
        rows.push([job.id || '', job.personId || '', '', '', '', 'kein Termin']);
        continue;
      }

      if (isCancelledJob_(job)) {
        deleteCalendarEventsForJob_(calendar, job);
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

      var event = calendarEventForJob_(calendar, job);
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

function getOrCreateChildFolder_(parent, name) {
  var folders = parent.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : parent.createFolder(name);
}

function websiteMediaFileName_(key, originalName) {
  var ext = String(originalName || '').match(/\.([a-zA-Z0-9]{2,5})$/);
  var suffix = ext ? ext[1].toLowerCase() : 'jpg';
  return String(key || 'website-image').replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + new Date().getTime() + '.' + suffix;
}

function saveWebsiteMediaEntry_(folder, key, entry) {
  entry = entry || {};
  if (!entry.dataUrl) return entry;
  var m = String(entry.dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('Ungültiges Website-Bild: ' + key);
  var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], websiteMediaFileName_(key, entry.name));
  var file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (shareErr) {}
  var id = file.getId();
  return {
    src: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w1800',
    driveUrl: file.getUrl(), fileId: id, name: entry.name || file.getName(), mimeType: m[1],
    size: Number(entry.size || blob.getBytes().length || 0), width: Number(entry.width || 0), height: Number(entry.height || 0),
    updatedAt: new Date().toISOString()
  };
}

function saveWebsiteContentMedia_(photoFolder, content) {
  content = content || { values:{}, media:{}, gallery:[] };
  content.values = content.values || {};
  content.media = content.media || {};
  content.gallery = Array.isArray(content.gallery) ? content.gallery : [];
  var hasUploads = Object.keys(content.media).some(function(k){ return content.media[k] && content.media[k].dataUrl; }) || content.gallery.some(function(x){ return x && x.dataUrl; });
  if (!hasUploads) return content;
  if (!photoFolder) throw new Error('Für neue Website-Bilder ist der bestehende Drive-Fotoordner erforderlich.');
  var folder = getOrCreateChildFolder_(photoFolder, 'WebsiteMedia');
  Object.keys(content.media).forEach(function(key) { content.media[key] = saveWebsiteMediaEntry_(folder, key, content.media[key]); });
  content.gallery = content.gallery.map(function(item, index) {
    if (!item || !item.dataUrl) return item;
    var saved = saveWebsiteMediaEntry_(folder, 'gallery-' + (item.id || index + 1), item);
    return { id:item.id || ('g-' + (index+1)), src:saved.src, driveUrl:saved.driveUrl, fileId:saved.fileId, name:saved.name, size:saved.size || 0, width:saved.width || 0, height:saved.height || 0, title:item.title || '', caption:item.caption || '', updatedAt:saved.updatedAt };
  });
  return content;
}

function stateForStorage_(state) {
  // Never store huge local base64 image payloads in Script Properties / Sheet state.
  // If Drive upload worked, savePhoto_ already replaced dataUrl with Drive metadata.
  // If Drive upload failed, keep an error marker but strip the base64 to avoid breaking cloud state.
  var clean = JSON.parse(JSON.stringify(state || {}));
  (clean.jobs || []).forEach(function(job) {
    ['beforePhoto', 'afterPhoto'].forEach(function(key) {
      var ph = job[key];
      if (ph && ph.dataUrl) {
        delete ph.dataUrl;
        ph.localOnly = true;
        ph.error = ph.error || 'Foto wurde nicht in Drive gespeichert. Drive Folder ID/Berechtigung prüfen und Foto erneut auswählen.';
        ph.errorAt = ph.errorAt || new Date().toISOString();
      }
    });
  });
  var wc = clean.websiteContent || {};
  var media = wc.media || {};
  Object.keys(media).forEach(function(key) { if (media[key] && media[key].dataUrl) delete media[key].dataUrl; });
  (wc.gallery || []).forEach(function(item) { if (item && item.dataUrl) delete item.dataUrl; });
  return clean;
}

function saveState_(state, folder) {
  var clean = stateForStorage_(state);
  var json = JSON.stringify(clean);
  if (folder) {
    var filename = 'lumian-portal-state.json';
    var files = folder.getFilesByName(filename);
    while (files.hasNext()) files.next().setTrashed(true);
    folder.createFile(filename, json, 'application/json');
  }
  saveLatestBackup_(clean);
  createAutoBackupIfDue_(clean);
  saveStateToSheet_(json);
  try {
    // Small pointer/cache only. If the state becomes too large, the Sheet remains the source of truth.
    PropertiesService.getScriptProperties().setProperty('LUMIAN_STATE', json.slice(0, 8000));
  } catch (e) {}
}

function saveStateToSheet_(json) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Cloud State') || ss.insertSheet('Cloud State');
  sh.clearContents();
  sh.getRange(1,1,1,3).setValues([['Part','Json','UpdatedAt']]).setFontWeight('bold');
  var chunkSize = 45000;
  var rows = [];
  for (var i = 0; i < json.length; i += chunkSize) {
    rows.push([rows.length + 1, json.slice(i, i + chunkSize), new Date().toISOString()]);
  }
  if (rows.length) sh.getRange(2,1,rows.length,3).setValues(rows);
  sh.autoResizeColumns(1, 3);
}

function loadState_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('Cloud State');
  if (sh && sh.getLastRow() > 1) {
    var values = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getValues();
    var rawFromSheet = values.map(function(r) { return String(r[0] || ''); }).join('');
    if (rawFromSheet) return JSON.parse(rawFromSheet);
  }
  var raw = PropertiesService.getScriptProperties().getProperty('LUMIAN_STATE') || '';
  if (!raw) return null;
  return JSON.parse(raw);
}

function writeSheets_(state) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  writeSheet_(ss, 'Employees', ['EmployeeId','Name','Phone','Email','EmployeeType','Role','EmploymentActive','LoginEnabled','PermissionsJson','CompensationDefaultsJson'], (state.users || []).map(function(u) {
    return [u.id,u.name,u.phone || '',u.email || '',u.employeeType || '',u.role || '',u.employmentActive !== false,u.loginEnabled !== false,JSON.stringify(u.permissions || {}),JSON.stringify(u.compensationDefaults || {})];
  }));
  writeSheet_(ss, 'People', ['LumianNr','Status','Name','Phone','Email','Strasse/Nr','PLZ/Ort','Source','ReferredBy','CreatedAt','CreatedBy','CustomerSince','AcquisitionAgreementJson'], (state.people || []).map(function(p) {
    return [p.id,p.status,p.name,p.phone,p.email,p.address,p.place,p.source,p.referredById,p.createdAt,p.createdBy,p.customerSince,JSON.stringify(p.acquisitionAgreement || null)];
  }));
  writeSheet_(ss, 'Leads', ['LeadId','LumianNr','Service','Source','ExpectedValue','AppointmentAt','ReferredBy','Status','CreatedAt','CreatedBy','AcquiredBy','AssignedTo','CommissionAgreementJson','Notes'], (state.leads || []).map(function(l) {
    return [l.id,l.personId,l.service,l.source,l.expectedValue,l.appointmentAt,l.referredById,l.status,l.createdAt,l.createdBy,l.acquiredBy || '',l.assignedTo || '',JSON.stringify(l.commissionAgreement || null),l.notes];
  }));
  writeSheet_(ss, 'Jobs', ['AuftragId','LumianNr','LeadId','Service','AppointmentAt','Amount','Status','PaidAt','CompletedAt','CalendarEventId','CalendarSyncedAt','CalendarStatus','PrimaryResponsible','TeamMemberIds','AcquiredBy','CommissionAgreementJson','CompensationLinesJson','EmployeeCost','Source','ReferredBy','BeforePhoto','AfterPhoto','CreatedAt','CreatedBy','Notes'], (state.jobs || []).map(function(j) {
    var lines = Array.isArray(j.compensationLines) ? j.compensationLines : [];
    var employeeCost = lines.reduce(function(sum, line) { var value = String(line.type || '') === 'hourly' ? amountValue_(line.hours) * amountValue_(line.rate) : amountValue_(line.amount); return sum + value; }, 0);
    return [j.id,j.personId,j.leadId,j.service,j.appointmentAt,j.amount,j.status,j.paidAt || '',j.completedAt || '',j.calendarEventId || '',j.calendarSyncedAt || '',j.calendarSyncStatus || '',j.assignedTo || '',(j.teamMemberIds || []).join(', '),j.acquiredBy || '',JSON.stringify(j.commissionAgreement || null),JSON.stringify(lines),employeeCost,j.source,j.referredById,photoLink_(j.beforePhoto),photoLink_(j.afterPhoto),j.createdAt,j.createdBy,j.notes];
  }));
  writePhotosSheet_(ss, state);
  writePhotoSyncSheet_(ss, state);
  writeCalendarSyncSheet_(ss, state);
  writeSyncDiagnosticsSheet_(ss, state);
  writeSheet_(ss, 'Rewards', ['RewardId','Type','Title','CustomerId','FromCustomerId','JobId','Amount','Status','AccountingPaymentStatus','CreditedAt','CreditedBy','RedeemedAt','RedeemedBy','CancelledAt','CancelledBy','CancelReason','Notes','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'], (state.rewards || []).map(function(r) {
    var expense = (((state.finance || {}).expenses) || []).filter(function(x) { return !x.deletedAt && x.rewardId === r.id; })[0] || null;
    return [r.id,r.manual === true ? 'Manual' : 'Automatic',r.title || '',r.customerId,r.fromPersonId,r.jobId,r.amount,r.status,expense ? deferredExpensePaymentStatus_(expense) : '',r.creditedAt || '',r.creditedBy || '',r.redeemedAt || '',r.redeemedBy || '',r.cancelledAt || '',r.cancelledBy || '',r.cancelReason || '',r.notes || '',r.createdAt,r.createdBy,r.updatedAt || '',r.updatedBy || ''];
  }));

  var finance = calculateFinance_(state);
  writeSheet_(ss, 'Finance Summary', ['Kennzahl','CHF','Info'], [
    ['Bezahlte Jobs', finance.paidJobsTotal, finance.paidJobsCount + ' kassierte Jobs'],
    ['Manuell ergänzt', finance.manualIncomeTotal, finance.manualIncomeCount + ' Eintrag(e)'],
    ['Pipeline offen', finance.forecastTotal, finance.forecastJobsCount + ' Job(s) + ' + finance.forecastLeadsCount + ' Lead(s)'],
    ['Löhne bezahlt', finance.employeeExpenseTotal, finance.employeeExpenseCount + ' bezahlt · ' + finance.employeeOpenExpenseCount + ' offen'],
    ['Empfehlungsboni eingelöst / ausbezahlt', finance.rewardExpenseTotal, finance.rewardExpenseCount + ' bezahlt · ' + finance.rewardOpenExpenseCount + ' gutgeschrieben/offen'],
    ['Ausgaben gesamt', finance.expenseTotal, finance.expenseCount + ' bezahlte/gebuchte Kostenposition(en)'],
    ['Gewinn', finance.paidJobsTotal + finance.manualIncomeTotal - finance.expenseTotal, 'bezahlte Einnahmen minus Ausgaben']
  ]);

  writeSheet_(ss, 'Finance Manual Income', ['IncomeId','Title','From','To','Amount','Notes','CreatedAt','CreatedBy'], ((state.finance && state.finance.manualIncome) || []).filter(function(x) { return !x.deletedAt; }).map(function(x) {
    return [x.id,x.title,x.from,x.to,x.amount,x.notes,x.createdAt,x.createdBy];
  }));
  writeSheet_(ss, 'Finance Expenses', ['ExpenseId','Date','Category','Subtype','Title','Amount','EmployeeId','AuftragId','CustomerId','CompensationLineId','RewardId','SourceType','Automatic','PaymentStatus','CountedAsExpense','Notes','CreatedAt','CreatedBy','UpdatedAt','UpdatedBy'], ((state.finance && state.finance.expenses) || []).filter(function(x) { return !x.deletedAt; }).map(function(x) {
    return [x.id,x.date,x.category,x.subtype || '',x.title,x.amount,x.employeeId || '',x.jobId || '',x.personId || '',x.compensationLineId || '',x.rewardId || '',x.sourceType || '',x.automatic === true,x.paymentStatus || '',!isDeferredExpense_(x) || deferredExpensePaymentStatus_(x) === 'bezahlt',x.notes,x.createdAt,x.createdBy,x.updatedAt || '',x.updatedBy || ''];
  }));

  var websiteContent = state.websiteContent || { values:{}, media:{}, gallery:[] };
  var websiteRows = Object.keys(websiteContent.values || {}).map(function(k) { return ['Text/Link', k, websiteContent.values[k], websiteContent.updatedAt || '', websiteContent.updatedBy || '']; });
  Object.keys(websiteContent.media || {}).forEach(function(k) { websiteRows.push(['Bild', k, JSON.stringify(websiteContent.media[k] || {}), websiteContent.updatedAt || '', websiteContent.updatedBy || '']); });
  websiteRows.push(['Galerie', 'home.gallery.items', JSON.stringify(websiteContent.gallery || []), websiteContent.updatedAt || '', websiteContent.updatedBy || '']);
  writeSheet_(ss, 'Website Content', ['Type','Key','Value','UpdatedAt','UpdatedBy'], websiteRows);

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

function writeSyncDiagnosticsSheet_(ss, state) {
  var rows = state.syncDiagnostics || [];
  if (!rows.length) rows = [['Keine Diagnose vorhanden', new Date().toISOString(), '', '']];
  writeSheet_(ss, 'Sync Diagnostics', ['Check','Wert','Info','Details'], rows);
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

function isEmployeeExpense_(x) {
  return !!x && (x.category === 'Löhne & Mitarbeiter' || (!!x.employeeId && x.sourceType !== 'referral_reward' && x.sourceType !== 'referralReward'));
}

function isRewardExpense_(x) {
  return !!x && (x.sourceType === 'referral_reward' || x.sourceType === 'referralReward' || !!x.rewardId || x.category === 'Kundenbonus & Empfehlungen' || x.category === 'Empfehlungs- / Kundenbonus');
}

function isDeferredExpense_(x) {
  return isEmployeeExpense_(x) || isRewardExpense_(x);
}

function deferredExpensePaymentStatus_(x) {
  if (!x) return 'offen';
  if (x.paymentStatus === 'bezahlt') return 'bezahlt';
  if (x.paymentStatus === 'storniert') return 'storniert';
  return 'offen';
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
  var manualIncome = (finance.manualIncome || []).filter(function(x) { return !x.deletedAt; });
  var expenses = (finance.expenses || []).filter(function(x) { return !x.deletedAt; });
  var countedExpenses = expenses.filter(function(x) { return !isDeferredExpense_(x) || deferredExpensePaymentStatus_(x) === 'bezahlt'; });
  var employeeExpenses = expenses.filter(isEmployeeExpense_);
  var employeePaidExpenses = employeeExpenses.filter(function(x) { return deferredExpensePaymentStatus_(x) === 'bezahlt'; });
  var employeeOpenExpenses = employeeExpenses.filter(function(x) { return deferredExpensePaymentStatus_(x) !== 'bezahlt'; });
  var rewardExpenses = expenses.filter(isRewardExpense_);
  var rewardPaidExpenses = rewardExpenses.filter(function(x) { return deferredExpensePaymentStatus_(x) === 'bezahlt'; });
  var rewardOpenExpenses = rewardExpenses.filter(function(x) { return deferredExpensePaymentStatus_(x) !== 'bezahlt'; });

  return {
    paidJobsCount: paidJobs.length,
    paidJobsTotal: paidJobs.reduce(function(sum, j) { return sum + amountValue_(j.amount); }, 0),
    manualIncomeCount: manualIncome.length,
    manualIncomeTotal: manualIncome.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0),
    forecastJobsCount: forecastJobs.length,
    forecastLeadsCount: forecastLeads.length,
    forecastTotal: forecastJobs.reduce(function(sum, j) { return sum + amountValue_(j.amount); }, 0) + forecastLeads.reduce(function(sum, l) { return sum + amountValue_(l.expectedValue); }, 0),
    expenseCount: countedExpenses.length,
    expenseTotal: countedExpenses.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0),
    employeeExpenseCount: employeePaidExpenses.length,
    employeeOpenExpenseCount: employeeOpenExpenses.length,
    employeeExpenseTotal: employeePaidExpenses.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0),
    rewardExpenseCount: rewardPaidExpenses.length,
    rewardOpenExpenseCount: rewardOpenExpenses.length,
    rewardExpenseTotal: rewardPaidExpenses.reduce(function(sum, x) { return sum + amountValue_(x.amount); }, 0)
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



function activityLogHeaders_() {
  return ['Timestamp','ReceivedAt','UserId','UserName','Action','Area','ObjectId','Description','DeviceId','DeviceLabel','PortalMode','Source','SyncRunId','ClientEventId'];
}

function getOrCreateActivityLogSheet_(ss) {
  var headers = activityLogHeaders_();
  var sh = ss.getSheetByName('Activity_Log') || ss.insertSheet('Activity_Log');
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    try { sh.setFrozenRows(1); } catch (e) {}
  } else {
    var existing = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getValues()[0].map(function(x) { return String(x || ''); });
    var missing = headers.some(function(h, i) { return existing[i] !== h; });
    if (missing) sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function safeLogText_(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max || 500);
}

function appendActivityLog_(entries, fallbackUser) {
  var result = appendActivityLogEntries_(entries || [], fallbackUser || '', 'direct');
  return json_(result);
}

function appendActivityLogEntries_(entries, fallbackUser, syncRunId) {
  try {
    if (!DEFAULT_ACTIVITY_LOG_SHEET_ID) return { ok: true, count: 0, skipped: true, error: 'No Activity Log Sheet ID configured' };
    if (!Array.isArray(entries) || !entries.length) return { ok: true, count: 0 };
    var ss = SpreadsheetApp.openById(DEFAULT_ACTIVITY_LOG_SHEET_ID);
    var sh = getOrCreateActivityLogSheet_(ss);
    var receivedAt = new Date().toISOString();
    var rows = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i] || {};
      var action = safeLogText_(e.action || e.reason || '', 160);
      if (!action) continue;
      rows.push([
        safeLogText_(e.timestamp || e.at || receivedAt, 60),
        receivedAt,
        safeLogText_(e.userId || e.by || fallbackUser || 'unknown', 80),
        safeLogText_(e.userName || e.user || e.displayName || '', 120),
        action,
        safeLogText_(e.area || 'Portal', 120),
        safeLogText_(e.objectId || e.id || '', 120),
        safeLogText_(e.description || e.details || '', 500),
        safeLogText_(e.deviceId || '', 120),
        safeLogText_(e.deviceLabel || '', 160),
        safeLogText_(e.portalMode || '', 40),
        safeLogText_(e.source || '', 80),
        safeLogText_(syncRunId || e.syncRunId || '', 120),
        safeLogText_(e.eventId || '', 120)
      ]);
    }
    if (!rows.length) return { ok: true, count: 0 };
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, activityLogHeaders_().length).setValues(rows);
    try { sh.autoResizeColumns(1, activityLogHeaders_().length); } catch (resizeErr) {}
    return { ok: true, count: rows.length, sheetId: DEFAULT_ACTIVITY_LOG_SHEET_ID };
  } catch (err) {
    return { ok: false, count: 0, error: String(err) };
  }
}

function getSyncDiagnostics_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var out = { syncDiagnostics: [], photoSync: [], calendarSync: [] };
  out.syncDiagnostics = readSheetRows_(ss, 'Sync Diagnostics');
  out.photoSync = readSheetRows_(ss, 'Photo Sync');
  out.calendarSync = readSheetRows_(ss, 'Calendar Sync');
  return out;
}

function readSheetRows_(ss, name) {
  var sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 1) return [];
  var values = sh.getDataRange().getDisplayValues();
  return values.slice(0, 25);
}

function runSyncTest_(params) {
  var state = loadState_() || {};
  var settings = state.settings || {};
  var folderId = String((params && params.driveFolderId) || settings.driveFolderId || DEFAULT_DRIVE_FOLDER_ID || '').trim();
  var backupFolderId = String((params && params.backupFolderId) || settings.backupFolderId || DEFAULT_BACKUP_FOLDER_ID || '').trim();
  var calendarInput = String((params && params.calendarId) || settings.calendarId || DEFAULT_CALENDAR_ID || '').trim();
  var calendarId = parseCalendarId_(calendarInput || DEFAULT_CALENDAR_ID);
  var result = {
    driveFolderId: folderId,
    backupFolderId: backupFolderId,
    calendarInput: calendarInput,
    calendarId: calendarId,
    drive: { ok: false, message: '' },
    backup: { ok: false, message: '' },
    calendar: { ok: false, message: '' },
    activityLogSheetId: DEFAULT_ACTIVITY_LOG_SHEET_ID,
    activityLog: { ok: false, message: '' }
  };

  try {
    if (!folderId) throw new Error('Keine Drive Folder ID vorhanden.');
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile('lumian-sync-test-' + new Date().getTime() + '.txt', 'Lumian Sync Test ' + new Date().toISOString(), 'text/plain');
    var fileName = file.getName();
    file.setTrashed(true);
    result.drive = { ok: true, message: 'OK: Drive Ordner erreichbar und Testdatei konnte erstellt werden: ' + folder.getName() + ' / ' + fileName };
  } catch (driveErr) {
    result.drive = { ok: false, message: 'FEHLER: Drive Ordner nicht beschreibbar. Folder ID/Berechtigung prüfen. Details: ' + String(driveErr) };
  }

  try {
    if (!backupFolderId) throw new Error('Keine Backup Folder ID vorhanden.');
    var backupFolder = DriveApp.getFolderById(backupFolderId);
    var backupFile = backupFolder.createFile('lumian-backup-test-' + new Date().getTime() + '.txt', 'Lumian Backup Test ' + new Date().toISOString(), 'text/plain');
    var backupFileName = backupFile.getName();
    backupFile.setTrashed(true);
    result.backup = { ok: true, message: 'OK: Backup-Ordner erreichbar und beschreibbar: ' + backupFolder.getName() + ' / ' + backupFileName };
  } catch (backupErr) {
    result.backup = { ok: false, message: 'FEHLER: Backup-Ordner nicht beschreibbar. Folder ID/Berechtigung prüfen. Details: ' + String(backupErr) };
  }

  try {
    if (!DEFAULT_ACTIVITY_LOG_SHEET_ID) throw new Error('Keine Activity Log Sheet ID vorhanden.');
    var logSS = SpreadsheetApp.openById(DEFAULT_ACTIVITY_LOG_SHEET_ID);
    getOrCreateActivityLogSheet_(logSS);
    result.activityLog = { ok: true, message: 'OK: Separates Activity Log Sheet erreichbar: ' + logSS.getName() };
  } catch (logErr) {
    result.activityLog = { ok: false, message: 'FEHLER: Activity Log Sheet nicht erreichbar/beschreibbar. Sheet ID/Berechtigung prüfen. Details: ' + String(logErr) };
  }

  try {
    if (!calendarId) throw new Error('Keine Calendar ID vorhanden.');
    var calendar = calendarId === 'primary' ? CalendarApp.getDefaultCalendar() : CalendarApp.getCalendarById(calendarId);
    if (!calendar) throw new Error('CalendarApp.getCalendarById returned null for: ' + calendarId);
    var start = new Date(new Date().getTime() + 15 * 60 * 1000);
    var end = new Date(start.getTime() + 10 * 60 * 1000);
    var event = calendar.createEvent('Lumian Sync Test', start, end);
    var eventId = event.getId();
    event.deleteEvent();
    result.calendar = { ok: true, message: 'OK: Kalender erreichbar. Test-Termin erfolgreich erstellt und wieder gelöscht. Event ID: ' + eventId };
  } catch (calErr) {
    result.calendar = { ok: false, message: 'FEHLER: Kalender nicht beschreibbar. Berechtigung prüfen. Details: ' + String(calErr) };
  }

  return result;
}

function jsonp_(callback, obj) {
  callback = String(callback || 'callback').replace(/[^a-zA-Z0-9_$\.]/g, '');
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}