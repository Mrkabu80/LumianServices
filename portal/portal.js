(() => {
  'use strict';

  const STORE_KEY = 'lumian_portal_state_v3';
  const SESSION_KEY = 'lumian_portal_session_v3';
  const USERS = [
    { id: 'noah', name: 'Noah', emoji: 'N' },
    { id: 'timo', name: 'Timo', emoji: 'T' }
  ];

  const DEFAULT_SETTINGS = {
    bonusAmount: 50,
    minOrder: 300,
    businessPhone: '41772794707',
    referralBase: 'https://www.lumianservices.ch/?ref={{customerId}}#booking',
    scriptUrl: '',
    driveFolderId: '',
    calendarId: '',
    referralTemplate: 'Hoi {{name}}, danke nochmals für dein Vertrauen in Lumian Services. Wenn du uns einem Freund, Nachbarn oder Familienmitglied empfiehlst und daraus ein Auftrag ab CHF {{minOrder}} entsteht, erhalten beide CHF {{bonus}} Vorteil. Dein persönlicher Empfehlungslink: {{referralLink}}',
    newCustomerTemplate: 'Hoi {{name}}, danke für deine Anfrage bei Lumian Services. Aktuell erhältst du als Neukunde CHF {{bonus}} Vorteil bei einem Auftrag ab CHF {{minOrder}}. Schreib uns einfach kurz, was gereinigt werden soll und sende Fotos direkt hier per WhatsApp.',
    reminderTemplate: 'Hoi {{name}}, kurze Erinnerung: Dein Lumian Termin für {{service}} ist am {{date}} geplant. Adresse: {{address}}. Falls etwas nicht passt, bitte kurz antworten. Danke!'
  };

  const state = loadState();
  let currentUser = sessionStorage.getItem(SESSION_KEY) || '';
  let activeTab = 'dashboard';
  let customerListMode = 'all';
  let stagedPhotos = { before: null, after: null };

  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

  function loadState() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (_) {}
    const base = {
      version: 3,
      createdAt: new Date().toISOString(),
      users: USERS.map(u => ({ ...u, passwordHash: '', salt: '' })),
      settings: { ...DEFAULT_SETTINGS },
      counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1 },
      people: [],
      leads: [],
      jobs: [],
      rewards: [],
      audit: []
    };
    if (!parsed) return base;
    return {
      ...base,
      ...parsed,
      users: USERS.map(u => ({ ...u, ...(parsed.users || []).find(x => x.id === u.id) })),
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
      counters: { ...base.counters, ...(parsed.counters || {}) },
      people: Array.isArray(parsed.people) ? parsed.people : [],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      rewards: Array.isArray(parsed.rewards) ? parsed.rewards : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : []
    };
  }

  function saveState(reason = 'save') {
    state.updatedAt = new Date().toISOString();
    if (currentUser) state.audit.push({ at: state.updatedAt, by: currentUser, reason });
    state.audit = state.audit.slice(-250);
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function toast(msg) {
    const el = $('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 2800);
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>'"]/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[ch]));
  }

  function normPhone(phone) {
    const clean = String(phone || '').replace(/[^\d+]/g, '');
    if (!clean) return '';
    if (clean.startsWith('+')) return clean.replace(/\D/g, '');
    if (clean.startsWith('00')) return clean.slice(2).replace(/\D/g, '');
    if (clean.startsWith('0')) return `41${clean.slice(1).replace(/\D/g, '')}`;
    return clean.replace(/\D/g, '');
  }

  function fmtDate(value) {
    if (!value) return '-';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleString('de-CH', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' });
    } catch (_) { return value; }
  }

  function userName(id) { return USERS.find(u => u.id === id)?.name || id || '-'; }
  function userEmoji(id) { return USERS.find(u => u.id === id)?.emoji || '?'; }
  function personById(id) { return state.people.find(p => p.id === id); }
  function leadById(id) { return state.leads.find(l => l.id === id); }
  function jobById(id) { return state.jobs.find(j => j.id === id); }
  function activeCustomers() { return state.people.filter(p => p.status === 'customer').sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function allPeopleSorted() { return [...state.people].sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
  function getSetting(k) { return state.settings[k] ?? DEFAULT_SETTINGS[k]; }

  function fillTemplate(tpl, data) {
    return String(tpl || '').replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, key) => data[key] ?? '');
  }

  function referralLink(customerId) {
    return fillTemplate(getSetting('referralBase'), { customerId });
  }

  function waUrl(phone, text) {
    const n = normPhone(phone || getSetting('businessPhone'));
    return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
  }

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function makeSalt() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

  async function verifyPassword(user, password) {
    if (!user.passwordHash) return true;
    const h = await sha256(`${user.salt}:${password}`);
    return h === user.passwordHash;
  }

  async function setPassword(userId, password) {
    const u = state.users.find(x => x.id === userId);
    if (!u) return;
    u.salt = makeSalt();
    u.passwordHash = await sha256(`${u.salt}:${password}`);
    saveState('password');
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
    $$('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    const title = { dashboard:'Dashboard', leads:'Leads', jobs:'Jobs', customers:'Kunden', rewards:'Bonus', settings:'Setup' }[tab] || 'Dashboard';
    $('[data-page-title]').textContent = title;
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $$('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  document.addEventListener('click', e => {
    const go = e.target.closest('[data-tab-go]');
    if (go) setTab(go.dataset.tabGo);
  });

  function renderAll() {
    if (!currentUser) return;
    renderStats(); renderLeads(); renderJobs(); renderCustomers(); renderRewards(); renderToday(); fillSettings();
  }

  function renderStats() {
    const openLeads = state.leads.filter(l => !['Job erstellt','Verloren'].includes(l.status)).length;
    const openJobs = state.jobs.filter(j => !['Erledigt','Bezahlt','Abgesagt'].includes(j.status)).length;
    const customers = activeCustomers().length;
    const openRewards = state.rewards.filter(r => r.status === 'offen').reduce((s,r)=>s+Number(r.amount||0),0);
    $('[data-stats]').innerHTML = [
      ['Offene Leads', openLeads], ['Offene Jobs', openJobs], ['Kunden', customers], ['Offener Bonus', `CHF ${openRewards}`]
    ].map(([label,val]) => `<div class="stat"><strong>${esc(val)}</strong><span>${esc(label)}</span></div>`).join('');
  }

  function renderToday() {
    const now = Date.now();
    const list = state.jobs.filter(j => j.appointmentAt && !['Erledigt','Bezahlt','Abgesagt'].includes(j.status))
      .sort((a,b)=>new Date(a.appointmentAt)-new Date(b.appointmentAt)).slice(0,5);
    $('[data-today-list]').innerHTML = list.length ? list.map(j => {
      const p = personById(j.personId) || j;
      const overdue = new Date(j.appointmentAt).getTime() < now;
      return `<div class="item-card">
        <div class="item-top"><div><div class="item-title">${esc(p.name)} · ${esc(j.service)}</div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(p.address || j.address || '')}</div></div><span class="badge ${overdue?'danger':'warn'}">${esc(j.status)}</span></div>
        <div class="actions">${mapLink(p.address || j.address)}${phoneLink(p.phone)}${jobButtons(j, true)}</div>
      </div>`;
    }).join('') : '<div class="empty">Keine offenen Termine.</div>';
  }

  function renderLeads() {
    const q = ($('[data-lead-search]')?.value || '').toLowerCase();
    const filter = $('[data-lead-filter]')?.value || 'active';
    let leads = [...state.leads].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    if (filter === 'active') leads = leads.filter(l => !['Job erstellt','Verloren'].includes(l.status));
    if (filter === 'won') leads = leads.filter(l => l.status === 'Job erstellt');
    if (filter === 'lost') leads = leads.filter(l => l.status === 'Verloren');
    if (q) leads = leads.filter(l => {
      const p = personById(l.personId) || {};
      return [l.id,l.service,l.status,l.source,p.id,p.name,p.phone,p.address,p.place].join(' ').toLowerCase().includes(q);
    });
    $('[data-lead-list]').innerHTML = leads.length ? leads.map(l => leadCard(l)).join('') : '<div class="empty">Keine Leads gefunden.</div>';
  }

  function leadCard(l) {
    const p = personById(l.personId) || {};
    const ref = personById(l.referredById);
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name)} <span class="badge">${esc(p.id)}</span></div><div class="item-sub">${esc(l.service)} · ${esc(p.place || '')} · erstellt von ${esc(userName(l.createdBy))}</div></div>
        <div class="badges"><span class="badge ${l.status==='Job erstellt'?'ok':l.status==='Verloren'?'danger':'warn'}">${esc(l.status)}</span>${ref?`<span class="badge ok">Empfohlen von ${esc(ref.name)} · ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || '')} ${l.expectedValue?`· ca. CHF ${esc(l.expectedValue)}`:''} ${l.appointmentAt?`· ${fmtDate(l.appointmentAt)}`:''}</div>
      <div class="actions">
        ${phoneLink(p.phone)}${waLeadLink(p, l)}${mapLink(p.address)}
        <button class="secondary" data-convert-lead="${esc(l.id)}">In Job umwandeln</button>
        <button class="secondary" data-mark-lead-lost="${esc(l.id)}">Verloren</button>
      </div>
    </article>`;
  }

  function renderJobs() {
    const q = ($('[data-job-search]')?.value || '').toLowerCase();
    const filter = $('[data-job-filter]')?.value || 'open';
    let jobs = [...state.jobs].sort((a,b)=>(new Date(a.appointmentAt || a.createdAt)) - (new Date(b.appointmentAt || b.createdAt)));
    if (filter === 'open') jobs = jobs.filter(j => !['Erledigt','Bezahlt','Abgesagt'].includes(j.status));
    if (filter === 'done') jobs = jobs.filter(j => ['Erledigt','Bezahlt'].includes(j.status));
    if (q) jobs = jobs.filter(j => {
      const p = personById(j.personId) || {};
      return [j.id,j.service,j.status,j.amount,j.appointmentAt,p.id,p.name,p.phone,p.address,p.place].join(' ').toLowerCase().includes(q);
    });
    $('[data-job-list]').innerHTML = jobs.length ? jobs.map(j => jobCard(j)).join('') : '<div class="empty">Keine Jobs gefunden.</div>';
  }

  function jobCard(j) {
    const p = personById(j.personId) || {};
    const done = ['Erledigt','Bezahlt'].includes(j.status);
    const photoHtml = [j.beforePhoto, j.afterPhoto].filter(Boolean).map((ph, i) => `<img class="thumb" src="${esc(ph.url || ph.dataUrl)}" alt="${i?'Nachher':'Vorher'} Foto">`).join('');
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name)} <span class="badge">${esc(p.id || '')}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service)} · zuständig: ${esc(userName(j.assignedTo))}</div></div>
        <div class="badges"><span class="badge ${done?'ok':'warn'}">${esc(j.status)}</span>${j.amount?`<span class="badge">CHF ${esc(j.amount)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(p.address || j.address || '')}</div>
      ${photoHtml ? `<div class="photo-preview">${photoHtml}</div>` : ''}
      <div class="actions">${mapLink(p.address || j.address)}${phoneLink(p.phone)}${jobButtons(j)}</div>
    </article>`;
  }

  function jobButtons(j, compact=false) {
    return `
      <button class="secondary" data-edit-job="${esc(j.id)}">Bearbeiten</button>
      <a class="secondary" href="${esc(waUrl(personById(j.personId)?.phone, reminderText(j)))}" target="_blank" rel="noopener">Reminder</a>
      <button class="secondary" data-calendar-job="${esc(j.id)}">Kalender</button>
      ${compact ? '' : `<button class="primary" data-complete-job="${esc(j.id)}">Erledigt</button><button class="secondary" data-paid-job="${esc(j.id)}">Bezahlt</button>`}
    `;
  }

  function renderCustomers() {
    const q = ($('[data-customer-search]')?.value || '').toLowerCase();
    let people = activeCustomers();
    if (q) people = people.filter(p => [p.id,p.name,p.phone,p.address,p.place,p.source].join(' ').toLowerCase().includes(q));
    if (!q && customerListMode !== 'all') people = [];
    $('[data-customer-list]').innerHTML = people.length ? people.map(p => customerCard(p)).join('') : '<div class="empty">Tippen zum Suchen oder „Alle anzeigen“ drücken.</div>';
  }

  function customerCard(p) {
    const jobs = state.jobs.filter(j => j.personId === p.id);
    const lastJob = [...jobs].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title">${esc(p.name)} <span class="badge ok">${esc(p.id)}</span></div><div class="item-sub">${esc(p.address || '')}</div></div>
        <div class="badges"><span class="badge">${jobs.length} Job(s)</span><span class="badge">${esc(p.source || 'Quelle offen')}</span></div>
      </div>
      <div class="item-sub">Referral-Link: ${esc(referralLink(p.id))}</div>
      <div class="actions">
        ${phoneLink(p.phone)}${mapLink(p.address)}
        <a class="primary" href="${esc(waUrl(p.phone, referralInviteText(p)))}" target="_blank" rel="noopener">Empfehlung senden</a>
        <button class="secondary" data-copy-ref="${esc(p.id)}">Link kopieren</button>
        ${lastJob ? `<button class="secondary" data-open-job-for="${esc(p.id)}">Neuer Job</button>` : ''}
      </div>
    </article>`;
  }

  function renderRewards() {
    const rewards = [...state.rewards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    $('[data-reward-list]').innerHTML = rewards.length ? rewards.map(r => {
      const to = personById(r.customerId); const from = personById(r.fromPersonId);
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">CHF ${esc(r.amount)} für ${esc(to?.name || r.customerId)}</div><div class="item-sub">aus Empfehlung: ${esc(from?.name || r.fromPersonId)} · ${esc(r.jobId || '')}</div></div><span class="badge ${r.status==='offen'?'warn':'ok'}">${esc(r.status)}</span></div>
        <div class="actions"><button class="secondary" data-toggle-reward="${esc(r.id)}">${r.status==='offen'?'Als gutgeschrieben markieren':'Wieder offen'}</button>${to?.phone?`<a class="secondary" href="${esc(waUrl(to.phone, `Hoi ${to.name}, danke für deine Empfehlung. Dein CHF ${r.amount} Guthaben wurde bei Lumian Services notiert.`))}" target="_blank" rel="noopener">WhatsApp</a>`:''}</div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Boni. Sie entstehen automatisch, wenn ein Empfehlungs-Job erledigt wird.</div>';
  }

  function phoneLink(phone) { return phone ? `<a class="secondary" href="tel:${esc(phone)}">Anrufen</a>` : ''; }
  function mapLink(address) { return address ? `<a class="secondary" href="https://maps.google.com/?q=${encodeURIComponent(address)}" target="_blank" rel="noopener">Maps</a>` : ''; }
  function waLeadLink(p,l) { return p.phone ? `<a class="secondary" href="${esc(waUrl(p.phone, newCustomerText(p,l)))}" target="_blank" rel="noopener">WhatsApp</a>` : ''; }

  function referralInviteText(p) {
    return fillTemplate(getSetting('referralTemplate'), {
      name: p.name || '', customerId: p.id, bonus: getSetting('bonusAmount'), minOrder: getSetting('minOrder'), referralLink: referralLink(p.id)
    });
  }
  function newCustomerText(p,l={}) {
    return fillTemplate(getSetting('newCustomerTemplate'), {
      name: p.name || '', customerId: p.id || '', bonus: getSetting('bonusAmount'), minOrder: getSetting('minOrder'), service: l.service || '', amount: l.expectedValue || '', address: p.address || ''
    });
  }
  function reminderText(j) {
    const p = personById(j.personId) || {};
    return fillTemplate(getSetting('reminderTemplate'), {
      name: p.name || '', customerId: p.id || '', date: fmtDate(j.appointmentAt), service: j.service || '', amount: j.amount || '', address: p.address || j.address || '', bonus: getSetting('bonusAmount'), minOrder: getSetting('minOrder')
    });
  }

  function nextId(type) {
    if (type === 'person') return `LM${state.counters.nextPerson++}`;
    if (type === 'lead') return `L${String(state.counters.nextLead++).padStart(4,'0')}`;
    if (type === 'job') return `J${String(state.counters.nextJob++).padStart(4,'0')}`;
    if (type === 'reward') return `R${String(state.counters.nextReward++).padStart(4,'0')}`;
  }

  function findOrCreatePerson(data) {
    const phone = normPhone(data.phone);
    let p = state.people.find(x => phone && normPhone(x.phone) === phone);
    if (!p && data.personId) p = personById(data.personId);
    if (!p) {
      p = { id: nextId('person'), status: 'lead', createdAt: new Date().toISOString(), createdBy: currentUser };
      state.people.push(p);
    }
    Object.assign(p, {
      name: data.name || p.name || '', phone: data.phone || p.phone || '', address: data.address || p.address || '', place: data.place || p.place || '', source: data.source || p.source || '', updatedAt: new Date().toISOString(), updatedBy: currentUser
    });
    return p;
  }

  function openLeadDialog() {
    const form = $('[data-lead-form]'); form.reset();
    const source = form.elements.source; if (source) source.value = 'WhatsApp';
    $('[data-lead-dialog]').showModal();
  }

  function openJobDialog(job=null, lead=null, person=null) {
    stagedPhotos = { before: null, after: null };
    const form = $('[data-job-form]'); form.reset(); $('[data-photo-preview]').innerHTML = '';
    const title = $('[data-job-modal-title]');
    if (job) { person = personById(job.personId) || {}; title.textContent = `Job bearbeiten · ${job.id}`; }
    else title.textContent = 'Job erstellen';
    form.elements.jobId.value = job?.id || '';
    form.elements.leadId.value = job?.leadId || lead?.id || '';
    form.elements.personId.value = job?.personId || lead?.personId || person?.id || '';
    form.elements.name.value = person?.name || '';
    form.elements.phone.value = person?.phone || '';
    form.elements.address.value = person?.address || '';
    form.elements.service.value = job?.service || lead?.service || 'Fensterreinigung';
    form.elements.appointmentAt.value = (job?.appointmentAt || lead?.appointmentAt || '').slice(0,16);
    form.elements.amount.value = job?.amount || lead?.expectedValue || '';
    form.elements.status.value = job?.status || 'Geplant';
    form.elements.assignedTo.value = job?.assignedTo || currentUser || 'noah';
    form.elements.notes.value = job?.notes || lead?.notes || '';
    if (job?.beforePhoto || job?.afterPhoto) {
      $('[data-photo-preview]').innerHTML = [job.beforePhoto, job.afterPhoto].filter(Boolean).map((ph,i)=>`<img src="${esc(ph.url || ph.dataUrl)}" alt="${i?'Nachher':'Vorher'}">`).join('');
    }
    $('[data-job-dialog]').showModal();
  }

  $$('[data-open-lead]').forEach(b => b.addEventListener('click', openLeadDialog));
  $('[data-open-job]')?.addEventListener('click', () => openJobDialog());
  $$('[data-close-modal]').forEach(b => b.addEventListener('click', () => b.closest('dialog')?.close()));

  $('[data-lead-form]')?.addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const p = findOrCreatePerson(Object.fromEntries(fd.entries()));
    const lead = {
      id: nextId('lead'), personId: p.id, service: fd.get('service'), source: fd.get('source'), expectedValue: fd.get('expectedValue'), appointmentAt: fd.get('appointmentAt'), referredById: fd.get('referredById') || '', notes: fd.get('notes') || '', status: 'Neu', createdAt: new Date().toISOString(), createdBy: currentUser
    };
    if (lead.referredById) p.source = 'Empfehlung';
    state.leads.push(lead);
    saveState('lead'); e.currentTarget.closest('dialog').close(); setTab('leads'); toast(`Lead gespeichert: ${p.id}`);
  });

  $('[data-job-form]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd.entries());
    const p = findOrCreatePerson(data);
    let job = data.jobId ? jobById(data.jobId) : null;
    if (!job) { job = { id: nextId('job'), createdAt: new Date().toISOString(), createdBy: currentUser }; state.jobs.push(job); }
    Object.assign(job, { personId: p.id, leadId: data.leadId || job.leadId || '', service: data.service, appointmentAt: data.appointmentAt, amount: data.amount, status: data.status, assignedTo: data.assignedTo || currentUser, notes: data.notes || '', updatedAt: new Date().toISOString(), updatedBy: currentUser });
    if (data.leadId) { const l = leadById(data.leadId); if (l) { l.status = 'Job erstellt'; l.jobId = job.id; } }
    if (stagedPhotos.before) job.beforePhoto = stagedPhotos.before;
    if (stagedPhotos.after) job.afterPhoto = stagedPhotos.after;
    if (['Erledigt','Bezahlt'].includes(job.status)) completeJob(job.id, false);
    saveState('job'); e.currentTarget.closest('dialog').close(); setTab('jobs'); toast(`Job gespeichert: ${job.id}`);
  });

  document.addEventListener('click', e => {
    const c = e.target.closest('[data-convert-lead]'); if (c) { const l=leadById(c.dataset.convertLead); if(l) openJobDialog(null,l,personById(l.personId)); }
    const lost = e.target.closest('[data-mark-lead-lost]'); if (lost) { const l=leadById(lost.dataset.markLeadLost); if(l){l.status='Verloren'; saveState('lead lost'); renderAll(); toast('Lead als verloren markiert.');}}
    const edit = e.target.closest('[data-edit-job]'); if (edit) { const j=jobById(edit.dataset.editJob); if(j) openJobDialog(j); }
    const comp = e.target.closest('[data-complete-job]'); if (comp) completeJob(comp.dataset.completeJob, true);
    const paid = e.target.closest('[data-paid-job]'); if (paid) { const j=jobById(paid.dataset.paidJob); if(j){j.status='Bezahlt'; completeJob(j.id, false); saveState('paid'); renderAll(); toast('Job als bezahlt markiert.');}}
    const cal = e.target.closest('[data-calendar-job]'); if (cal) addCalendar(jobById(cal.dataset.calendarJob));
    const copy = e.target.closest('[data-copy-ref]'); if (copy) { navigator.clipboard?.writeText(referralLink(copy.dataset.copyRef)); toast('Empfehlungslink kopiert.'); }
    const newJob = e.target.closest('[data-open-job-for]'); if (newJob) openJobDialog(null,null,personById(newJob.dataset.openJobFor));
    const rew = e.target.closest('[data-toggle-reward]'); if (rew) { const r=state.rewards.find(x=>x.id===rew.dataset.toggleReward); if(r){r.status=r.status==='offen'?'gutgeschrieben':'offen'; saveState('reward'); renderAll();}}
  });

  function completeJob(jobId, showToast) {
    const job = jobById(jobId); if (!job) return;
    const p = personById(job.personId); if (!p) return;
    job.status = job.status === 'Bezahlt' ? 'Bezahlt' : 'Erledigt';
    p.status = 'customer'; p.customerSince = p.customerSince || new Date().toISOString();
    const lead = job.leadId ? leadById(job.leadId) : null;
    const amount = Number(job.amount || lead?.expectedValue || 0);
    const refId = lead?.referredById || p.referredById;
    if (refId && amount >= Number(getSetting('minOrder'))) {
      const exists = state.rewards.some(r => r.jobId === job.id && r.customerId === refId);
      if (!exists) state.rewards.push({ id: nextId('reward'), customerId: refId, fromPersonId: p.id, jobId: job.id, amount: Number(getSetting('bonusAmount')), status: 'offen', createdAt: new Date().toISOString(), createdBy: currentUser });
    }
    saveState('complete'); renderAll(); if (showToast) toast('Job erledigt. Kunde & Empfehlungsbonus aktualisiert.');
  }

  async function compressImage(file) {
    if (!file || !file.type.startsWith('image/')) return null;
    const img = await new Promise((resolve,reject)=>{ const i=new Image(); i.onload=()=>resolve(i); i.onerror=reject; i.src=URL.createObjectURL(file); });
    const max = 1200; let { width, height } = img;
    const scale = Math.min(1, max / Math.max(width, height)); width = Math.round(width*scale); height = Math.round(height*scale);
    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
    canvas.getContext('2d').drawImage(img,0,0,width,height);
    const dataUrl = canvas.toDataURL('image/jpeg', .72);
    return { name: file.name.replace(/\.[^.]+$/, '') + '.jpg', dataUrl, size: Math.round(dataUrl.length * .75), createdAt: new Date().toISOString() };
  }

  $('[data-job-form]')?.addEventListener('change', async e => {
    if (e.target.name !== 'beforePhoto' && e.target.name !== 'afterPhoto') return;
    toast('Foto wird komprimiert...');
    const img = await compressImage(e.target.files?.[0]);
    if (!img) return;
    if (e.target.name === 'beforePhoto') stagedPhotos.before = img; else stagedPhotos.after = img;
    $('[data-photo-preview]').innerHTML = [stagedPhotos.before, stagedPhotos.after].filter(Boolean).map((ph,i)=>`<img src="${esc(ph.dataUrl)}" alt="${i?'Nachher':'Vorher'}">`).join('');
    toast('Foto gespeichert.');
  });

  function addCalendar(job) {
    if (!job || !job.appointmentAt) return toast('Kein Termin gesetzt.');
    const p = personById(job.personId) || {};
    const start = new Date(job.appointmentAt);
    const end = new Date(start.getTime() + 2*60*60*1000);
    const pad = n => String(n).padStart(2,'0');
    const icsDate = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    const title = `Lumian: ${p.name || 'Kunde'} - ${job.service || 'Reinigung'}`;
    const description = `Telefon: ${p.phone || ''}\nBetrag: CHF ${job.amount || ''}\nJob: ${job.id}\nKunde: ${p.id || ''}`;
    const ics = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lumian Services//Portal//DE','BEGIN:VEVENT',`UID:${job.id}@lumianservices.ch`,`DTSTAMP:${icsDate(new Date())}`,`DTSTART:${icsDate(start)}`,`DTEND:${icsDate(end)}`,`SUMMARY:${title}`,`LOCATION:${p.address || job.address || ''}`,`DESCRIPTION:${description}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${job.id}-lumian-termin.ics`; a.click(); URL.revokeObjectURL(a.href);
  }

  // Autocomplete existing customers/people for referrals.
  const refSearch = $('[data-ref-search]');
  refSearch?.addEventListener('input', () => {
    const q = refSearch.value.toLowerCase().trim();
    const box = $('[data-ref-suggestions]');
    const hidden = $('[data-lead-form]').elements.referredById;
    hidden.value = '';
    if (q.length < 1) { box.hidden = true; return; }
    const matches = allPeopleSorted().filter(p => [p.id,p.name,p.phone,p.address,p.place].join(' ').toLowerCase().includes(q)).slice(0,8);
    box.innerHTML = matches.map(p => `<button type="button" data-pick-ref="${esc(p.id)}">${esc(p.name)} · ${esc(p.id)} ${p.place?`· ${esc(p.place)}`:''}</button>`).join('') || '<button type="button" disabled>Kein Kunde gefunden</button>';
    box.hidden = false;
  });
  document.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick-ref]');
    if (!pick) return;
    const p = personById(pick.dataset.pickRef); if (!p) return;
    $('[data-lead-form]').elements.referredById.value = p.id;
    refSearch.value = `${p.name} · ${p.id}`;
    $('[data-ref-suggestions]').hidden = true;
  });

  ['lead','job','customer'].forEach(type => {
    const el = $(`[data-${type}-search]`); if (el) el.addEventListener('input', renderAll);
    const fl = $(`[data-${type}-filter]`); if (fl) fl.addEventListener('change', renderAll);
  });
  $('[data-show-all-customers]')?.addEventListener('click', () => { customerListMode = 'all'; renderCustomers(); });

  function fillSettings() {
    const form = $('[data-settings-form]'); if (!form || form.dataset.filled === 'yes') return;
    Object.entries(state.settings).forEach(([k,v]) => { if (form.elements[k]) form.elements[k].value = v; });
    form.dataset.filled = 'yes';
  }
  $('[data-settings-form]')?.addEventListener('submit', e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    Object.keys(DEFAULT_SETTINGS).forEach(k => { if (fd.has(k)) state.settings[k] = fd.get(k); });
    state.settings.bonusAmount = Number(state.settings.bonusAmount || 0); state.settings.minOrder = Number(state.settings.minOrder || 0);
    saveState('settings'); toast('Setup gespeichert.');
  });
  $('[data-change-password]')?.addEventListener('click', async () => {
    const form = $('[data-settings-form]'); const user = state.users.find(u => u.id === currentUser);
    const cur = form.elements.currentPassword.value; const neu = form.elements.newPassword.value;
    if (!neu || neu.length < 4) return toast('Neues Passwort: mindestens 4 Zeichen.');
    if (user.passwordHash && !(await verifyPassword(user, cur))) return toast('Aktuelles Passwort stimmt nicht.');
    await setPassword(currentUser, neu); form.elements.currentPassword.value=''; form.elements.newPassword.value=''; toast('Passwort geändert.');
  });
  $('[data-logout]')?.addEventListener('click', () => { currentUser=''; sessionStorage.removeItem(SESSION_KEY); renderLogin(); });

  function exportCsv() {
    const rows = [['LumianNr','Status','Name','Telefon','Adresse','Ort','Quelle','Kunde seit']].concat(state.people.map(p => [p.id,p.status,p.name,p.phone,p.address,p.place,p.source,p.customerSince || '']));
    downloadText('lumian-kunden.csv', rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(';')).join('\n'), 'text/csv;charset=utf-8');
  }
  function exportJson() { downloadText(`lumian-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(state,null,2), 'application/json'); }
  function downloadText(name, text, type) { const blob = new Blob([text], {type}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href); }
  $('[data-export-csv]')?.addEventListener('click', exportCsv);
  $('[data-export-json]')?.addEventListener('click', exportJson);
  $('[data-import-json]')?.addEventListener('change', async e => {
    const file=e.target.files?.[0]; if(!file) return;
    try { const imported=JSON.parse(await file.text()); localStorage.setItem(STORE_KEY, JSON.stringify(imported)); location.reload(); } catch { toast('Backup konnte nicht gelesen werden.'); }
  });
  $('[data-reset-demo]')?.addEventListener('click', () => { if(confirm('Wirklich alle lokalen Portal-Daten löschen?')){ localStorage.removeItem(STORE_KEY); location.reload(); } });

  function makeCloudPayload() {
    return { action:'syncFull', sentAt:new Date().toISOString(), by:currentUser, state };
  }
  async function syncCloud() {
    const url = getSetting('scriptUrl'); if (!url) return toast('Bitte zuerst Google Apps Script URL im Setup eintragen.');
    saveState('before sync');
    try {
      await fetch(url, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain'}, body: JSON.stringify(makeCloudPayload()) });
      toast('Sync gesendet. In Google Sheet prüfen.');
    } catch (_) { toast('Sync konnte nicht gesendet werden.'); }
  }
  function loadCloud() {
    const url = getSetting('scriptUrl'); if (!url) return toast('Bitte zuerst Google Apps Script URL im Setup eintragen.');
    const cb = `lumianCloud_${Date.now()}`;
    window[cb] = data => {
      try {
        if (!data || !data.state) throw new Error('empty');
        localStorage.setItem(STORE_KEY, JSON.stringify(data.state));
        toast('Cloud-Daten geladen. App lädt neu...');
        setTimeout(()=>location.reload(),800);
      } catch { toast('Cloud-Daten konnten nicht geladen werden.'); }
      delete window[cb]; script.remove();
    };
    const script = document.createElement('script');
    script.src = `${url}${url.includes('?')?'&':'?'}action=load&callback=${cb}`;
    script.onerror = () => { toast('Cloud laden fehlgeschlagen.'); delete window[cb]; script.remove(); };
    document.body.appendChild(script);
  }
  $$('[data-sync-now]').forEach(b => b.addEventListener('click', syncCloud));
  $('[data-load-cloud]')?.addEventListener('click', loadCloud);

  renderLogin();
})();
