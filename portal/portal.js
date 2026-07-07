(() => {
  'use strict';

  const STORE_KEY = 'lumian.portal.v5';
  const OLD_KEYS = ['lumian.portal.v4','lumian.portal.v3','lumian.portal.v2'];
  const SESSION_KEY = 'lumian.portal.user';
  const USERS = [
    { id: 'noah', name: 'Noah', emoji: 'N' },
    { id: 'timo', name: 'Timo', emoji: 'T' }
  ];
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
  let customerListMode = 'search';
  let stagedPhotos = { before: null, after: null };
  let deferredInstallPrompt = null;
  let state = loadState();

  function newState() {
    return {
      version: 5,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      users: USERS.map(u => ({ ...u, passwordHash: '', salt: '', credentialId: '', credentialUserHandle: '' })),
      settings: { ...DEFAULT_SETTINGS },
      counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1 },
      people: [],
      leads: [],
      jobs: [],
      rewards: [],
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
    merged.version = 5;
    merged.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    merged.counters = { ...base.counters, ...(s.counters || {}) };
    merged.users = USERS.map(u => {
      const old = (s.users || []).find(x => x.id === u.id) || {};
      return { ...u, passwordHash: old.passwordHash || '', salt: old.salt || '', credentialId: old.credentialId || '', credentialUserHandle: old.credentialUserHandle || '' };
    });
    merged.people = Array.isArray(s.people) ? s.people.map(p => ({ email: '', ...p })) : [];
    merged.leads = Array.isArray(s.leads) ? s.leads : [];
    merged.jobs = Array.isArray(s.jobs) ? s.jobs.map(j => ({ source: '', referredById: '', ...j })) : [];
    merged.rewards = Array.isArray(s.rewards) ? s.rewards : [];
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
  function userName(id) { return USERS.find(u => u.id === id)?.name || id || '-'; }
  function userEmoji(id) { return USERS.find(u => u.id === id)?.emoji || '?'; }
  function personById(id) { return state.people.find(p => p.id === id); }
  function leadById(id) { return state.leads.find(l => l.id === id); }
  function jobById(id) { return state.jobs.find(j => j.id === id); }
  function allPeopleSorted() { return [...state.people].sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function activeCustomers() { return state.people.filter(p => p.status === 'customer').sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function activeLeads() { return state.leads.filter(l => !['Job erstellt','Kunde geworden','Verloren'].includes(l.status)); }

  function fillTemplate(template, data) {
    return String(template || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => data[key] ?? '');
  }

  function referralLink(customerId) { return fillTemplate(getSetting('referralBase'), { customerId }); }

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

  function renderLogin() {
    $('[data-login-view]').hidden = !!currentUser;
    $('[data-portal-view]').hidden = !currentUser;
    if (!currentUser) return;
    const u = state.users.find(x => x.id === currentUser);
    $('[data-user-pill]').innerHTML = `<span>${esc(userEmoji(currentUser))}</span>${esc(u?.name || currentUser)}`;
    renderAll();
  }

  $('[data-login-form]')?.addEventListener('submit', async event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const userId = fd.get('user');
    const password = String(fd.get('password') || '');
    const user = state.users.find(u => u.id === userId);
    if (!user) return;
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
    activeTab = tab;
    $$('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
    $$('[data-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === tab));
    const titles = { dashboard:'Übersicht', leads:'Leads', jobs:'Jobs', customers:'Kunden', rewards:'Bonus', settings:'Setup' };
    $('[data-page-title]').textContent = titles[tab] || 'Übersicht';
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  document.addEventListener('click', event => {
    const go = event.target.closest('[data-tab-go]');
    if (go) setTab(go.dataset.tabGo);
  });

  function renderAll() {
    if (!currentUser) return;
    renderStats(); renderToday(); renderLeads(); renderJobs(); renderCustomers(); renderRewards(); fillSettings(false);
  }

  function renderStats() {
    const openLeadCount = activeLeads().length;
    const openJobCount = state.jobs.filter(j => !['Erledigt','Bezahlt','Abgesagt'].includes(j.status)).length;
    const customerCount = activeCustomers().length;
    const openRewards = state.rewards.filter(r => r.status === 'offen').reduce((s,r)=>s+Number(r.amount||0),0);
    $('[data-stats]').innerHTML = [
      ['Offene Leads', openLeadCount], ['Offene Jobs', openJobCount], ['Kunden', customerCount], ['Offener Bonus', `CHF ${openRewards}`]
    ].map(([label, value]) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
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
        <div class="actions">${mapLink(p.address)}${phoneLink(p.phone)}${customerReminderLink(j)}${calendarButton(j)}</div>
      </article>`;
    }).join('') : '<div class="empty">Keine offenen Termine.</div>';
  }

  function renderLeads() {
    const q = ($('[data-lead-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-lead-filter]')?.value || 'active';
    let leads = [...state.leads].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    if (filter === 'active') leads = leads.filter(l => !['Job erstellt','Kunde geworden','Verloren'].includes(l.status));
    if (filter === 'won') leads = leads.filter(l => ['Job erstellt','Kunde geworden'].includes(l.status));
    if (filter === 'lost') leads = leads.filter(l => l.status === 'Verloren');
    if (q) leads = leads.filter(l => {
      const p = personById(l.personId) || {};
      return [l.id,l.service,l.status,l.source,p.id,p.name,p.phone,p.email,p.address,p.place].join(' ').toLowerCase().includes(q);
    });
    $('[data-lead-list]').innerHTML = leads.length ? leads.map(leadCard).join('') : '<div class="empty">Keine Leads gefunden.</div>';
  }

  function leadCard(l) {
    const p = personById(l.personId) || {};
    const ref = personById(l.referredById || p.referredById);
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge">${esc(p.id || '')}</span></div><div class="item-sub">${esc(l.service || '')} · ${esc(p.place || '')} · erfasst von ${esc(userName(l.createdBy))}</div></div>
        <div class="badges"><span class="badge ${l.status==='Verloren'?'danger':l.status==='Offen'?'warn':'ok'}">${esc(l.status)}</span>${ref?`<span class="badge ok">Empf. ${esc(ref.name)} · ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || '')}${l.expectedValue?` · ca. CHF ${esc(l.expectedValue)}`:''}${l.appointmentAt?` · ${fmtDate(l.appointmentAt)}`:''}</div>
      <div class="actions">${phoneLink(p.phone)}${waLeadLink(p,l)}${mapLink(p.address)}${l.status==='Offen'?`<button class="primary" data-convert-lead="${esc(l.id)}">In Job umwandeln</button><button class="secondary" data-mark-lead-lost="${esc(l.id)}">Verloren</button>`:`<button class="secondary" data-open-person-job="${esc(p.id || '')}">Neuer Job</button>`}</div>
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
    $('[data-job-list]').innerHTML = jobs.length ? jobs.map(jobCard).join('') : '<div class="empty">Keine Jobs gefunden.</div>';
  }

  function jobCard(j) {
    const p = personById(j.personId) || {};
    const done = ['Erledigt','Bezahlt'].includes(j.status);
    const ref = personById(j.referredById || p.referredById);
    const photos = [j.beforePhoto, j.afterPhoto].filter(Boolean).map((ph,i)=>`<img class="thumb" src="${esc(ph.dataUrl || ph.url)}" alt="${i?'Nachher':'Vorher'} Foto">`).join('');
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name || 'Ohne Name')} <span class="badge ${p.status==='customer'?'ok':'warn'}">${esc(p.id || '')} · ${p.status==='customer'?'Kunde':'Lead'}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · zuständig: ${esc(userName(j.assignedTo))}</div></div>
        <div class="badges"><span class="badge ${done?'ok':j.status==='Abgesagt'?'danger':'warn'}">${esc(j.status)}</span>${j.amount?`<span class="badge">CHF ${esc(j.amount)}</span>`:''}${ref?`<span class="badge ok">Empf. ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || '')}</div>
      ${photos ? `<div class="photo-preview">${photos}</div>` : ''}
      <div class="actions">${mapLink(p.address)}${phoneLink(p.phone)}${customerReminderLink(j)}${calendarButton(j)}<button class="secondary" data-edit-job="${esc(j.id)}">Bearbeiten</button>${!done?`<button class="primary" data-complete-job="${esc(j.id)}">Erledigt</button><button class="secondary" data-paid-job="${esc(j.id)}">Bezahlt</button>`:`<a class="primary" href="${esc(waUrlFor(p.phone, referralInviteText(p)))}" target="_blank" rel="noopener">Empfehlung senden</a>`}</div>
    </article>`;
  }

  function renderCustomers() {
    const q = ($('[data-customer-search]')?.value || '').toLowerCase().trim();
    let customers = activeCustomers();
    if (q) customers = customers.filter(p => [p.id,p.name,p.phone,p.email,p.address,p.place,p.source].join(' ').toLowerCase().includes(q));
    if (!q && customerListMode !== 'all') customers = [];
    $('[data-customer-list]').innerHTML = customers.length ? customers.map(customerCard).join('') : '<div class="empty">Tippen zum Suchen oder „Alle anzeigen“ drücken.</div>';
  }

  function customerCard(p) {
    const jobs = state.jobs.filter(j => j.personId === p.id);
    return `<article class="item-card">
      <div class="item-top"><div><div class="item-title">${esc(p.name)} <span class="badge ok">${esc(p.id)}</span></div><div class="item-sub">${esc(p.address || '')}</div></div><div class="badges"><span class="badge">${jobs.length} Job(s)</span><span class="badge">${esc(p.source || 'Quelle offen')}</span></div></div>
      <div class="item-sub">Empfehlungslink: ${esc(referralLink(p.id))}</div>
      <div class="actions">${phoneLink(p.phone)}${mapLink(p.address)}${p.phone?`<a class="primary" href="${esc(waUrlFor(p.phone, referralInviteText(p)))}" target="_blank" rel="noopener">Empfehlung senden</a>`:''}<button class="secondary" data-copy-ref="${esc(p.id)}">Link kopieren</button><button class="secondary" data-open-person-job="${esc(p.id)}">Neuer Job</button></div>
    </article>`;
  }

  function renderRewards() {
    const rewards = [...state.rewards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('[data-reward-list]').innerHTML = rewards.length ? rewards.map(r => {
      const receiver = personById(r.customerId); const from = personById(r.fromPersonId);
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">CHF ${esc(r.amount)} Guthaben für ${esc(receiver?.name || r.customerId)}</div><div class="item-sub">Empfohlen hat: ${esc(receiver?.id || '')} · neuer Kunde: ${esc(from?.name || r.fromPersonId)} · Job ${esc(r.jobId || '')}</div></div><span class="badge ${r.status==='offen'?'warn':'ok'}">${esc(r.status)}</span></div>
        <div class="actions"><button class="secondary" data-toggle-reward="${esc(r.id)}">${r.status==='offen'?'Als gutgeschrieben markieren':'Wieder offen'}</button>${receiver?.phone?`<a class="secondary" href="${esc(waUrlFor(receiver.phone, `Hoi ${receiver.name}, danke für deine Empfehlung. Dein CHF ${r.amount} Guthaben wurde bei Lumian Services notiert.`))}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Boni. Sie entstehen automatisch, wenn ein Empfehlungs-Job erledigt wird und der Mindestauftrag erreicht ist.</div>';
  }

  function mapLink(address) { return address ? `<a class="secondary" href="https://maps.google.com/?q=${encodeURIComponent(address)}" target="_blank" rel="noopener">Maps</a>` : ''; }
  function phoneLink(phone) { const p = parseSwissPhone(phone); return p.ok && !p.empty ? `<a class="secondary" href="tel:${esc(p.tel)}">Anrufen</a>` : ''; }
  function waUrlFor(phone, text) { const p = parseSwissPhone(phone); if (!p.ok || p.empty) return '#'; return `https://wa.me/${p.wa}?text=${encodeURIComponent(text)}`; }
  function waBusinessUrl(text) { const n = normalizeBusinessPhone(getSetting('businessPhone')); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : '#'; }
  function customerReminderLink(job) { const p = personById(job.personId) || {}; const parsed = parseSwissPhone(p.phone); return parsed.ok && !parsed.empty ? `<a class="secondary" href="${esc(waUrlFor(p.phone, reminderText(job)))}" target="_blank" rel="noopener">Reminder an Kunden</a>` : ''; }
  function calendarButton(job) { return job.appointmentAt ? `<button class="secondary" data-calendar-job="${esc(job.id)}">Kalender</button>` : ''; }
  function waLeadLink(p,l) { const parsed = parseSwissPhone(p.phone); return parsed.ok && !parsed.empty ? `<a class="secondary" href="${esc(waUrlFor(p.phone, newCustomerText(p,l)))}" target="_blank" rel="noopener">WhatsApp Antwort</a>` : ''; }

  function referralInviteText(p) {
    return fillTemplate(getSetting('referralTemplate'), { name:p.name||'', customerId:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), referralLink:referralLink(p.id) });
  }
  function newCustomerText(p,l={}) {
    return fillTemplate(getSetting('newCustomerTemplate'), { name:p.name||'', customerId:p.id||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder'), service:l.service||'', amount:l.expectedValue||'', address:p.address||'' });
  }
  function reminderText(j) {
    const p = personById(j.personId) || {};
    return fillTemplate(getSetting('reminderTemplate'), { name:p.name||'', customerId:p.id||'', date:fmtDate(j.appointmentAt), service:j.service||'', amount:j.amount||'', address:p.address||'', bonus:getSetting('bonusAmount'), minOrder:getSetting('minOrder') });
  }

  function openLeadDialog() {
    const form = $('[data-lead-form]'); form.reset();
    form.elements.source.value = 'WhatsApp';
    form.elements.referredById.value = '';
    $('[data-ref-suggestions="lead"]').hidden = true;
    $('[data-lead-dialog]').showModal();
  }

  function openJobDialog(job = null, lead = null, person = null) {
    const form = $('[data-job-form]'); form.reset(); stagedPhotos = { before:null, after:null }; $('[data-photo-preview]').innerHTML = '';
    if (job) { person = personById(job.personId); lead = job.leadId ? leadById(job.leadId) : null; }
    if (person) {
      form.elements.personId.value = person.id || '';
      form.elements.name.value = person.name || '';
      form.elements.phone.value = person.phone || '';
      form.elements.email.value = person.email || '';
      form.elements.address.value = person.address || '';
      form.elements.place.value = person.place || '';
      form.elements.source.value = person.source || 'WhatsApp';
      if (person.referredById) setRefField('job', person.referredById);
    }
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
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog')?.close()));
  $('[data-forgot-password]')?.addEventListener('click', () => $('[data-reset-dialog]').showModal());

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
    if (!job || !job.appointmentAt) return toast('Kein Termin gesetzt.');
    const p = personById(job.personId) || {};
    const start = new Date(job.appointmentAt);
    const end = new Date(start.getTime() + 2*60*60*1000);
    const pad = n => String(n).padStart(2,'0');
    const icsDate = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lumian Services//Portal//DE','BEGIN:VEVENT',`UID:${job.id}@lumianservices.ch`,`DTSTAMP:${icsDate(new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:Lumian: ${p.name || 'Kunde'} - ${job.service || 'Reinigung'}`,`LOCATION:${p.address || ''}`,`DESCRIPTION:Telefon: ${p.phone || ''}\nBetrag: CHF ${job.amount || ''}\nJob: ${job.id}\nKunde: ${p.id || ''}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${job.id}-lumian-termin.ics`; a.click(); URL.revokeObjectURL(a.href);
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

  document.addEventListener('click', event => {
    const pick = event.target.closest('[data-pick-ref]');
    if (!pick) return;
    setRefField(pick.dataset.scope, pick.dataset.pickRef);
    $(`[data-ref-suggestions="${pick.dataset.scope}"]`).hidden = true;
  });

  ['lead','job','customer'].forEach(type => {
    const search = $(`[data-${type}-search]`); if (search) search.addEventListener('input', () => { if (type === 'customer') customerListMode='search'; renderAll(); });
    const filter = $(`[data-${type}-filter]`); if (filter) filter.addEventListener('change', renderAll);
  });
  $('[data-show-all-customers]')?.addEventListener('click', () => { customerListMode = 'all'; renderCustomers(); });

  function fillSettings(force = false) {
    const form = $('[data-settings-form]'); if (!form) return;
    if (form.dataset.filled === 'yes' && !force) return;
    Object.entries({ ...DEFAULT_SETTINGS, ...state.settings }).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = value ?? ''; });
    form.dataset.filled = 'yes';
  }
  $('[data-settings-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    Object.keys(DEFAULT_SETTINGS).forEach(key => { if (fd.has(key)) state.settings[key] = fd.get(key); });
    state.settings.bonusAmount = Number(state.settings.bonusAmount || 0);
    state.settings.minOrder = Number(state.settings.minOrder || 0);
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
    const code = String(fd.get('code') || '').trim();
    const newPw = String(fd.get('newPassword') || '');
    if (code !== String(getSetting('recoveryCode')).trim()) return toast('Reset-Code stimmt nicht.');
    if (newPw.length < 4) return toast('Neues Passwort: mindestens 4 Zeichen.');
    await setPassword(fd.get('user'), newPw);
    event.currentTarget.closest('dialog').close();
    toast('Passwort wurde zurückgesetzt.');
  });
  $('[data-logout]')?.addEventListener('click', () => { currentUser = ''; sessionStorage.removeItem(SESSION_KEY); renderLogin(); });

  function exportCsv() {
    const rows = [['LumianNr','Status','Name','Telefon','Email','Adresse','Ort','Quelle','EmpfohlenVon','KundeSeit']]
      .concat(state.people.map(p => [p.id,p.status,p.name,p.phone,p.email,p.address,p.place,p.source,p.referredById,p.customerSince || '']));
    downloadText('lumian-kunden-excel.csv', rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() { downloadText(`lumian-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state,null,2), 'application/json'); }
  function downloadText(name, text, type) { const blob = new Blob([text], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); }
  $('[data-export-csv]')?.addEventListener('click', exportCsv);
  $('[data-export-json]')?.addEventListener('click', exportJson);
  $('[data-import-json]')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { const imported = migrateState(JSON.parse(await file.text())); localStorage.setItem(STORE_KEY, JSON.stringify(imported)); location.reload(); }
    catch { toast('Backup konnte nicht gelesen werden.'); }
  });
  $('[data-reset-demo]')?.addEventListener('click', () => { if (confirm('Wirklich alle lokalen Portal-Daten auf diesem Gerät löschen?')) { localStorage.removeItem(STORE_KEY); location.reload(); } });

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

  renderLogin();
})();
