/**
 * Lumian Services Mini-CRM backend for Google Sheets + Google Drive.
 *
 * Setup:
 * 1) Create a Google Sheet named "Lumian Portal".
 * 2) Extensions -> Apps Script.
 * 3) Paste this whole file.
 * 4) Deploy -> New deployment -> Web app.
 *    Execute as: Me
 *    Who has access: Anyone with the link
 * 5) Copy the Web App URL into Lumian Portal -> Setup.
 * 6) Optional: create a Google Drive folder for photos and paste its folder ID into the portal setup.
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action !== 'syncFull') return json_({ ok: false, error: 'Unknown action' });

    var state = payload.state || {};
    var settings = state.settings || {};
    var folderId = settings.driveFolderId || '';
    var photoFolder = folderId ? DriveApp.getFolderById(folderId) : null;

    if (photoFolder && state.jobs) {
      state.jobs = state.jobs.map(function(job) {
        job.beforePhoto = savePhoto_(photoFolder, job, job.beforePhoto, 'before');
        job.afterPhoto = savePhoto_(photoFolder, job, job.afterPhoto, 'after');
        return job;
      });
    }

    writeSheets_(state);
    saveState_(state, photoFolder);
    return json_({ ok: true, savedAt: new Date().toISOString() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
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
  return json_({ ok: true, message: 'Lumian Portal backend is running.' });
}

function savePhoto_(folder, job, photo, type) {
  if (!photo) return photo;
  if (photo.url && !photo.dataUrl) return photo;
  if (!photo.dataUrl) return photo;

  var match = String(photo.dataUrl).match(/^data:(image\/\w+);base64,(.+)$/);
  if (!match) return photo;

  var ext = match[1].split('/')[1] || 'jpg';
  if (ext === 'jpeg') ext = 'jpg';
  var filename = job.id + '-' + type + '.' + ext;
  var bytes = Utilities.base64Decode(match[2]);
  var blob = Utilities.newBlob(bytes, match[1], filename);

  var existing = folder.getFilesByName(filename);
  while (existing.hasNext()) existing.next().setTrashed(true);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    name: filename,
    url: file.getUrl(),
    fileId: file.getId(),
    createdAt: new Date().toISOString(),
    uploadedBy: 'Google Apps Script'
  };
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
  writeSheet_(ss, 'People', ['LumianNr','Status','Name','Phone','Address','Place','Source','CreatedAt','CreatedBy','CustomerSince'], (state.people || []).map(function(p) {
    return [p.id,p.status,p.name,p.phone,p.address,p.place,p.source,p.createdAt,p.createdBy,p.customerSince];
  }));
  writeSheet_(ss, 'Leads', ['LeadId','LumianNr','Service','Source','ExpectedValue','AppointmentAt','ReferredBy','Status','CreatedAt','CreatedBy','Notes'], (state.leads || []).map(function(l) {
    return [l.id,l.personId,l.service,l.source,l.expectedValue,l.appointmentAt,l.referredById,l.status,l.createdAt,l.createdBy,l.notes];
  }));
  writeSheet_(ss, 'Jobs', ['JobId','LumianNr','LeadId','Service','AppointmentAt','Amount','Status','AssignedTo','BeforePhoto','AfterPhoto','CreatedAt','CreatedBy','Notes'], (state.jobs || []).map(function(j) {
    return [j.id,j.personId,j.leadId,j.service,j.appointmentAt,j.amount,j.status,j.assignedTo,photoLink_(j.beforePhoto),photoLink_(j.afterPhoto),j.createdAt,j.createdBy,j.notes];
  }));
  writeSheet_(ss, 'Rewards', ['RewardId','CustomerId','FromCustomerId','JobId','Amount','Status','CreatedAt','CreatedBy'], (state.rewards || []).map(function(r) {
    return [r.id,r.customerId,r.fromPersonId,r.jobId,r.amount,r.status,r.createdAt,r.createdBy];
  }));
  writeSheet_(ss, 'Settings', ['Key','Value'], Object.keys(state.settings || {}).map(function(k) {
    return [k, state.settings[k]];
  }));
}

function photoLink_(photo) {
  if (!photo) return '';
  return photo.url || photo.fileId || photo.name || '';
}

function writeSheet_(ss, name, headers, rows) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold');
  if (rows.length) sh.getRange(2,1,rows.length,headers.length).setValues(rows);
  sh.autoResizeColumns(1, headers.length);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
