(() => {
  'use strict';

  const STORE_KEY = 'lumian.portal.v5';
  const OLD_KEYS = ['lumian.portal.v4','lumian.portal.v3','lumian.portal.v2'];
  const SESSION_KEY = 'lumian.portal.user';
  const ACTIVITY_LOG_QUEUE_KEY = 'lumian.portal.activityLogQueue.v1';
  const DEVICE_ID_KEY = 'lumian.portal.deviceId.v1';
  const USERS = [
    { id: 'noah', name: 'Noah', emoji: 'N' },
    { id: 'timo', name: 'Timo', emoji: 'T' }
  ];
  const ADMIN_IDS = ['noah','timo'];
  function defaultRecoveryCode(userId) {
    const u = state?.users?.find?.(x => x.id === userId) || USERS.find(x => x.id === userId);
    return `${u?.name || 'Lumian'}-Reset-2026`;
  }
  function normalizeUserId(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  }
  function isAdmin(id = currentUser) {
    const u = state?.users?.find?.(x => x.id === id);
    return ADMIN_IDS.includes(id) || u?.role === 'admin';
  }
  function activeUsers() {
    return (state?.users || []).filter(u => u.active !== false);
  }
  function canAccessTab(tab) {
    if (isAdmin()) return true;
    return ['dashboard','leads','jobs','customers'].includes(tab);
  }
  const DEFAULT_SETTINGS = {
    bonusAmount: 50,
    minOrder: 300,
    businessPhone: '0772794707',
    referralBase: 'https://www.lumianservices.ch/empfehlung/?ref={{customerId}}',
    googleReviewUrl: 'https://g.page/r/CQIaGL8jXr4wEAI/review',
    scriptUrl: 'https://script.google.com/macros/s/AKfycbxrPY6xXXbHjZXSaJJxujw-4xDCFhLg4aNpB7VqlxAkYmCYljSk4I2JfZ10cm1pjp9S/exec',
    driveFolderId: '1LByFV1zXcBrfbgGV1BjbAwKAcRBEJKQr',
    backupFolderId: '1gCHjA3CKET8fPjYkc80_6rC4zIL7isy4',
    calendarId: 'lumianservices@gmail.com',
    recoveryCode: 'Lumian-Reset-2026',
    referralTemplate: 'Hoi {{name}}, danke nochmals für dein Vertrauen in Lumian Services.\n\nWenn du uns an Freunde, Familie oder Nachbarn weiterempfiehlst, erhalten sie CHF {{bonus}} Rabatt auf ihren ersten Auftrag ab CHF {{minOrder}}. Du erhältst nach abgeschlossenem Auftrag ebenfalls CHF {{bonus}} Guthaben für deine nächste Reinigung.\n\nDein Empfehlungslink:\n{{referralLink}}\n\nLiebe Grüsse\nLumian Services',
    newCustomerTemplate: 'Hoi {{name}}, danke für deine Anfrage bei Lumian Services.\n\nGerne schauen wir uns dein Anliegen an und melden uns mit einem Vorschlag. Wenn du über eine Empfehlung kommst, gilt der CHF {{bonus}} Vorteil ab einem Auftrag von CHF {{minOrder}}.\n\nLiebe Grüsse\nLumian Services',
    reminderTemplate: 'Hoi {{name}}, kurze Erinnerung: Wir haben deinen Lumian Termin am {{date}} für {{service}} eingetragen.\n\nAdresse: {{address}}\nBetrag gemäss Abmachung: CHF {{amount}}\n\nLiebe Grüsse\nLumian Services',
    reviewTemplate: 'Hoi {{name}}, danke nochmals für dein Vertrauen in Lumian Services.\n\nWenn du mit unserer Arbeit zufrieden warst, freuen wir uns sehr über eine kurze Google-Bewertung. Das hilft uns als junges Schweizer Unternehmen enorm.\n\nHier direkt bewerten:\n{{googleReviewLink}}\n\nLiebe Grüsse\nLumian Services'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let currentUser = sessionStorage.getItem(SESSION_KEY) || '';
  let activeTab = 'dashboard';
  const PAGE_SIZE = 10;
  let listPages = { today: 1, leads: 1, jobs: 1, customers: 1, income: 1, expenses: 1, activity: 1, rewards: 1 };
  let customerListMode = 'search';
  let stagedPhotos = { before: null, after: null };
  let deferredInstallPrompt = null;
  let cloudSyncTimer = null;
  let cloudSyncInProgress = false;
  let suppressAutoCloudSync = false;
  const CLOUD_SETTING_KEYS = ['scriptUrl','driveFolderId','backupFolderId','calendarId'];
  const SETUP_UNLOCK_MS = 5 * 60 * 1000;
  const setupUnlockedUntil = { cloud: 0, backup: 0 };
  let state = loadState();

  function newState() {
    return {
      version: 8,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      users: USERS.map(u => ({ ...u, role: 'admin', active: true, passwordHash: '', salt: '', credentialId: '', credentialUserHandle: '', recoveryCode: `${u.name}-Reset-2026` })),
      portalMode: 'test',
      goLiveAt: '',
      settings: { ...DEFAULT_SETTINGS },
      counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 },
      people: [],
      leads: [],
      jobs: [],
      rewards: [],
      finance: { manualIncome: [], expenses: [] },
      audit: []
    };
  }

  function loadState() {
    let raw = localStorage.getItem(STORE_KEY);
    if (!raw) {
      for (const k of OLD_KEYS) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    if (!raw) return newState();
    try { return migrateState(JSON.parse(raw)); }
    catch { return newState(); }
  }

  function migrateState(s) {
    const base = newState();
    const merged = { ...base, ...s };
    merged.version = 8;
    merged.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    if (!merged.settings.scriptUrl || String(merged.settings.scriptUrl).includes('AKfycbzE4gou4eqYLhpS_Ap4oDTMDHQBqk1KC9m6XXBJCP2VefN0AKWSPhH6pcWzrBaMftRiVg')) {
      merged.settings.scriptUrl = DEFAULT_SETTINGS.scriptUrl;
    }
    // v27: move default referral links from homepage booking anchor to dedicated referral page.
    if (String(merged.settings.referralBase || '').includes('#booking')) merged.settings.referralBase = DEFAULT_SETTINGS.referralBase;
    merged.counters = { ...base.counters, ...(s.counters || {}) };
    const incomingUsers = Array.isArray(s.users) ? s.users : [];
    const defaultUsers = USERS.map(u => {
      const old = incomingUsers.find(x => x.id === u.id) || {};
      return { ...u, role: 'admin', active: old.active !== false, passwordHash: old.passwordHash || '', salt: old.salt || '', credentialId: old.credentialId || '', credentialUserHandle: old.credentialUserHandle || '', recoveryCode: old.recoveryCode || s.settings?.recoveryCode || `${u.name}-Reset-2026` };
    });
    const customUsers = incomingUsers.filter(u => u && u.id && !USERS.some(base => base.id === u.id)).map(u => ({
      id: normalizeUserId(u.id),
      name: u.name || u.id,
      emoji: u.emoji || String(u.name || u.id || '?').slice(0,1).toUpperCase(),
      role: u.role === 'admin' ? 'admin' : 'staff',
      active: u.active !== false,
      passwordHash: u.passwordHash || '',
      salt: u.salt || '',
      credentialId: u.credentialId || '',
      credentialUserHandle: u.credentialUserHandle || '',
      recoveryCode: u.recoveryCode || `${u.name || u.id}-Reset-2026`
    })).filter(u => u.id);
    merged.users = [...defaultUsers, ...customUsers];
    merged.people = Array.isArray(s.people) ? s.people.map(p => ({ email: '', ...p })) : [];
    merged.leads = Array.isArray(s.leads) ? s.leads : [];
    merged.jobs = Array.isArray(s.jobs) ? s.jobs.map(j => normalizeJobForNoUnpaidDone({ source: '', referredById: '', ...j })) : [];
    merged.rewards = Array.isArray(s.rewards) ? s.rewards : [];
    merged.finance = { manualIncome: [], expenses: [], ...(s.finance || {}) };
    if (!Array.isArray(merged.finance.manualIncome)) merged.finance.manualIncome = [];
    if (!Array.isArray(merged.finance.expenses)) merged.finance.expenses = [];
    merged.audit = Array.isArray(s.audit) ? s.audit : [];
    localStorage.setItem(STORE_KEY, JSON.stringify(merged));
    return merged;
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function deviceLabel() {
    const ua = String(navigator.userAgent || 'Browser');
    if (/iphone/i.test(ua)) return 'iPhone';
    if (/ipad/i.test(ua)) return 'iPad';
    if (/android/i.test(ua)) return 'Android';
    if (/macintosh|mac os/i.test(ua)) return 'Mac / Browser';
    if (/windows/i.test(ua)) return 'Windows / Browser';
    return 'Browser';
  }

  function pendingActivityLog() {
    try {
      const arr = JSON.parse(localStorage.getItem(ACTIVITY_LOG_QUEUE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }

  function setPendingActivityLog(arr) {
    localStorage.setItem(ACTIVITY_LOG_QUEUE_KEY, JSON.stringify((arr || []).slice(-500)));
  }

  function compactDescription(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  }

  function activityMetaFromReason(reason) {
    const r = compactDescription(reason);
    if (!r || r === 'save' || r.startsWith('before sync')) return null;
    const lower = r.toLowerCase();
    const meta = { action: 'Portal geändert', area: 'Portal', objectId: '', description: r };
    const rules = [
      [/^kunde gespeichert|customer/i, 'Kunde gespeichert', 'Kunden'],
      [/^lead erstellt|^lead gespeichert|^lead$/i, 'Lead erstellt', 'Leads'],
      [/^lead geändert|lead edit/i, 'Lead geändert', 'Leads'],
      [/lead verloren|lead lost/i, 'Lead verloren', 'Leads'],
      [/lead in job/i, 'Lead in Job umgewandelt', 'Jobs'],
      [/^job erstellt|^job gespeichert|^job$/i, 'Job gespeichert', 'Jobs'],
      [/^job geändert/i, 'Job geändert', 'Jobs'],
      [/job bezahlt|complete paid/i, 'Job bezahlt/abgeschlossen', 'Jobs'],
      [/job payment|payment still open|complete blocked/i, 'Job Zahlung offen gelassen', 'Jobs'],
      [/manual income delete|einnahme gelöscht/i, 'Einnahme gelöscht', 'Buchhaltung'],
      [/manual income edit|einnahme geändert/i, 'Einnahme geändert', 'Buchhaltung'],
      [/manual income|einnahme gespeichert/i, 'Einnahme gespeichert', 'Buchhaltung'],
      [/expense delete|ausgabe gelöscht/i, 'Ausgabe gelöscht', 'Buchhaltung'],
      [/expense edit|ausgabe geändert/i, 'Ausgabe geändert', 'Buchhaltung'],
      [/expense|ausgabe gespeichert/i, 'Ausgabe gespeichert', 'Buchhaltung'],
      [/reward|bonus/i, 'Bonus geändert', 'Bonus'],
      [/settings cloud|google\/drive/i, 'Google/Drive Einstellungen geändert', 'Einstellungen'],
      [/settings|einstellungen/i, 'Einstellungen geändert', 'Einstellungen'],
      [/password|passwort/i, 'Passwort geändert', 'Benutzer'],
      [/biometric off/i, 'Biometrie entfernt', 'Benutzer'],
      [/biometric/i, 'Biometrie aktiviert', 'Benutzer'],
      [/user disable|benutzer deaktiviert/i, 'Benutzer deaktiviert', 'Benutzer'],
      [/user save|benutzer gespeichert/i, 'Benutzer gespeichert', 'Benutzer'],
      [/customers import|kunden importiert/i, 'Kunden importiert', 'Import'],
      [/leads import|leads importiert/i, 'Leads importiert', 'Import'],
      [/website leads imported|website/i, 'Website-Leads importiert', 'Leads'],
      [/calendar sync/i, 'Kalender-Sync angefordert', 'Jobs']
    ];
    for (const [pattern, action, area] of rules) {
      if (pattern.test(r)) { meta.action = action; meta.area = area; break; }
    }
    const idMatch = r.match(/\b(L\d{3,}|J\d{3,}|LM\d{3,}|F\d{3,}|R\d{3,}|[a-z0-9_-]{2,})\b/i);
    if (idMatch && !['lead','job','save','edit'].includes(idMatch[1].toLowerCase())) meta.objectId = idMatch[1];
    return meta;
  }

  function queueActivity(action, area = 'Portal', objectId = '', description = '', options = {}) {
    if (!currentUser && !options.allowAnonymous) return;
    const entry = {
      eventId: 'act-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      userId: currentUser || options.userId || 'system',
      userName: userName(currentUser || options.userId || 'system'),
      action: compactDescription(action),
      area: compactDescription(area || 'Portal'),
      objectId: compactDescription(objectId || ''),
      description: compactDescription(description || action),
      deviceId: getDeviceId(),
      deviceLabel: deviceLabel(),
      portalMode: state?.portalMode || 'test',
      source: options.source || (navigator.onLine === false ? 'offline' : 'portal')
    };
    const arr = pendingActivityLog();
    arr.push(entry);
    setPendingActivityLog(arr);
    if (options.flush) setTimeout(() => flushActivityLog(true), 250);
    return entry;
  }

  function queueActivityFromSaveReason(reason) {
    const meta = activityMetaFromReason(reason);
    if (meta) queueActivity(meta.action, meta.area, meta.objectId, meta.description);
  }

  async function flushActivityLog(silent = true) {
    const entries = pendingActivityLog();
    if (!entries.length) return true;
    const url = currentScriptUrl();
    if (!url || navigator.onLine === false) return false;
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'appendActivityLog', by: currentUser || 'system', entries })
      });
      setPendingActivityLog([]);
      return true;
    } catch (err) {
      if (!silent) toast('Aktivitätslog konnte nicht gesendet werden. Es bleibt lokal vorgemerkt.');
      return false;
    }
  }

  function saveState(reason = 'save', options = {}) {
    state.updatedAt = new Date().toISOString();
    if (currentUser) state.audit.push({ at: state.updatedAt, by: currentUser, reason });
    if (!options.activityLogged) queueActivityFromSaveReason(reason);
    state.audit = state.audit.slice(-400);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    if (options.cloud !== false) queueCloudSync(reason);
  }

  function hasBusinessData(s = state) {
    return !!s && [s.people, s.leads, s.jobs, s.rewards, s.finance?.manualIncome, s.finance?.expenses].some(arr => Array.isArray(arr) && arr.length);
  }

  function recordStamp(item = {}) {
    return Date.parse(item.deletedAt || item.updatedAt || item.createdAt || '') || 0;
  }

  function mergeRecordsById(localArr = [], cloudArr = []) {
    const map = new Map();
    const put = item => {
      if (!item || !item.id) return;
      const id = String(item.id);
      const old = map.get(id);
      if (!old || recordStamp(item) >= recordStamp(old)) map.set(id, { ...old, ...item });
    };
    (cloudArr || []).forEach(put);
    (localArr || []).forEach(put);
    return Array.from(map.values());
  }

  function mergeUsers(localUsers = [], cloudUsers = []) {
    const map = new Map();
    (cloudUsers || []).forEach(u => { if (u?.id) map.set(String(u.id), { ...u }); });
    (localUsers || []).forEach(u => { if (u?.id) map.set(String(u.id), { ...(map.get(String(u.id)) || {}), ...u }); });
    return Array.from(map.values());
  }

  function maxCounters(a = {}, b = {}) {
    return {
      nextPerson: Math.max(Number(a.nextPerson || 1001), Number(b.nextPerson || 1001)),
      nextLead: Math.max(Number(a.nextLead || 1), Number(b.nextLead || 1)),
      nextJob: Math.max(Number(a.nextJob || 1), Number(b.nextJob || 1)),
      nextReward: Math.max(Number(a.nextReward || 1), Number(b.nextReward || 1)),
      nextFinance: Math.max(Number(a.nextFinance || 1), Number(b.nextFinance || 1))
    };
  }

  function mergeLocalCloudStates(localState = {}, cloudState = {}) {
    const local = migrateState({ ...localState });
    const cloud = migrateState({ ...cloudState });
    const merged = {
      ...cloud,
      ...local,
      createdAt: cloud.createdAt || local.createdAt,
      updatedAt: new Date().toISOString(),
      portalMode: (cloud.portalMode === 'production' || local.portalMode === 'production') ? 'production' : (cloud.portalMode || local.portalMode || 'test'),
      goLiveAt: cloud.goLiveAt || local.goLiveAt || '',
      settings: { ...DEFAULT_SETTINGS, ...(local.settings || {}), ...(cloud.settings || {}) },
      users: mergeUsers(local.users, cloud.users),
      counters: maxCounters(local.counters, cloud.counters),
      people: mergeRecordsById(local.people, cloud.people),
      leads: mergeRecordsById(local.leads, cloud.leads),
      jobs: mergeRecordsById(local.jobs, cloud.jobs),
      rewards: mergeRecordsById(local.rewards, cloud.rewards),
      finance: {
        manualIncome: mergeRecordsById(local.finance?.manualIncome || [], cloud.finance?.manualIncome || []),
        expenses: mergeRecordsById(local.finance?.expenses || [], cloud.finance?.expenses || [])
      },
      audit: [...(cloud.audit || []), ...(local.audit || [])].slice(-400)
    };
    if (!merged.settings.scriptUrl && local.settings?.scriptUrl) merged.settings.scriptUrl = local.settings.scriptUrl;
    if (!merged.settings.driveFolderId && local.settings?.driveFolderId) merged.settings.driveFolderId = local.settings.driveFolderId;
    if (!merged.settings.backupFolderId && local.settings?.backupFolderId) merged.settings.backupFolderId = local.settings.backupFolderId;
    return merged;
  }

  function queueCloudSync(reason = '') {
    if (suppressAutoCloudSync || !currentUser || cloudSyncInProgress) return;
    if (String(reason || '').startsWith('before sync')) return;
    const url = String(getSetting('scriptUrl') || '').trim();
    if (!url) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => syncCloud(true), 1400);
  }

  function toast(message) {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
  }

  function getSetting(key) { const v = state.settings[key]; return (v === undefined || v === null || v === '') ? DEFAULT_SETTINGS[key] : v; }
  function userName(id) { return state?.users?.find(u => u.id === id)?.name || USERS.find(u => u.id === id)?.name || id || '-'; }
  function userEmoji(id) { return state?.users?.find(u => u.id === id)?.emoji || USERS.find(u => u.id === id)?.emoji || '?'; }
  function personById(id) { return state.people.find(p => p.id === id); }
  function leadById(id) { return state.leads.find(l => l.id === id); }
  function jobById(id) { return state.jobs.find(j => j.id === id); }
  function allPeopleSorted() { return [...state.people].sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function normalizeJobForNoUnpaidDone(job = {}) {
    const j = { ...job };
    const status = String(j.status || '').toLowerCase();
    const markedPaid = !!j.paidAt || status.includes('bezahlt');
    if (markedPaid) {
      j.status = 'Bezahlt';
      j.paidAt = j.paidAt || j.completedAt || j.updatedAt || j.createdAt || new Date().toISOString();
      j.completedAt = j.completedAt || j.paidAt;
      return j;
    }
    // New rule: there is no valid state "Erledigt but not paid".
    // If old/local/cloud data contains it, reopen the job as planned so it stays forecast only.
    if (status === 'erledigt' || status.includes('erledigt') || status.includes('zahlung offen')) {
      j.status = 'Geplant';
      delete j.completedAt;
      delete j.paidAt;
    }
    return j;
  }
  function activeCustomers() { return state.people.filter(p => p.status === 'customer').sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function activeLeads() { return state.leads.filter(l => !['Job erstellt','Job erledigt / Zahlung offen','Kunde geworden','Verloren'].includes(l.status)); }

  function leadForPerson(personId) {
    return state.leads
      .filter(l => l.personId === personId && !['Kunde geworden','Verloren'].includes(l.status))
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0] || null;
  }

  function personSearchText(p) {
    const lead = leadForPerson(p.id);
    return [p.id, p.name, p.phone, p.email, p.address, p.place, p.source, p.status, p.contactStatus, p.contactReason, p.contactNote, lead?.id, lead?.service, lead?.status, lead?.notes].join(' ').toLowerCase();
  }

  function searchPeople(q, limit = 8) {
    const needle = String(q || '').trim().toLowerCase();
    if (!needle) return [];
    return [...state.people]
      .filter(p => personSearchText(p).includes(needle))
      .sort((a,b) => {
        const sa = a.status === 'customer' ? 0 : 1;
        const sb = b.status === 'customer' ? 0 : 1;
        return sa - sb || (a.name || '').localeCompare(b.name || '', 'de-CH') || (a.id || '').localeCompare(b.id || '', 'de-CH');
      })
      .slice(0, limit);
  }

  function personStatusLabel(p) { return p.status === 'customer' ? 'Kunde' : 'Lead'; }

  function contactStatus(p = {}) {
    return p.contactStatus || 'Aktiv';
  }
  function isContactBlocked(p = {}) {
    return ['Nicht kontaktieren','Problemfall'].includes(contactStatus(p));
  }
  function contactBadge(p = {}) {
    const status = contactStatus(p);
    if (!status || status === 'Aktiv') return '';
    const cls = status === 'Nicht kontaktieren' ? 'badge danger' : (status === 'Problemfall' ? 'badge warn' : 'badge');
    return `<span class="${cls}">${esc(status)}</span>`;
  }
  function contactWarningText(p = {}) {
    if (!isContactBlocked(p)) return '';
    return [contactStatus(p), p.contactReason, p.contactNote].filter(Boolean).join(' · ');
  }


  function fillTemplate(template, data) {
    return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => data[key] ?? '');
  }

  function referralLink(customerId) { return fillTemplate(getSetting('referralBase'), { customerId }); }
  function googleReviewLink() { return String(getSetting('googleReviewUrl') || '').trim(); }
  function fullAddressForPerson(p = {}) {
    return [p.address, p.place].filter(Boolean).join(', ');
  }
  function mapsUrlForPerson(p = {}) {
    const q = fullAddressForPerson(p) || p.address || p.place || '';
    return q ? `https://maps.google.com/?q=${encodeURIComponent(q)}` : '';
  }

  function validateEmail(email) {
    const value = String(email || '').trim();
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  }

  function parseSwissPhone(input) {
    const raw = String(input || '').trim();
    if (!raw) return { ok: true, empty: true, raw: '', display: '', tel: '', wa: '' };
    let clean = raw.replace(/[\s().-]/g, '');
    if (clean.startsWith('00')) clean = '+' + clean.slice(2);
    if (clean.startsWith('+41')) {
      const rest = clean.slice(3).replace(/\D/g, '');
      if (/^[1-9]\d{8}$/.test(rest)) return { ok: true, empty: false, raw, display: '+41 ' + rest.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4'), tel: '+41' + rest, wa: '41' + rest };
    }
    const digits = clean.replace(/\D/g, '');
    if (/^0[1-9]\d{8}$/.test(digits)) {
      const rest = digits.slice(1);
      return { ok: true, empty: false, raw, display: digits.replace(/(\d{3})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4'), tel: '+41' + rest, wa: '41' + rest };
    }
    if (/^41[1-9]\d{8}$/.test(digits)) {
      const rest = digits.slice(2);
      return { ok: true, empty: false, raw, display: '+41 ' + rest.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4'), tel: '+41' + rest, wa: '41' + rest };
    }
    return { ok: false, empty: false, raw, display: raw, tel: '', wa: '' };
  }

  function normalizeBusinessPhone(input) {
    const parsed = parseSwissPhone(input);
    if (parsed.ok && !parsed.empty) return parsed.wa;
    const digits = String(input || '').replace(/\D/g, '');
    return digits.startsWith('41') ? digits : digits;
  }

  function validateContactFields(form) {
    const phoneInput = form.elements.phone;
    const emailInput = form.elements.email;
    [phoneInput, emailInput].filter(Boolean).forEach(i => i.classList.remove('invalid'));
    if (phoneInput) {
      const p = parseSwissPhone(phoneInput.value);
      if (!p.ok) { phoneInput.classList.add('invalid'); phoneInput.focus(); toast('Bitte Schweizer Telefonnummer korrekt eingeben, z.B. 077 535 05 71.'); return false; }
    }
    if (emailInput && !validateEmail(emailInput.value)) { emailInput.classList.add('invalid'); emailInput.focus(); toast('Bitte E-Mail-Adresse korrekt eingeben.'); return false; }
    return true;
  }

  function parseDateValue(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDateOnly(value) {
    const d = parseDateValue(value);
    if (!d) return value ? String(value) : '-';
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  }

  function fmtDate(value) {
    const d = parseDateValue(value);
    if (!d) return value ? String(value) : '-';
    return `${fmtDateOnly(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function fmtDateTimeForField(value) {
    if (!value) return '';
    const d = parseDateValue(value);
    if (!d) return String(value || '');
    return `${fmtDateOnly(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function fmtDateOnlyForField(value) {
    if (!value) return '';
    const d = parseDateValue(value);
    if (!d) return String(value || '');
    return fmtDateOnly(d);
  }

  function isoDateOnlyFromField(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const d = parseDateValue(raw);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function isoDateTimeFromField(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const d = parseDateValue(raw);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function isValidSwissDateField(value, withTime = false) {
    const raw = String(value || '').trim();
    if (!raw) return true;
    if (withTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) return !!parseDateValue(raw);
    if (!withTime && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return !!parseDateValue(raw);
    const re = withTime ? /^\d{1,2}\.\d{1,2}\.\d{4}(?:[,\s]+\d{1,2}:\d{2})$/ : /^\d{1,2}\.\d{1,2}\.\d{4}$/;
    return re.test(raw) && !!parseDateValue(raw);
  }

  function markInvalidDateInput(input, label, withTime = false) {
    if (!input || isValidSwissDateField(input.value, withTime)) { input?.classList?.remove('invalid'); return false; }
    input.classList.add('invalid');
    input.focus();
    toast(`${label}: Bitte ${withTime ? 'Datum und Uhrzeit' : 'Datum'} auswählen.`);
    return true;
  }


  function nativeDateValueFromField(value) {
    const d = parseDateValue(value);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function nativeDateTimeValueFromField(value) {
    const d = parseDateValue(value);
    if (!d) return '';
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function enhanceCalendarField(input) {
    if (!input || input.dataset.calendarEnhanced === '1') return;
    input.dataset.calendarEnhanced = '1';
    input.lang = 'de-CH';
    input.autocomplete = 'off';
    if (input.matches('[data-ch-datetime]')) {
      try { input.type = 'datetime-local'; } catch {}
      input.placeholder = 'TT.MM.JJJJ HH:MM';
      const native = nativeDateTimeValueFromField(input.value);
      if (native) input.value = native;
    } else {
      try { input.type = 'date'; } catch {}
      input.placeholder = 'TT.MM.JJJJ';
      const native = nativeDateValueFromField(input.value);
      if (native) input.value = native;
    }
  }

  function syncCalendarNative(input) { enhanceCalendarField(input); }
  function syncAllCalendarControls(root = document) { $$('[data-ch-date],[data-ch-datetime]', root).forEach(enhanceCalendarField); }


  function photoPreviewSrc(photo) {
    if (!photo) return '';
    if (photo.dataUrl) return photo.dataUrl;
    if (photo.thumbnailUrl) return photo.thumbnailUrl;
    if (photo.url) return photo.url;
    if (photo.fileId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(photo.fileId)}&sz=w1200`;
    return '';
  }

  function photoPreviewHtml(photos, small = false) {
    return (photos || []).filter(Boolean).map((ph, i) => {
      const src = photoPreviewSrc(ph);
      const label = i ? 'Nachher Foto' : 'Vorher Foto';
      if (!src) {
        const drive = ph.driveUrl ? `<a href="${esc(ph.driveUrl)}" target="_blank" rel="noopener">In Drive öffnen</a>` : 'Keine Vorschau verfügbar';
        return `<div class="photo-placeholder">${esc(label)}<br>${drive}</div>`;
      }
      const open = ph.driveUrl ? `<a class="photo-open" href="${esc(ph.driveUrl)}" target="_blank" rel="noopener">In Drive öffnen</a>` : '';
      return `<div class="photo-box"><img class="${small ? 'thumb' : ''}" src="${esc(src)}" alt="${esc(label)}" loading="lazy">${open}</div>`;
    }).join('');
  }

  function nextId(type) {
    if (type === 'person') return `LM${state.counters.nextPerson++}`;
    if (type === 'lead') return `L${String(state.counters.nextLead++).padStart(4,'0')}`;
    if (type === 'job') return `J${String(state.counters.nextJob++).padStart(4,'0')}`;
    if (type === 'reward') return `R${String(state.counters.nextReward++).padStart(4,'0')}`;
    return `${type}-${Date.now()}`;
  }

  function bumpCountersFromIds(personId = '', leadId = '') {
    const p = String(personId || '').match(/^LM(\d+)$/i);
    if (p) state.counters.nextPerson = Math.max(state.counters.nextPerson || 1001, Number(p[1]) + 1);
    const l = String(leadId || '').match(/^L(\d+)$/i);
    if (l) state.counters.nextLead = Math.max(state.counters.nextLead || 1, Number(l[1]) + 1);
  }

  function cleanReferralCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  }

  function findOrCreatePerson(data) {
    const parsedPhone = parseSwissPhone(data.phone || '');
    const phoneTel = parsedPhone.ok && !parsedPhone.empty ? parsedPhone.tel : '';
    let p = data.personId ? personById(data.personId) : null;
    if (!p && phoneTel) p = state.people.find(x => parseSwissPhone(x.phone).tel === phoneTel);
    if (!p) {
      p = { id: nextId('person'), status: 'lead', createdAt: new Date().toISOString(), createdBy: currentUser };
      state.people.push(p);
    }
    const wasCustomer = p.status === 'customer';
    Object.assign(p, {
      name: data.name || p.name || '',
      phone: phoneTel || data.phone || p.phone || '',
      email: data.email || p.email || '',
      address: data.address || p.address || '',
      place: data.place || p.place || '',
      source: data.source || p.source || '',
      referredById: data.referredById || p.referredById || '',
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser
    });
    if (!wasCustomer && !p.status) p.status = 'lead';
    return p;
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function makeSalt() { return crypto.getRandomValues(new Uint32Array(2)).join('-') + '-' + Date.now(); }
  async function verifyPassword(user, password) {
    if (!user.passwordHash) return true;
    return await sha256(`${user.salt}:${password}`) === user.passwordHash;
  }
  async function setPassword(userId, password) {
    const u = state.users.find(x => x.id === userId);
    if (!u) return false;
    u.salt = makeSalt();
    u.passwordHash = await sha256(`${u.salt}:${password}`);
    saveState(`Passwort geändert: ${userId}`);
    return true;
  }

  function renderUserOptions() {
    const opts = activeUsers().map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}${u.role === 'admin' ? ' · Admin' : ''}</option>`).join('');
    $$('[data-user-select]').forEach(sel => {
      const old = sel.value;
      sel.innerHTML = opts;
      if (old && [...sel.options].some(o => o.value === old)) sel.value = old;
    });
    $$('[data-assigned-select]').forEach(sel => {
      const old = sel.value || currentUser;
      sel.innerHTML = activeUsers().map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}</option>`).join('');
      if (old && [...sel.options].some(o => o.value === old)) sel.value = old;
    });
  }

  function renderPermissions() {
    const admin = isAdmin();
    $$('[data-tab]').forEach(btn => {
      const allowed = canAccessTab(btn.dataset.tab);
      btn.hidden = !allowed;
    });
    $$('[data-admin-only]').forEach(el => { el.hidden = !admin; });
    if (currentUser && !canAccessTab(activeTab)) activeTab = 'dashboard';
  }

  function formatShortDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  }

  function updatePortalModeUi() {
    const production = String(state.portalMode || 'test') === 'production';
    const label = production ? `PRODUKTIVBETRIEB${state.goLiveAt ? ' seit ' + formatShortDate(state.goLiveAt) : ''}` : 'TESTBETRIEB';
    $$('[data-portal-mode-label]').forEach(el => {
      el.textContent = label;
      el.classList.toggle('production', production);
      el.classList.toggle('test', !production);
    });
  }

  function isSetupUnlocked(section) {
    return isAdmin() && Date.now() < Number(setupUnlockedUntil[section] || 0);
  }

  function applySetupLocks() {
    $$('[data-lock-section]').forEach(box => {
      const section = box.dataset.lockSection;
      const unlocked = isSetupUnlocked(section);
      box.classList.toggle('is-locked', !unlocked);
      box.classList.toggle('is-unlocked', unlocked);
      const status = $(`[data-lock-status="${section}"]`, box);
      if (status) status.textContent = unlocked ? 'Entsperrt für kurze Zeit' : 'Gesperrt';
      $$('[data-unlock-section]', box).forEach(btn => { btn.hidden = unlocked; btn.disabled = false; });
      $$('[data-lock-now]', box).forEach(btn => { btn.hidden = !unlocked; btn.disabled = false; });
      $$('input,select,textarea,button,a', $('[data-lock-body]', box) || box).forEach(el => {
        if (el.closest('.lock-toolbar')) return;
        if (el.matches('a')) {
          el.setAttribute('aria-disabled', String(!unlocked));
          return;
        }
        el.disabled = !unlocked;
      });
    });
  }

  async function unlockSetupSection(section) {
    if (!isAdmin()) { toast('Nur Admins können diesen Bereich entsperren.'); return false; }
    const label = section === 'cloud' ? 'Google Sheet / Drive entsperren?' : 'Daten, Import & Backup entsperren?';
    if (!(await confirmSensitiveAction(label))) return false;
    setupUnlockedUntil[section] = Date.now() + SETUP_UNLOCK_MS;
    applySetupLocks();
    setTimeout(applySetupLocks, SETUP_UNLOCK_MS + 500);
    toast('Bereich entsperrt. Danach bitte wieder sperren oder kurz warten.');
    return true;
  }

  function lockSetupSection(section) {
    setupUnlockedUntil[section] = 0;
    applySetupLocks();
    toast('Bereich wieder gesperrt.');
  }

  function compactPortalInfoTexts(root = document) {
    const selectors = 'p.hint, p.muted, div.import-hint, div.portal-note';
    $$(selectors, root).forEach(el => {
      if (el.dataset.infoProcessed === 'yes') return;
      if (el.closest('.login-card')) return;
      const text = el.textContent.trim().replace(/\s+/g, ' ');
      if (text.length < 18) return;
      el.dataset.infoProcessed = 'yes';
      el.classList.add('info-compact');
      el.innerHTML = `<button class="info-trigger" type="button" aria-label="Info anzeigen">i</button><span class="info-popover" role="tooltip">${esc(text)}</span>`;
    });
  }

  let floatingInfoPopover = null;

  function ensureFloatingInfoPopover() {
    if (floatingInfoPopover) return floatingInfoPopover;
    floatingInfoPopover = document.createElement('div');
    floatingInfoPopover.className = 'floating-info-popover';
    floatingInfoPopover.setAttribute('role', 'tooltip');
    document.body.appendChild(floatingInfoPopover);
    return floatingInfoPopover;
  }

  function closeFloatingInfoPopover() {
    if (floatingInfoPopover) floatingInfoPopover.classList.remove('open');
    $$('.info-compact.open').forEach(el => el.classList.remove('open'));
  }

  function openFloatingInfoPopover(trigger) {
    const parent = trigger.closest('.info-compact');
    const text = parent?.querySelector('.info-popover')?.textContent?.trim();
    if (!parent || !text) return;
    const pop = ensureFloatingInfoPopover();
    pop.textContent = text;
    pop.classList.add('open');
    $$('.info-compact.open').forEach(el => { if (el !== parent) el.classList.remove('open'); });
    parent.classList.add('open');

    const rect = trigger.getBoundingClientRect();
    const gap = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    pop.style.left = '12px';
    pop.style.top = '12px';
    const popRect = pop.getBoundingClientRect();
    let left = rect.left;
    const maxLeft = vw - popRect.width - 12;
    if (left > maxLeft) left = maxLeft;
    if (left < 12) left = 12;

    let top = rect.bottom + gap;
    const fitsBelow = (rect.bottom + gap + popRect.height) <= (vh - 12);
    if (!fitsBelow) top = Math.max(12, rect.top - popRect.height - gap);

    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  }

  document.addEventListener('click', event => {
    const info = event.target.closest('.info-trigger');
    if (info) {
      event.preventDefault();
      const parent = info.closest('.info-compact');
      if (parent?.classList.contains('open')) closeFloatingInfoPopover();
      else openFloatingInfoPopover(info);
      return;
    }
    if (!event.target.closest('.floating-info-popover') && !event.target.closest('.info-compact')) closeFloatingInfoPopover();
  });

  document.addEventListener('mouseover', event => {
    const info = event.target.closest('.info-trigger');
    if (!info || window.matchMedia('(hover: none)').matches) return;
    openFloatingInfoPopover(info);
  });

  document.addEventListener('mouseout', event => {
    if (window.matchMedia('(hover: none)').matches) return;
    const from = event.target.closest('.info-compact');
    if (!from) return;
    const to = event.relatedTarget;
    if (to && (to.closest('.info-compact') === from || to.closest('.floating-info-popover'))) return;
    closeFloatingInfoPopover();
  });

  window.addEventListener('scroll', () => { if (floatingInfoPopover?.classList.contains('open')) closeFloatingInfoPopover(); }, true);
  window.addEventListener('resize', closeFloatingInfoPopover);

  document.addEventListener('click', event => {
    const unlock = event.target.closest('[data-unlock-section]');
    if (unlock) { event.preventDefault(); unlockSetupSection(unlock.dataset.unlockSection); return; }
    const lock = event.target.closest('[data-lock-now]');
    if (lock) { event.preventDefault(); lockSetupSection(lock.dataset.lockNow); }
  });

  function renderLogin() {
    renderUserOptions();
    $('[data-login-view]').hidden = !!currentUser;
    $('[data-portal-view]').hidden = !currentUser;
    if (!currentUser) return;
    renderPermissions();
    const u = state.users.find(x => x.id === currentUser);
    $('[data-user-pill]').innerHTML = `<span>${esc(userEmoji(currentUser))}</span>${esc(u?.name || currentUser)}${u?.role==='admin'?' · Admin':''}`;
    setTab(activeTab);
    setTimeout(setupSmartStickyNav, 120);
    if (!renderLogin._checkedWebsiteLeads && getSetting('scriptUrl')) {
      renderLogin._checkedWebsiteLeads = true;
      setTimeout(() => autoLoadCloudThenCheckWebsiteLeads(), 900);
    }
  }

  $('[data-login-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const userId = fd.get('user');
    const password = String(fd.get('password') || '');
    const user = state.users.find(u => u.id === userId);
    if (!user || user.active === false) return toast('Benutzer ist nicht aktiv.');
    if (!user.passwordHash) {
      if (password.length < 4) return toast('Bitte mindestens 4 Zeichen verwenden.');
      await setPassword(userId, password);
      toast(`Passwort für ${user.name} gesetzt.`);
    } else if (!(await verifyPassword(user, password))) {
      return toast('Passwort stimmt nicht.');
    }
    currentUser = userId;
    sessionStorage.setItem(SESSION_KEY, currentUser);
    queueActivity('Login', 'Login', '', 'Benutzer hat sich angemeldet.', { flush: true });
    renderLogin();
  });

  function setTab(tab) {
    if (!canAccessTab(tab)) tab = 'dashboard';
    activeTab = tab;
    renderPermissions();
    $$('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $$('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tab));
    const titles = { dashboard:'Übersicht', leads:'Leads', jobs:'Jobs', customers:'Kunden', finance:'Buchhaltung', rewards:'Bonus', settings:'Einstellungen' };
    $('[data-page-title]').textContent = titles[tab] || 'Übersicht';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-tab-go]');
    if (go) setTab(go.dataset.tabGo);
    const pageBtn = event.target.closest('[data-page-target]');
    if (pageBtn) {
      const key = pageBtn.dataset.pageTarget;
      if (pageBtn.dataset.pageReset) listPages[key] = 1;
      else listPages[key] = Math.max(1, (listPages[key] || 1) + Number(pageBtn.dataset.pageDir || 0));
      renderAll();
    }
  });

  function renderAll() {
    if (!currentUser) return;
    renderStats(); renderToday(); renderLeads(); renderJobs(); renderCustomers(); renderFinance(); renderRewards(); renderUsers(); fillSettings(false); updatePortalModeUi(); applySetupLocks(); compactPortalInfoTexts();
  }

  function renderStats() {
    const openLeadCount = activeLeads().length;
    const openJobCount = state.jobs.filter(isOpenJob).length;
    const customerCount = activeCustomers().length;
    const openRewards = state.rewards.filter(r => r.status === 'offen').reduce((s,r)=>s+Number(r.amount||0),0);
    const cards = [['Offene Leads', openLeadCount], ['Offene Jobs', openJobCount], ['Kunden', customerCount]];
    if (isAdmin()) cards.push(['Offener Bonus', `CHF ${openRewards}`]);
    $('[data-stats]').innerHTML = cards.map(([label, value]) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
  }

  function renderToday() {
    const now = Date.now();
    const jobs = state.jobs.filter(j => j.appointmentAt && isOpenJob(j))
      .sort((a,b)=>new Date(a.appointmentAt)-new Date(b.appointmentAt));
    const pageData = paginateItems(jobs, 'today');
    renderPager('today', pageData);
    $('[data-today-list]').innerHTML = pageData.slice.length ? pageData.slice.map(j => {
      const p = personById(j.personId) || {};
      const overdue = new Date(j.appointmentAt).getTime() < now;
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge">${esc(p.id || '')}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · ${esc(fullAddressForPerson(p))}</div></div><span class="badge ${overdue?'danger':'warn'}">${esc(j.status)}</span></div>
        <div class="actions">${customerReminderLink(j)}${calendarButton(j)}${phoneLink(p.phone)}${mapLink(p)}</div>
      </article>`;
    }).join('') : '<div class="empty">Keine offenen Termine.</div>';
  }


  function paginateItems(items, key) {
    const total = items.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (!listPages[key] || listPages[key] < 1) listPages[key] = 1;
    if (listPages[key] > pages) listPages[key] = pages;
    const page = listPages[key];
    const start = 0;
    const end = Math.min(page * PAGE_SIZE, total);
    return { slice: items.slice(start, end), total, page, pages, start, end };
  }

  function renderPager(key, data) {
    const el = $(`[data-${key.slice(0,-1)}-pager]`) || $(`[data-${key}-pager]`);
    if (!el) return;
    if (!data.total) { el.innerHTML = ''; return; }
    const labels = { today:'Termine', leads:'Leads', jobs:'Jobs', customers:'Kunden', income:'Einträge', expenses:'Ausgaben', activity:'Kunden', rewards:'Bonus-Einträge' };
    const label = labels[key] || 'Einträge';
    if (data.total <= PAGE_SIZE) {
      el.innerHTML = `<div class="pager-summary">${data.total} ${label}</div>`;
      return;
    }
    const more = data.end < data.total ? `<button class="secondary" type="button" data-page-target="${key}" data-page-dir="1">Weitere ${Math.min(PAGE_SIZE, data.total - data.end)} anzeigen</button>` : '';
    const less = data.page > 1 ? `<button class="secondary" type="button" data-page-target="${key}" data-page-reset="1">Weniger anzeigen</button>` : '';
    el.innerHTML = `<div class="pager-summary">${data.end} von ${data.total} ${label} angezeigt</div>
      <div class="pager-actions">${more}${less}</div>`;
  }

  function renderLeads() {
    const q = ($('[data-lead-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-lead-filter]')?.value || 'active';
    let leads = [...state.leads].sort((a,b)=>(personById(a.personId)?.name||'').localeCompare(personById(b.personId)?.name||'', 'de-CH') || new Date(b.createdAt)-new Date(a.createdAt));
    if (filter === 'active') leads = leads.filter(l => !['Job erstellt','Job erledigt / Zahlung offen','Kunde geworden','Verloren'].includes(l.status));
    if (filter === 'won') leads = leads.filter(l => ['Job erstellt','Job erledigt / Zahlung offen','Kunde geworden'].includes(l.status));
    if (filter === 'lost') leads = leads.filter(l => l.status === 'Verloren');
    if (q) leads = leads.filter(l => {
      const p = personById(l.personId) || {};
      return [l.id,l.service,l.status,l.source,l.expectedValue,l.appointmentAt,l.notes,p.id,p.name,p.phone,p.email,p.address,p.place].join(' ').toLowerCase().includes(q);
    });
    const pageData = paginateItems(leads, 'leads');
    renderPager('leads', pageData);
    $('[data-lead-list]').innerHTML = pageData.slice.length ? pageData.slice.map(leadCard).join('') : '<div class="empty">Keine Leads gefunden.</div>';
  }

  function leadCard(l) {
    const p = personById(l.personId) || {};
    const ref = personById(l.referredById || p.referredById);
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge badge-id">${esc(p.id || '')}</span></div><div class="item-sub">${esc(l.service || '')} · ${esc(p.place || '')} · erfasst von ${esc(userName(l.createdBy || l.assignedTo || currentUser))}</div></div>
        <div class="badges"><span class="badge ${l.status==='Verloren'?'danger':l.status==='Offen'?'warn':'ok'}">${esc(l.status)}</span>${ref?`<span class="badge ok">Empfohlen von ${esc(ref.name)} · ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(fullAddressForPerson(p))}${l.expectedValue?` · ca. CHF ${esc(l.expectedValue)}`:''}${l.appointmentAt?` · ${fmtDate(l.appointmentAt)}`:''}${l.notes?`<br>${esc(String(l.notes).slice(0,160))}`:''}</div>
      <div class="actions">${waLeadLink(p,l)}${phoneLink(p.phone)}${mapLink(p)}<button class="secondary" data-edit-lead="${esc(l.id)}">Bearbeiten</button>${l.status==='Offen'?`<button class="primary" data-convert-lead="${esc(l.id)}">In Job umwandeln</button><button class="secondary" data-mark-lead-lost="${esc(l.id)}">Verloren</button>`:`<button class="secondary" data-open-person-job="${esc(p.id || '')}">Neuer Job</button>`}</div>
    </article>`;
  }

  function renderJobs() {
    const q = ($('[data-job-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-job-filter]')?.value || 'open';
    let jobs = [...state.jobs].sort((a,b)=>new Date(a.appointmentAt || a.createdAt)-new Date(b.appointmentAt || b.createdAt));
    if (filter === 'open') jobs = jobs.filter(isOpenJob);
    if (filter === 'unpaid') jobs = jobs.filter(j => isOpenJob(j) && amountValue(j.amount) > 0);
    if (filter === 'done') jobs = jobs.filter(isCompletedJob);
    if (q) jobs = jobs.filter(j => {
      const p = personById(j.personId) || {};
      return [j.id,j.service,j.status,j.amount,j.appointmentAt,j.source,p.id,p.name,p.phone,p.email,p.address,p.place].join(' ').toLowerCase().includes(q);
    });
    const pageData = paginateItems(jobs, 'jobs');
    renderPager('jobs', pageData);
    $('[data-job-list]').innerHTML = pageData.slice.length ? pageData.slice.map(jobCard).join('') : '<div class="empty">Keine Jobs gefunden.</div>';
  }

  function jobCard(j) {
    const p = personById(j.personId) || {};
    const paid = isPaidJob(j);
    const cancelled = isCancelledJob(j);
    const statusLabel = paid ? 'Bezahlt / abgeschlossen' : (cancelled ? 'Abgesagt' : `${j.status || 'Geplant'} · Zahlung offen`);
    const statusClass = paid ? 'ok' : (cancelled ? 'danger' : 'warn');
    const ref = personById(j.referredById || p.referredById);
    const currentAmount = amountValue(j.amount);
    const customerTotal = p.status === 'customer' ? totalRevenueForPerson(p.id) : 0;
    const amountBadges = p.status === 'customer'
      ? `${currentAmount ? `<span class="badge money-badge order">Auftrag ${esc(money(currentAmount))}</span>` : ''}<span class="badge money-badge total">Umsatz total ${esc(money(customerTotal))}</span>`
      : (currentAmount ? `<span class="badge money-badge order">Auftrag ${esc(money(currentAmount))}</span>` : '');
    const syncBadges = jobSyncBadges(j);
    const photos = photoPreviewHtml([j.beforePhoto, j.afterPhoto], true);
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge badge-id">${esc(p.id || '')}</span> <span class="badge ${p.status==='customer'?'ok':'warn'}">${p.status==='customer'?'Kunde':'Lead'}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · zuständig: ${esc(userName(j.assignedTo || j.createdBy || currentUser))}</div></div>
        <div class="badges"><span class="badge ${statusClass}">${esc(statusLabel)}</span>${paid?`<span class="badge ok">Zahlung erledigt</span>`:'<span class="badge warn">Zahlung offen</span>'}${amountBadges}${syncBadges}${ref?`<span class="badge ok">Empfohlen von ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(fullAddressForPerson(p))}</div>
      ${photos ? `<div class="photo-preview">${photos}</div>` : ''}
      <div class="actions">${customerReminderLink(j)}${calendarButton(j)}${phoneLink(p.phone)}${mapLink(p)}${reviewLink(p, j)}<button class="secondary" data-edit-job="${esc(j.id)}">Bearbeiten</button>${!cancelled && !paid ? `<button class="primary" data-complete-job="${esc(j.id)}">Job erledigt &amp; bezahlt</button>` : ''}</div>
    </article>`;
  }

  function jobSyncBadges(job) {
    const badges = [];
    const photos = [job?.beforePhoto, job?.afterPhoto].filter(Boolean);
    if (photos.some(ph => ph?.error)) badges.push('<span class="badge danger">Foto Sync Fehler</span>');
    else if (photos.some(ph => ph?.dataUrl || ph?.localOnly)) badges.push('<span class="badge warn">Foto wartet auf Drive</span>');
    else if (photos.some(ph => ph?.url || ph?.driveUrl)) badges.push('<span class="badge ok">Fotos in Drive</span>');

    if (job?.appointmentAt && !isCancelledJob(job)) {
      const status = String(job.calendarSyncStatus || '');
      if (status.toLowerCase().includes('fehler') || status.toLowerCase().includes('nicht gefunden')) badges.push('<span class="badge danger">Kalender Fehler</span>');
      else if (job.calendarEventId || status.toLowerCase().includes('synchronisiert')) badges.push('<span class="badge ok">Kalender sync</span>');
      else badges.push('<span class="badge warn">Kalender wartet</span>');
    }
    return badges.join('');
  }

  function renderCustomers() {
    const q = ($('[data-customer-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-customer-filter]')?.value || 'all';
    let customers = activeCustomers();
    if (filter === 'active') customers = customers.filter(p => contactStatus(p) === 'Aktiv');
    if (filter === 'inactive') customers = customers.filter(p => contactStatus(p) === 'Inaktiv / Pause');
    if (filter === 'blocked') customers = customers.filter(p => contactStatus(p) === 'Nicht kontaktieren');
    if (filter === 'problem') customers = customers.filter(p => contactStatus(p) === 'Problemfall');
    if (q) customers = customers.filter(p => [p.id,p.name,p.phone,p.email,p.address,p.place,p.source,p.contactStatus,p.contactReason,p.contactNote].join(' ').toLowerCase().includes(q));
    const pageData = paginateItems(customers, 'customers');
    renderPager('customers', pageData);
    $('[data-customer-list]').innerHTML = pageData.slice.length ? pageData.slice.map(customerCard).join('') : '<div class="empty">Noch keine Kunden gefunden. Kunde manuell hinzufügen, importieren oder Job als erledigt markieren.</div>';
  }

  function customerCard(p) {
    const jobs = state.jobs.filter(j => j.personId === p.id);
    const paidJobsCount = paidJobsForPerson(p.id).length;
    const openJobsCount = jobs.filter(isOpenJob).length;
    const revenueTotal = totalRevenueForPerson(p.id);
    const link = referralLink(p.id);
    const blocked = isContactBlocked(p);
    const warning = contactWarningText(p);
    const contactActions = blocked
      ? `<button class="secondary" data-show-contact-warning="${esc(p.id)}">Kontakt gesperrt</button>`
      : `${whatsappLink(p.phone, referralInviteText(p), 'Empfehlungslink senden', true)}${reviewLink(p)}${phoneLink(p.phone)}<button class="secondary" data-copy-ref="${esc(p.id)}">Link kopieren</button>`;
    return `<article class="item-card ${blocked ? 'contact-blocked' : ''}">
      <div class="item-top"><div><div class="item-title">${esc(p.name)} <span class="badge badge-id">${esc(p.id)}</span> ${contactBadge(p)}</div><div class="item-sub">${esc(fullAddressForPerson(p) || p.address || '')}</div>${warning ? `<div class="item-warning">${esc(warning)}</div>` : ''}</div><div class="badges"><span class="badge">${jobs.length} Job(s)</span><span class="badge ok">${paidJobsCount} bezahlt</span>${openJobsCount ? `<span class="badge warn">${openJobsCount} offen</span>` : ''}<span class="badge money-badge total">Umsatz total ${esc(money(revenueTotal))}</span><span class="badge">${esc(p.source || 'Quelle offen')}</span></div></div>
      <div class="referral-link-line"><span>Empfehlungslink</span><strong>${esc(link)}</strong></div>
      <div class="actions">${contactActions}${mapLink(p)}<button class="secondary" data-edit-customer="${esc(p.id)}">Bearbeiten</button><button class="secondary" data-open-person-job="${esc(p.id)}">Neuer Job</button></div>
    </article>`;
  }


  function money(value) {
    return `CHF ${amountValue(value).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function amountValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    let s = String(value ?? '').trim();
    if (!s) return 0;
    s = s.replace(/CHF/ig,'').replace(/Fr\.?/ig,'').replace(/'/g,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      s = lastComma > lastDot ? s.replace(/\./g,'').replace(',', '.') : s.replace(/,/g,'');
    } else {
      s = s.replace(/,/g,'.');
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }
  function isPaidJob(job = {}) {
    const status = String(job.status || '').toLowerCase();
    return status === 'bezahlt' || status.includes('bezahlt') || !!job.paidAt;
  }
  function isCompletedJob(job = {}) {
    // A job is completed only when payment is confirmed.
    return isPaidJob(job);
  }
  function isCancelledJob(job = {}) {
    const status = String(job.status || '').toLowerCase();
    return status === 'abgesagt' || status.includes('abgesagt');
  }
  function isOpenJob(job = {}) {
    return !isPaidJob(job) && !isCancelledJob(job);
  }

  function paidJobsForPerson(personId) {
    if (!personId) return [];
    return state.jobs.filter(j => j.personId === personId && isPaidJob(j) && amountValue(j.amount) > 0);
  }

  function totalRevenueForPerson(personId) {
    return paidJobsForPerson(personId).reduce((sum, j) => sum + amountValue(j.amount), 0);
  }

  function ymd(d) {
    if (!d) return '';
    if (typeof d === 'string') {
      const raw = d.trim();
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const swiss = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (swiss) return `${swiss[3]}-${swiss[2].padStart(2,'0')}-${swiss[1].padStart(2,'0')}`;
    }
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    // Use local date parts, not UTC, so Swiss browser time does not shift month/week ends by one day.
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }
  function financeJobDate(job) {
    return job.paidAt || job.completedAt || job.appointmentAt || job.updatedAt || job.createdAt || '';
  }
  function dateInRange(value, from, to) {
    const d = ymd(value);
    if (!d) return false;
    return (!from || d >= from) && (!to || d <= to);
  }
  function getFinanceRange() {
    const period = $('[data-finance-period]')?.value || 'month';
    const now = new Date();
    let from = '', to = ymd(now), label = '';
    const start = new Date(now);
    if (period === 'todate') {
      from = '';
      to = ymd(now);
      label = 'Bisher / bis heute';
    } else if (period === 'week') {
      const day = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - day);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      from = ymd(start);
      to = ymd(end);
      label = 'Diese Woche';
    } else if (period === 'year') {
      from = `${now.getFullYear()}-01-01`;
      to = `${now.getFullYear()}-12-31`;
      label = 'Dieses Jahr';
    } else if (period === 'custom') {
      from = isoDateOnlyFromField($('[data-finance-from]')?.value || '');
      to = isoDateOnlyFromField($('[data-finance-to]')?.value || '') || to;
      label = from || to ? `${from ? fmtDateOnly(from) : '...'} bis ${to ? fmtDateOnly(to) : '...'}` : 'Benutzerdefiniert';
    } else {
      const month = String(now.getMonth()+1).padStart(2,'0');
      from = `${now.getFullYear()}-${month}-01`;
      to = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
      label = 'Dieser Monat';
    }
    return { period, from, to, label };
  }
  function completedJobs() {
    return state.jobs.filter(isCompletedJob);
  }
  function paidJobs() {
    return state.jobs.filter(isPaidJob);
  }
  function isPipelineAllOpen(range) {
    return range?.period === 'todate';
  }
  function forecastJobs(range) {
    return state.jobs
      .filter(isOpenJob)
      .filter(j => amountValue(j.amount) > 0)
      // Bei "Bisher / bis heute" ist die echte Buchhaltung bis heute,
      // aber die Pipeline soll alle aktuell offenen Jobs zeigen, auch zukünftige Termine.
      .filter(j => isPipelineAllOpen(range) || dateInRange(j.appointmentAt || j.createdAt, range.from, range.to))
      .map(j => {
        const p = personById(j.personId) || {};
        return { type:'Pipeline', id:j.id, date:j.appointmentAt || j.createdAt, title:`${p.name || j.personId} · ${j.service || 'Reinigung'}`, amount:amountValue(j.amount), personId:j.personId, jobId:j.id, status:j.status, createdBy:j.createdBy || '', assignedTo:j.assignedTo || '' };
      });
  }
  function forecastLeadItems(range) {
    return state.leads
      .filter(l => !['Job erstellt','Job erledigt / Zahlung offen','Kunde geworden','Verloren'].includes(l.status))
      .filter(l => amountValue(l.expectedValue) > 0)
      // Bei "Bisher / bis heute" bleibt Pipeline offen = alles, was offen ist.
      .filter(l => isPipelineAllOpen(range) || dateInRange(l.appointmentAt || l.createdAt, range.from, range.to))
      .map(l => {
        const p = personById(l.personId) || {};
        return { type:'Lead Schätzung', id:l.id, date:l.appointmentAt || l.createdAt, title:`${p.name || l.personId} · ${l.service || 'Reinigung'}`, amount:amountValue(l.expectedValue), personId:l.personId, leadId:l.id, status:l.status || 'Offen', createdBy:l.createdBy || '', assignedTo:'' };
      });
  }
  function jobIncomeItems(range) {
    return paidJobs().filter(j => dateInRange(financeJobDate(j), range.from, range.to)).map(j => {
      const p = personById(j.personId) || {};
      return { type:'Job bezahlt', id:j.id, date:financeJobDate(j), title:`${p.name || j.personId} · ${j.service || 'Reinigung'}`, amount:amountValue(j.amount), personId:j.personId, jobId:j.id, createdBy:j.createdBy || '', assignedTo:j.assignedTo || '' };
    });
  }
  function manualIncomeItems(range) {
    return (state.finance?.manualIncome || []).filter(x => !x.deletedAt).filter(x => {
      const start = x.from || x.date || x.createdAt;
      const end = x.to || start;
      return (!range.from || end >= range.from) && (!range.to || start <= range.to);
    }).map(x => ({ type:'Manuell', id:x.id, date:x.from || x.createdAt, from:x.from || '', to:x.to || '', title:x.title || 'Manuelle Einnahme', amount:amountValue(x.amount), notes:x.notes || '', createdBy:x.createdBy || '' }));
  }
  function expenseItems(range) {
    return (state.finance?.expenses || []).filter(x => !x.deletedAt).filter(x => dateInRange(x.date || x.createdAt, range.from, range.to)).map(x => ({ ...x, amount:amountValue(x.amount) }));
  }
  function financeSummary(range) {
    const jobs = jobIncomeItems(range);
    const manual = manualIncomeItems(range);
    const expenses = expenseItems(range);
    const forecast = forecastJobs(range);
    const forecastLeads = forecastLeadItems(range);
    const forecastAll = [...forecast, ...forecastLeads];
    const jobIncome = jobs.reduce((s,x)=>s+amountValue(x.amount),0);
    const manualIncome = manual.reduce((s,x)=>s+amountValue(x.amount),0);
    const expenseTotal = expenses.reduce((s,x)=>s+amountValue(x.amount),0);
    const forecastTotal = forecastAll.reduce((s,x)=>s+amountValue(x.amount),0);
    return { jobs, manual, expenses, forecast, forecastLeads, forecastAll, jobIncome, manualIncome, incomeTotal:jobIncome+manualIncome, expenseTotal, profit:jobIncome+manualIncome-expenseTotal, forecastTotal };
  }

  function canEditFinanceEntry(x) {
    return !!x && (x.createdBy === currentUser);
  }

  function updateFinanceDateControls(range) {
    const fromWrap = $('[data-finance-from-wrap]');
    const toWrap = $('[data-finance-to-wrap]');
    const fromInput = $('[data-finance-from]');
    const toInput = $('[data-finance-to]');
    const applyBtn = $('[data-finance-apply]');
    const isCustom = range.period === 'custom';
    [fromWrap, toWrap].filter(Boolean).forEach(el => { el.hidden = !isCustom; });
    if (applyBtn) applyBtn.hidden = !isCustom;
    if (!isCustom) {
      if (fromInput) fromInput.value = range.from ? nativeDateValueFromField(range.from) : '';
      if (toInput) toInput.value = range.to ? nativeDateValueFromField(range.to) : '';
    }
    if (range.period === 'todate') {
      if (fromInput) fromInput.value = '';
      if (toInput) toInput.value = '';
    }
  }

  function renderFinance() {
    if (!$('[data-finance-stats]') || !isAdmin()) return;
    const range = getFinanceRange();
    updateFinanceDateControls(range);
    const s = financeSummary(range);
    $('[data-finance-period-label]').textContent = range.label;
    $('[data-finance-stats]').innerHTML = [
      ['Bezahlte Jobs', money(s.jobIncome), `${s.jobs.length} kassierte Jobs`],
      ['Manuell ergänzt', money(s.manualIncome), `${s.manual.length} Eintrag(e)`],
      ['Pipeline offen', money(s.forecastTotal), `${s.forecast.length} Job(s) + ${s.forecastLeads.length} Lead(s)`],
      ['Ausgaben', money(s.expenseTotal), `${s.expenses.length} Kostenposition(en)`],
      ['Gewinn', money(s.profit), 'bezahlte Einnahmen minus Ausgaben']
    ].map(([label,val,sub]) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(val)}</strong><em>${esc(sub)}</em></div>`).join('');

    renderFinanceChart(s);
    const incomes = [...s.jobs, ...s.manual].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const incomePage = paginateItems(incomes, 'income');
    renderPager('income', incomePage);
    $('[data-income-count]').textContent = `${incomes.length} Eintrag(e)`;
    $('[data-income-list]').innerHTML = incomePage.slice.length ? incomePage.slice.map(x => {
      const by = x.createdBy ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const editBtns = x.type === 'Manuell' && canEditFinanceEntry(x) ? `<div class="actions"><button class="secondary" data-edit-manual-income="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-manual-income="${esc(x.id)}">Löschen</button></div>` : (x.jobId ? `<div class="actions"><button class="secondary" data-edit-job="${esc(x.jobId)}">Job/Zahlung bearbeiten</button></div>` : '');
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.type)} · ${esc(fmtDateOnly(x.date))}${by}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><span class="badge ok">${esc(money(x.amount))}</span></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine Einnahmen im Zeitraum.</div>';

    const sortedExpenses = [...s.expenses].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const expensePage = paginateItems(sortedExpenses, 'expenses');
    renderPager('expenses', expensePage);
    $('[data-expense-count]').textContent = `${s.expenses.length} Eintrag(e)`;
    $('[data-expense-list]').innerHTML = expensePage.slice.length ? expensePage.slice.map(x => {
      const by = x.createdBy ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const editBtns = canEditFinanceEntry(x) ? `<div class="actions"><button class="secondary" data-edit-expense="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-expense="${esc(x.id)}">Löschen</button></div>` : '';
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.category || 'Ausgabe')} · ${esc(fmtDateOnly(x.date))}${by}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><span class="badge danger">${esc(money(x.amount))}</span></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine Ausgaben im Zeitraum.</div>';

    renderCustomerActivity(range);
  }
  function renderFinanceChart(s) {
    const max = Math.max(s.incomeTotal, s.forecastTotal || 0, s.expenseTotal, Math.abs(s.profit), 1);
    const rows = [
      ['Bezahlte Einnahmen', s.incomeTotal, 'income'],
      ['Pipeline offen', s.forecastTotal, 'forecast'],
      ['Ausgaben', s.expenseTotal, 'expense'],
      ['Gewinn', s.profit, s.profit >= 0 ? 'profit' : 'loss']
    ];
    $('[data-finance-chart]').innerHTML = rows.map(([label,val,cls]) => {
      const w = Math.max(4, Math.round(Math.abs(val) / max * 100));
      return `<div class="bar-row"><div class="bar-label">${esc(label)}</div><div class="bar-track"><span class="${esc(cls)}" style="width:${w}%"></span></div><strong>${esc(money(val))}</strong></div>`;
    }).join('');
  }
  function renderCustomerActivity(range) {
    const rows = state.people.map(p => {
      const allJobs = completedJobs().filter(j => j.personId === p.id);
      const inRange = allJobs.filter(j => dateInRange(financeJobDate(j), range.from, range.to));
      const revenue = inRange.reduce((s,j)=>s+amountValue(j.amount),0);
      const last = allJobs.map(financeJobDate).filter(Boolean).sort().pop() || '';
      const days = last ? Math.round((new Date() - new Date(last)) / 86400000) : null;
      return { p, allJobs, inRange, revenue, last, days };
    }).filter(r => r.allJobs.length || r.p.status === 'customer');

    const sort = $('[data-customer-activity-sort]')?.value || 'revenue';
    rows.sort((a,b) => {
      if (sort === 'jobs') return b.inRange.length - a.inRange.length || b.revenue - a.revenue;
      if (sort === 'last') return String(b.last).localeCompare(String(a.last));
      if (sort === 'name') return (a.p.name||'').localeCompare(b.p.name||'', 'de-CH');
      return b.revenue - a.revenue || b.inRange.length - a.inRange.length;
    });

    const pageData = paginateItems(rows, 'activity');
    renderPager('activity', pageData);
    $('[data-customer-activity-list]').innerHTML = pageData.slice.length ? pageData.slice.map(r => {
      const inactive = r.days !== null && r.days > 90;
      const status = r.last ? `Letzter Job: ${fmtDate(r.last)}${inactive ? ' · lange nicht kontaktiert' : ''}` : 'Noch kein erledigter Job';
      return `<article class="item-card mini">
        <div class="item-top"><div><div class="item-title">${esc(r.p.name || r.p.id)} <span class="badge">${esc(r.p.id)}</span></div><div class="item-sub">${esc(status)}</div></div><div class="badges"><span class="badge ok">${esc(money(r.revenue))}</span><span class="badge">${r.inRange.length} Job(s) im Zeitraum</span><span class="badge">${r.allJobs.length} total</span>${inactive ? '<span class="badge warn">Nachfassen</span>' : ''}</div></div>
        <div class="actions">${phoneLink(r.p.phone)}${whatsappLink(r.p.phone, `Hoi ${r.p.name || ''}, wir hoffen, es geht Ihnen gut. Falls Fenster, Dachrinne, Terrasse oder Solaranlage wieder Reinigung brauchen, melden Sie sich gerne bei Lumian Services.`, 'WhatsApp Nachfassen')}${reviewLink(r.p)}<button class="secondary" data-open-person-job="${esc(r.p.id)}">Neuer Job</button></div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Kundenaktivität.</div>';
  }


  function renderRewards() {
    if (!$('[data-reward-list]') || !isAdmin()) return;
    const rewards = [...state.rewards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const pageData = paginateItems(rewards, 'rewards');
    renderPager('rewards', pageData);
    $('[data-reward-list]').innerHTML = pageData.slice.length ? pageData.slice.map(r => {
      const receiver = personById(r.customerId); const from = personById(r.fromPersonId);
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">CHF ${esc(r.amount)} Guthaben für ${esc(receiver?.name || r.customerId)}</div><div class="item-sub">Empfohlen hat: ${esc(receiver?.id || '')} · neuer Kunde: ${esc(from?.name || r.fromPersonId)} · Job ${esc(r.jobId || '')}</div></div><span class="badge ${r.status==='offen'?'warn':'ok'}">${esc(r.status)}</span></div>
        <div class="actions"><button class="secondary" data-toggle-reward="${esc(r.id)}">${r.status==='offen'?'Als gutgeschrieben markieren':'Wieder offen'}</button>${whatsappLink(receiver?.phone, `Hoi ${receiver?.name || ''}, danke für deine Empfehlung. Dein CHF ${r.amount} Guthaben wurde bei Lumian Services notiert.`, 'WhatsApp')}</div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Boni. Sie entstehen automatisch, wenn ein Empfehlungs-Job erledigt wird und der Mindestauftrag erreicht ist.</div>';
  }

  function mapLink(target) {
    const q = typeof target === 'string' ? target : fullAddressForPerson(target || {});
    return q ? `<a class="secondary" href="https://maps.google.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Maps</a>` : '';
  }
  function phoneLink(phone) { const p = parseSwissPhone(phone); return p.ok && !p.empty ? `<a class="secondary" href="tel:${esc(p.tel)}">Anrufen</a>` : ''; }
  function smsLink(phone, text='') { return ''; }
  function isLikelySwissMobile(parsed) { return parsed?.ok && !parsed.empty && /^417[4-9]\d{7}$/.test(parsed.wa); }
  function waUrlFor(phone, text) { const p = parseSwissPhone(phone); if (!p.ok || p.empty || !p.wa) return ''; return `https://api.whatsapp.com/send?phone=${p.wa}&text=${encodeURIComponent(text)}`; }
  function whatsappLink(phone, text, label='WhatsApp', primary=false) { const url = waUrlFor(phone, text); return url ? `<a class="${primary?'primary':'secondary'}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : ''; }
  function waBusinessUrl(text) { const n = normalizeBusinessPhone(getSetting('businessPhone')); return n ? `https://api.whatsapp.com/send?phone=${n}&text=${encodeURIComponent(text)}` : '#'; }
  function customerReminderLink(job) { const p = personById(job.personId) || {}; return whatsappLink(p.phone, reminderText(job), 'Erinnerung senden', true); }
  function calendarButton(job) { return (!isCompletedJob(job) && !isCancelledJob(job)) ? `<button class="secondary" data-calendar-job="${esc(job.id)}">Kalender</button>` : ''; }
  function waLeadLink(p,l) { return whatsappLink(p.phone, newCustomerText(p,l), 'WhatsApp'); }
  function reviewLink(p, job = {}) { const link = googleReviewLink(); return link ? whatsappLink(p?.phone, reviewText(p, job), 'Google Review') : ''; }

  function referralInviteText(p) {
    return fillTemplate(getSetting('referralTemplate'), { name:p.name||'', customerId:p.id||'', code:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), referralLink:referralLink(p.id) });
  }
  function newCustomerText(p,l={}) {
    return fillTemplate(getSetting('newCustomerTemplate'), { name:p.name||'', customerId:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), service:l.service||'', amount:l.expectedValue||'', address:fullAddressForPerson(p)||'' });
  }
  function reminderText(j) {
    const p = personById(j.personId) || {};
    return fillTemplate(getSetting('reminderTemplate'), { name:p.name||'', customerId:p.id||'', date:fmtDate(j.appointmentAt), service:j.service||'', amount:j.amount||'', address:fullAddressForPerson(p)||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder') });
  }
  function reviewText(p = {}, j = {}) {
    return fillTemplate(getSetting('reviewTemplate'), { name:p.name||'', customerId:p.id||'', date:j.appointmentAt ? fmtDate(j.appointmentAt) : '', service:j.service||'', amount:j.amount||'', address:fullAddressForPerson(p)||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), referralLink:referralLink(p.id||''), googleReviewLink:googleReviewLink() });
  }

  function openCustomerDialog(person = null) {
    const form = $('[data-customer-form]');
    if (!form) return;
    form.reset();
    form.elements.source.value = 'Import / Manuell';
    form.elements.contactStatus.value = 'Aktiv';
    form.elements.contactReason.value = '';
    if (person) {
      form.elements.personId.value = person.id || '';
      form.elements.name.value = person.name || '';
      form.elements.phone.value = person.phone || '';
      form.elements.email.value = person.email || '';
      form.elements.address.value = person.address || '';
      form.elements.place.value = person.place || '';
      form.elements.source.value = person.source || 'Import / Manuell';
      form.elements.contactStatus.value = person.contactStatus || 'Aktiv';
      form.elements.contactReason.value = person.contactReason || '';
      form.elements.contactNote.value = person.contactNote || '';
      form.elements.notes.value = person.notes || '';
      $('[data-customer-modal-title]').textContent = `Kunde bearbeiten: ${person.name || person.id}`;
      $('[data-customer-submit]').textContent = 'Änderungen speichern';
    } else {
      form.elements.personId.value = '';
      $('[data-customer-modal-title]').textContent = 'Kunde manuell hinzufügen';
      $('[data-customer-submit]').textContent = 'Kunde speichern';
    }
    $('[data-customer-dialog]').showModal();
  }

  function openLeadDialog(lead = null) {
    const form = $('[data-lead-form]');
    if (!form) return;
    form.reset();
    form.elements.source.value = 'WhatsApp';
    form.elements.referredById.value = '';
    form.elements.leadId.value = '';
    form.elements.personId.value = '';
    $('[data-lead-modal-title]').textContent = 'Lead hinzufügen';
    $('[data-lead-submit]').textContent = 'Lead speichern';
    if (lead) {
      const person = personById(lead.personId) || {};
      form.elements.leadId.value = lead.id || '';
      form.elements.personId.value = person.id || lead.personId || '';
      form.elements.name.value = person.name || '';
      form.elements.phone.value = person.phone || '';
      form.elements.email.value = person.email || '';
      form.elements.address.value = person.address || '';
      form.elements.place.value = person.place || '';
      form.elements.service.value = lead.service || form.elements.service.value;
      form.elements.source.value = lead.source || person.source || 'Website';
      form.elements.expectedValue.value = lead.expectedValue || '';
      form.elements.appointmentAt.value = nativeDateTimeValueFromField(lead.appointmentAt) || '';
      form.elements.referredById.value = lead.referredById || person.referredById || '';
      if (form.elements.referredById.value) setRefField('lead', form.elements.referredById.value);
      form.elements.notes.value = lead.notes || '';
      $('[data-lead-modal-title]').textContent = `Lead bearbeiten: ${person.name || lead.id}`;
      $('[data-lead-submit]').textContent = 'Änderungen speichern';
    }
    $('[data-ref-suggestions="lead"]').hidden = true;
    $('[data-lead-dialog]').showModal();
    requestAnimationFrame(() => syncAllCalendarControls(form));
  }

  function fillJobPerson(form, person, lead = null) {
    if (!form || !person) return;
    if (isContactBlocked(person)) toast(`Achtung: ${person.name || person.id} ist als ${contactStatus(person)} markiert.`);
    form.elements.personId.value = person.id || '';
    form.elements.personSearch.value = `${person.name || 'Ohne Name'} · ${person.id || ''} · ${personStatusLabel(person)}`;
    form.elements.name.value = person.name || '';
    form.elements.phone.value = person.phone || '';
    form.elements.email.value = person.email || '';
    form.elements.address.value = person.address || '';
    form.elements.place.value = person.place || '';
    form.elements.source.value = person.source || 'WhatsApp';
    if (person.referredById) setRefField('job', person.referredById);
    const linkedLead = lead || leadForPerson(person.id);
    if (linkedLead) {
      form.elements.leadId.value = linkedLead.id || '';
      form.elements.service.value = linkedLead.service || form.elements.service.value;
      form.elements.appointmentAt.value = nativeDateTimeValueFromField(linkedLead.appointmentAt) || form.elements.appointmentAt.value || '';
      form.elements.amount.value = linkedLead.expectedValue || form.elements.amount.value || '';
      form.elements.source.value = linkedLead.source || form.elements.source.value;
      if (linkedLead.referredById) setRefField('job', linkedLead.referredById);
    }
  }

  function openJobDialog(job = null, lead = null, person = null) {
    renderUserOptions();
    const form = $('[data-job-form]'); form.reset(); stagedPhotos = { before:null, after:null }; $('[data-photo-preview]').innerHTML = '';
    if (job) { person = personById(job.personId); lead = job.leadId ? leadById(job.leadId) : null; }
    if (person) fillJobPerson(form, person, lead);
    if (lead) {
      form.elements.leadId.value = lead.id;
      form.elements.service.value = lead.service || form.elements.service.value;
      form.elements.appointmentAt.value = nativeDateTimeValueFromField(lead.appointmentAt) || '';
      form.elements.amount.value = lead.expectedValue || '';
      form.elements.source.value = lead.source || form.elements.source.value;
      if (lead.referredById) setRefField('job', lead.referredById);
    }
    if (job) {
      form.elements.jobId.value = job.id;
      form.elements.leadId.value = job.leadId || '';
      form.elements.service.value = job.service || form.elements.service.value;
      form.elements.appointmentAt.value = nativeDateTimeValueFromField(job.appointmentAt) || '';
      form.elements.amount.value = job.amount || '';
      form.elements.status.value = job.status || 'Geplant';
      form.elements.assignedTo.value = job.assignedTo || currentUser || 'noah';
      form.elements.source.value = job.source || form.elements.source.value;
      form.elements.notes.value = job.notes || '';
      if (job.referredById) setRefField('job', job.referredById);
      stagedPhotos.before = job.beforePhoto || null;
      stagedPhotos.after = job.afterPhoto || null;
      $('[data-photo-preview]').innerHTML = photoPreviewHtml([stagedPhotos.before, stagedPhotos.after]);
      $('[data-job-modal-title]').textContent = 'Job bearbeiten';
    } else {
      form.elements.jobId.value = '';
      form.elements.status.value = 'Geplant';
      form.elements.assignedTo.value = currentUser || 'noah';
      $('[data-job-modal-title]').textContent = lead ? 'Lead in Job umwandeln' : 'Job direkt erstellen';
    }
    $('[data-ref-suggestions="job"]').hidden = true;
    $('[data-job-dialog]').showModal();
    requestAnimationFrame(() => syncAllCalendarControls(form));
  }

  $$('[data-open-lead]').forEach(btn => btn.addEventListener('click', () => openLeadDialog()));
  $$('[data-open-job]').forEach(btn => btn.addEventListener('click', () => openJobDialog()));
  $$('[data-open-customer]').forEach(btn => btn.addEventListener('click', openCustomerDialog));
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog')?.close()));
  $('[data-forgot-password]')?.addEventListener('click', () => $('[data-reset-dialog]').showModal());

  $('[data-customer-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !validateContactFields(form)) return;
    const fd = new FormData(form);
    const p = findOrCreatePerson({
      personId: fd.get('personId'),
      name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: ''
    });
    p.status = 'customer';
    p.customerSince = p.customerSince || new Date().toISOString();
    p.contactStatus = fd.get('contactStatus') || 'Aktiv';
    p.contactReason = fd.get('contactReason') || '';
    p.contactNote = fd.get('contactNote') || '';
    p.notes = fd.get('notes') || p.notes || '';
    saveState(`Kunde gespeichert: ${p.id} / ${p.name || ''}`);
    form.closest('dialog').close();
    setTab('customers');
    toast(`Kunde gespeichert: ${p.id}`);
  });

  $('[data-lead-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !validateContactFields(form)) return;
    if (markInvalidDateInput(form.elements.appointmentAt, 'Besichtigung/Termin', true)) return;
    const fd = new FormData(form);
    const p = findOrCreatePerson({
      personId: fd.get('personId'), name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: fd.get('referredById')
    });
    const existingId = String(fd.get('leadId') || '').trim();
    let lead = existingId ? leadById(existingId) : null;
    if (!lead) {
      lead = { id: nextId('lead'), createdAt: new Date().toISOString(), createdBy: currentUser, status: 'Offen' };
      state.leads.push(lead);
    } else {
      lead.updatedAt = new Date().toISOString();
      lead.updatedBy = currentUser;
    }
    Object.assign(lead, {
      personId: p.id,
      service: fd.get('service'),
      source: fd.get('source'),
      expectedValue: fd.get('expectedValue'),
      appointmentAt: isoDateTimeFromField(fd.get('appointmentAt')),
      referredById: fd.get('referredById'),
      status: lead.status || 'Offen',
      notes: fd.get('notes'),
      websiteLeadKey: lead.websiteLeadKey || p.websiteLeadKey || ''
    });
    saveState(`${existingId ? 'Lead geändert' : 'Lead erstellt'}: ${lead.id} / ${p.name || p.id}`); form.closest('dialog').close(); setTab('leads'); toast(existingId ? `Lead geändert: ${p.id}` : `Lead gespeichert: ${p.id}`);
  });

  $('[data-job-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !validateContactFields(form)) return;
    if (markInvalidDateInput(form.elements.appointmentAt, 'Termin', true)) return;
    const fd = new FormData(form);
    const lead = fd.get('leadId') ? leadById(fd.get('leadId')) : null;
    const p = findOrCreatePerson({
      personId: fd.get('personId'), name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: fd.get('referredById') || lead?.referredById || ''
    });
    const existingJobId = String(fd.get('jobId') || '').trim();
    let job = existingJobId ? jobById(existingJobId) : null;
    if (!job) {
      job = { id: nextId('job'), personId: p.id, createdAt: new Date().toISOString(), createdBy: currentUser };
      state.jobs.push(job);
    }
    Object.assign(job, {
      personId: p.id,
      leadId: fd.get('leadId') || job.leadId || '',
      service: fd.get('service'),
      appointmentAt: isoDateTimeFromField(fd.get('appointmentAt')),
      amount: fd.get('amount'),
      status: fd.get('status'),
      assignedTo: fd.get('assignedTo'),
      source: fd.get('source'),
      referredById: fd.get('referredById') || job.referredById || p.referredById || '',
      notes: fd.get('notes'),
      beforePhoto: stagedPhotos.before || job.beforePhoto || null,
      afterPhoto: stagedPhotos.after || job.afterPhoto || null,
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser
    });
    job = Object.assign(job, normalizeJobForNoUnpaidDone(job));
    if (job.status === 'Bezahlt') job.paidAt = job.paidAt || new Date().toISOString();
    else { delete job.paidAt; delete job.completedAt; }
    if (lead) lead.status = 'Job erstellt';
    if (isCompletedJob(job)) completeJob(job.id, false);
    saveState(`${existingJobId ? 'Job geändert' : (lead ? 'Lead in Job umgewandelt' : 'Job erstellt')}: ${job.id} / ${p.name || p.id}`); form.closest('dialog').close(); setTab('jobs');
    const needsMediaSync = !!(job.beforePhoto?.dataUrl || job.afterPhoto?.dataUrl || job.appointmentAt);
    const calMsg = job.appointmentAt && calendarSyncTarget() ? ' Termin wird automatisch mit Google Calendar synchronisiert.' : '';
    toast(job.status === 'Bezahlt' ? `Job bezahlt und abgeschlossen: ${p.id}.${calMsg}` : `Job gespeichert: ${p.id}.${calMsg}`);
    if (needsMediaSync && currentScriptUrl()) {
      setTimeout(() => syncCloud(false), 350);
    }
  });

  document.addEventListener('click', event => {
    const convert = event.target.closest('[data-convert-lead]');
    if (convert) { const lead = leadById(convert.dataset.convertLead); if (lead) openJobDialog(null, lead, personById(lead.personId)); }
    const lost = event.target.closest('[data-mark-lead-lost]');
    if (lost) { const lead = leadById(lost.dataset.markLeadLost); if (lead) { lead.status='Verloren'; saveState(`Lead verloren: ${lead.id}`); renderAll(); } }
    const editLead = event.target.closest('[data-edit-lead]');
    if (editLead) { const lead = leadById(editLead.dataset.editLead); if (lead) openLeadDialog(lead); }
    const edit = event.target.closest('[data-edit-job]');
    if (edit) { const job = jobById(edit.dataset.editJob); if (job) openJobDialog(job); }
    const done = event.target.closest('[data-complete-job]');
    if (done) confirmCompleteJobPaid(done.dataset.completeJob);
    const paid = event.target.closest('[data-paid-job]');
    if (paid) confirmCompleteJobPaid(paid.dataset.paidJob);
    const cal = event.target.closest('[data-calendar-job]');
    if (cal) addCalendar(jobById(cal.dataset.calendarJob));
    const copy = event.target.closest('[data-copy-ref]');
    if (copy) { const link = referralLink(copy.dataset.copyRef); navigator.clipboard?.writeText(link); toast('Empfehlungslink kopiert.'); }
    const personJob = event.target.closest('[data-open-person-job]');
    if (personJob) openJobDialog(null, null, personById(personJob.dataset.openPersonJob));
    const rew = event.target.closest('[data-toggle-reward]');
    if (rew) { const r = state.rewards.find(x => x.id === rew.dataset.toggleReward); if (r) { r.status = r.status === 'offen' ? 'gutgeschrieben' : 'offen'; saveState(`Bonus geändert: ${r.id}`); renderAll(); } }
  });

  function confirmCompleteJobPaid(jobId) {
    const job = jobById(jobId);
    if (!job) return;
    const p = personById(job.personId) || {};
    const ok = window.confirm(`Ist die Zahlung für ${p.name || job.personId || 'diesen Job'} bezahlt/bestätigt?\n\nOK = Ja, Job abschliessen und Kunde erstellen.\nAbbrechen = Nein, Job bleibt offen.`);
    if (!ok) {
      const clean = normalizeJobForNoUnpaidDone(job);
      Object.assign(job, clean);
      saveState(`Job Zahlung offen gelassen: ${job.id}`);
      renderAll();
      toast('Job bleibt offen, solange die Zahlung nicht bezahlt/bestätigt ist.');
      return;
    }
    job.status = 'Bezahlt';
    job.paidAt = job.paidAt || new Date().toISOString();
    completeJob(job.id, true);
  }

  function completeJob(jobId, showMessage) {
    const job = jobById(jobId); if (!job) return;
    const p = personById(job.personId); if (!p) return;

    // New rule: no "Erledigt / Zahlung offen" state.
    // Work is only closed when payment is confirmed.
    if (!isPaidJob(job)) {
      Object.assign(job, normalizeJobForNoUnpaidDone(job));
      saveState(`Job Abschluss blockiert/Zahlung offen: ${job.id}`);
      renderAll();
      if (showMessage) toast('Nicht abgeschlossen: zuerst Zahlung bezahlt/bestätigt wählen.');
      return;
    }

    job.status = 'Bezahlt';
    job.paidAt = job.paidAt || new Date().toISOString();
    job.completedAt = job.completedAt || job.paidAt;
    const lead = job.leadId ? leadById(job.leadId) : null;

    p.status = 'customer';
    p.customerSince = p.customerSince || new Date().toISOString();
    if (lead) lead.status = 'Kunde geworden';

    const amount = amountValue(job.amount || lead?.expectedValue || 0);
    const refId = job.referredById || lead?.referredById || p.referredById;
    if (refId && refId !== p.id && amount >= Number(getSetting('minOrder'))) {
      const exists = state.rewards.some(r => r.jobId === job.id && r.customerId === refId);
      if (!exists) state.rewards.push({ id: nextId('reward'), customerId: refId, fromPersonId: p.id, jobId: job.id, amount: Number(getSetting('bonusAmount')), status: 'offen', createdAt: new Date().toISOString(), createdBy: currentUser });
    }
    saveState(`Job bezahlt/abgeschlossen: ${job.id}`); renderAll();
    if (showMessage) toast('Job bezahlt und abgeschlossen. Person ist jetzt Kunde und zählt als echte Einnahme.');
  }

  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    const img = await new Promise((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = URL.createObjectURL(file);
    });
    const max = 1200; let width = img.width, height = img.height;
    const scale = Math.min(1, max / Math.max(width, height)); width = Math.round(width*scale); height = Math.round(height*scale);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', .72);
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', dataUrl, size: Math.round(dataUrl.length * .75), createdAt: new Date().toISOString(), localOnly: true };
  }

  $('[data-job-form]')?.addEventListener('change', async event => {
    if (!['beforePhoto','afterPhoto'].includes(event.target.name)) return;
    toast('Foto wird komprimiert...');
    const photo = await compressImage(event.target.files?.[0]);
    if (!photo) return;
    if (event.target.name === 'beforePhoto') stagedPhotos.before = photo; else stagedPhotos.after = photo;
    $('[data-photo-preview]').innerHTML = photoPreviewHtml([stagedPhotos.before, stagedPhotos.after]);
    toast('Foto gespeichert. Beim Sync wird es in Drive abgelegt: Kundenordner LMxxxx → Jxxxx_before/Jxxxx_after.');
  });

  function downloadCalendarIcs(job) {
    if (!job?.appointmentAt) return toast('Kein Termin im Job eingetragen. Bitte Job bearbeiten und Datum/Zeit setzen.');
    const p = personById(job.personId) || {};
    const start = new Date(job.appointmentAt);
    if (Number.isNaN(start.getTime())) return toast('Termin ist ungültig.');
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2,'0');
    const clean = v => String(v || '').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const icsDate = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    const address = fullAddressForPerson(p);
    const maps = mapsUrlForPerson(p);
    const description = [
      `Kunde: ${p.name || ''} (${p.id || ''})`,
      `Telefon: ${p.phone || ''}`,
      `Service: ${job.service || ''}`,
      `Betrag: CHF ${job.amount || ''}`,
      `Job: ${job.id}`,
      maps ? `Maps: ${maps}` : ''
    ].filter(Boolean).join('\n');
    const ics = [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lumian Services//Portal//DE','BEGIN:VEVENT',
      `UID:${clean(job.id)}@lumianservices.ch`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${clean(`Lumian: ${p.name || 'Kunde'} - ${job.service || 'Reinigung'}`)}`,
      `LOCATION:${clean(address)}`,
      maps ? `URL:${clean(maps)}` : '',
      `DESCRIPTION:${clean(description)}`,
      'END:VEVENT','END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${job.id}-lumian-termin.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Kalenderdatei erstellt. Auf dem iPhone öffnen und hinzufügen.');
  }

  function addCalendar(job) {
    if (!job?.appointmentAt) return toast('Kein Termin im Job eingetragen. Bitte Job bearbeiten und Datum/Zeit setzen.');
    if (currentScriptUrl() && calendarSyncTarget()) {
      saveState('calendar sync requested');
      syncCloud(false);
      toast('Kalender-Sync gesendet. Der Termin wird im Lumian Google Calendar erstellt/aktualisiert.');
      return;
    }
    downloadCalendarIcs(job);
  }

  function setRefField(scope, personId) {
    const p = personById(personId); if (!p) return;
    const form = scope === 'lead' ? $('[data-lead-form]') : $('[data-job-form]');
    form.elements.referredById.value = p.id;
    form.elements.referredBySearch.value = `${p.name} · ${p.id}`;
  }

  $$('[data-ref-search]').forEach(input => {
    input.addEventListener('input', () => {
      const scope = input.dataset.refSearch;
      const form = scope === 'lead' ? $('[data-lead-form]') : $('[data-job-form]');
      const box = $(`[data-ref-suggestions="${scope}"]`);
      form.elements.referredById.value = '';
      const q = input.value.toLowerCase().trim();
      if (!q) { box.hidden = true; return; }
      const matches = allPeopleSorted().filter(p => [p.id,p.name,p.phone,p.email,p.address,p.place].join(' ').toLowerCase().includes(q)).slice(0, 8);
      box.innerHTML = matches.length ? matches.map(p => `<button type="button" data-pick-ref="${esc(p.id)}" data-scope="${esc(scope)}">${esc(p.name || 'Ohne Name')} · ${esc(p.id)} ${p.place?`· ${esc(p.place)}`:''}</button>`).join('') : '<button type="button" disabled>Kein Kunde/Lead gefunden</button>';
      box.hidden = false;
    });
  });

  $('[data-person-search="job"]')?.addEventListener('input', event => {
    const box = $('[data-person-suggestions="job"]');
    const hits = searchPeople(event.target.value, 10);
    if (!hits.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = hits.map(p => {
      const lead = leadForPerson(p.id);
      return `<button type="button" data-pick-person="${esc(p.id)}"><strong>${esc(p.name || 'Ohne Name')}</strong> · ${esc(p.id)} · ${esc(personStatusLabel(p))}${contactStatus(p) !== 'Aktiv' ? ` · ${esc(contactStatus(p))}` : ''}${lead ? ` · offener Lead: ${esc(lead.service || lead.id)}` : ''}<br><small>${esc(fullAddressForPerson(p) || p.phone || '')}</small></button>`;
    }).join('');
    box.hidden = false;
  });


  document.addEventListener('click', event => {
    const editCustomer = event.target.closest('[data-edit-customer]');
    if (editCustomer) {
      event.preventDefault();
      const person = personById(editCustomer.dataset.editCustomer);
      if (!person) return toast('Kunde nicht gefunden.');
      openCustomerDialog(person);
      return;
    }
    const warning = event.target.closest('[data-show-contact-warning]');
    if (warning) {
      event.preventDefault();
      const person = personById(warning.dataset.showContactWarning);
      if (person) alert(contactWarningText(person) || 'Dieser Kunde soll nicht kontaktiert werden.');
    }
  });

  document.addEventListener('click', event => {
    const pickPerson = event.target.closest('[data-pick-person]');
    if (!pickPerson) return;
    const person = personById(pickPerson.dataset.pickPerson);
    if (person) fillJobPerson($('[data-job-form]'), person);
    $('[data-person-suggestions="job"]').hidden = true;
  });

  document.addEventListener('click', event => {
    const pick = event.target.closest('[data-pick-ref]');
    if (!pick) return;
    setRefField(pick.dataset.scope, pick.dataset.pickRef);
    $(`[data-ref-suggestions="${pick.dataset.scope}"]`).hidden = true;
  });

  ['lead','job','customer'].forEach(type => {
    const search = $(`[data-${type}-search]`); if (search) search.addEventListener('input', () => { const key = type === 'customer' ? 'customers' : `${type}s`; if (listPages[key]) listPages[key]=1; if (type === 'customer') customerListMode='search'; renderAll(); });
    const filter = $(`[data-${type}-filter]`); if (filter) filter.addEventListener('change', () => { const key = type === 'customer' ? 'customers' : `${type}s`; if (listPages[key]) listPages[key]=1; renderAll(); });
  });
  $('[data-show-all-customers]')?.addEventListener('click', () => { customerListMode = 'all'; renderCustomers(); });

  function fillSettings(force = false) {
    const form = $('[data-settings-form]'); if (!form) return;
    if (form.dataset.filled === 'yes' && !force) return;
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (form.elements[key]) form.elements[key].value = getSetting(key) ?? '';
    });
    const u = state.users.find(x => x.id === currentUser);
    if (form.elements.userRecoveryCode) form.elements.userRecoveryCode.value = u?.recoveryCode || defaultRecoveryCode(currentUser);
    form.dataset.filled = 'yes';
  }
  function saveSettingsFromForm(showToast = true, options = {}) {
    const form = $('[data-settings-form]');
    if (!form) return false;
    // The settings form exists in the DOM even before the tab was opened.
    // Fill it first, otherwise background sync can accidentally read empty inputs.
    if (form.dataset.filled !== 'yes') fillSettings(true);
    const fd = new FormData(form);
    const includeCloud = options.includeCloud === true;
    Object.keys(DEFAULT_SETTINGS).forEach(key => {
      if (!fd.has(key)) return;
      if (CLOUD_SETTING_KEYS.includes(key) && !includeCloud) return;
      state.settings[key] = String(fd.get(key) || '').trim();
    });
    state.settings.bonusAmount = Number(state.settings.bonusAmount || 0);
    state.settings.minOrder = Number(state.settings.minOrder || 0);
    const u = state.users.find(x => x.id === currentUser);
    if (u && fd.has('userRecoveryCode')) u.recoveryCode = String(fd.get('userRecoveryCode') || '').trim() || defaultRecoveryCode(currentUser);
    saveState(includeCloud ? 'Google/Drive Einstellungen geändert' : 'Einstellungen geändert');
    if (showToast) toast(includeCloud ? 'Google/Drive Einstellungen gespeichert.' : 'Einstellungen gespeichert. Google/Drive bleibt separat geschützt.');
    fillSettings(true);
    applySetupLocks();
    return true;
  }
  $('[data-settings-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    saveSettingsFromForm(true);
  });
  $('[data-save-cloud-settings]')?.addEventListener('click', async () => {
    if (!isSetupUnlocked('cloud') && !(await unlockSetupSection('cloud'))) return;
    saveSettingsFromForm(true, { includeCloud: true });
  });
  $('[data-change-password]')?.addEventListener('click', async () => {
    const form = $('[data-settings-form]'); const u = state.users.find(x => x.id === currentUser);
    const cur = String(form.elements.currentPassword.value || ''); const neu = String(form.elements.newPassword.value || '');
    if (!neu || neu.length < 4) return toast('Neues Passwort: mindestens 4 Zeichen.');
    if (u.passwordHash && !(await verifyPassword(u, cur))) return toast('Aktuelles Passwort stimmt nicht.');
    await setPassword(currentUser, neu);
    form.elements.currentPassword.value = ''; form.elements.newPassword.value = ''; toast('Passwort geändert.');
  });
  $('[data-reset-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const userId = String(fd.get('user') || '');
    const user = state.users.find(x => x.id === userId);
    const code = String(fd.get('code') || '').trim();
    const newPw = String(fd.get('newPassword') || '');
    const expectedCode = String(user?.recoveryCode || state.settings.recoveryCode || defaultRecoveryCode(userId)).trim();
    if (!user || code !== expectedCode) return toast('Reset-Code stimmt nicht.');
    if (newPw.length < 4) return toast('Neues Passwort: mindestens 4 Zeichen.');
    await setPassword(userId, newPw);
    event.currentTarget.closest('dialog').close();
    toast('Passwort wurde zurückgesetzt.');
  });
  $('[data-logout]')?.addEventListener('click', () => { queueActivity('Logout', 'Login', '', 'Benutzer hat sich abgemeldet.', { flush: true }); flushActivityLog(true); currentUser = ''; sessionStorage.removeItem(SESSION_KEY); renderLogin(); });


  function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g,'""')}"`;
  }
  function csvLine(values) {
    return values.map(csvEscape).join(';');
  }
  function downloadStaticFile(path, filename) {
    const a = document.createElement('a');
    a.href = path;
    a.download = filename || '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function downloadCustomersTemplate() {
    downloadStaticFile('templates/lumian-kunden-import-vorlage.xlsx', 'lumian-kunden-import-vorlage.xlsx');
  }
  function downloadLeadsTemplate() {
    downloadStaticFile('templates/lumian-leads-import-vorlage.xlsx', 'lumian-leads-import-vorlage.xlsx');
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', quoted = false;
    const src = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < src.length; i++) {
      const ch = src[i], next = src[i+1];
      if (quoted) {
        if (ch === '"' && next === '"') { field += '"'; i++; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else {
        if (ch === '"') quoted = true;
        else if (ch === ';' || ch === ',') { row.push(field.trim()); field = ''; }
        else if (ch === '\n') { row.push(field.trim()); if (row.some(v => v !== '')) rows.push(row); row = []; field = ''; }
        else if (ch !== '\r') field += ch;
      }
    }
    row.push(field.trim()); if (row.some(v => v !== '')) rows.push(row);
    return rows;
  }
  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/[^a-z0-9]/g,'');
  }
  function rowObjects(rows) {
    if (!rows.length) return [];
    const headers = rows[0].map(normHeader);
    return rows.slice(1).map(r => Object.fromEntries(headers.map((h,i)=>[h, r[i] || '']))).filter(o => Object.values(o).some(Boolean));
  }



  function excelXmlEscape(value) {
    return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function excelXmlCell(value, rowIndex = 0) {
    const style = rowIndex === 0 ? 'Header' : 'Text';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<Cell ss:StyleID="${style}"><Data ss:Type="Number">${value}</Data></Cell>`;
    }
    return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell>`;
  }
  function excelXmlWorkbook(sheets) {
    const styles = `<Styles>
<Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16" ss:Color="#FFFFFF"/><Interior ss:Color="#031A24" ss:Pattern="Solid"/></Style>
<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#031A24" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="Text"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
</Styles>`;
    const body = sheets.map(([name, rows, widths = []]) => {
      const cols = widths.map(w => `<Column ss:Width="${Number(w) || 100}"/>`).join('');
      const tableRows = rows.map((row, ri) => `<Row>${row.map(cell => excelXmlCell(cell, ri)).join('')}</Row>`).join('');
      return `<Worksheet ss:Name="${excelXmlEscape(String(name).slice(0,31))}"><Table>${cols}${tableRows}</Table></Worksheet>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${styles}${body}</Workbook>`;
  }
  function downloadExcelXml(filename, sheets) {
    const xml = excelXmlWorkbook(sheets);
    downloadText(filename, xml, 'application/vnd.ms-excel;charset=utf-8');
  }
  function parseExcelXml(text) {
    const doc = new DOMParser().parseFromString(String(text || ''), 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Excel XML konnte nicht gelesen werden.');
    const worksheets = Array.from(doc.getElementsByTagName('*')).filter(el => el.localName === 'Worksheet');
    const ws = worksheets.find(s => /import/i.test(s.getAttribute('ss:Name') || s.getAttribute('Name') || '')) || worksheets[0];
    if (!ws) return [];
    const rowEls = Array.from(ws.getElementsByTagName('*')).filter(el => el.localName === 'Row');
    return rowEls.map(rowEl => {
      const cells = Array.from(rowEl.children).filter(el => el.localName === 'Cell');
      const row = [];
      cells.forEach(cell => {
        const idx = Number(cell.getAttribute('ss:Index') || cell.getAttribute('Index') || 0);
        if (idx > 0) while (row.length < idx - 1) row.push('');
        const data = Array.from(cell.children).find(el => el.localName === 'Data');
        row.push(data ? data.textContent.trim() : '');
      });
      return row;
    }).filter(r => r.some(v => String(v || '').trim() !== ''));
  }
  function isExcelXmlFile(file) {
    return /\.(xls|xml)$/i.test(file?.name || '');
  }

  function isExcelFile(file) {
    return /\.(xlsx|xls)$/i.test(file?.name || '');
  }
  function requireXlsx() {
    if (window.XLSX) return true;
    toast('XLSX-Modul lädt noch oder ist offline. Bitte die heruntergeladene .xls-Vorlage verwenden oder kurz warten.');
    return false;
  }
  async function importFile(file, type) {
    if (!file) return;
    let objects = [];
    if (isExcelXmlFile(file)) {
      const rows = parseExcelXml(await file.text());
      objects = rowObjects(rows);
    } else if (isExcelFile(file)) {
      if (!requireXlsx()) return;
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type:'array', cellDates:true, raw:false });
      const preferred = wb.SheetNames.find(n => /import/i.test(n)) || wb.SheetNames[0];
      const ws = wb.Sheets[preferred];
      const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'', raw:false });
      objects = rowObjects(rows.filter(r => r.some(v => String(v || '').trim() !== '')));
    } else {
      const rows = parseCsv(await file.text());
      objects = rowObjects(rows);
    }
    if (!objects.length) return toast('Importdatei ist leer oder hat keine Kopfzeile.');
    if (type === 'customers') importCustomersFromObjects(objects); else importLeadsFromObjects(objects);
  }
  function aoaSheet(rows, cols) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = cols.map(w => ({ wch:w }));
    if (rows.length > 1) ws['!autofilter'] = { ref: XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:Math.max(0, rows.length-1), c:rows[0].length-1}}) };
    ws['!freeze'] = { xSplit:0, ySplit:1 };
    return ws;
  }
  function writeWorkbook(filename, sheets) {
    if (!requireXlsx()) return;
    const wb = XLSX.utils.book_new();
    sheets.forEach(([name, rows, cols]) => XLSX.utils.book_append_sheet(wb, aoaSheet(rows, cols || []), name));
    XLSX.writeFile(wb, filename);
  }

  function csvAddress(o) {
    return o.strassenr || o.strassenummer || o.strassennr || o.strasse || o.adresse || o.address || '';
  }
  function csvPlace(o) {
    return o.plzort || o.plzundort || o.postleitzahlort || o.ort || o.place || '';
  }

  function findReferral(input) {
    const q = String(input || '').trim().toLowerCase();
    if (!q) return '';
    const hit = state.people.find(p => [p.id,p.name,p.phone,p.email].join(' ').toLowerCase().includes(q));
    return hit?.id || '';
  }
  function bumpPersonCounterFromId(id) {
    const m = String(id || '').match(/^LM(\d+)$/i);
    if (!m) return;
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= state.counters.nextPerson) state.counters.nextPerson = n + 1;
  }
  function dateForInput(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const parsed = parseDateValue(v);
    if (!parsed) return v;
    const hasTime = /\d{1,2}:\d{2}/.test(v);
    const hh = hasTime ? String(parsed.getHours()).padStart(2,'0') : '09';
    const mm = hasTime ? String(parsed.getMinutes()).padStart(2,'0') : '00';
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}T${hh}:${mm}`;
  }
  function importCustomersFromObjects(items) {
    let imported = 0, skipped = 0; const errors = [];
    for (const o of items) {
      const name = o.name || o.kundenname || o.customer || '';
      const phone = o.telefon || o.phone || o.natel || '';
      const email = o.email || o.mail || '';
      if (!name && !phone) { skipped++; continue; }
      const parsed = parseSwissPhone(phone);
      if (phone && !parsed.ok) { skipped++; errors.push(`${name || phone}: Telefon ungültig`); continue; }
      if ((email || '').trim() && !validateEmail(email)) { skipped++; errors.push(`${name || email}: E-Mail ungültig`); continue; }
      const wantedId = (o.lumiannr || o.kundennr || o.kundennummer || o.customerid || '').toUpperCase().replace(/\s/g,'');
      let person = wantedId ? personById(wantedId) : null;
      if (!person && parsed.ok && !parsed.empty) person = state.people.find(p => parseSwissPhone(p.phone).tel === parsed.tel);
      if (!person) {
        person = { id: wantedId && /^LM\d+$/i.test(wantedId) ? wantedId : nextId('person'), createdAt:new Date().toISOString(), createdBy:currentUser };
        state.people.push(person);
      }
      Object.assign(person, {
        status:'customer',
        name: name || person.name || '',
        phone: parsed.ok && !parsed.empty ? parsed.tel : (person.phone || ''),
        email: email || person.email || '',
        address: csvAddress(o) || person.address || '',
        place: csvPlace(o) || person.place || '',
        source: o.quelle || o.source || person.source || 'Import',
        referredById: findReferral(o.empfohlenvon || o.referral || o.referredby) || person.referredById || '',
        customerSince: dateForInput(o.kundeseit || o.customersince) || person.customerSince || new Date().toISOString(),
        notes: o.notizen || o.notes || person.notes || '',
        updatedAt:new Date().toISOString(), updatedBy:currentUser
      });
      bumpPersonCounterFromId(person.id);
      imported++;
    }
    saveState('customers import');
    renderAll();
    let msg = `${imported} Kunde(n) importiert.` + (skipped ? ` ${skipped} übersprungen.` : '');
    if (errors.length) msg += ` Fehler: ${errors.slice(0,3).join(' | ')}`;
    toast(msg);
  }
  function importLeadsFromObjects(items) {
    let imported = 0, skipped = 0; const errors = [];
    for (const o of items) {
      const name = o.name || o.kundenname || '';
      const phone = o.telefon || o.phone || o.natel || '';
      const email = o.email || o.mail || '';
      if (!name && !phone) { skipped++; continue; }
      const parsed = parseSwissPhone(phone);
      if (phone && !parsed.ok) { skipped++; errors.push(`${name || phone}: Telefon ungültig`); continue; }
      if ((email || '').trim() && !validateEmail(email)) { skipped++; errors.push(`${name || email}: E-Mail ungültig`); continue; }
      const person = findOrCreatePerson({
        name, phone, email,
        address: csvAddress(o) || '',
        place: csvPlace(o) || '',
        source: o.quelle || o.source || 'Import',
        referredById: findReferral(o.empfohlenvon || o.referral || o.referredby)
      });
      const exists = state.leads.some(l => l.personId === person.id && l.service === (o.service || 'Fensterreinigung') && l.status === 'Offen');
      if (!exists) state.leads.push({
        id: nextId('lead'), personId: person.id,
        service: o.service || 'Fensterreinigung', source: o.quelle || o.source || 'Import',
        expectedValue: o.betrag || o.schaetzung || o.expectedvalue || '',
        appointmentAt: dateForInput(o.termin || o.appointment || o.appointmentat),
        referredById: person.referredById || '', status:'Offen', notes:o.notizen || o.notes || '',
        createdAt:new Date().toISOString(), createdBy:currentUser
      });
      imported++;
    }
    saveState('leads import');
    renderAll();
    let msg = `${imported} Lead(s) importiert.` + (skipped ? ` ${skipped} übersprungen.` : '');
    if (errors.length) msg += ` Fehler: ${errors.slice(0,3).join(' | ')}`;
    toast(msg);
  }
  async function importCsvFile(file, type) {
    return importFile(file, type);
  }

  async function confirmSensitiveAction(label) {
    const user = state.users.find(x => x.id === currentUser);
    if (!user) return false;
    if (!confirm(`${label}\n\nDiese Aktion kann wichtige Portal-Daten verändern oder löschen. Bitte bestätigen.`)) return false;

    if (user.credentialId && navigator.credentials?.get) {
      try {
        await navigator.credentials.get({
          publicKey: {
            challenge: randomChallenge(),
            allowCredentials: [{ type:'public-key', id: fromB64url(user.credentialId) }],
            userVerification:'preferred',
            timeout:45000
          }
        });
        return true;
      } catch {
        // Fall back to password confirmation.
      }
    }

    const pw = prompt(`Zur Bestätigung bitte das Passwort für ${user.name} eingeben:`);
    if (pw === null) return false;
    if (!(await verifyPassword(user, pw))) {
      toast('Passwort stimmt nicht. Aktion abgebrochen.');
      return false;
    }
    return true;
  }


  function addManualIncome(form) {
    if (!isAdmin()) return toast('Nur Admins können Buchhaltung ändern.');
    if (markInvalidDateInput(form.elements.from, 'Von') || markInvalidDateInput(form.elements.to, 'Bis')) return;
    const fd = new FormData(form);
    state.finance = state.finance || { manualIncome: [], expenses: [] };
    const id = fd.get('entryId');
    let entry = id ? state.finance.manualIncome.find(x => x.id === id) : null;
    if (entry && !canEditFinanceEntry(entry)) return toast('Nur die Person, die den Eintrag erstellt hat, kann ihn bearbeiten.');
    if (!entry) {
      entry = { id: nextId('finance'), createdAt: new Date().toISOString(), createdBy: currentUser };
      state.finance.manualIncome.push(entry);
    } else {
      entry.updatedAt = new Date().toISOString();
      entry.updatedBy = currentUser;
    }
    Object.assign(entry, {
      title: fd.get('title'),
      from: isoDateOnlyFromField(fd.get('from')),
      to: isoDateOnlyFromField(fd.get('to')),
      amount: amountValue(fd.get('amount')),
      notes: fd.get('notes') || ''
    });
    saveState(`${entry.updatedBy ? 'Einnahme geändert' : 'Einnahme gespeichert'}: ${entry.id} / ${entry.title || ''}`);
    form.reset();
    setDefaultFinanceDates();
    renderFinance();
    toast(entry.updatedAt ? 'Einnahme geändert.' : 'Einnahme gespeichert.');
  }
  function addExpense(form) {
    if (!isAdmin()) return toast('Nur Admins können Buchhaltung ändern.');
    if (markInvalidDateInput(form.elements.date, 'Datum')) return;
    const fd = new FormData(form);
    state.finance = state.finance || { manualIncome: [], expenses: [] };
    const id = fd.get('entryId');
    let entry = id ? state.finance.expenses.find(x => x.id === id) : null;
    if (entry && !canEditFinanceEntry(entry)) return toast('Nur die Person, die den Eintrag erstellt hat, kann ihn bearbeiten.');
    if (!entry) {
      entry = { id: nextId('finance'), createdAt: new Date().toISOString(), createdBy: currentUser };
      state.finance.expenses.push(entry);
    } else {
      entry.updatedAt = new Date().toISOString();
      entry.updatedBy = currentUser;
    }
    Object.assign(entry, {
      date: isoDateOnlyFromField(fd.get('date')),
      category: fd.get('category'),
      title: fd.get('title'),
      amount: amountValue(fd.get('amount')),
      notes: fd.get('notes') || ''
    });
    saveState(`${entry.updatedBy ? 'Ausgabe geändert' : 'Ausgabe gespeichert'}: ${entry.id} / ${entry.title || ''}`);
    form.reset();
    setDefaultFinanceDates();
    renderFinance();
    toast(entry.updatedAt ? 'Ausgabe geändert.' : 'Ausgabe gespeichert.');
  }

  function renderUsers() {
    const list = $('[data-user-list]');
    if (!list) return;
    if (!isAdmin()) { list.innerHTML = ''; return; }
    list.innerHTML = activeUsers().map(u => {
      const locked = ADMIN_IDS.includes(u.id);
      return `<article class="item-card mini">
        <div class="item-top"><div><div class="item-title">${esc(u.name)} <span class="badge">${esc(u.id)}</span></div><div class="item-sub">${u.role === 'admin' ? 'Admin: volle Rechte' : 'Mitarbeiter: Übersicht, Leads, Jobs, Kunden'} · Reset-Code separat</div></div><span class="badge ${u.role==='admin'?'ok':''}">${esc(u.emoji || '?')}</span></div>
        <div class="actions">${locked ? '<span class="hint">Admin-Benutzer geschützt</span>' : `<button class="secondary danger" data-disable-user="${esc(u.id)}">Deaktivieren</button>`}</div>
      </article>`;
    }).join('');
  }

  
  async function saveUserFromSetup() {
    const form = $('[data-user-form]');
    if (!form) return;
    if (!isAdmin()) return toast('Nur Noah und Timo können Benutzer anlegen.');
    const fd = new FormData();
    ['userId','name','emoji','password','recoveryCode','role'].forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      fd.append(name, el ? el.value : '');
    });
    const id = normalizeUserId(fd.get('userId'));
    if (!id || id.length < 2) return toast('Benutzername: mindestens 2 Zeichen.');
    if (ADMIN_IDS.includes(id)) return toast('Noah und Timo sind bereits Admins.');
    const pw = String(fd.get('password') || '');
    if (pw.length < 4) return toast('Start-Passwort: mindestens 4 Zeichen.');
    let u = state.users.find(x => x.id === id);
    if (!u) {
      u = { id, name:'', emoji:'', role:'staff', active:true, passwordHash:'', salt:'', credentialId:'', credentialUserHandle:'', recoveryCode:'' };
      state.users.push(u);
    }
    u.name = String(fd.get('name') || id).trim();
    u.emoji = String(fd.get('emoji') || u.name.slice(0,1).toUpperCase()).trim().slice(0,2);
    u.role = 'staff';
    u.active = true;
    u.recoveryCode = String(fd.get('recoveryCode') || `${u.name}-Reset-2026`).trim();
    await setPassword(id, pw);
    form.querySelectorAll('input,select').forEach(el => { if (el.name !== 'role') el.value=''; });
    const roleEl = form.querySelector('[name="role"]'); if (roleEl) roleEl.value = 'staff';
    renderUserOptions(); renderUsers(); saveState(`Benutzer gespeichert: ${u.id}`);
    toast(`Mitarbeiter ${u.name} gespeichert.`);
  }
  $('[data-save-user]')?.addEventListener('click', saveUserFromSetup);


  document.addEventListener('click', event => {
    const dis = event.target.closest('[data-disable-user]');
    if (!dis) return;
    if (!isAdmin()) return toast('Nur Admins können Benutzer deaktivieren.');
    const u = state.users.find(x => x.id === dis.dataset.disableUser);
    if (!u || ADMIN_IDS.includes(u.id)) return;
    if (!confirm(`${u.name} wirklich deaktivieren?`)) return;
    u.active = false;
    saveState(`Benutzer deaktiviert: ${u.id}`);
    renderUserOptions(); renderUsers();
    toast('Benutzer deaktiviert.');
  });


  function setDefaultFinanceDates() {
    const today = ymd(new Date());
    $$('[data-manual-income-form] [data-ch-date], [data-expense-form] [data-ch-date]').forEach(input => { if (!input.value) input.value = nativeDateValueFromField(today); });
    const range = getFinanceRange();
    updateFinanceDateControls(range);
    if (range.period === 'custom') {
      if ($('[data-finance-from]') && !$('[data-finance-from]').value) $('[data-finance-from]').value = nativeDateValueFromField(ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
      if ($('[data-finance-to]') && !$('[data-finance-to]').value) $('[data-finance-to]').value = nativeDateValueFromField(ymd(new Date()));
    }
    syncAllCalendarControls();
  }
  $('[data-manual-income-form]')?.addEventListener('submit', event => { event.preventDefault(); addManualIncome(event.currentTarget); });
  $('[data-expense-form]')?.addEventListener('submit', event => { event.preventDefault(); addExpense(event.currentTarget); });
  $$('[data-finance-period],[data-finance-from],[data-finance-to],[data-customer-activity-sort]').forEach(el => el.addEventListener('change', renderFinance));
  $$('[data-ch-date],[data-ch-datetime]').forEach(el => {
    enhanceCalendarField(el);
    el.addEventListener('input', () => el.classList.remove('invalid'));
    el.addEventListener('change', () => el.classList.remove('invalid'));
  });
  syncAllCalendarControls();
  $('[data-finance-apply]')?.addEventListener('click', renderFinance);
  document.addEventListener('click', async event => {
    const editIncome = event.target.closest('[data-edit-manual-income]');
    if (editIncome) {
      const entry = (state.finance.manualIncome || []).find(x => x.id === editIncome.dataset.editManualIncome);
      if (!entry) return;
      if (!canEditFinanceEntry(entry)) return toast('Nur der Ersteller kann diesen Eintrag bearbeiten.');
      if (!(await confirmSensitiveAction('Manuelle Einnahme bearbeiten?'))) return;
      const form = $('[data-manual-income-form]');
      form.elements.entryId.value = entry.id;
      form.elements.title.value = entry.title || '';
      form.elements.from.value = nativeDateValueFromField(entry.from || ymd(entry.createdAt));
      form.elements.to.value = nativeDateValueFromField(entry.to || entry.from || ymd(entry.createdAt));
      form.elements.amount.value = entry.amount || '';
      form.elements.notes.value = entry.notes || '';
      form.scrollIntoView({ behavior:'smooth', block:'center' });
      toast('Eintrag geladen. Jetzt ändern und speichern.');
    }

    const delIncome = event.target.closest('[data-delete-manual-income]');
    if (delIncome) {
      const entry = (state.finance.manualIncome || []).find(x => x.id === delIncome.dataset.deleteManualIncome);
      if (!entry) return;
      if (!canEditFinanceEntry(entry)) return toast('Nur der Ersteller kann diesen Eintrag löschen.');
      if (!(await confirmSensitiveAction('Manuelle Einnahme löschen?'))) return;
      entry.deletedAt = new Date().toISOString();
      entry.deletedBy = currentUser;
      saveState(`Einnahme gelöscht: ${entry.id}`); renderFinance(); toast('Einnahme gelöscht.');
    }

    const editExpense = event.target.closest('[data-edit-expense]');
    if (editExpense) {
      const entry = (state.finance.expenses || []).find(x => x.id === editExpense.dataset.editExpense);
      if (!entry) return;
      if (!canEditFinanceEntry(entry)) return toast('Nur der Ersteller kann diese Ausgabe bearbeiten.');
      if (!(await confirmSensitiveAction('Ausgabe bearbeiten?'))) return;
      const form = $('[data-expense-form]');
      form.elements.entryId.value = entry.id;
      form.elements.date.value = nativeDateValueFromField(entry.date || ymd(entry.createdAt));
      form.elements.category.value = entry.category || 'Sonstiges';
      form.elements.title.value = entry.title || '';
      form.elements.amount.value = entry.amount || '';
      form.elements.notes.value = entry.notes || '';
      form.scrollIntoView({ behavior:'smooth', block:'center' });
      toast('Ausgabe geladen. Jetzt ändern und speichern.');
    }

    const del = event.target.closest('[data-delete-expense]');
    if (del) {
      const entry = (state.finance.expenses || []).find(x => x.id === del.dataset.deleteExpense);
      if (!entry) return;
      if (!canEditFinanceEntry(entry)) return toast('Nur der Ersteller kann diese Ausgabe löschen.');
      if (!(await confirmSensitiveAction('Ausgabe löschen?'))) return;
      entry.deletedAt = new Date().toISOString();
      entry.deletedBy = currentUser;
      saveState(`Ausgabe gelöscht: ${entry.id}`); renderFinance(); toast('Ausgabe gelöscht.');
    }
  });
  function exportFinanceExcel() {
    renderFinance();
    const range = getFinanceRange();
    const s = financeSummary(range);
    const now = fmtDate(new Date());

    const summary = [
      ['Lumian Services Buchhaltungsreport'],
      ['Zeitraum', range.label],
      ['Exportiert am', now],
      [],
      ['Kennzahl','CHF','Info'],
      ['Bezahlte Jobs', s.jobIncome, `${s.jobs.length} kassierte Jobs`],
      ['Manuell ergänzt', s.manualIncome, `${s.manual.length} Eintrag(e)`],
      ['Pipeline offen / noch nicht kassiert', s.forecastTotal, `${s.forecast.length} offene/geplante Jobs + ${s.forecastLeads.length} offene Leads`],
      ['Ausgaben', -s.expenseTotal, `${s.expenses.length} Kostenposition(en)`],
      ['Gewinn', s.profit, 'bezahlte Einnahmen minus Ausgaben']
    ];
    const incomeRows = [
      ['Typ','Datum','Bis','Kunde/Titel','Service/Kategorie','Betrag CHF','Eingetragen von','Notiz','ID'],
      ...s.jobs.map(x => ['Einnahme Job bezahlt', fmtDateOnly(x.date), '', x.title, 'Job bezahlt', x.amount, userName(x.assignedTo || x.createdBy), '', x.jobId]),
      ...s.manual.map(x => ['Einnahme manuell', fmtDateOnly(x.date), x.to ? fmtDateOnly(x.to) : '', x.title, 'Manuell', x.amount, userName(x.createdBy), x.notes || '', x.id])
    ];
    const forecastRows = [
      ['Typ','Datum','Kunde/Titel','Status','Betrag CHF','Zuständig','JobID'],
      ...s.forecastAll.map(x => ['Pipeline offen', fmtDateOnly(x.date), x.title, x.status || (x.leadId ? 'Lead offen' : 'offen/geplant'), x.amount, userName(x.assignedTo || x.createdBy), x.jobId || x.leadId || x.id])
    ];
    const expenseRows = [
      ['Datum','Kategorie','Titel','Betrag CHF','Eingetragen von','Notiz','ID'],
      ...s.expenses.map(x => [fmtDateOnly(x.date), x.category || 'Ausgabe', x.title, amountValue(x.amount), userName(x.createdBy), x.notes || '', x.id])
    ];
    const customerRows = [
      ['LumianNr','Kunde','Telefon','PLZ/Ort','Jobs im Zeitraum','Umsatz CHF','Letzter Job','Jobs total'],
      ...state.people.map(p => {
        const allJobs = completedJobs().filter(j => j.personId === p.id);
        const inRange = allJobs.filter(j => dateInRange(financeJobDate(j), range.from, range.to));
        const revenue = inRange.reduce((sum,j)=>sum+amountValue(j.amount),0);
        const last = allJobs.map(financeJobDate).filter(Boolean).sort().pop() || '';
        return [p.id, p.name || '', p.phone || '', p.place || '', inRange.length, revenue, last ? fmtDateOnly(last) : '', allJobs.length];
      }).filter(r => r[4] || r[7] || r[1])
    ];

    downloadExcelXml(`lumian-buchhaltung-${(range.from || 'start').replaceAll('-','')}-${(range.to || 'heute').replaceAll('-','')}.xls`, [
      ['Zusammenfassung', summary, [220,130,280]],
      ['Einnahmen', incomeRows, [150,90,90,220,140,90,130,240,100]],
      ['Pipeline offen', forecastRows, [130,90,220,130,90,130,100]],
      ['Ausgaben', expenseRows, [90,140,220,90,130,240,100]],
      ['Kundenaktivität', customerRows, [90,170,120,130,100,90,100,80]]
    ]);
    toast('Excel-Report erstellt.');
  }
  $('[data-finance-export]')?.addEventListener('click', exportFinanceExcel);


  function exportCsv() {
    const rows = [['LumianNr','Status','Name','Telefon','Email','Strasse/Nr','PLZ/Ort','Quelle','EmpfohlenVon','KundeSeit','Notizen']]
      .concat(state.people.map(p => [p.id,p.status,p.name,p.phone,p.email,p.address,p.place,p.source,p.referredById,p.customerSince ? fmtDateOnly(p.customerSince) : '',p.notes || '']));
    downloadExcelXml(`lumian-kunden-export-${new Date().toISOString().slice(0,10)}.xls`, [
      ['Kunden', rows, [90,90,170,120,180,180,130,120,110,110,240]]
    ]);
  }
  function exportJson() { downloadText(`lumian-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state,null,2), 'application/json'); queueActivity('JSON Backup heruntergeladen', 'Backup', '', 'Einzelnes JSON-Backup wurde lokal heruntergeladen.', { flush: true }); }
  function downloadText(name, text, type) { downloadBlob(name, new Blob([text], { type })); }
  function downloadBlob(name, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function backupStamp() {
    return new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').slice(0,19);
  }
  function cleanBackupState() {
    return migrateState(JSON.parse(JSON.stringify(state)));
  }
  function photoBackupInfo(photo) {
    if (!photo) return '';
    if (typeof photo === 'string') return photo;
    return [photo.name, photo.driveUrl || photo.url || photo.thumbnailUrl || '', photo.fileId ? `fileId:${photo.fileId}` : '', photo.localOnly ? 'wartet lokal auf Drive' : '', photo.error ? `Fehler:${photo.error}` : ''].filter(Boolean).join(' | ');
  }
  function emergencyCustomersRows() {
    const paid = paidJobs();
    return [['LumianNr','Status','Name','Telefon','Email','Strasse/Nr','PLZ/Ort','Quelle','EmpfohlenVon','Kontaktstatus','Kontaktgrund','Kontaktnotiz','KundeSeit','Jobs bezahlt','Umsatz CHF','Notizen','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...allPeopleSorted().map(p => {
        const pj = paid.filter(j => j.personId === p.id);
        const revenue = pj.reduce((sum,j)=>sum + amountValue(j.amount), 0);
        return [p.id, personStatusLabel(p), p.name || '', p.phone || '', p.email || '', p.address || '', p.place || '', p.source || '', p.referredById || '', contactStatus(p), p.contactReason || '', p.contactNote || '', p.customerSince ? fmtDateOnly(p.customerSince) : '', pj.length, revenue, p.notes || '', p.createdAt ? fmtDate(p.createdAt) : '', userName(p.createdBy), p.updatedAt ? fmtDate(p.updatedAt) : '', userName(p.updatedBy), p.deletedAt ? fmtDate(p.deletedAt) : ''];
      })
    ];
  }
  function emergencyLeadsRows() {
    const sorted = [...(state.leads || [])].sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''), 'de-CH'));
    return [['LeadID','LumianNr','Name','Telefon','Email','Service','Status','Termin','Schätzung CHF','Quelle','EmpfohlenVon','Notizen','WebsiteLeadKey','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(l => {
        const p = personById(l.personId) || {};
        return [l.id || '', l.personId || '', p.name || '', p.phone || '', p.email || '', l.service || '', l.status || '', l.appointmentAt ? fmtDate(l.appointmentAt) : '', amountValue(l.expectedValue || 0), l.source || '', l.referredById || p.referredById || '', l.notes || '', l.websiteLeadKey || '', l.createdAt ? fmtDate(l.createdAt) : '', userName(l.createdBy), l.updatedAt ? fmtDate(l.updatedAt) : '', userName(l.updatedBy), l.deletedAt ? fmtDate(l.deletedAt) : ''];
      })
    ];
  }
  function emergencyJobsRows() {
    const sorted = [...(state.jobs || [])].sort((a,b)=>String(a.appointmentAt || a.createdAt || '').localeCompare(String(b.appointmentAt || b.createdAt || '')) || String(a.id||'').localeCompare(String(b.id||'')));
    return [['JobID','LumianNr','Name','Telefon','LeadID','Service','Termin','Betrag CHF','Status','Zuständig','Quelle','EmpfohlenVon','Notizen','Bezahlt am','Abgeschlossen am','Vorher Foto','Nachher Foto','Calendar Event ID','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(j => {
        const p = personById(j.personId) || {};
        return [j.id || '', j.personId || '', p.name || '', p.phone || '', j.leadId || '', j.service || '', j.appointmentAt ? fmtDate(j.appointmentAt) : '', amountValue(j.amount || 0), j.status || '', userName(j.assignedTo), j.source || '', j.referredById || p.referredById || '', j.notes || '', j.paidAt ? fmtDate(j.paidAt) : '', j.completedAt ? fmtDate(j.completedAt) : '', photoBackupInfo(j.beforePhoto), photoBackupInfo(j.afterPhoto), j.calendarEventId || '', j.createdAt ? fmtDate(j.createdAt) : '', userName(j.createdBy), j.updatedAt ? fmtDate(j.updatedAt) : '', userName(j.updatedBy), j.deletedAt ? fmtDate(j.deletedAt) : ''];
      })
    ];
  }
  function emergencyRewardsRows() {
    const sorted = [...(state.rewards || [])].sort((a,b)=>String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return [['BonusID','Empfänger LumianNr','Empfänger Name','Von LumianNr','Von Name','JobID','Betrag CHF','Status','Notiz','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(r => {
        const receiver = personById(r.customerId) || {};
        const source = personById(r.fromPersonId) || {};
        return [r.id || '', r.customerId || '', receiver.name || '', r.fromPersonId || '', source.name || '', r.jobId || '', amountValue(r.amount || 0), r.status || '', r.notes || '', r.createdAt ? fmtDate(r.createdAt) : '', userName(r.createdBy), r.updatedAt ? fmtDate(r.updatedAt) : '', userName(r.updatedBy), r.deletedAt ? fmtDate(r.deletedAt) : ''];
      })
    ];
  }
  function emergencyFinanceSheets() {
    const range = { period:'all', label:'Bisher / kompletter Portalstand', from:'', to:'' };
    const s = financeSummary(range);
    const summary = [
      ['Lumian Services Emergency Backup'],
      ['Exportiert am', fmtDate(new Date())],
      ['Portal-Modus', state.portalMode || ''],
      ['Cloud-Stand zuletzt geändert', state.updatedAt ? fmtDate(state.updatedAt) : ''],
      [],
      ['Kennzahl','CHF','Info'],
      ['Bezahlte Jobs', s.jobIncome, `${s.jobs.length} kassierte Jobs`],
      ['Manuell ergänzt', s.manualIncome, `${s.manual.length} Eintrag(e)`],
      ['Pipeline offen / noch nicht kassiert', s.forecastTotal, `${s.forecastAll.length} offene/geplante Einträge`],
      ['Ausgaben', -s.expenseTotal, `${s.expenses.length} Kostenposition(en)`],
      ['Gewinn', s.profit, 'bezahlte Einnahmen minus Ausgaben']
    ];
    const incomeRows = [
      ['Typ','Datum','Bis','Kunde/Titel','Service/Kategorie','Betrag CHF','Eingetragen von','Notiz','ID','Gelöscht am'],
      ...s.jobs.map(x => ['Einnahme Job bezahlt', fmtDateOnly(x.date), '', x.title, 'Job bezahlt', x.amount, userName(x.assignedTo || x.createdBy), '', x.jobId, '']),
      ...(state.finance?.manualIncome || []).map(x => ['Einnahme manuell', x.from ? fmtDateOnly(x.from) : fmtDateOnly(x.createdAt), x.to ? fmtDateOnly(x.to) : '', x.title || 'Manuell', 'Manuell', amountValue(x.amount), userName(x.createdBy), x.notes || '', x.id || '', x.deletedAt ? fmtDate(x.deletedAt) : ''])
    ];
    const forecastRows = [
      ['Typ','Datum','Kunde/Titel','Status','Betrag CHF','Zuständig','JobID/LeadID'],
      ...s.forecastAll.map(x => ['Pipeline offen', fmtDateOnly(x.date), x.title, x.status || (x.leadId ? 'Lead offen' : 'offen/geplant'), x.amount, userName(x.assignedTo || x.createdBy), x.jobId || x.leadId || x.id])
    ];
    const expenseRows = [
      ['Datum','Kategorie','Titel','Betrag CHF','Eingetragen von','Notiz','ID','Gelöscht am'],
      ...(state.finance?.expenses || []).map(x => [x.date ? fmtDateOnly(x.date) : fmtDateOnly(x.createdAt), x.category || 'Ausgabe', x.title || '', amountValue(x.amount), userName(x.createdBy), x.notes || '', x.id || '', x.deletedAt ? fmtDate(x.deletedAt) : ''])
    ];
    return [
      ['Zusammenfassung', summary, [220,160,300]],
      ['Einnahmen', incomeRows, [150,90,90,220,140,90,130,240,100,120]],
      ['Pipeline offen', forecastRows, [130,90,240,130,90,130,120]],
      ['Ausgaben', expenseRows, [90,140,220,90,130,240,100,120]],
      ['Bonus', emergencyRewardsRows(), [90,90,170,90,170,90,90,90,220,120,120,120,120,120]]
    ];
  }
  function emergencyWorkbookFiles() {
    return {
      'excel/lumian-kunden.xls': excelXmlWorkbook([['Kunden', emergencyCustomersRows(), [90,80,180,130,190,190,130,130,110,120,170,220,100,90,90,260,130,120,130,120,120]]]),
      'excel/lumian-leads.xls': excelXmlWorkbook([['Leads', emergencyLeadsRows(), [90,90,180,130,190,150,100,130,100,120,110,260,180,130,120,130,120,120]]]),
      'excel/lumian-jobs.xls': excelXmlWorkbook([['Jobs', emergencyJobsRows(), [90,90,180,130,90,150,130,90,100,120,120,110,260,130,130,260,260,180,130,120,130,120,120]]]),
      'excel/lumian-buchhaltung-und-bonus.xls': excelXmlWorkbook(emergencyFinanceSheets())
    };
  }

  function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  }
  const CRC32_TABLE = makeCrc32Table();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function le16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n & 0xffff, true); return b; }
  function le32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
  function concatBytes(parts) {
    const total = parts.reduce((sum,p)=>sum+p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    parts.forEach(p => { out.set(p, offset); offset += p.length; });
    return out;
  }
  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }
  function makeStoreZip(fileMap) {
    const encoder = new TextEncoder();
    const locals = [], centrals = [];
    let offset = 0;
    const dt = dosDateTime(new Date());
    Object.entries(fileMap).forEach(([name, content]) => {
      const nameBytes = encoder.encode(name);
      const dataBytes = content instanceof Uint8Array ? content : encoder.encode(String(content ?? ''));
      const crc = crc32(dataBytes);
      const local = concatBytes([le32(0x04034b50), le16(20), le16(0x0800), le16(0), le16(dt.time), le16(dt.date), le32(crc), le32(dataBytes.length), le32(dataBytes.length), le16(nameBytes.length), le16(0), nameBytes, dataBytes]);
      const central = concatBytes([le32(0x02014b50), le16(20), le16(20), le16(0x0800), le16(0), le16(dt.time), le16(dt.date), le32(crc), le32(dataBytes.length), le32(dataBytes.length), le16(nameBytes.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(offset), nameBytes]);
      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });
    const centralSize = centrals.reduce((sum,p)=>sum+p.length, 0);
    const end = concatBytes([le32(0x06054b50), le16(0), le16(0), le16(centrals.length), le16(centrals.length), le32(centralSize), le32(offset), le16(0)]);
    return new Blob([...locals, ...centrals, end], { type:'application/zip' });
  }
  function downloadLocalFullBackup() {
    const stamp = backupStamp();
    const full = cleanBackupState();
    const files = {
      'README-WIEDERHERSTELLUNG.txt': `Lumian Services lokales Komplettbackup\nErstellt: ${new Date().toLocaleString('de-CH')}\n\nZum Wiederherstellen im Portal unter Einstellungen > Daten, Import & Backup den gesperrten Bereich entsperren und diese ZIP-Datei bei "Lokales Komplettbackup importieren" auswählen. Die Excel-Dateien sind zur Kontrolle/Lesbarkeit. Für eine komplette Wiederherstellung wird die JSON-Datei im Backup verwendet.`,
      'lumian-portal-full-backup.json': JSON.stringify(full, null, 2),
      'lumian-portal-meta.json': JSON.stringify({ createdAt:new Date().toISOString(), createdBy:currentUser, portalMode:state.portalMode || '', people:(state.people||[]).length, leads:(state.leads||[]).length, jobs:(state.jobs||[]).length, manualIncome:(state.finance?.manualIncome||[]).length, expenses:(state.finance?.expenses||[]).length }, null, 2),
      ...emergencyWorkbookFiles()
    };
    const blob = makeStoreZip(files);
    downloadBlob(`lumian-komplettbackup-${stamp}.zip`, blob);
    queueActivity('Lokales Komplettbackup heruntergeladen', 'Backup', '', 'Vollbackup ZIP wurde lokal auf dieses Gerät heruntergeladen.', { flush: true });
    toast('Lokales Komplettbackup wurde heruntergeladen.');
  }
  async function readLocalBackupStateFromFile(file) {
    if (!file) throw new Error('Keine Datei ausgewählt.');
    if (/\.json$/i.test(file.name || '') || String(file.type || '').includes('json')) {
      const parsed = JSON.parse(await file.text());
      return parsed?.state || parsed;
    }
    if (!/\.zip$/i.test(file.name || '') && !String(file.type || '').includes('zip')) throw new Error('Bitte ZIP- oder JSON-Backup auswählen.');
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');
    let offset = 0;
    let fallbackJson = null;
    while (offset + 30 <= bytes.length) {
      const sig = view.getUint32(offset, true);
      if (sig === 0x02014b50 || sig === 0x06054b50) break;
      if (sig !== 0x04034b50) { offset++; continue; }
      const flags = view.getUint16(offset + 6, true);
      const method = view.getUint16(offset + 8, true);
      const compSize = view.getUint32(offset + 18, true);
      const nameLen = view.getUint16(offset + 26, true);
      const extraLen = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLen + extraLen;
      const dataEnd = dataStart + compSize;
      if (dataEnd > bytes.length) break;
      const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLen));
      if ((flags & 0x0008) || method !== 0) throw new Error('Dieses ZIP-Backup kann im Browser nicht direkt gelesen werden. Bitte die JSON-Datei aus der ZIP importieren.');
      if (/\.json$/i.test(name)) {
        const obj = JSON.parse(decoder.decode(bytes.slice(dataStart, dataEnd)));
        if (/full-backup|portal/i.test(name) && (obj.people || obj.state?.people)) return obj.state || obj;
        fallbackJson = fallbackJson || (obj.state || obj);
      }
      offset = dataEnd;
    }
    if (fallbackJson) return fallbackJson;
    throw new Error('In der ZIP-Datei wurde kein Portal-JSON gefunden.');
  }
  async function importLocalFullBackup(file) {
    if (!file) return;
    if (!(await confirmSensitiveAction('Lokales Komplettbackup importieren? Bestehende lokale Portal-Daten werden überschrieben.'))) return;
    try {
      const imported = migrateState(await readLocalBackupStateFromFile(file));
      localStorage.setItem(STORE_KEY, JSON.stringify(imported));
      queueActivity('Lokales Komplettbackup importiert', 'Backup', '', file?.name || 'Lokales Backup importiert', { flush: true });
      toast('Lokales Komplettbackup importiert. Portal wird neu geladen.');
      setTimeout(() => location.reload(), 600);
    } catch (err) {
      toast('Backup konnte nicht gelesen werden: ' + String(err.message || err).slice(0, 140));
    }
  }
  $$('[data-download-customers-template]').forEach(btn => btn.addEventListener('click', downloadCustomersTemplate));
  $$('[data-download-leads-template]').forEach(btn => btn.addEventListener('click', downloadLeadsTemplate));
  $$('[data-import-customers]').forEach(input => input.addEventListener('change', async event => { await importCsvFile(event.target.files?.[0], 'customers'); event.target.value=''; }));
  $$('[data-import-leads]').forEach(input => input.addEventListener('change', async event => { await importCsvFile(event.target.files?.[0], 'leads'); event.target.value=''; }));
  $('[data-export-csv]')?.addEventListener('click', exportCsv);
  $('[data-export-json]')?.addEventListener('click', exportJson);
  $('[data-local-full-backup]')?.addEventListener('click', downloadLocalFullBackup);
  $('[data-clear-web-cache]')?.addEventListener('click', clearWebAppCacheAndReload);
  $('[data-import-local-full-backup]')?.addEventListener('change', async event => {
    await importLocalFullBackup(event.target.files?.[0]);
    event.target.value='';
  });
  $('[data-import-json]')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    await importLocalFullBackup(file);
    event.target.value='';
  });
  $('[data-reset-cloud]')?.addEventListener('click', goLiveResetCloud);
  $('[data-reset-demo]')?.addEventListener('click', clearLocalCacheAndReloadCloud);
  $$('[data-backup-now]').forEach(btn => btn.addEventListener('click', backupNow));
  $('[data-list-drive-backups]')?.addEventListener('click', listDriveBackups);
  $('[data-restore-drive-backup]')?.addEventListener('click', restoreSelectedDriveBackup);


  function websiteLeadKey(row = {}) {
    return String(row.websiteLeadKey || row.WebsiteLeadKey || row.key || `${row.createdAt || ''}|${row.phone || ''}|${row.name || ''}|${row.referral || ''}`).trim();
  }

  function normalizeAppointmentInput(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = dateForInput(raw);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(parsed)) return parsed.slice(0,16);
    return '';
  }

  function importWebsiteLead(row = {}) {
    const key = websiteLeadKey(row);
    if (!key) return false;
    if (state.leads.some(l => l.websiteLeadKey === key) || state.people.some(p => p.websiteLeadKey === key)) return false;

    const existingByPhone = row.phone ? state.people.find(p => parseSwissPhone(p.phone).tel && parseSwissPhone(p.phone).tel === parseSwissPhone(row.phone).tel) : null;
    const personId = existingByPhone?.id || (row.lumianNr && !personById(row.lumianNr) ? String(row.lumianNr) : nextId('person'));
    const leadId = row.leadId && !leadById(row.leadId) ? String(row.leadId) : nextId('lead');
    bumpCountersFromIds(personId, leadId);

    const referral = cleanReferralCode(row.referral || row.referredById || '');
    const source = referral ? 'Website Empfehlung' : (row.source || 'Website Anfrage');
    const now = row.createdAt || new Date().toISOString();

    let p = existingByPhone || personById(personId);
    if (!p) {
      p = {
        id: personId,
        status: 'lead',
        name: row.name || '',
        phone: row.phone || '',
        email: '',
        address: row.address || '',
        place: row.place || '',
        source,
        referredById: referral,
        createdAt: now,
        createdBy: 'website',
        customerSince: '',
        websiteLeadKey: key
      };
      state.people.push(p);
    } else {
      Object.assign(p, {
        name: row.name || p.name || '',
        phone: row.phone || p.phone || '',
        address: row.address || p.address || '',
        place: row.place || p.place || '',
        source: p.source || source,
        referredById: p.referredById || referral,
        websiteLeadKey: p.websiteLeadKey || key
      });
    }

    const normalizedAppointment = normalizeAppointmentInput(row.desiredDate || '');
    const notes = [
      normalizedAppointment ? `Wunsch-Termin: ${fmtDate(normalizedAppointment)}` : (row.desiredDate ? `Wunsch-Termin: ${row.desiredDate}` : ''),
      row.message ? `Beschreibung: ${row.message}` : ''
    ].filter(Boolean).join('\n');

    state.leads.push({
      id: leadId,
      personId: p.id,
      service: row.service || '',
      source,
      expectedValue: '',
      appointmentAt: normalizedAppointment,
      referredById: referral,
      status: row.status || 'Offen',
      createdAt: now,
      createdBy: 'website',
      notes,
      websiteLeadKey: key
    });

    return true;
  }

  function importWebsiteLeads(rows = []) {
    let count = 0;
    rows.forEach(row => { if (importWebsiteLead(row)) count++; });
    if (count) {
      saveState(`Website-Leads importiert: ${count}`);
      listPages.leads = 1;
      renderAll();
      if (activeTab !== 'leads') {
        setTab('leads');
      }
    }
    return count;
  }


  function setWebLeadsStatus(message, tone = '') {
    const box = $('[data-web-leads-status]');
    if (!box) return;
    box.textContent = message || '';
    box.dataset.tone = tone || '';
    box.hidden = !message;
  }

  function currentScriptUrl() {
    return String(getSetting('scriptUrl') || '').trim();
  }

  function autoLoadCloudThenCheckWebsiteLeads() {
    const url = currentScriptUrl();
    if (!url) return;
    if (autoLoadCloudThenCheckWebsiteLeads._busy) return;
    autoLoadCloudThenCheckWebsiteLeads._busy = true;

    const callbackName = `lumianAutoCloud_${Date.now()}`;
    const script = document.createElement('script');
    let finished = false;
    let timer = null;
    const done = () => {
      if (finished) return;
      finished = true;
      autoLoadCloudThenCheckWebsiteLeads._busy = false;
      clearTimeout(timer);
      try { delete window[callbackName]; } catch {}
      script.remove();
    };

    window[callbackName] = data => {
      try {
        const cloudState = data?.state;
        if (cloudState) {
          suppressAutoCloudSync = true;
          const merged = mergeCloudStatePreserveLocalMedia(state, cloudState);
          state = migrateState(merged);
          localStorage.setItem(STORE_KEY, JSON.stringify(state));
          suppressAutoCloudSync = false;
          renderAll();
          // Push any local/offline records that were newer than cloud after merging.
          setTimeout(() => syncCloud(true), 900);
        }
      } catch {}
      done();
      checkWebsiteLeads(true);
    };

    timer = setTimeout(() => { done(); checkWebsiteLeads(true); }, 8000);
    script.onerror = () => { done(); checkWebsiteLeads(true); };
    script.src = `${url}${url.includes('?')?'&':'?'}action=load&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  }

  function checkWebsiteLeads(silent = false) {
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl();
    if (!url) {
      const msg = 'Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.';
      if (!silent) { toast(msg); setWebLeadsStatus(msg, 'error'); }
      return;
    }

    const btn = document.activeElement?.matches?.('[data-check-website-leads]') ? document.activeElement : null;
    const oldText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Prüfe...'; }
    if (!silent) setWebLeadsStatus('Web-Leads werden geprüft...', 'loading');

    const callbackName = `lumianWebsiteLeads_${Date.now()}`;
    const script = document.createElement('script');
    let done = false;

    const finish = (message, tone = '') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (btn) { btn.disabled = false; btn.textContent = oldText || 'Web-Leads prüfen'; }
      try { delete window[callbackName]; } catch {}
      script.remove();
      if (!silent && message) { toast(message); setWebLeadsStatus(message, tone); }
    };

    window[callbackName] = data => {
      try {
        const rows = data?.leads || [];
        const count = importWebsiteLeads(rows);
        if (count) finish(`${count} neue Website-/Danke-Code-Anfrage(n) importiert.`, 'ok');
        else finish(`Keine neuen Web-Leads gefunden. Gesamt in Cloud: ${rows.length}.`, rows.length ? 'ok' : '');
      } catch (err) {
        finish('Web-Leads konnten nicht importiert werden: ' + String(err).slice(0,120), 'error');
      }
    };

    const timer = setTimeout(() => {
      finish('Keine Antwort vom Google Script. Deployment/Access prüfen: Web App, Execute as Me, Anyone with link.', 'error');
    }, 12000);

    script.onerror = () => finish('Google Script konnte nicht geladen werden. URL oder Zugriff prüfen.', 'error');
    script.src = `${url}${url.includes('?')?'&':'?'}action=websiteLeads&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  }

  function hasLocalPhotoData(s = state) {
    return (s.jobs || []).some(j => j?.beforePhoto?.dataUrl || j?.afterPhoto?.dataUrl || j?.beforePhoto?.localOnly || j?.afterPhoto?.localOnly);
  }

  function mergeCloudStatePreserveLocalMedia(localState, cloudState) {
    const merged = mergeLocalCloudStates(localState || {}, cloudState || {});
    const localJobs = new Map((localState?.jobs || []).map(j => [String(j.id || ''), j]));
    (merged.jobs || []).forEach(job => {
      const local = localJobs.get(String(job.id || ''));
      if (!local) return;
      ['beforePhoto','afterPhoto'].forEach(key => {
        const cloudPhoto = job[key];
        const localPhoto = local[key];
        if (localPhoto?.dataUrl && (!cloudPhoto || cloudPhoto.localOnly || cloudPhoto.error || (!cloudPhoto.driveUrl && !cloudPhoto.url && !cloudPhoto.fileId))) {
          job[key] = Object.assign({}, cloudPhoto || {}, localPhoto, { localOnly: true });
        }
      });
    });
    return merged;
  }

  function refreshCloudAfterSync(expectedSyncRunId = '', silent = true) {
    const url = currentScriptUrl();
    if (!url) return;
    const callbackName = `lumianAfterPhotoSync_${Date.now()}`;
    const script = document.createElement('script');
    const cleanup = () => { try { delete window[callbackName]; } catch {} script.remove(); };
    window[callbackName] = data => {
      try {
        const cloudState = data?.state;
        const sameRun = !expectedSyncRunId || cloudState?.lastSyncRunId === expectedSyncRunId;
        if (cloudState && sameRun) {
          suppressAutoCloudSync = true;
          const merged = mergeCloudStatePreserveLocalMedia(state, cloudState);
          state = migrateState(merged);
          localStorage.setItem(STORE_KEY, JSON.stringify(state));
          suppressAutoCloudSync = false;
          renderAll();
          const failedPhoto = (state.jobs || []).some(j => j?.beforePhoto?.error || j?.afterPhoto?.error);
          const failedCal = (state.jobs || []).some(j => String(j?.calendarSyncStatus || '').toLowerCase().includes('fehler'));
          if (!silent) toast(failedPhoto || failedCal ? 'Sync fertig, aber es gibt Fehler-Badges. Bitte Drive/Kalender testen.' : 'Sync fertig. Fotos/Kalender-Status ist aktualisiert.');
        } else if (!silent) {
          toast('Sync nicht bestätigt. Bitte Drive/Kalender testen oder Apps Script Deployment prüfen.');
        }
      } catch { if (!silent) toast('Sync-Antwort konnte nicht gelesen werden.'); }
      cleanup();
    };
    script.onerror = cleanup;
    script.src = `${url}${url.includes('?')?'&':'?'}action=load&callback=${callbackName}&t=${Date.now()}`;
    document.body.appendChild(script);
  }

  function calendarSyncTarget(s = state) {
    return String(s?.settings?.calendarId || DEFAULT_SETTINGS.calendarId || '').trim();
  }
  function calendarSyncNeeded(s = state) {
    return !!calendarSyncTarget(s) && (s.jobs || []).some(j => j && j.appointmentAt && !isCancelledJob(j));
  }

  function makeCloudPayload() { const syncRunId = `sync-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; saveState('before sync', { cloud: false }); return { action:'syncFull', syncRunId, sentAt:new Date().toISOString(), by:currentUser, state, activityLog: pendingActivityLog() }; }
  async function syncCloud(silent = false) {
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl(); if (!url) { if (!silent) toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.'); return; }
    if (navigator.onLine === false) { if (!silent) toast('Offline gespeichert. Sync startet automatisch, sobald das Gerät online ist.'); return; }
    if (cloudSyncInProgress) return;
    cloudSyncInProgress = true;
    queueActivity(silent ? 'Auto-Sync gesendet' : 'Sync gesendet', 'Sync', '', silent ? 'Automatischer Cloud-Sync wurde gestartet.' : 'Manueller Cloud-Sync wurde gestartet.');
    const payload = makeCloudPayload();
    const refreshPhotos = hasLocalPhotoData(payload.state);
    const refreshCalendar = calendarSyncNeeded(payload.state);
    const refreshAfterSync = refreshPhotos || refreshCalendar;
    try {
      await fetch(url, { method:'POST', mode:'no-cors', headers:{ 'Content-Type':'text/plain' }, body: JSON.stringify(payload) });
      setPendingActivityLog([]);
      if (!silent) toast(refreshPhotos ? 'Sync gesendet. Fotos/Termine werden gespeichert...' : (refreshCalendar ? 'Sync gesendet. Google Calendar wird aktualisiert...' : 'Sync gesendet. Google Sheet/Drive prüfen.'));
      setTimeout(() => refreshCloudAfterSync(payload.syncRunId, silent), refreshAfterSync ? 6500 : 2200);
    }
    catch { if (!silent) toast('Sync konnte nicht gesendet werden.'); }
    finally { cloudSyncInProgress = false; }
  }
  function loadCloud() {
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl(); if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    const callbackName = `lumianCloud_${Date.now()}`;
    const script = document.createElement('script');
    window[callbackName] = data => {
      try {
        if (!data || !data.state) throw new Error('empty');
        suppressAutoCloudSync = true;
        const imported = mergeCloudStatePreserveLocalMedia(state, data.state);
        state = migrateState(imported);
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
        suppressAutoCloudSync = false;
        renderAll();
        queueActivity('Refresh / Cloud geladen', 'Sync', '', 'Aktuelle Cloud-Daten wurden auf dieses Gerät geladen.', { flush: true });
        toast('Cloud geladen und mit diesem Gerät abgeglichen.');
      } catch { toast('Cloud-Daten konnten nicht geladen werden.'); }
      delete window[callbackName]; script.remove();
    };
    script.src = `${url}${url.includes('?')?'&':'?'}action=load&callback=${callbackName}&t=${Date.now()}`;
    script.onerror = () => { toast('Cloud laden fehlgeschlagen.'); delete window[callbackName]; script.remove(); };
    document.body.appendChild(script);
  }

  function jsonpRequest(url, action, params = {}) {
    return new Promise((resolve, reject) => {
      const callbackName = `lumianJsonp_${action}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      const script = document.createElement('script');
      const cleanup = () => { try { delete window[callbackName]; } catch {} script.remove(); };
      const qs = new URLSearchParams(Object.assign({}, params, { action, callback: callbackName, t: Date.now() }));
      window[callbackName] = data => { cleanup(); resolve(data); };
      script.onerror = () => { cleanup(); reject(new Error('Apps Script konnte nicht geladen werden. URL/Deployment prüfen.')); };
      script.src = `${url}${url.includes('?')?'&':'?'}${qs.toString()}`;
      document.body.appendChild(script);
    });
  }

  async function testGoogleSync() {
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl();
    if (!url) return toast('Bitte zuerst Google Apps Script URL speichern.');
    toast('Drive/Kalender Test läuft...');
    try {
      const data = await jsonpRequest(url, 'testsync', {
        driveFolderId: getSetting('driveFolderId') || DEFAULT_SETTINGS.driveFolderId,
        backupFolderId: getSetting('backupFolderId') || DEFAULT_SETTINGS.backupFolderId,
        calendarId: getSetting('calendarId') || DEFAULT_SETTINGS.calendarId
      });
      const test = data?.test || {};
      const driveMsg = test.drive?.message || 'Drive: keine Antwort';
      const calMsg = test.calendar?.message || 'Kalender: keine Antwort';
      const backupMsg = test.backup?.message || 'Backup: keine Antwort';
      const activityMsg = test.activityLog?.message || 'Activity Log: keine Antwort';
      alert(`Lumian Sync Test\n\nFoto Drive Folder ID:\n${test.driveFolderId || ''}\n\nBackup Folder ID:\n${test.backupFolderId || ''}\n\nActivity Log Sheet ID:\n${test.activityLogSheetId || ''}\n\nKalender ID:\n${test.calendarId || ''}\n\nFotos Drive:\n${driveMsg}\n\nBackup Drive:\n${backupMsg}\n\nActivity Log:\n${activityMsg}\n\nKalender:\n${calMsg}`);
      toast(test.drive?.ok && test.backup?.ok && test.activityLog?.ok && test.calendar?.ok ? 'Drive/Kalender/Backup/Log Test OK.' : 'Test zeigt Fehler. Siehe Meldung.');
    } catch (err) {
      alert('Sync-Test fehlgeschlagen:\n' + (err?.message || err));
      toast('Sync-Test fehlgeschlagen.');
    }
  }

  async function backupNow() {
    if (!isAdmin()) return toast('Nur Admins können Backups erstellen.');
    saveSettingsFromForm(false);
    const url = currentScriptUrl();
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    try {
      const data = await jsonpRequest(url, 'backupnow', { backupFolderId: getSetting('backupFolderId') || DEFAULT_SETTINGS.backupFolderId });
      if (!data?.ok) throw new Error(data?.error || 'Backup nicht bestätigt.');
      queueActivity('Drive-Backup erstellt', 'Backup', '', 'Manuelles Backup wurde auf Google Drive gespeichert.', { flush: true });
      toast('Backup wurde auf Google Drive gespeichert.');
    } catch (err) {
      toast('Backup konnte nicht gespeichert werden.');
    }
  }

  async function listDriveBackups() {
    if (!isAdmin()) return toast('Nur Admins können Drive-Backups anzeigen.');
    const url = currentScriptUrl();
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    const picker = $('[data-backup-picker]');
    const select = $('[data-drive-backup-select]');
    const status = $('[data-backup-list-status]');
    try {
      toast('Drive-Backups werden geladen...');
      const data = await jsonpRequest(url, 'listbackups', { backupFolderId: getSetting('backupFolderId') || DEFAULT_SETTINGS.backupFolderId });
      if (!data?.ok) throw new Error(data?.error || 'Keine Backupliste erhalten.');
      const backups = data.backups || [];
      if (!backups.length) {
        if (picker) picker.hidden = false;
        if (select) select.innerHTML = '<option value="">Keine Backups gefunden</option>';
        if (status) status.textContent = 'Keine Drive-Backups im Backup-Ordner gefunden.';
        compactPortalInfoTexts(picker || document);
        return toast('Keine Drive-Backups gefunden.');
      }
      if (select) {
        select.innerHTML = backups.map(b => `<option value="${esc(b.id)}">${esc(b.name)} · ${esc(b.createdAt || '')} · ${esc(b.sizeLabel || '')}</option>`).join('');
      }
      if (picker) picker.hidden = false;
      if (status) {
        status.dataset.infoProcessed = '';
        status.textContent = `${backups.length} Backup(s) gefunden. Vor Wiederherstellung wird automatisch ein Sicherheitsbackup vom aktuellen Stand erstellt.`;
      }
      compactPortalInfoTexts(picker || document);
      toast('Drive-Backups geladen.');
    } catch (err) {
      toast('Drive-Backups konnten nicht geladen werden.');
    }
  }

  async function restoreSelectedDriveBackup() {
    if (!isAdmin()) return toast('Nur Admins können Backups wiederherstellen.');
    const url = currentScriptUrl();
    const select = $('[data-drive-backup-select]');
    const fileId = String(select?.value || '').trim();
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    if (!fileId) return toast('Bitte zuerst ein Drive-Backup auswählen.');
    const chosen = select?.selectedOptions?.[0]?.textContent || 'ausgewähltes Backup';
    if (!(await confirmSensitiveAction(`Backup wiederherstellen?\n\n${chosen}`))) return;
    const typed = prompt('Letzte Bestätigung: Schreibe RESTORE, um dieses Backup wiederherzustellen. Aktueller Stand wird vorher automatisch gesichert.');
    if (typed !== 'RESTORE') return toast('Wiederherstellung abgebrochen.');
    try {
      toast('Backup wird wiederhergestellt...');
      const data = await jsonpRequest(url, 'restorebackup', {
        fileId,
        confirm:'RESTORE-LUMIAN-BACKUP',
        backupFolderId: getSetting('backupFolderId') || DEFAULT_SETTINGS.backupFolderId
      });
      if (!data?.ok || !data.state) throw new Error(data?.error || 'Restore nicht bestätigt.');
      suppressAutoCloudSync = true;
      state = migrateState(data.state);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      suppressAutoCloudSync = false;
      renderAll();
      queueActivity('Drive-Backup wiederhergestellt', 'Backup', fileId, chosen, { flush: true });
      toast('Backup wiederhergestellt. Alle Geräte sollten Cloud laden.');
    } catch (err) {
      toast('Backup konnte nicht wiederhergestellt werden.');
    }
  }

  async function clearWebAppCacheAndReload() {
    if (!(await confirmSensitiveAction('Web-App Cache auf diesem Gerät erneuern? Geschäftsdaten und lokale Offline-Daten bleiben erhalten.'))) return;
    queueActivity('Web-App Cache erneuert', 'Cache', '', 'Technischer App-Cache auf diesem Gerät wurde erneuert.', { flush: true });
    let cleared = 0;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key).then(ok => { if (ok) cleared += 1; })));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.update().catch(() => {})));
      }
      toast(cleared ? 'Web-App Cache erneuert. Portal lädt neu...' : 'Portal lädt neu...');
    } catch (err) {
      toast('Portal lädt neu...');
    }
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    setTimeout(() => window.location.replace(url.toString()), 700);
  }

  async function clearLocalCacheAndReloadCloud() {
    if (!(await confirmSensitiveAction('Lokalen Cache auf diesem Gerät löschen und Cloud neu laden?'))) return;
    const keep = migrateState(state);
    const fresh = newState();
    fresh.settings = { ...fresh.settings, ...keep.settings };
    fresh.users = keep.users?.length ? keep.users : fresh.users;
    localStorage.setItem(STORE_KEY, JSON.stringify(fresh));
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
    state = fresh;
    queueActivity('Lokaler Cache gelöscht und Cloud neu geladen', 'Cache', '', 'Lokaler Geräte-Cache wurde zurückgesetzt.', { flush: true });
    toast('Lokaler Cache gelöscht. Cloud wird geladen...');
    loadCloud();
  }

  async function goLiveResetCloud() {
    if (!isAdmin()) return toast('Nur Admins können Testdaten löschen.');
    saveSettingsFromForm(false);
    const url = currentScriptUrl();
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    if (!(await confirmSensitiveAction('Testdaten löschen und produktiv starten?'))) return;
    const typed = prompt('Letzte Bestätigung: Schreibe PRODUKTIV, um Test-Leads/Jobs/Kunden/Buchhaltung zu löschen. Benutzer, Passwörter und Einstellungen bleiben erhalten.');
    if (typed !== 'PRODUKTIV') return toast('Vorgang abgebrochen.');
    try {
      const data = await jsonpRequest(url, 'golivereset', { confirm:'START-PRODUCTION', backupFolderId: getSetting('backupFolderId') || DEFAULT_SETTINGS.backupFolderId });
      if (!data?.ok) throw new Error(data?.error || 'Produktiv-Start nicht bestätigt.');
      localStorage.removeItem(STORE_KEY);
      OLD_KEYS.forEach(k => localStorage.removeItem(k));
      queueActivity('Testdaten gelöscht & Produktivbetrieb gestartet', 'Setup', '', 'Produktivmodus wurde gestartet.', { flush: true });
      toast('Testdaten gelöscht, Backup erstellt, Produktivmodus gestartet. Portal lädt neu...');
      setTimeout(() => location.reload(), 900);
    } catch {
      toast('Produktiv-Start konnte nicht abgeschlossen werden.');
    }
  }

  async function resetCloudAndLocal() {
    if (!isAdmin()) return toast('Nur Admins können Cloud-Daten löschen.');
    saveSettingsFromForm(false);
    const url = currentScriptUrl();
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    if (!(await confirmSensitiveAction('Kompletten Cloud-Reset wirklich ausführen?'))) return;
    const typed = prompt('Letzte Bestätigung: Schreibe RESET, um ALLES zu leeren.');
    if (typed !== 'RESET') return toast('Löschen abgebrochen.');
    try {
      const data = await jsonpRequest(url, 'resetall', { confirm:'RESET-LUMIAN-PORTAL' });
      if (!data?.ok) throw new Error(data?.error || 'Cloud-Reset nicht bestätigt.');
      localStorage.removeItem(STORE_KEY);
      OLD_KEYS.forEach(k => localStorage.removeItem(k));
      toast('Cloud und lokale Daten gelöscht. Portal lädt neu...');
      setTimeout(() => location.reload(), 900);
    } catch {
      toast('Cloud-Reset konnte nicht gesendet werden.');
    }
  }

  $$('[data-sync-now]').forEach(btn => btn.addEventListener('click', syncCloud));
  $$('[data-test-sync]').forEach(btn => btn.addEventListener('click', testGoogleSync));
  $$('[data-load-cloud]').forEach(btn => btn.addEventListener('click', loadCloud));
  $$('[data-check-website-leads]').forEach(btn => btn.addEventListener('click', () => checkWebsiteLeads(false)));
  window.addEventListener('online', () => { if (currentUser && currentScriptUrl()) { toast('Gerät ist online. Sync läuft...'); syncCloud(true); flushActivityLog(true); } });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentUser && currentScriptUrl()) {
      const now = Date.now();
      if (!autoLoadCloudThenCheckWebsiteLeads._last || now - autoLoadCloudThenCheckWebsiteLeads._last > 60000) {
        autoLoadCloudThenCheckWebsiteLeads._last = now;
        autoLoadCloudThenCheckWebsiteLeads();
      }
    }
  });

  // PWA install button: works on Android/Chrome. iPhone shows clear manual instructions.
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; });
  $$('[data-install-portal]').forEach(btn => btn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(()=>{});
      deferredInstallPrompt = null;
    } else {
      $('[data-install-dialog]').showModal();
    }
  }));


  function setupSmartStickyNav() {
    const tabs = $('.tabs');
    const topbar = $('.topbar');
    if (!tabs || !topbar) return;

    const update = () => {
      if (!currentUser || window.innerWidth > 1100) {
        document.body.classList.remove('nav-stuck');
        document.documentElement.style.setProperty('--tabs-height', '0px');
        return;
      }

      const topOffset = 6 + (window.visualViewport?.offsetTop || 0);
      const tabsHeight = Math.ceil(tabs.getBoundingClientRect().height || 56);
      document.documentElement.style.setProperty('--tabs-height', `${tabsHeight}px`);

      const topbarBottom = topbar.getBoundingClientRect().bottom;
      document.body.classList.toggle('nav-stuck', topbarBottom <= topOffset);
    };

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    setTimeout(update, 80);
    setTimeout(update, 400);
  }

  function b64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let str = ''; bytes.forEach(b => str += String.fromCharCode(b));
    return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function fromB64url(str) {
    str = String(str).replace(/-/g,'+').replace(/_/g,'/');
    while (str.length % 4) str += '=';
    const bin = atob(str);
    const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  function randomChallenge() { const a = new Uint8Array(32); crypto.getRandomValues(a); return a.buffer; }
  async function enableBiometric() {
    if (!window.PublicKeyCredential || !navigator.credentials?.create) return toast('Biometrie/Passkey wird auf diesem Browser nicht unterstützt.');
    try {
      const user = state.users.find(u => u.id === currentUser);
      const userHandle = new TextEncoder().encode(currentUser + '@lumian');
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: randomChallenge(), rp: { name: 'Lumian Portal' },
        user: { id: userHandle, name: `${currentUser}@lumianservices.ch`, displayName: userName(currentUser) },
        pubKeyCredParams: [{ type:'public-key', alg:-7 }, { type:'public-key', alg:-257 }],
        authenticatorSelection: { userVerification:'preferred', residentKey:'preferred' },
        timeout: 60000, attestation: 'none'
      }});
      user.credentialId = b64url(cred.rawId); user.credentialUserHandle = b64url(userHandle);
      saveState('Biometrie aktiviert'); toast('Face ID / Touch ID ist auf diesem Gerät aktiviert.');
    } catch { toast('Biometrie wurde nicht aktiviert.'); }
  }
  async function biometricLogin() {
    const select = $('[data-login-form]').elements.user;
    const user = state.users.find(u => u.id === select.value);
    if (!user?.credentialId) return toast('Für diesen Benutzer zuerst in den Einstellungen Biometrie aktivieren.');
    if (!navigator.credentials?.get) return toast('Biometrie/Passkey wird auf diesem Browser nicht unterstützt.');
    try {
      await navigator.credentials.get({ publicKey: { challenge: randomChallenge(), allowCredentials: [{ type:'public-key', id: fromB64url(user.credentialId) }], userVerification:'preferred', timeout:60000 }});
      currentUser = user.id; sessionStorage.setItem(SESSION_KEY, currentUser); renderLogin(); toast(`Willkommen, ${userName(user.id)}.`);
    } catch { toast('Biometrie abgebrochen oder fehlgeschlagen.'); }
  }
  $('[data-enable-biometric]')?.addEventListener('click', enableBiometric);
  $('[data-disable-biometric]')?.addEventListener('click', () => { const u = state.users.find(x => x.id === currentUser); if (u) { u.credentialId=''; u.credentialUserHandle=''; saveState('Biometrie entfernt'); toast('Biometrie auf diesem Gerät entfernt.'); } });
  $('[data-biometric-login]')?.addEventListener('click', biometricLogin);

  setDefaultFinanceDates();
  renderLogin();
  setupSmartStickyNav();
})();
