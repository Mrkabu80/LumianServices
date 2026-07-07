(() => {
  'use strict';

  const STORE_KEY = 'lumian.portal.v5';
  const OLD_KEYS = ['lumian.portal.v4','lumian.portal.v3','lumian.portal.v2'];
  const SESSION_KEY = 'lumian.portal.user';
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
    referralBase: 'https://www.lumianservices.ch/?ref={{customerId}}#booking',
    scriptUrl: '',
    driveFolderId: '',
    calendarId: '',
    recoveryCode: 'Lumian-Reset-2026',
    referralTemplate: 'Hoi {{name}}, danke nochmals für dein Vertrauen in Lumian Services.\n\nWenn du uns an Freunde, Familie oder Nachbarn weiterempfiehlst, erhalten sie CHF {{bonus}} Rabatt auf ihren ersten Auftrag ab CHF {{minOrder}}. Du erhältst nach abgeschlossenem Auftrag ebenfalls CHF {{bonus}} Guthaben für deine nächste Reinigung.\n\nDein Empfehlungslink:\n{{referralLink}}\n\nLiebe Grüsse\nLumian Services',
    newCustomerTemplate: 'Hoi {{name}}, danke für deine Anfrage bei Lumian Services.\n\nGerne schauen wir uns dein Anliegen an und melden uns mit einem Vorschlag. Wenn du über eine Empfehlung kommst, gilt der CHF {{bonus}} Vorteil ab einem Auftrag von CHF {{minOrder}}.\n\nLiebe Grüsse\nLumian Services',
    reminderTemplate: 'Hoi {{name}}, kurze Erinnerung: Wir haben deinen Lumian Termin am {{date}} für {{service}} eingetragen.\n\nAdresse: {{address}}\nBetrag gemäss Abmachung: CHF {{amount}}\n\nLiebe Grüsse\nLumian Services'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let currentUser = sessionStorage.getItem(SESSION_KEY) || '';
  let activeTab = 'dashboard';
  const PAGE_SIZE = 20;
  let listPages = { leads: 1, jobs: 1, customers: 1 };
  let customerListMode = 'search';
  let stagedPhotos = { before: null, after: null };
  let deferredInstallPrompt = null;
  let state = loadState();

  function newState() {
    return {
      version: 6,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      users: USERS.map(u => ({ ...u, role: 'admin', active: true, passwordHash: '', salt: '', credentialId: '', credentialUserHandle: '', recoveryCode: `${u.name}-Reset-2026` })),
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
    merged.version = 6;
    merged.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
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
    merged.jobs = Array.isArray(s.jobs) ? s.jobs.map(j => ({ source: '', referredById: '', ...j })) : [];
    merged.rewards = Array.isArray(s.rewards) ? s.rewards : [];
    merged.finance = { manualIncome: [], expenses: [], ...(s.finance || {}) };
    if (!Array.isArray(merged.finance.manualIncome)) merged.finance.manualIncome = [];
    if (!Array.isArray(merged.finance.expenses)) merged.finance.expenses = [];
    merged.audit = Array.isArray(s.audit) ? s.audit : [];
    localStorage.setItem(STORE_KEY, JSON.stringify(merged));
    return merged;
  }

  function saveState(reason = 'save') {
    state.updatedAt = new Date().toISOString();
    if (currentUser) state.audit.push({ at: state.updatedAt, by: currentUser, reason });
    state.audit = state.audit.slice(-400);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
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

  function getSetting(key) { return state.settings[key] ?? DEFAULT_SETTINGS[key]; }
  function userName(id) { return state?.users?.find(u => u.id === id)?.name || USERS.find(u => u.id === id)?.name || id || '-'; }
  function userEmoji(id) { return state?.users?.find(u => u.id === id)?.emoji || USERS.find(u => u.id === id)?.emoji || '?'; }
  function personById(id) { return state.people.find(p => p.id === id); }
  function leadById(id) { return state.leads.find(l => l.id === id); }
  function jobById(id) { return state.jobs.find(j => j.id === id); }
  function allPeopleSorted() { return [...state.people].sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function activeCustomers() { return state.people.filter(p => p.status === 'customer').sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function activeLeads() { return state.leads.filter(l => !['Job erstellt','Kunde geworden','Verloren'].includes(l.status)); }

  function leadForPerson(personId) {
    return state.leads
      .filter(l => l.personId === personId && !['Kunde geworden','Verloren'].includes(l.status))
      .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0] || null;
  }

  function personSearchText(p) {
    const lead = leadForPerson(p.id);
    return [p.id, p.name, p.phone, p.email, p.address, p.place, p.source, p.status, lead?.id, lead?.service, lead?.status].join(' ').toLowerCase();
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

  function fillTemplate(template, data) {
    return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => data[key] ?? '');
  }

  function referralLink(customerId) { return fillTemplate(getSetting('referralBase'), { customerId }); }
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

  function fmtDate(value) {
    if (!value) return '-';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString('de-CH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch { return value; }
  }

  function nextId(type) {
    if (type === 'person') return `LM${state.counters.nextPerson++}`;
    if (type === 'lead') return `L${String(state.counters.nextLead++).padStart(4,'0')}`;
    if (type === 'job') return `J${String(state.counters.nextJob++).padStart(4,'0')}`;
    if (type === 'reward') return `R${String(state.counters.nextReward++).padStart(4,'0')}`;
    return `${type}-${Date.now()}`;
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
    saveState('password');
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
    renderLogin();
  });

  function setTab(tab) {
    if (!canAccessTab(tab)) tab = 'dashboard';
    activeTab = tab;
    renderPermissions();
    $$('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $$('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tab));
    const titles = { dashboard:'Übersicht', leads:'Leads', jobs:'Jobs', customers:'Kunden', finance:'Buchhaltung', rewards:'Bonus', settings:'Setup' };
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
      listPages[key] = Math.max(1, (listPages[key] || 1) + Number(pageBtn.dataset.pageDir || 0));
      renderAll();
      const panel = pageBtn.closest('.panel');
      panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  function renderAll() {
    if (!currentUser) return;
    renderStats(); renderToday(); renderLeads(); renderJobs(); renderCustomers(); renderFinance(); renderRewards(); renderUsers(); fillSettings(false);
  }

  function renderStats() {
    const openLeadCount = activeLeads().length;
    const openJobCount = state.jobs.filter(j => !['Erledigt','Bezahlt','Abgesagt'].includes(j.status)).length;
    const customerCount = activeCustomers().length;
    const openRewards = state.rewards.filter(r => r.status === 'offen').reduce((s,r)=>s+Number(r.amount||0),0);
    const cards = [['Offene Leads', openLeadCount], ['Offene Jobs', openJobCount], ['Kunden', customerCount]];
    if (isAdmin()) cards.push(['Offener Bonus', `CHF ${openRewards}`]);
    $('[data-stats]').innerHTML = cards.map(([label, value]) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
  }

  function renderToday() {
    const now = Date.now();
    const jobs = state.jobs.filter(j => j.appointmentAt && !['Erledigt','Bezahlt','Abgesagt'].includes(j.status))
      .sort((a,b)=>new Date(a.appointmentAt)-new Date(b.appointmentAt)).slice(0, 8);
    $('[data-today-list]').innerHTML = jobs.length ? jobs.map(j => {
      const p = personById(j.personId) || {};
      const overdue = new Date(j.appointmentAt).getTime() < now;
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge">${esc(p.id || '')}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · ${esc(p.address || '')}</div></div><span class="badge ${overdue?'danger':'warn'}">${esc(j.status)}</span></div>
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
    const start = (page - 1) * PAGE_SIZE;
    return { slice: items.slice(start, start + PAGE_SIZE), total, page, pages, start, end: Math.min(start + PAGE_SIZE, total) };
  }

  function renderPager(key, data) {
    const el = $(`[data-${key.slice(0,-1)}-pager]`) || $(`[data-${key}-pager]`);
    if (!el) return;
    if (!data.total) { el.innerHTML = ''; return; }
    const label = key === 'leads' ? 'Leads' : key === 'jobs' ? 'Jobs' : 'Kunden';
    if (data.total <= PAGE_SIZE) {
      el.innerHTML = `<div class="pager-summary">${data.total} ${label}</div>`;
      return;
    }
    el.innerHTML = `<div class="pager-summary">${data.start + 1}–${data.end} von ${data.total} ${label}</div>
      <div class="pager-actions">
        <button class="secondary" type="button" data-page-target="${key}" data-page-dir="-1" ${data.page <= 1 ? 'disabled' : ''}>Zurück</button>
        <span class="pager-page">Seite ${data.page} / ${data.pages}</span>
        <button class="secondary" type="button" data-page-target="${key}" data-page-dir="1" ${data.page >= data.pages ? 'disabled' : ''}>Weiter</button>
      </div>`;
  }

  function renderLeads() {
    const q = ($('[data-lead-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-lead-filter]')?.value || 'active';
    let leads = [...state.leads].sort((a,b)=>(personById(a.personId)?.name||'').localeCompare(personById(b.personId)?.name||'', 'de-CH') || new Date(b.createdAt)-new Date(a.createdAt));
    if (filter === 'active') leads = leads.filter(l => !['Job erstellt','Kunde geworden','Verloren'].includes(l.status));
    if (filter === 'won') leads = leads.filter(l => ['Job erstellt','Kunde geworden'].includes(l.status));
    if (filter === 'lost') leads = leads.filter(l => l.status === 'Verloren');
    if (q) leads = leads.filter(l => {
      const p = personById(l.personId) || {};
      return [l.id,l.service,l.status,l.source,p.id,p.name,p.phone,p.email,p.address,p.place].join(' ').toLowerCase().includes(q);
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
        <div class="badges"><span class="badge ${l.status==='Verloren'?'danger':l.status==='Offen'?'warn':'ok'}">${esc(l.status)}</span>${ref?`<span class="badge ok">Empf. ${esc(ref.name)} · ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || '')}${l.expectedValue?` · ca. CHF ${esc(l.expectedValue)}`:''}${l.appointmentAt?` · ${fmtDate(l.appointmentAt)}`:''}</div>
      <div class="actions">${waLeadLink(p,l)}${phoneLink(p.phone)}${mapLink(p)}${l.status==='Offen'?`<button class="primary" data-convert-lead="${esc(l.id)}">In Job umwandeln</button><button class="secondary" data-mark-lead-lost="${esc(l.id)}">Verloren</button>`:`<button class="secondary" data-open-person-job="${esc(p.id || '')}">Neuer Job</button>`}</div>
    </article>`;
  }

  function renderJobs() {
    const q = ($('[data-job-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-job-filter]')?.value || 'open';
    let jobs = [...state.jobs].sort((a,b)=>new Date(a.appointmentAt || a.createdAt)-new Date(b.appointmentAt || b.createdAt));
    if (filter === 'open') jobs = jobs.filter(j => !['Erledigt','Bezahlt','Abgesagt'].includes(j.status));
    if (filter === 'done') jobs = jobs.filter(j => ['Erledigt','Bezahlt'].includes(j.status));
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
    const done = ['Erledigt','Bezahlt'].includes(j.status);
    const ref = personById(j.referredById || p.referredById);
    const photos = [j.beforePhoto, j.afterPhoto].filter(Boolean).map((ph,i)=>`<img class="thumb" src="${esc(ph.dataUrl || ph.url)}" alt="${i?'Nachher':'Vorher'} Foto">`).join('');
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge badge-id">${esc(p.id || '')}</span> <span class="badge ${p.status==='customer'?'ok':'warn'}">${p.status==='customer'?'Kunde':'Lead'}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · zuständig: ${esc(userName(j.assignedTo || j.createdBy || currentUser))}</div></div>
        <div class="badges"><span class="badge ${done?'ok':j.status==='Abgesagt'?'danger':'warn'}">${esc(j.status)}</span>${j.amount?`<span class="badge">CHF ${esc(j.amount)}</span>`:''}${ref?`<span class="badge ok">Empf. ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || '')}</div>
      ${photos ? `<div class="photo-preview">${photos}</div>` : ''}
      <div class="actions">${customerReminderLink(j)}${calendarButton(j)}${phoneLink(p.phone)}${mapLink(p)}<button class="secondary" data-edit-job="${esc(j.id)}">Bearbeiten</button>${!done?`<button class="primary" data-complete-job="${esc(j.id)}">Erledigt</button><button class="secondary" data-paid-job="${esc(j.id)}">Bezahlt</button>`:whatsappLink(p.phone, referralInviteText(p), 'Empfehlung senden', true)}</div>
    </article>`;
  }

  function renderCustomers() {
    const q = ($('[data-customer-search]')?.value || '').toLowerCase().trim();
    let customers = activeCustomers();
    if (q) customers = customers.filter(p => [p.id,p.name,p.phone,p.email,p.address,p.place,p.source].join(' ').toLowerCase().includes(q));
    const pageData = paginateItems(customers, 'customers');
    renderPager('customers', pageData);
    $('[data-customer-list]').innerHTML = pageData.slice.length ? pageData.slice.map(customerCard).join('') : '<div class="empty">Noch keine Kunden gefunden. Kunde manuell hinzufügen, importieren oder Job als erledigt markieren.</div>';
  }

  function customerCard(p) {
    const jobs = state.jobs.filter(j => j.personId === p.id);
    const link = referralLink(p.id);
    return `<article class="item-card">
      <div class="item-top"><div><div class="item-title">${esc(p.name)} <span class="badge badge-id">${esc(p.id)}</span></div><div class="item-sub">${esc(fullAddressForPerson(p) || p.address || '')}</div></div><div class="badges"><span class="badge">${jobs.length} Job(s)</span><span class="badge">${esc(p.source || 'Quelle offen')}</span></div></div>
      <div class="referral-link-line"><span>Empfehlungslink</span><strong>${esc(link)}</strong></div>
      <div class="actions">${whatsappLink(p.phone, referralInviteText(p), 'WhatsApp', true)}${phoneLink(p.phone)}${mapLink(p)}<button class="secondary" data-copy-ref="${esc(p.id)}">Link kopieren</button><button class="secondary" data-open-person-job="${esc(p.id)}">Neuer Job</button></div>
    </article>`;
  }


  function money(value) {
    return `CHF ${Number(value || 0).toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function ymd(d) {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0,10);
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
    if (period === 'week') {
      const day = (now.getDay() + 6) % 7;
      start.setDate(now.getDate() - day);
      from = ymd(start); label = 'Diese Woche';
    } else if (period === 'year') {
      from = `${now.getFullYear()}-01-01`; label = 'Dieses Jahr';
    } else if (period === 'custom') {
      from = $('[data-finance-from]')?.value || '';
      to = $('[data-finance-to]')?.value || to;
      label = from || to ? `${from || '...'} bis ${to || '...'}` : 'Benutzerdefiniert';
    } else {
      from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`; label = 'Dieser Monat';
    }
    return { period, from, to, label };
  }
  function completedJobs() {
    return state.jobs.filter(j => ['Erledigt','Bezahlt'].includes(j.status));
  }
  function paidJobs() {
    return state.jobs.filter(j => j.status === 'Bezahlt');
  }
  function forecastJobs(range) {
    return state.jobs
      .filter(j => j.status !== 'Bezahlt' && j.status !== 'Abgesagt')
      .filter(j => Number(j.amount || 0) > 0)
      .filter(j => dateInRange(j.appointmentAt || j.createdAt, range.from, range.to))
      .map(j => {
        const p = personById(j.personId) || {};
        return { type:'Forecast', id:j.id, date:j.appointmentAt || j.createdAt, title:`${p.name || j.personId} · ${j.service || 'Reinigung'}`, amount:Number(j.amount || 0), personId:j.personId, jobId:j.id, status:j.status, createdBy:j.createdBy || '', assignedTo:j.assignedTo || '' };
      });
  }
  function jobIncomeItems(range) {
    return paidJobs().filter(j => dateInRange(financeJobDate(j), range.from, range.to)).map(j => {
      const p = personById(j.personId) || {};
      return { type:'Job bezahlt', id:j.id, date:financeJobDate(j), title:`${p.name || j.personId} · ${j.service || 'Reinigung'}`, amount:Number(j.amount || 0), personId:j.personId, jobId:j.id, createdBy:j.createdBy || '', assignedTo:j.assignedTo || '' };
    });
  }
  function manualIncomeItems(range) {
    return (state.finance?.manualIncome || []).filter(x => {
      const start = x.from || x.date || x.createdAt;
      const end = x.to || start;
      return (!range.from || end >= range.from) && (!range.to || start <= range.to);
    }).map(x => ({ type:'Manuell', id:x.id, date:x.from || x.createdAt, from:x.from || '', to:x.to || '', title:x.title || 'Manuelle Einnahme', amount:Number(x.amount || 0), notes:x.notes || '', createdBy:x.createdBy || '' }));
  }
  function expenseItems(range) {
    return (state.finance?.expenses || []).filter(x => dateInRange(x.date || x.createdAt, range.from, range.to)).map(x => ({ ...x, amount:Number(x.amount || 0) }));
  }
  function financeSummary(range) {
    const jobs = jobIncomeItems(range);
    const manual = manualIncomeItems(range);
    const expenses = expenseItems(range);
    const forecast = forecastJobs(range);
    const jobIncome = jobs.reduce((s,x)=>s+x.amount,0);
    const manualIncome = manual.reduce((s,x)=>s+x.amount,0);
    const expenseTotal = expenses.reduce((s,x)=>s+x.amount,0);
    const forecastTotal = forecast.reduce((s,x)=>s+x.amount,0);
    return { jobs, manual, expenses, forecast, jobIncome, manualIncome, incomeTotal:jobIncome+manualIncome, expenseTotal, profit:jobIncome+manualIncome-expenseTotal, forecastTotal };
  }

  function canEditFinanceEntry(x) {
    return !!x && (x.createdBy === currentUser);
  }

  function renderFinance() {
    if (!$('[data-finance-stats]') || !isAdmin()) return;
    const range = getFinanceRange();
    const s = financeSummary(range);
    $('[data-finance-period-label]').textContent = range.label;
    $('[data-finance-stats]').innerHTML = [
      ['Bezahlte Jobs', money(s.jobIncome), `${s.jobs.length} kassierte Jobs`],
      ['Manuell ergänzt', money(s.manualIncome), `${s.manual.length} Eintrag(e)`],
      ['Voraussichtlich', money(s.forecastTotal), `${s.forecast.length} offene/geplante Jobs`],
      ['Ausgaben', money(s.expenseTotal), `${s.expenses.length} Kostenposition(en)`],
      ['Gewinn grob', money(s.profit), 'bezahlte Einnahmen minus Ausgaben']
    ].map(([label,val,sub]) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(val)}</strong><em>${esc(sub)}</em></div>`).join('');

    renderFinanceChart(s);
    const incomes = [...s.jobs, ...s.manual].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    $('[data-income-count]').textContent = `${incomes.length} Eintrag(e)`;
    $('[data-income-list]').innerHTML = incomes.length ? incomes.map(x => {
      const by = x.createdBy ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const editBtns = x.type === 'Manuell' && canEditFinanceEntry(x) ? `<div class="actions"><button class="secondary" data-edit-manual-income="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-manual-income="${esc(x.id)}">Löschen</button></div>` : '';
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.type)} · ${esc(ymd(x.date))}${by}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><span class="badge ok">${esc(money(x.amount))}</span></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine Einnahmen im Zeitraum.</div>';

    $('[data-expense-count]').textContent = `${s.expenses.length} Eintrag(e)`;
    $('[data-expense-list]').innerHTML = s.expenses.length ? s.expenses.sort((a,b)=>String(b.date).localeCompare(String(a.date))).map(x => {
      const by = x.createdBy ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const editBtns = canEditFinanceEntry(x) ? `<div class="actions"><button class="secondary" data-edit-expense="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-expense="${esc(x.id)}">Löschen</button></div>` : '';
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.category || 'Ausgabe')} · ${esc(ymd(x.date))}${by}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><span class="badge danger">${esc(money(x.amount))}</span></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine Ausgaben im Zeitraum.</div>';

    renderCustomerActivity(range);
  }
  function renderFinanceChart(s) {
    const max = Math.max(s.incomeTotal, s.forecastTotal || 0, s.expenseTotal, Math.abs(s.profit), 1);
    const rows = [
      ['Bezahlte Einnahmen', s.incomeTotal, 'income'],
      ['Voraussichtlich', s.forecastTotal, 'forecast'],
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
      const revenue = inRange.reduce((s,j)=>s+Number(j.amount||0),0);
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

    $('[data-customer-activity-list]').innerHTML = rows.length ? rows.map(r => {
      const inactive = r.days !== null && r.days > 90;
      const status = r.last ? `Letzter Job: ${fmtDate(r.last)}${inactive ? ' · lange nicht kontaktiert' : ''}` : 'Noch kein erledigter Job';
      return `<article class="item-card mini">
        <div class="item-top"><div><div class="item-title">${esc(r.p.name || r.p.id)} <span class="badge">${esc(r.p.id)}</span></div><div class="item-sub">${esc(status)}</div></div><div class="badges"><span class="badge ok">${esc(money(r.revenue))}</span><span class="badge">${r.inRange.length} Job(s) im Zeitraum</span><span class="badge">${r.allJobs.length} total</span>${inactive ? '<span class="badge warn">Nachfassen</span>' : ''}</div></div>
        <div class="actions">${phoneLink(r.p.phone)}${whatsappLink(r.p.phone, `Hoi ${r.p.name || ''}, wir hoffen, es geht Ihnen gut. Falls Fenster, Dachrinne, Terrasse oder Solaranlage wieder Reinigung brauchen, melden Sie sich gerne bei Lumian Services.`, 'WhatsApp Nachfassen')}<button class="secondary" data-open-person-job="${esc(r.p.id)}">Neuer Job</button></div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Kundenaktivität.</div>';
  }


  function renderRewards() {
    if (!$('[data-reward-list]') || !isAdmin()) return;
    const rewards = [...state.rewards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('[data-reward-list]').innerHTML = rewards.length ? rewards.map(r => {
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
  function customerReminderLink(job) { const p = personById(job.personId) || {}; return whatsappLink(p.phone, reminderText(job), 'WhatsApp'); }
  function calendarButton(job) { return !['Erledigt','Bezahlt','Abgesagt'].includes(job.status) ? `<button class="secondary" data-calendar-job="${esc(job.id)}">Kalender</button>` : ''; }
  function waLeadLink(p,l) { return whatsappLink(p.phone, newCustomerText(p,l), 'WhatsApp'); }

  function referralInviteText(p) {
    return fillTemplate(getSetting('referralTemplate'), { name:p.name||'', customerId:p.id||'', code:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), referralLink:referralLink(p.id) });
  }
  function newCustomerText(p,l={}) {
    return fillTemplate(getSetting('newCustomerTemplate'), { name:p.name||'', customerId:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), service:l.service||'', amount:l.expectedValue||'', address:p.address||'' });
  }
  function reminderText(j) {
    const p = personById(j.personId) || {};
    return fillTemplate(getSetting('reminderTemplate'), { name:p.name||'', customerId:p.id||'', date:fmtDate(j.appointmentAt), service:j.service||'', amount:j.amount||'', address:p.address||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder') });
  }

  function openCustomerDialog() {
    const form = $('[data-customer-form]');
    if (!form) return;
    form.reset();
    form.elements.source.value = 'Import / Manuell';
    $('[data-customer-dialog]').showModal();
  }

  function openLeadDialog() {
    const form = $('[data-lead-form]'); form.reset();
    form.elements.source.value = 'WhatsApp';
    form.elements.referredById.value = '';
    $('[data-ref-suggestions="lead"]').hidden = true;
    $('[data-lead-dialog]').showModal();
  }

  function fillJobPerson(form, person, lead = null) {
    if (!form || !person) return;
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
      form.elements.appointmentAt.value = linkedLead.appointmentAt || form.elements.appointmentAt.value || '';
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
      form.elements.appointmentAt.value = lead.appointmentAt || '';
      form.elements.amount.value = lead.expectedValue || '';
      form.elements.source.value = lead.source || form.elements.source.value;
      if (lead.referredById) setRefField('job', lead.referredById);
    }
    if (job) {
      form.elements.jobId.value = job.id;
      form.elements.leadId.value = job.leadId || '';
      form.elements.service.value = job.service || form.elements.service.value;
      form.elements.appointmentAt.value = job.appointmentAt || '';
      form.elements.amount.value = job.amount || '';
      form.elements.status.value = job.status || 'Geplant';
      form.elements.assignedTo.value = job.assignedTo || currentUser || 'noah';
      form.elements.source.value = job.source || form.elements.source.value;
      form.elements.notes.value = job.notes || '';
      if (job.referredById) setRefField('job', job.referredById);
      stagedPhotos.before = job.beforePhoto || null;
      stagedPhotos.after = job.afterPhoto || null;
      $('[data-photo-preview]').innerHTML = [stagedPhotos.before, stagedPhotos.after].filter(Boolean).map((ph,i)=>`<img src="${esc(ph.dataUrl || ph.url)}" alt="${i?'Nachher':'Vorher'}">`).join('');
      $('[data-job-modal-title]').textContent = 'Job bearbeiten';
    } else {
      form.elements.jobId.value = '';
      form.elements.status.value = 'Geplant';
      form.elements.assignedTo.value = currentUser || 'noah';
      $('[data-job-modal-title]').textContent = lead ? 'Lead in Job umwandeln' : 'Job direkt erstellen';
    }
    $('[data-ref-suggestions="job"]').hidden = true;
    $('[data-job-dialog]').showModal();
  }

  $$('[data-open-lead]').forEach(btn => btn.addEventListener('click', openLeadDialog));
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
      name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: ''
    });
    p.status = 'customer';
    p.customerSince = p.customerSince || new Date().toISOString();
    p.notes = fd.get('notes') || p.notes || '';
    saveState('customer manual');
    form.closest('dialog').close();
    setTab('customers');
    toast(`Kunde gespeichert: ${p.id}`);
  });

  $('[data-lead-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !validateContactFields(form)) return;
    const fd = new FormData(form);
    const p = findOrCreatePerson({
      name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: fd.get('referredById')
    });
    const lead = {
      id: nextId('lead'), personId: p.id, service: fd.get('service'), source: fd.get('source'), expectedValue: fd.get('expectedValue'), appointmentAt: fd.get('appointmentAt'), referredById: fd.get('referredById'), status: 'Offen', notes: fd.get('notes'), createdAt: new Date().toISOString(), createdBy: currentUser
    };
    state.leads.push(lead);
    saveState('lead'); form.closest('dialog').close(); setTab('leads'); toast(`Lead gespeichert: ${p.id}`);
  });

  $('[data-job-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity() || !validateContactFields(form)) return;
    const fd = new FormData(form);
    const lead = fd.get('leadId') ? leadById(fd.get('leadId')) : null;
    const p = findOrCreatePerson({
      personId: fd.get('personId'), name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: fd.get('referredById') || lead?.referredById || ''
    });
    let job = fd.get('jobId') ? jobById(fd.get('jobId')) : null;
    if (!job) {
      job = { id: nextId('job'), personId: p.id, createdAt: new Date().toISOString(), createdBy: currentUser };
      state.jobs.push(job);
    }
    Object.assign(job, {
      personId: p.id,
      leadId: fd.get('leadId') || job.leadId || '',
      service: fd.get('service'),
      appointmentAt: fd.get('appointmentAt'),
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
    if (lead) lead.status = 'Job erstellt';
    if (['Erledigt','Bezahlt'].includes(job.status)) completeJob(job.id, false);
    saveState('job'); form.closest('dialog').close(); setTab('jobs'); toast(`Job gespeichert: ${p.id}`);
  });

  document.addEventListener('click', event => {
    const convert = event.target.closest('[data-convert-lead]');
    if (convert) { const lead = leadById(convert.dataset.convertLead); if (lead) openJobDialog(null, lead, personById(lead.personId)); }
    const lost = event.target.closest('[data-mark-lead-lost]');
    if (lost) { const lead = leadById(lost.dataset.markLeadLost); if (lead) { lead.status='Verloren'; saveState('lead lost'); renderAll(); } }
    const edit = event.target.closest('[data-edit-job]');
    if (edit) { const job = jobById(edit.dataset.editJob); if (job) openJobDialog(job); }
    const done = event.target.closest('[data-complete-job]');
    if (done) completeJob(done.dataset.completeJob, true);
    const paid = event.target.closest('[data-paid-job]');
    if (paid) { const job = jobById(paid.dataset.paidJob); if (job) { job.status='Bezahlt'; completeJob(job.id, true); } }
    const cal = event.target.closest('[data-calendar-job]');
    if (cal) addCalendar(jobById(cal.dataset.calendarJob));
    const copy = event.target.closest('[data-copy-ref]');
    if (copy) { const link = referralLink(copy.dataset.copyRef); navigator.clipboard?.writeText(link); toast('Empfehlungslink kopiert.'); }
    const personJob = event.target.closest('[data-open-person-job]');
    if (personJob) openJobDialog(null, null, personById(personJob.dataset.openPersonJob));
    const rew = event.target.closest('[data-toggle-reward]');
    if (rew) { const r = state.rewards.find(x => x.id === rew.dataset.toggleReward); if (r) { r.status = r.status === 'offen' ? 'gutgeschrieben' : 'offen'; saveState('reward'); renderAll(); } }
  });

  function completeJob(jobId, showMessage) {
    const job = jobById(jobId); if (!job) return;
    const p = personById(job.personId); if (!p) return;
    job.status = job.status === 'Bezahlt' ? 'Bezahlt' : 'Erledigt';
    job.completedAt = job.completedAt || new Date().toISOString();
    if (job.status === 'Bezahlt') job.paidAt = job.paidAt || new Date().toISOString();
    p.status = 'customer'; p.customerSince = p.customerSince || new Date().toISOString();
    const lead = job.leadId ? leadById(job.leadId) : null;
    if (lead) lead.status = 'Kunde geworden';
    const amount = Number(job.amount || lead?.expectedValue || 0);
    const refId = job.referredById || lead?.referredById || p.referredById;
    if (refId && refId !== p.id && amount >= Number(getSetting('minOrder'))) {
      const exists = state.rewards.some(r => r.jobId === job.id && r.customerId === refId);
      if (!exists) state.rewards.push({ id: nextId('reward'), customerId: refId, fromPersonId: p.id, jobId: job.id, amount: Number(getSetting('bonusAmount')), status: 'offen', createdAt: new Date().toISOString(), createdBy: currentUser });
    }
    saveState('complete'); renderAll();
    if (showMessage) toast('Job erledigt. Person ist jetzt Kunde; Empfehlungslink ist verfügbar.');
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
    $('[data-photo-preview]').innerHTML = [stagedPhotos.before, stagedPhotos.after].filter(Boolean).map((ph,i)=>`<img src="${esc(ph.dataUrl || ph.url)}" alt="${i?'Nachher':'Vorher'}">`).join('');
    toast('Foto gespeichert. Beim Google Sync wird es in Drive abgelegt.');
  });

  function addCalendar(job) {
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
      return `<button type="button" data-pick-person="${esc(p.id)}"><strong>${esc(p.name || 'Ohne Name')}</strong> · ${esc(p.id)} · ${esc(personStatusLabel(p))}${lead ? ` · offener Lead: ${esc(lead.service || lead.id)}` : ''}<br><small>${esc(p.address || p.phone || '')}</small></button>`;
    }).join('');
    box.hidden = false;
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
    Object.entries({ ...DEFAULT_SETTINGS, ...state.settings }).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
    const u = state.users.find(x => x.id === currentUser);
    if (form.elements.userRecoveryCode) form.elements.userRecoveryCode.value = u?.recoveryCode || defaultRecoveryCode(currentUser);
    form.dataset.filled = 'yes';
  }
  $('[data-settings-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    Object.keys(DEFAULT_SETTINGS).forEach(key => { if (fd.has(key)) state.settings[key] = fd.get(key); });
    state.settings.bonusAmount = Number(state.settings.bonusAmount || 0);
    state.settings.minOrder = Number(state.settings.minOrder || 0);
    const u = state.users.find(x => x.id === currentUser);
    if (u && fd.has('userRecoveryCode')) u.recoveryCode = String(fd.get('userRecoveryCode') || '').trim() || defaultRecoveryCode(currentUser);
    saveState('settings'); toast('Setup gespeichert.');
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
  $('[data-logout]')?.addEventListener('click', () => { currentUser = ''; sessionStorage.removeItem(SESSION_KEY); renderLogin(); });


  function csvEscape(value) {
    return `"${String(value ?? '').replace(/"/g,'""')}"`;
  }
  function csvLine(values) {
    return values.map(csvEscape).join(';');
  }
  function downloadCustomersTemplate() {
    const rows = [
      ['LumianNr','Name','Telefon','Email','Adresse','Ort','Quelle','EmpfohlenVon','KundeSeit','Notizen'],
      ['', 'Maria Müller', '077 535 05 71', 'maria@email.ch', 'Musterstrasse 1, 5600 Lenzburg', 'Lenzburg', 'Empfehlung', 'LM1001', '', 'bestehender Kunde']
    ];
    downloadText('lumian-kunden-import-vorlage.csv', rows.map(csvLine).join('\n'), 'text/csv;charset=utf-8');
  }
  function downloadLeadsTemplate() {
    const rows = [
      ['Name','Telefon','Email','Adresse','Ort','Service','Quelle','Betrag','Termin','EmpfohlenVon','Notizen'],
      ['Peter Beispiel', '079 123 45 67', '', 'Beispielweg 2, 5400 Baden', 'Baden', 'Fensterreinigung', 'Google', '350', '2026-07-20 14:00', 'LM1001', 'Besichtigung nötig']
    ];
    downloadText('lumian-leads-import-vorlage.csv', rows.map(csvLine).join('\n'), 'text/csv;charset=utf-8');
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
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0,16);
    const cleaned = v.replace(' ', 'T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cleaned)) return cleaned.slice(0,16);
    return v;
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
        address: o.adresse || o.address || person.address || '',
        place: o.ort || o.place || person.place || '',
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
        address: o.adresse || o.address || '',
        place: o.ort || o.place || '',
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
    if (!file) return;
    const rows = parseCsv(await file.text());
    const objects = rowObjects(rows);
    if (!objects.length) return toast('Importdatei ist leer oder hat keine Kopfzeile.');
    if (type === 'customers') importCustomersFromObjects(objects); else importLeadsFromObjects(objects);
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
      from: fd.get('from'),
      to: fd.get('to'),
      amount: Number(fd.get('amount') || 0),
      notes: fd.get('notes') || ''
    });
    saveState(entry.updatedAt ? 'manual income edit' : 'manual income');
    form.reset();
    setDefaultFinanceDates();
    renderFinance();
    toast(entry.updatedAt ? 'Einnahme geändert.' : 'Einnahme gespeichert.');
  }
  function addExpense(form) {
    if (!isAdmin()) return toast('Nur Admins können Buchhaltung ändern.');
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
      date: fd.get('date'),
      category: fd.get('category'),
      title: fd.get('title'),
      amount: Number(fd.get('amount') || 0),
      notes: fd.get('notes') || ''
    });
    saveState(entry.updatedAt ? 'expense edit' : 'expense');
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
    renderUserOptions(); renderUsers(); saveState('user save');
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
    saveState('user disable');
    renderUserOptions(); renderUsers();
    toast('Benutzer deaktiviert.');
  });


  function setDefaultFinanceDates() {
    const today = ymd(new Date());
    $$('[data-manual-income-form] input[type="date"], [data-expense-form] input[type="date"]').forEach(input => { if (!input.value) input.value = today; });
    const range = getFinanceRange();
    if ($('[data-finance-from]') && !$('[data-finance-from]').value) $('[data-finance-from]').value = range.from;
    if ($('[data-finance-to]') && !$('[data-finance-to]').value) $('[data-finance-to]').value = range.to;
  }
  $('[data-manual-income-form]')?.addEventListener('submit', event => { event.preventDefault(); addManualIncome(event.currentTarget); });
  $('[data-expense-form]')?.addEventListener('submit', event => { event.preventDefault(); addExpense(event.currentTarget); });
  $$('[data-finance-period],[data-finance-from],[data-finance-to],[data-customer-activity-sort]').forEach(el => el.addEventListener('change', renderFinance));
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
      form.elements.from.value = entry.from || ymd(entry.createdAt);
      form.elements.to.value = entry.to || entry.from || ymd(entry.createdAt);
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
      state.finance.manualIncome = (state.finance.manualIncome || []).filter(x => x.id !== entry.id);
      saveState('manual income delete'); renderFinance(); toast('Einnahme gelöscht.');
    }

    const editExpense = event.target.closest('[data-edit-expense]');
    if (editExpense) {
      const entry = (state.finance.expenses || []).find(x => x.id === editExpense.dataset.editExpense);
      if (!entry) return;
      if (!canEditFinanceEntry(entry)) return toast('Nur der Ersteller kann diese Ausgabe bearbeiten.');
      if (!(await confirmSensitiveAction('Ausgabe bearbeiten?'))) return;
      const form = $('[data-expense-form]');
      form.elements.entryId.value = entry.id;
      form.elements.date.value = entry.date || ymd(entry.createdAt);
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
      state.finance.expenses = (state.finance.expenses || []).filter(x => x.id !== entry.id);
      saveState('expense delete'); renderFinance(); toast('Ausgabe gelöscht.');
    }
  });
  function exportFinanceCsv() {
    const range = getFinanceRange();
    const s = financeSummary(range);
    const rows = [
      ['Typ','Datum/Von','Bis','Titel/Kunde','Kategorie','Betrag CHF','Eingetragen von','Notiz','JobID/ID'],
      ...s.jobs.map(x => ['Einnahme Job bezahlt', ymd(x.date), '', x.title, 'Job bezahlt', x.amount, userName(x.assignedTo || x.createdBy), '', x.jobId]),
      ...s.forecast.map(x => ['Voraussichtlich', ymd(x.date), '', x.title, x.status || 'offen/geplant', x.amount, userName(x.assignedTo || x.createdBy), 'Noch nicht kassiert', x.jobId]),
      ...s.manual.map(x => ['Einnahme manuell', ymd(x.date), x.to || '', x.title, 'Manuell', x.amount, userName(x.createdBy), x.notes || '', x.id]),
      ...s.expenses.map(x => ['Ausgabe', ymd(x.date), '', x.title, x.category || 'Ausgabe', -Number(x.amount || 0), userName(x.createdBy), x.notes || '', x.id]),
      [],
      ['Zusammenfassung','','','Bezahlte Jobs','',s.jobIncome,'',''],
      ['Zusammenfassung','','','Voraussichtlich / noch nicht kassiert','',s.forecastTotal,'',''],
      ['Zusammenfassung','','','Manuell ergänzt','',s.manualIncome,'',''],
      ['Zusammenfassung','','','Ausgaben','',-s.expenseTotal,'',''],
      ['Zusammenfassung','','','Gewinn grob','',s.profit,'','']
    ];
    downloadText(`lumian-buchhaltung-${range.from || 'start'}-${range.to || 'heute'}.csv`, rows.map(csvLine).join('\n'), 'text/csv;charset=utf-8');
  }
  $('[data-finance-export]')?.addEventListener('click', exportFinanceCsv);


  function exportCsv() {
    const rows = [['LumianNr','Status','Name','Telefon','Email','Adresse','Ort','Quelle','EmpfohlenVon','KundeSeit']]
      .concat(state.people.map(p => [p.id,p.status,p.name,p.phone,p.email,p.address,p.place,p.source,p.referredById,p.customerSince || '']));
    downloadText('lumian-kunden-excel.csv', rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() { downloadText(`lumian-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state,null,2), 'application/json'); }
  function downloadText(name, text, type) { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  $$('[data-download-customers-template]').forEach(btn => btn.addEventListener('click', downloadCustomersTemplate));
  $$('[data-download-leads-template]').forEach(btn => btn.addEventListener('click', downloadLeadsTemplate));
  $$('[data-import-customers]').forEach(input => input.addEventListener('change', async event => { await importCsvFile(event.target.files?.[0], 'customers'); event.target.value=''; }));
  $$('[data-import-leads]').forEach(input => input.addEventListener('change', async event => { await importCsvFile(event.target.files?.[0], 'leads'); event.target.value=''; }));
  $('[data-export-csv]')?.addEventListener('click', exportCsv);
  $('[data-export-json]')?.addEventListener('click', exportJson);
  $('[data-import-json]')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    if (!(await confirmSensitiveAction('Backup importieren? Bestehende lokale Portal-Daten werden überschrieben.'))) { event.target.value=''; return; }
    try { const imported = migrateState(JSON.parse(await file.text())); localStorage.setItem(STORE_KEY, JSON.stringify(imported)); location.reload(); }
    catch { toast('Backup konnte nicht gelesen werden.'); }
  });
  $('[data-reset-demo]')?.addEventListener('click', async () => {
    if (!(await confirmSensitiveAction('Lokale Daten wirklich löschen?'))) return;
    if (confirm('Letzte Bestätigung: Alle lokalen Portal-Daten auf diesem Gerät werden gelöscht.')) {
      localStorage.removeItem(STORE_KEY);
      OLD_KEYS.forEach(k => localStorage.removeItem(k));
      location.reload();
    }
  });

  function makeCloudPayload() { saveState('before sync'); return { action:'syncFull', sentAt:new Date().toISOString(), by:currentUser, state }; }
  async function syncCloud() {
    const url = getSetting('scriptUrl'); if (!url) return toast('Bitte zuerst Google Apps Script URL im Setup eintragen.');
    try { await fetch(url, { method:'POST', mode:'no-cors', headers:{ 'Content-Type':'text/plain' }, body: JSON.stringify(makeCloudPayload()) }); toast('Sync gesendet. Google Sheet/Drive prüfen.'); }
    catch { toast('Sync konnte nicht gesendet werden.'); }
  }
  function loadCloud() {
    const url = getSetting('scriptUrl'); if (!url) return toast('Bitte zuerst Google Apps Script URL im Setup eintragen.');
    const callbackName = `lumianCloud_${Date.now()}`;
    const script = document.createElement('script');
    window[callbackName] = data => {
      try {
        if (!data || !data.state) throw new Error('empty');
        const imported = migrateState(data.state);
        localStorage.setItem(STORE_KEY, JSON.stringify(imported));
        toast('Cloud geladen. App lädt neu...'); setTimeout(() => location.reload(), 800);
      } catch { toast('Cloud-Daten konnten nicht geladen werden.'); }
      delete window[callbackName]; script.remove();
    };
    script.src = `${url}${url.includes('?')?'&':'?'}action=load&callback=${callbackName}`;
    script.onerror = () => { toast('Cloud laden fehlgeschlagen.'); delete window[callbackName]; script.remove(); };
    document.body.appendChild(script);
  }
  $$('[data-sync-now]').forEach(btn => btn.addEventListener('click', syncCloud));
  $('[data-load-cloud]')?.addEventListener('click', loadCloud);

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
      saveState('biometric'); toast('Face ID / Touch ID ist auf diesem Gerät aktiviert.');
    } catch { toast('Biometrie wurde nicht aktiviert.'); }
  }
  async function biometricLogin() {
    const select = $('[data-login-form]').elements.user;
    const user = state.users.find(u => u.id === select.value);
    if (!user?.credentialId) return toast('Für diesen Benutzer zuerst im Setup Biometrie aktivieren.');
    if (!navigator.credentials?.get) return toast('Biometrie/Passkey wird auf diesem Browser nicht unterstützt.');
    try {
      await navigator.credentials.get({ publicKey: { challenge: randomChallenge(), allowCredentials: [{ type:'public-key', id: fromB64url(user.credentialId) }], userVerification:'preferred', timeout:60000 }});
      currentUser = user.id; sessionStorage.setItem(SESSION_KEY, currentUser); renderLogin(); toast(`Willkommen, ${userName(user.id)}.`);
    } catch { toast('Biometrie abgebrochen oder fehlgeschlagen.'); }
  }
  $('[data-enable-biometric]')?.addEventListener('click', enableBiometric);
  $('[data-disable-biometric]')?.addEventListener('click', () => { const u = state.users.find(x => x.id === currentUser); if (u) { u.credentialId=''; u.credentialUserHandle=''; saveState('biometric off'); toast('Biometrie auf diesem Gerät entfernt.'); } });
  $('[data-biometric-login]')?.addEventListener('click', biometricLogin);

  setDefaultFinanceDates();
  renderLogin();
  setupSmartStickyNav();
})();