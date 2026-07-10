(() => {
  'use strict';
  // Emergency cache/service-worker rescue for mobile browsers that keep an old PWA controller.
  (function emergencySwResetOnQuery(){
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('swreset') !== '1') return;
      if ('caches' in window) caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
      if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(r => r.unregister()))).catch(() => {});
    } catch (_) {}
  })();



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
  const ROLE_PRESETS = {
    admin: {
      createLeads:true, viewAllOperational:true, contactCustomers:true, updateJobs:true,
      uploadPhotos:true, viewJobAmount:true, viewOwnCompensation:true, viewCustomerHistory:true, manageWebsiteLeads:true
    },
    teamlead: {
      createLeads:true, viewAllOperational:true, contactCustomers:true, updateJobs:true,
      uploadPhotos:true, viewJobAmount:true, viewOwnCompensation:true, viewCustomerHistory:true, manageWebsiteLeads:false
    },
    staff: {
      createLeads:true, viewAllOperational:false, contactCustomers:true, updateJobs:true,
      uploadPhotos:true, viewJobAmount:false, viewOwnCompensation:true, viewCustomerHistory:true, manageWebsiteLeads:false
    },
    helper: {
      createLeads:false, viewAllOperational:false, contactCustomers:true, updateJobs:false,
      uploadPhotos:true, viewJobAmount:false, viewOwnCompensation:true, viewCustomerHistory:false, manageWebsiteLeads:false
    }
  };
  function normalizedRole(role, id = '') {
    if (ADMIN_IDS.includes(id) || role === 'admin') return 'admin';
    return ['teamlead','staff','helper'].includes(role) ? role : 'staff';
  }
  function roleLabel(role) {
    return ({ admin:'Admin · volle Rechte', teamlead:'Teamleitung', staff:'Mitarbeiter', helper:'Hilfskraft' })[role] || 'Mitarbeiter';
  }
  function defaultPermissionsForRole(role) { return { ...(ROLE_PRESETS[normalizedRole(role)] || ROLE_PRESETS.staff) }; }
  function normalizePermissions(role, permissions = {}) { return { ...defaultPermissionsForRole(role), ...(permissions || {}) }; }
  function normalizeCompensationDefaults(raw = {}) {
    const hourlyRate = amountValue(raw.hourlyRate || raw.defaultHourlyRate || 0);
    const legacyFixed = amountValue(raw.fixedAmount || raw.defaultFixedAmount || 0);
    let workPayType = String(raw.workPayType || raw.defaultPayType || '').toLowerCase();
    if (!['none','hourly','fixed'].includes(workPayType)) workPayType = hourlyRate > 0 ? 'hourly' : (legacyFixed > 0 ? 'fixed' : 'none');
    return {
      workPayType,
      hourlyRate,
      firstCommissionPct: Math.max(0, Math.min(100, amountValue(raw.firstCommissionPct || 0))),
      repeatCommissionPct: Math.max(0, Math.min(100, amountValue(raw.repeatCommissionPct || 0))),
      maxCommissionJobs: Math.max(0, Math.floor(amountValue(raw.maxCommissionJobs || 0))),
      commissionActive: raw.commissionActive === true || raw.commissionActive === 'true'
    };
  }
  function normalizeEmployeeUser(u = {}, fallback = {}) {
    const id = normalizeUserId(u.id || fallback.id || '');
    const role = normalizedRole(u.role || fallback.role, id);
    const name = String(u.name || fallback.name || id || 'Mitarbeiter').trim();
    const loginEnabled = u.loginEnabled !== undefined ? u.loginEnabled !== false : u.active !== false;
    return {
      ...fallback, ...u, id, name,
      emoji: String(u.emoji || fallback.emoji || name.slice(0,1).toUpperCase()).slice(0,2),
      role,
      employeeType: u.employeeType === 'temporary' || role === 'helper' ? 'temporary' : 'fixed',
      phone: String(u.phone || '').trim(),
      email: String(u.email || '').trim(),
      employmentActive: u.employmentActive !== false,
      loginEnabled,
      active: loginEnabled,
      permissions: normalizePermissions(role, u.permissions),
      compensationDefaults: normalizeCompensationDefaults(u.compensationDefaults || u),
      passwordHash: u.passwordHash || '', salt: u.salt || '',
      credentialId: u.credentialId || '', credentialUserHandle: u.credentialUserHandle || '',
      recoveryCode: u.recoveryCode || `${name}-Reset-2026`
    };
  }
  function isAdmin(id = currentUser) {
    const u = state?.users?.find?.(x => x.id === id);
    return ADMIN_IDS.includes(id) || u?.role === 'admin';
  }
  function employeeUsers() { return (state?.users || []).filter(u => u.employmentActive !== false); }
  function activeUsers() { return employeeUsers(); }
  function loginUsers() { return employeeUsers().filter(u => u.loginEnabled !== false && u.active !== false); }
  function userPermissions(id = currentUser) {
    const u = state?.users?.find?.(x => x.id === id);
    if (isAdmin(id)) return { ...ROLE_PRESETS.admin };
    return normalizePermissions(u?.role || 'staff', u?.permissions || {});
  }
  function hasPermission(key, id = currentUser) { return !!userPermissions(id)[key]; }
  function canManageWebsiteLeads(id = currentUser) { return isAdmin(id) || hasPermission('manageWebsiteLeads', id); }
  function canCreateJobs(id = currentUser) { return isAdmin(id) || normalizedRole(state?.users?.find?.(u=>u.id===id)?.role) === 'teamlead'; }
  function canAccessTab(tab) {
    if (isAdmin()) return true;
    if (tab === 'dashboard' || tab === 'jobs') return true;
    if (tab === 'leads') return hasPermission('createLeads') || canManageWebsiteLeads() || visibleLeads().length > 0;
    if (tab === 'customers') return hasPermission('viewCustomerHistory') || visibleCustomers().length > 0;
    if (tab === 'settings') return true;
    return false;
  }

  function normalizeCommissionAgreement(raw = {}, employeeId = '') {
    const id = normalizeUserId(raw.employeeId || employeeId || '');
    return {
      employeeId: id,
      firstPct: Math.max(0, Math.min(100, amountValue(raw.firstPct ?? raw.firstCommissionPct ?? 0))),
      repeatPct: Math.max(0, Math.min(100, amountValue(raw.repeatPct ?? raw.repeatCommissionPct ?? 0))),
      maxJobs: Math.max(0, Math.floor(amountValue(raw.maxJobs ?? raw.maxCommissionJobs ?? 0))),
      active: raw.active !== false && raw.commissionActive !== false && !!id,
      stoppedAt: raw.stoppedAt || '',
      createdAt: raw.createdAt || '',
      updatedAt: raw.updatedAt || ''
    };
  }
  function commissionAgreementFromEmployee(employeeId) {
    const u = state?.users?.find?.(x => x.id === employeeId);
    const d = normalizeCompensationDefaults(u?.compensationDefaults || {});
    return normalizeCommissionAgreement({
      employeeId,
      firstPct:d.firstCommissionPct,
      repeatPct:d.repeatCommissionPct,
      maxJobs:d.maxCommissionJobs,
      active:d.commissionActive,
      createdAt:new Date().toISOString()
    }, employeeId);
  }
  function normalizeCompensationLine(line = {}, index = 0) {
    const type = ['none','fixed','hourly','commission'].includes(line.type) ? line.type : 'none';
    const id = String(line.id || `line-${Date.now()}-${index}-${Math.random().toString(36).slice(2,6)}`);
    const hours = Math.max(0, amountValue(line.hours || 0));
    const rate = Math.max(0, amountValue(line.rate || 0));
    const percent = Math.max(0, Math.min(100, amountValue(line.percent || 0)));
    const baseAmount = amountValue(line.baseAmount || 0);
    let amount = amountValue(line.amount || 0);
    if (type === 'hourly') amount = Math.round(hours * rate * 100) / 100;
    if (type === 'commission' && !amount && percent && baseAmount) amount = Math.round(baseAmount * percent) / 100;
    return {
      ...line, id, type,
      employeeId: normalizeUserId(line.employeeId || ''),
      amount, hours, rate, percent, baseAmount,
      automatic: line.automatic === true,
      description: String(line.description || '')
    };
  }
  function normalizePersonRecord(p = {}) {
    const agreement = p.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(p.acquisitionAgreement) : null;
    return { email:'', contactStatus:'Aktiv', ...p, acquisitionAgreement:agreement };
  }
  function normalizeLeadRecord(l = {}) {
    const acquiredBy = normalizeUserId(l.acquiredBy || l.leadOwner || l.createdBy || '');
    return {
      ...l, acquiredBy, assignedTo:normalizeUserId(l.assignedTo || l.createdBy || acquiredBy || ''),
      commissionAgreement:l.commissionAgreement?.employeeId ? normalizeCommissionAgreement(l.commissionAgreement, acquiredBy) : null
    };
  }
  function normalizeJobRecord(j = {}) {
    const team = Array.from(new Set([...(Array.isArray(j.teamMemberIds) ? j.teamMemberIds : []), j.assignedTo].filter(Boolean).map(normalizeUserId)));
    return {
      ...j,
      acquiredBy:normalizeUserId(j.acquiredBy || ''),
      assignedTo:normalizeUserId(j.assignedTo || j.createdBy || ''),
      teamMemberIds:team,
      commissionAgreement:j.commissionAgreement?.employeeId ? normalizeCommissionAgreement(j.commissionAgreement, j.acquiredBy) : null,
      compensationLines:Array.isArray(j.compensationLines) ? j.compensationLines.map(normalizeCompensationLine) : []
    };
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

  const DEFAULT_GALLERY = [
    { id:'g1', src:'https://lumianservices.ch/assets/img/gallery/01-before-after.jpg', title:'Vorher / Nachher', caption:'Fenster wieder klar – der Unterschied ist sofort sichtbar.' },
    { id:'g2', src:'https://lumianservices.ch/assets/img/gallery/02-window-after.jpg', title:'Klares Finish', caption:'Glasflächen sauber gereinigt und frisch im Look.' },
    { id:'g3', src:'https://lumianservices.ch/assets/img/gallery/03-balcony-glass.jpg', title:'Balkon & Glas', caption:'Balkon- und Glasflächen mit sauberem Finish.' },
    { id:'g4', src:'https://lumianservices.ch/assets/img/gallery/04-terrace-work.jpg', title:'Aussenbereich', caption:'Aussenreinigung direkt vor Ort – unkompliziert und sauber.' },
    { id:'g5', src:'https://lumianservices.ch/assets/img/gallery/05-inside-window.jpg', title:'Innenfenster', caption:'Rahmen, Glas und Innenflächen sorgfältig gepflegt.' },
    { id:'g6', src:'https://lumianservices.ch/assets/img/gallery/06-high-window.jpg', title:'Hohe Fenster', caption:'Auch schwer erreichbare Flächen werden sauber bearbeitet.' }
  ];
  const WEBSITE_CONTENT_SECTIONS = [
    { page:'home', id:'hero', title:'Homepage · Hero', fields:[
      ['home.hero.eyebrow','Leistungszeile','text'],['home.hero.title','Hauptüberschrift','textarea'],['home.hero.lead','Einleitung','textarea'],
      ['home.hero.primaryText','Primärer Button','text'],['home.hero.primaryHref','Primärer Button-Link','url'],['home.hero.whatsappText','WhatsApp Button','text'],['home.hero.whatsappHref','WhatsApp Link','url'],
      ['home.hero.image','Hero-Logo/Bild','image'],['global.logo','Website-Logo dunkel','image'],
      ['home.nav.story','Navigation: Story','text'],['home.nav.services','Navigation: Angebot','text'],['home.nav.gallery','Navigation: Galerie','text'],['home.nav.referral','Navigation: Danke-Programm','text'],['home.nav.faq','Navigation: FAQ','text'],['home.nav.redeem','Navigation: Danke-Code','text'],['home.nav.cta','Navigation: Offerte','text'],
      ['home.hero.trust1','Vorteil 1','text'],['home.hero.trust2','Vorteil 2','text'],['home.hero.trust3','Vorteil 3','text'],['home.hero.pill','Text am Hero-Bild','text'],
      ['home.hero.mini1Title','Mini-Karte 1 Titel','text'],['home.hero.mini1Text','Mini-Karte 1 Text','text'],['home.hero.mini2Title','Mini-Karte 2 Titel','text'],['home.hero.mini2Text','Mini-Karte 2 Text','text'],['home.hero.mini3Title','Mini-Karte 3 Titel','text'],['home.hero.mini3Text','Mini-Karte 3 Text','text']
    ]},
    { page:'home', id:'story', title:'Homepage · Story & Team', fields:[
      ['home.story.kicker','Bereichstitel','text'],['home.story.title','Überschrift','textarea'],['home.story.p1','Text 1','textarea'],['home.story.p2','Text 2','textarea'],
      ['home.story.noahName','Name Noah','text'],['home.story.noahImage','Bild Noah','image'],['home.story.timoName','Name Timo','text'],['home.story.timoImage','Bild Timo','image']
    ]},
    { page:'home', id:'referral', title:'Homepage · Danke-Programm', fields:[
      ['home.referral.kicker','Bereichstitel','text'],['home.referral.title','Überschrift','textarea'],['home.referral.text','Einleitung','textarea'],['home.referral.highlight','Hervorgehobener Text','textarea'],
      ['home.referral.ticketTitle','Ticket-Titel','text'],['home.referral.ticketValue','Ticket-Vorteil','text'],['home.referral.ticketCondition','Ticket-Bedingung','text'],['home.referral.smallPrint','Kleingedrucktes','textarea']
    ]},
    { page:'home', id:'services', title:'Homepage · Angebot', fields:[
      ['home.services.kicker','Bereichstitel','text'],['home.services.title','Überschrift','text'],['home.services.intro','Einleitung','textarea'],
      ['home.services.1.title','Service 1 Titel','text'],['home.services.1.text','Service 1 Text','textarea'],['home.services.2.title','Service 2 Titel','text'],['home.services.2.text','Service 2 Text','textarea'],
      ['home.services.3.title','Service 3 Titel','text'],['home.services.3.text','Service 3 Text','textarea'],['home.services.4.title','Service 4 Titel','text'],['home.services.4.text','Service 4 Text','textarea'],
      ['home.services.5.title','Service 5 Titel','text'],['home.services.5.text','Service 5 Text','textarea'],['home.services.6.title','Service 6 Titel','text'],['home.services.6.text','Service 6 Text','textarea']
    ]},
    { page:'home', id:'galleryHead', title:'Homepage · Galerie-Kopf', fields:[
      ['home.gallery.kicker','Bereichstitel','text'],['home.gallery.title','Überschrift','text'],['home.gallery.intro','Einleitung','textarea']
    ]},
    { page:'home', id:'booking', title:'Homepage · Buchung & Gebiet', fields:[
      ['home.booking.kicker','Bereichstitel','text'],['home.booking.title','Überschrift','textarea'],['home.booking.intro','Einleitung','textarea'],['home.booking.refTitle','Danke-Code Titel','text'],['home.booking.refText','Danke-Code Text','textarea'],['home.booking.refButton','Danke-Code Button','text'],['home.booking.refHref','Danke-Code Link','url'],
      ['home.booking.bullet1','Hinweis 1','text'],['home.booking.bullet2','Hinweis 2','text'],['home.booking.bullet3','Hinweis 3','text'],['home.booking.submit','Formular-Button','text'],['home.booking.note','Formular-Hinweis','textarea'],
      ['home.area.kicker','Gebiet Bereichstitel','text'],['home.area.title','Gebiet Überschrift','text'],['home.area.text','Gebiet Text','textarea'],['global.phoneHuman','Telefon sichtbar','text'],['global.phoneTel','Telefon-Link','url'],['global.email','E-Mail','text'],['global.emailHref','E-Mail-Link','url'],['home.area.whatsappText','Direktkontakt WhatsApp Text','text'],['global.whatsappText','Footer WhatsApp Text','text'],['global.whatsappHref','WhatsApp Link','url']
    ]},
    { page:'home', id:'faq', title:'Homepage · FAQ & Abschluss', fields:[
      ['home.faq.kicker','FAQ Bereichstitel','text'],['home.faq.title','FAQ Überschrift','text'],['home.faq.intro','FAQ Einleitung','textarea'],
      ['home.faq.1.q','Frage 1','text'],['home.faq.1.a','Antwort 1','textarea'],['home.faq.2.q','Frage 2','text'],['home.faq.2.a','Antwort 2','textarea'],['home.faq.3.q','Frage 3','text'],['home.faq.3.a','Antwort 3','textarea'],['home.faq.4.q','Frage 4','text'],['home.faq.4.a','Antwort 4','textarea'],['home.faq.5.q','Frage 5','text'],['home.faq.5.a','Antwort 5','textarea'],['home.faq.6.q','Frage 6','text'],['home.faq.6.a','Antwort 6','textarea'],
      ['home.final.title','Abschlussüberschrift','textarea'],['home.final.button','Abschlussbutton','text'],['home.final.href','Abschlusslink','url'],
      ['home.app.kicker','App Bereichstitel','text'],['home.app.title','App Überschrift','text'],['home.app.text','App Text','textarea'],['home.app.button','App Button','text'],
      ['global.footerText','Footer-Text','text'],['global.footerContactTitle','Footer: Kontakt Titel','text'],['global.footerLegalTitle','Footer: Rechtliches Titel','text'],['global.footerImprintText','Footer: Impressum Text','text'],['global.footerImprintHref','Footer: Impressum Link','url'],['global.footerPrivacyText','Footer: Datenschutz Text','text'],['global.footerPrivacyHref','Footer: Datenschutz Link','url'],['global.footerCookiesText','Footer: Cookies Text','text'],['global.footerCookiesHref','Footer: Cookies Link','url'],['global.footerBookingText','Footer: Buchungshinweise Text','text'],['global.footerBookingHref','Footer: Buchungshinweise Link','url'],['global.copyright','Copyright','text']
    ]},
    { page:'referral', id:'refHero', title:'Empfehlungsseite · Inhalt', fields:[
      ['referral.kicker','Bereichstitel','text'],['referral.title','Hauptüberschrift','text'],['referral.lead','Einleitung','textarea'],['referral.missingTitle','Kein Code Titel','text'],['referral.missingText','Kein Code Text','textarea'],
      ['referral.flowTitle','Ablauf Titel','text'],['referral.flowText','Ablauf Text','textarea'],['referral.headerBrand','Header Markenname','text'],['referral.backText','Zur Website Button','text'],['referral.backHref','Zur Website Link','url'],['referral.detectedTitle','Erkannter Code Titel','text'],['referral.detectedNote','Erkannter Code Hinweis','text'],['referral.bullet1','Hinweis 1','text'],['referral.bullet2','Hinweis 2','text'],['referral.bullet3','Hinweis 3','text'],['referral.submitText','Formular-Button','text'],['referral.formNote','Formular-Hinweis','textarea'],['global.logo','Logo','image'],['global.footerText','Footer-Text','text'],['global.footerContactTitle','Footer Kontakt Titel','text'],['global.footerLegalTitle','Footer Rechtliches Titel','text'],['global.copyright','Copyright','text']
    ]},
    { page:'imprint', id:'imprintMain', title:'Impressum · Anbieter & Zweck', fields:[
      ['imprint.kicker','Bereichstitel','text'],['imprint.title','Seitentitel','text'],['imprint.providerTitle','Anbieter Titel','text'],
      ['imprint.businessName','Firmenname','text'],['imprint.owner','Inhaber','text'],['imprint.legalForm','Rechtsform','text'],['imprint.street','Strasse','text'],['imprint.city','PLZ / Ort','text'],['imprint.country','Land','text'],
      ['imprint.purposeTitle','Zweck Titel','text'],['imprint.purpose1','Zweck Text 1','textarea'],['imprint.purpose2','Zweck Text 2','textarea']
    ]},
    { page:'imprint', id:'imprintTerms', title:'Impressum · Preise & Haftung', fields:[
      ['imprint.pricesTitle','Preise Titel','text'],['imprint.prices1','Preise Text 1','textarea'],['imprint.prices2','Preise Text 2','textarea'],
      ['imprint.contentTitle','Haftung Inhalte Titel','text'],['imprint.content1','Haftung Inhalte Text 1','textarea'],['imprint.content2','Haftung Inhalte Text 2','textarea'],
      ['imprint.linksTitle','Externe Links Titel','text'],['imprint.links1','Externe Links Text','textarea']
    ]},
    { page:'imprint', id:'imprintRights', title:'Impressum · Urheberrecht & Datenschutz', fields:[
      ['imprint.copyrightTitle','Urheberrechte Titel','text'],['imprint.copyright1','Urheberrechte Text 1','textarea'],['imprint.copyright2','Urheberrechte Text 2','textarea'],
      ['imprint.privacyTitle','Datenschutz Titel','text'],['imprint.privacyText','Datenschutz Hinweis','textarea']
    ]},
    { page:'privacy', id:'privacyBasics', title:'Datenschutz · Grundlagen', fields:[
      ['privacy.kicker','Bereichstitel','text'],['privacy.title','Seitentitel','text'],
      ['privacy.s1Title','1. Titel','text'],['privacy.s1p1','1. Text 1','textarea'],['privacy.s1p2','1. Text 2','textarea'],
      ['privacy.s2Title','2. Titel','text'],['privacy.s2p1','2. Text 1','textarea'],['privacy.s2p2','2. Text 2','textarea'],
      ['privacy.s3Title','3. Titel','text'],['privacy.s3p1','3. Text 1','textarea'],['privacy.s3p2','3. Text 2','textarea']
    ]},
    { page:'privacy', id:'privacyServices', title:'Datenschutz · Kontakt, Hosting, Cloud & Bilder', fields:[
      ['privacy.s4Title','4. Titel','text'],['privacy.s4p1','4. Text','textarea'],
      ['privacy.s5Title','5. Titel','text'],['privacy.s5p1','5. Text 1','textarea'],['privacy.s5p2','5. Text 2','textarea'],
      ['privacy.s6Title','6. Titel','text'],['privacy.s6p1','6. Text 1','textarea'],['privacy.s6p2','6. Text 2','textarea'],
      ['privacy.s7Title','7. Titel','text'],['privacy.s7p1','7. Text 1','textarea'],['privacy.s7p2','7. Text 2','textarea']
    ]},
    { page:'privacy', id:'privacyRights', title:'Datenschutz · Empfänger, Aufbewahrung, Rechte & Sicherheit', fields:[
      ['privacy.s8Title','8. Titel','text'],['privacy.s8p1','8. Text 1','textarea'],['privacy.s8p2','8. Text 2','textarea'],
      ['privacy.s9Title','9. Titel','text'],['privacy.s9p1','9. Text','textarea'],
      ['privacy.s10Title','10. Titel','text'],['privacy.s10p1','10. Text 1','textarea'],['privacy.s10p2','10. Text 2','textarea'],
      ['privacy.s11Title','11. Titel','text'],['privacy.s11p1','11. Text 1','textarea'],['privacy.s11p2','Stand','text'],
      ['privacy.localTitle','Lokale Speicherung Titel','text'],['privacy.local1','Lokale Speicherung Text 1','textarea'],['privacy.local2','Lokale Speicherung Text 2','textarea']
    ]},
    { page:'cookies', id:'cookiesMain', title:'Cookies & lokale Speicherung · Hinweise', fields:[
      ['cookies.kicker','Bereichstitel','text'],['cookies.title','Seitentitel','text'],
      ['cookies.s1Title','Technische Speicherung Titel','text'],['cookies.s1p1','Text 1','textarea'],['cookies.s1p2','Text 2','textarea'],
      ['cookies.s2Title','App-Funktion Titel','text'],['cookies.s2p1','App-Funktion Text','textarea'],
      ['cookies.s3Title','Externe Dienste Titel','text'],['cookies.s3p1','Externe Dienste Text','textarea'],
      ['cookies.s4Title','Änderungen Titel','text'],['cookies.s4p1','Änderungen Text','textarea'],['cookies.s4p2','Stand','text']
    ]}
  ];
  const DEFAULT_WEBSITE_VALUES = {
    'home.hero.eyebrow':'Fensterreinigung · Storen · Dachrinnen · Dach- & Aussenreinigung','home.hero.title':'Fensterreinigung & Aussenreinigung, die man sofort sieht.','home.hero.lead':'Lumian Services reinigt Fenster, Glasflächen, Storen, Rollläden, Dachrinnen, Terrassen, Balkone und Aussenflächen für Privat- und Geschäftskunden in der Schweiz. Schnell, fair und unkompliziert per WhatsApp.','home.hero.primaryText':'Offerte in 60 Sekunden','home.hero.primaryHref':'#booking','home.hero.whatsappText':'WhatsApp starten','home.hero.whatsappHref':'https://wa.me/41772794707?text=Hoi%20Lumian%20Services%2C%20ich%20m%C3%B6chte%20eine%20Reinigung%20anfragen.',
    'home.nav.story':'Story','home.nav.services':'Angebot','home.nav.gallery':'Galerie','home.nav.referral':'Danke-Programm','home.nav.faq':'FAQ','home.nav.redeem':'Danke-Code einlösen','home.nav.cta':'Offerte anfragen','home.hero.trust1':'⭐ 5.0 Google','home.hero.trust2':'24h Anfrage','home.hero.trust3':'Unverbindliche Kurzofferte','home.hero.pill':'Jung. Schnell. Sichtbar sauber.','home.hero.mini1Title':'Fenster','home.hero.mini1Text':'streifenarm und klar','home.hero.mini2Title':'Storen','home.hero.mini2Text':'frisch statt grau','home.hero.mini3Title':'Dachrinnen','home.hero.mini3Text':'frei und sauber',
    'home.story.kicker':'Die Story','home.story.title':'Noah & Timo. Zwei Studenten, ein klares Ziel.','home.story.p1':'Gestartet mit kleinen Fensterreinigungen und Aussenreinigungen. Geblieben wegen dem Gefühl, wenn Kunden nachher sagen: «Wow, das sieht wieder richtig frisch aus.»','home.story.p2':'Lumian Services ist jung, direkt und unkompliziert: Fenster putzen, Storen reinigen, Dachrinnen freimachen, Balkon, Terrasse und Aussenflächen sauber liefern. Keine grosse Show. Nur ein Ergebnis, das man sofort sieht.','home.story.noahName':'Noah','home.story.timoName':'Timo',
    'home.referral.kicker':'Danke-Programm','home.referral.title':'Empfehlen soll sich gut anfühlen.','home.referral.text':'Ihre Empfehlung ist für uns das schönste Kompliment. Deshalb bedanken wir uns mit unserem Lumian Danke-Programm.','home.referral.highlight':'Wenn Sie Lumian Services weiterempfehlen und daraus ein bezahlter Auftrag entsteht, erhalten Sie als Dankeschön eine persönliche Aufmerksamkeit. Auch Ihr empfohlener Kontakt profitiert bei der ersten passenden Buchung.','home.referral.ticketTitle':'Danke-Code','home.referral.ticketValue':'z.B. CHF 50 Vorteil','home.referral.ticketCondition':'für Neukunden bei Aufträgen ab CHF 300','home.referral.smallPrint':'Das Dankeschön kann als Rabatt, Migros Gutschein, Coop Gutschein, Lidl Gutschein oder als kleine Aufmerksamkeit erfolgen. Nicht bar auszahlbar. Details je nach Aktion.',
    'home.services.kicker':'Angebot','home.services.title':'Glanz draussen. Ruhe drinnen.','home.services.intro':'Für Wohnungen, Einfamilienhäuser, Balkone, Terrassen, Wintergärten, Fassadenbereiche und kleinere Gewerbeflächen in Aargau, Zürich, Zug, Luzern und Umgebung.',
    'home.services.1.title':'Fensterreinigung','home.services.1.text':'Fenster innen und aussen, Rahmen, Simse und Glasflächen. Streifenarme Fensterreinigung und Glasreinigung für Wohnungen, Häuser und kleinere Gewerbeflächen.','home.services.2.title':'Storen & Rollläden','home.services.2.text':'Storenreinigung und Rollladenreinigung gegen Staub, Pollen, Spinnweben und graue Ablagerungen, damit Fensterbereiche wieder gepflegt aussehen.','home.services.3.title':'Dachrinnen','home.services.3.text':'Dachrinnenreinigung und kleine Dachreinigung auf Anfrage: Laub, Moos und Ablagerungen entfernen, damit Wasser wieder sauber abläuft.','home.services.4.title':'Terrasse & Balkon','home.services.4.text':'Terrassenreinigung, Balkonreinigung, Geländer, Glas und Aussenbereich. Ideal vor Besuch, Sommer, Wohnungsübergabe oder Umzugsreinigung.','home.services.5.title':'Aussenreinigung','home.services.5.text':'Fassadennahe Flächen, Eingänge, Wege, Steinflächen, Solarpanel- und PV-Reinigung sowie kleine Spezialaufträge auf Anfrage.','home.services.6.title':'Quick Check','home.services.6.text':'Fotos senden, Ort nennen, Fensterzahl, Fläche oder Verschmutzung kurz beschreiben. Wir melden uns schnell mit einer Einschätzung.',
    'home.gallery.kicker':'Galerie','home.gallery.title':'So sieht sauber aus.','home.gallery.intro':'Echte Eindrücke aus Fensterreinigung, Storenreinigung, Balkonreinigung, Terrassenreinigung und Aussenreinigung.',
    'home.booking.kicker':'Buchen','home.booking.title':'Reinigungsanfrage in 60 Sekunden senden.','home.booking.intro':'Kurz Name, Ort und Anliegen senden. Die Anfrage öffnet WhatsApp mit allen Angaben. Lumian meldet sich persönlich, prüft Aufwand, Preis und Termin und bestätigt den Auftrag erst danach.','home.booking.refTitle':'Danke-Code erhalten?','home.booking.refText':'Wenn Sie einen Danke-Code oder Empfehlungslink erhalten haben, starten Sie hier Ihre Anfrage. Der Code wird auf der nächsten Seite automatisch erkannt oder kann manuell eingetragen werden.','home.booking.refButton':'Anfrage mit Danke-Code starten','home.booking.refHref':'empfehlung/','home.booking.bullet1':'Fotos können danach einfach per WhatsApp gesendet werden.','home.booking.bullet2':'Termin wird nach Rückbestätigung fixiert.','home.booking.bullet3':'Keine Online Zahlung nötig.','home.booking.submit':'Anfrage per WhatsApp senden','home.booking.note':'Die Anfrage ist unverbindlich. Wenn ein Empfehlungscode vorhanden ist, wird er automatisch mitgesendet.',
    'home.area.kicker':'Gebiet','home.area.title':'Zug, Luzern & Umgebung.','home.area.text':'Lumian Services arbeitet auf Anfrage in Aargau, Zürich, Zug, Luzern, Lenzburg, Aarau, Baden, Brugg, Wohlen, Othmarsingen und Umgebung. Fotos senden, Standort nennen. Wir prüfen, ob es passt.',
    'home.faq.kicker':'FAQ','home.faq.title':'Kurz beantwortet.','home.faq.intro':'Die wichtigsten Fragen zu Fensterreinigung, Dachrinnen, Storen, Aussenreinigung und Offerten.','home.faq.1.q':'Wie schnell bekomme ich eine Offerte?','home.faq.1.a':'Meist reicht eine kurze Beschreibung mit Fotos. Danach melden wir uns so schnell wie möglich mit einer Einschätzung oder Rückfrage.','home.faq.2.q':'Muss ich online zahlen?','home.faq.2.a':'Nein. Aktuell läuft die Bezahlung nach Absprache, zum Beispiel per TWINT, bar oder Rechnung, je nach Auftrag.','home.faq.3.q':'Ist der gebuchte Slot fix?','home.faq.3.a':'Der Slot ist eine Reservation. Fix wird der Termin, sobald Lumian Services ihn per WhatsApp, SMS, Telefon oder Mail bestätigt.','home.faq.4.q':'Was muss ich vorbereiten?','home.faq.4.a':'Am besten Fensterbereiche frei machen, Zugang klären und spezielle Stellen kurz fotografieren. Den Rest besprechen wir einfach vorher.','home.faq.5.q':'Reinigt ihr auch Storen und Dachrinnen?','home.faq.5.a':'Ja. Fensterreinigung, Glasreinigung, Storen, Rollläden, Dachrinnen, Balkon, Terrasse, fassadennahe Aussenreinigung und kleine Dach- oder Solarpanel-Reinigungen auf Anfrage gehören zu den Hauptservices.','home.faq.6.q':'Was ist das Lumian Danke-Programm?','home.faq.6.a':'Wenn Sie mit unserer Arbeit zufrieden sind und uns weiterempfehlen, können Sie einen persönlichen Danke-Code erhalten. Ihr Kontakt profitiert bei der ersten passenden Buchung und Sie erhalten nach einem erfolgreichen Auftrag ein kleines Dankeschön.','home.final.title':'Fenster wieder klar. Dachrinnen wieder frei. Aussenbereiche wieder frisch.','home.final.button':'Jetzt anfragen','home.final.href':'#booking','home.app.kicker':'Als App speichern','home.app.title':'Lumian direkt auf dem Home-Bildschirm.','home.app.text':'Speichern Sie die Website wie eine App auf dem Smartphone. So sind Kontakt, Offerte und WhatsApp immer schnell erreichbar.','home.app.button':'App-Hinweis anzeigen',
    'referral.kicker':'Empfehlung','referral.title':'Danke-Code erhalten?','referral.lead':'Willkommen bei Lumian Services. Wenn Sie einen Danke-Code oder Empfehlungslink erhalten haben, wird der Code automatisch übernommen. Senden Sie uns kurz Ihre Angaben — wir melden uns persönlich per WhatsApp oder Telefon.','referral.missingTitle':'Kein Code erkannt?','referral.missingText':'Tragen Sie den Empfehlungs-/Danke-Code unten ein, falls Sie ihn separat erhalten haben.','referral.flowTitle':'So läuft es:','referral.flowText':'Anfrage senden → Lumian meldet sich → Termin & Preis werden persönlich bestätigt.','referral.headerBrand':'Lumian Services','referral.backText':'Zur Website','referral.backHref':'../index.html','referral.detectedTitle':'Empfehlungs-/Danke-Code erkannt','referral.detectedNote':'Dieser Code wird mit Ihrer Anfrage mitgesendet.','referral.bullet1':'Keine Online-Zahlung.','referral.bullet2':'Fotos können danach per WhatsApp gesendet werden.','referral.bullet3':'Termin erst nach persönlicher Bestätigung fix.','referral.submitText':'Anfrage per WhatsApp senden','referral.formNote':'WhatsApp öffnet sich mit allen Angaben inklusive Empfehlungs-/Danke-Code.',
    'imprint.kicker':'Rechtliches','imprint.title':'Impressum','imprint.providerTitle':'Anbieter und Kontaktadresse','imprint.businessName':'Lumian Services','imprint.owner':'Fares Aburok','imprint.legalForm':'Einzelunternehmen','imprint.street':'Wilhalde 8A','imprint.city':'5504 Othmarsingen','imprint.country':'Schweiz',
    'imprint.purposeTitle':'Inhalt und Zweck dieser Website','imprint.purpose1':'Diese Website informiert über die Dienstleistungen von Lumian Services. Dazu gehören insbesondere Fensterreinigung, Storenreinigung, Rollladenreinigung, Dachrinnenreinigung, Balkonreinigung, Terrassenreinigung und weitere Arbeiten im Aussenbereich.','imprint.purpose2':'Anfragen können über WhatsApp, Telefon, E-Mail oder über das Formular auf der Website gestellt werden. Eine Anfrage ist noch kein verbindlicher Auftrag. Ein Termin und ein Preis gelten erst dann als bestätigt, wenn Lumian Services dies ausdrücklich bestätigt.',
    'imprint.pricesTitle':'Preise, Angebote und Verfügbarkeit','imprint.prices1':'Preisangaben, Beispiele, Aktionen und Verfügbarkeiten auf dieser Website sind ohne ausdrückliche Bestätigung unverbindlich. Der effektive Preis hängt vom Objekt, von der Zugänglichkeit, vom Verschmutzungsgrad, vom Sicherheitsaufwand und vom gewünschten Leistungsumfang ab.','imprint.prices2':'Individuelle Offerten werden nach Möglichkeit auf Basis von Fotos, Beschreibung und Standort erstellt. Bei unklaren Angaben kann eine Besichtigung oder eine Rückfrage nötig sein.',
    'imprint.contentTitle':'Haftung für Inhalte','imprint.content1':'Die Inhalte dieser Website werden sorgfältig erstellt und regelmässig geprüft. Trotzdem kann Lumian Services keine Gewähr für Vollständigkeit, Richtigkeit und Aktualität übernehmen.','imprint.content2':'Änderungen an Texten, Leistungen, Preisen und Verfügbarkeiten sind jederzeit möglich.','imprint.linksTitle':'Haftung für externe Links','imprint.links1':'Diese Website kann Links zu externen Angeboten enthalten, zum Beispiel zu WhatsApp, Telefonfunktionen, E-Mail Programmen oder später zu einem Buchungstool. Für Inhalte und Datenschutz dieser externen Anbieter ist der jeweilige Anbieter verantwortlich.',
    'imprint.copyrightTitle':'Urheberrechte','imprint.copyright1':'Texte, Bilder, Logos, Gestaltung und sonstige Inhalte dieser Website gehören Lumian Services oder werden mit entsprechender Berechtigung verwendet. Eine Verwendung, Kopie oder Veröffentlichung ist nur mit vorheriger Zustimmung erlaubt.','imprint.copyright2':'Bilder von Kundenobjekten werden nur zu Präsentationszwecken verwendet. Wenn ein Bild entfernt oder zusätzlich anonymisiert werden soll, genügt eine kurze Nachricht an Lumian Services.','imprint.privacyTitle':'Datenschutz','imprint.privacyText':'Informationen zur Bearbeitung von Personendaten stehen in der',
    'privacy.kicker':'Datenschutz','privacy.title':'Datenschutzerklärung','privacy.s1Title':'1. Verantwortliche Stelle','privacy.s1p1':'Verantwortlich für die Bearbeitung von Personendaten ist Lumian Services, Inhaber Fares Aburok. Die vollständige Kontaktadresse steht im','privacy.s1p2':'Für Datenschutzanfragen erreichen Sie uns per E-Mail oder telefonisch:',
    'privacy.s2Title':'2. Welche Daten wir bearbeiten','privacy.s2p1':'Wir bearbeiten Daten, die Sie uns freiwillig senden. Dazu gehören zum Beispiel Name, Telefonnummer, E-Mail Adresse, Ort, gewünschte Dienstleistung, Terminwunsch, Nachrichtentext und Fotos, die Sie uns für eine Offerte oder Rückfrage senden.','privacy.s2p2':'Beim Besuch der Website können technische Daten anfallen. Dazu gehören zum Beispiel IP Adresse, Datum und Uhrzeit des Zugriffs, verwendeter Browser, Betriebssystem und aufgerufene Seiten. Diese Daten helfen, die Website sicher und stabil zu betreiben.',
    'privacy.s3Title':'3. Warum wir Daten bearbeiten','privacy.s3p1':'Wir verwenden Ihre Angaben, um Anfragen zu beantworten, Offerten zu erstellen, Termine zu koordinieren, Aufträge auszuführen, Rückfragen zu klären und das Referral Programm abzuwickeln.','privacy.s3p2':'Wir bearbeiten nur Daten, die für diese Zwecke sinnvoll oder notwendig sind.',
    'privacy.s4Title':'4. Kontakt über WhatsApp, Telefon und E-Mail','privacy.s4p1':'Wenn Sie uns per WhatsApp, Telefon oder E-Mail kontaktieren, werden die von Ihnen übermittelten Daten über den jeweiligen Anbieter verarbeitet. Bitte senden Sie nur Informationen und Bilder, die für Ihre Anfrage nötig sind.',
    'privacy.s5Title':'5. Hosting und technische Dienstleister','privacy.s5p1':'Diese Website kann über GitHub Pages oder einen ähnlichen statischen Hosting Dienst betrieben werden. Dabei können technische Zugriffsdaten durch den Hosting Anbieter verarbeitet werden.','privacy.s5p2':'Falls später externe Buchungstools, Karten, Analytics oder weitere Dienste eingebunden werden, wird diese Datenschutzerklärung angepasst.',
    'privacy.s6Title':'6. Cookies und Tracking','privacy.s6p1':'Diese Website ist bewusst schlank aufgebaut. Lumian Services setzt aktuell keine eigenen Marketing Cookies, kein Google Analytics und kein Tracking ein.','privacy.s6p2':'Falls später externe Tools eingebunden werden, können diese Anbieter Cookies oder ähnliche Technologien verwenden.',
    'privacy.s7Title':'7. Referral Programm','privacy.s7p1':'Für Referral Codes bearbeiten wir die Angaben, die nötig sind, um eine Empfehlung einem Auftrag zuzuordnen und einen möglichen Vorteil korrekt auszugeben.','privacy.s7p2':'Eine Barauszahlung besteht nicht, sofern nichts anderes ausdrücklich schriftlich vereinbart wurde.',
    'privacy.s8Title':'8. Weitergabe von Daten','privacy.s8p1':'Wir geben Personendaten nur weiter, wenn dies für die Bearbeitung einer Anfrage, die Ausführung eines Auftrags, den Betrieb der Website, gesetzliche Pflichten oder berechtigte Interessen notwendig ist.','privacy.s8p2':'Eine Weitergabe zu fremden Werbezwecken findet nicht statt.',
    'privacy.s9Title':'9. Aufbewahrung','privacy.s9p1':'Wir bewahren Personendaten nur so lange auf, wie es für die Bearbeitung der Anfrage, die Ausführung des Auftrags, gesetzliche Pflichten oder berechtigte Geschäftsinteressen nötig ist.',
    'privacy.s10Title':'10. Ihre Rechte','privacy.s10p1':'Sie können Auskunft über Ihre Personendaten verlangen. Soweit gesetzlich vorgesehen, können Sie auch Berichtigung, Löschung oder Einschränkung der Bearbeitung verlangen.','privacy.s10p2':'Kontaktieren Sie uns dafür über die oben genannte E-Mail Adresse.',
    'privacy.s11Title':'11. Änderungen','privacy.s11p1':'Wir können diese Datenschutzerklärung jederzeit anpassen. Es gilt die jeweils auf dieser Website veröffentlichte Version.','privacy.s11p2':'Stand: Juli 2026','privacy.localTitle':'Cookie-Hinweise und lokale Speicherung','privacy.local1':'Wir verwenden keine eigenen Marketing-Cookies und kein Tracking. Damit der Cookie-Hinweis nicht bei jedem Besuch erneut erscheint, speichern wir lokal im Browser die Information, dass der Hinweis verstanden wurde. Diese Speicherung dient nur der Bedienbarkeit der Website.','privacy.local2':'Weitere Informationen finden Sie in den',
    'cookies.kicker':'Cookies','cookies.title':'Cookie-Hinweise','cookies.s1Title':'Technisch notwendige Speicherung','cookies.s1p1':'Diese Website ist bewusst schlank aufgebaut. Lumian Services setzt keine Werbe-Cookies, kein Tracking und kein Google Analytics ein.','cookies.s1p2':'Damit der Cookie-Hinweis nicht bei jedem Besuch erneut erscheint, speichern wir lokal im Browser die Information, dass der Hinweis verstanden wurde. Diese Speicherung dient nur der Bedienbarkeit der Website.','cookies.s2Title':'Lokale App-Funktion','cookies.s2p1':'Wenn Sie Lumian Services auf dem Smartphone zum Home-Bildschirm hinzufügen, kann der Browser einzelne Dateien zwischenspeichern, damit die Website schneller startet und bei schlechter Verbindung besser reagiert.','cookies.s3Title':'Externe Dienste','cookies.s3p1':'Beim Kontakt über WhatsApp, Telefon oder E-Mail gelten zusätzlich die Bedingungen und Datenschutzhinweise der jeweiligen Anbieter. Externe Buchungstools oder Statistikdienste sind aktuell nicht eingebunden.','cookies.s4Title':'Änderungen','cookies.s4p1':'Falls später Statistik, Marketing oder externe Buchungstools eingebunden werden, werden diese Hinweise und die Datenschutzerklärung entsprechend angepasst.','cookies.s4p2':'Stand: Juli 2026',
    'global.phoneHuman':'+41 77 279 47 07','global.phoneTel':'tel:+41772794707','global.email':'info@lumianservices.ch','global.emailHref':'mailto:info@lumianservices.ch','home.area.whatsappText':'WhatsApp öffnen','global.whatsappText':'WhatsApp','global.whatsappHref':'https://wa.me/41772794707','global.footerText':'Lumian Services. Reinigung mit frischem Anspruch.','global.footerContactTitle':'Kontakt','global.footerLegalTitle':'Rechtliches','global.footerImprintText':'Impressum','global.footerImprintHref':'impressum.html','global.footerPrivacyText':'Datenschutz','global.footerPrivacyHref':'datenschutz.html','global.footerCookiesText':'Cookies','global.footerCookiesHref':'cookies.html','global.footerBookingText':'Buchungshinweise','global.footerBookingHref':'buchung.html','global.copyright':'© 2026 Lumian Services. Alle Rechte vorbehalten.'
  };
  const DEFAULT_WEBSITE_MEDIA = {
    'home.hero.image':{ src:'https://lumianservices.ch/assets/img/lumian-logo-hero.png', name:'Hero Logo' },
    'global.logo':{ src:'https://lumianservices.ch/assets/img/lumian-logo-dark.png', name:'Lumian Logo dunkel' },
    'home.story.noahImage':{ src:'https://lumianservices.ch/assets/img/founders/noah.png', name:'Noah' },
    'home.story.timoImage':{ src:'https://lumianservices.ch/assets/img/founders/timo.png', name:'Timo' }
  };

  const LEGACY_LEGAL_WEBSITE_VALUES_V103 = {"imprint.kicker":"Rechtliches","imprint.title":"Impressum","imprint.providerTitle":"Anbieter und Kontaktadresse","imprint.businessName":"Lumian Services","imprint.owner":"Fares Aburok","imprint.legalForm":"Einzelunternehmen","imprint.street":"Wilhalde 8A","imprint.city":"5504 Othmarsingen","imprint.country":"Schweiz","imprint.purposeTitle":"Inhalt und Zweck dieser Website","imprint.purpose1":"Diese Website informiert über die Dienstleistungen von Lumian Services. Dazu gehören insbesondere Fensterreinigung, Storenreinigung, Rollladenreinigung, Dachrinnenreinigung, Balkonreinigung, Terrassenreinigung und weitere Arbeiten im Aussenbereich.","imprint.purpose2":"Anfragen können über WhatsApp, Telefon, E-Mail oder über das Formular auf der Website gestellt werden. Eine Anfrage ist noch kein verbindlicher Auftrag. Ein Termin und ein Preis gelten erst dann als bestätigt, wenn Lumian Services dies ausdrücklich bestätigt.","imprint.pricesTitle":"Preise, Angebote und Verfügbarkeit","imprint.prices1":"Preisangaben, Beispiele, Aktionen und Verfügbarkeiten auf dieser Website sind ohne ausdrückliche Bestätigung unverbindlich. Der effektive Preis hängt vom Objekt, von der Zugänglichkeit, vom Verschmutzungsgrad, vom Sicherheitsaufwand und vom gewünschten Leistungsumfang ab.","imprint.prices2":"Individuelle Offerten werden nach Möglichkeit auf Basis von Fotos, Beschreibung und Standort erstellt. Bei unklaren Angaben kann eine Besichtigung oder eine Rückfrage nötig sein.","imprint.contentTitle":"Haftung für Inhalte","imprint.content1":"Die Inhalte dieser Website werden sorgfältig erstellt und regelmässig geprüft. Trotzdem kann Lumian Services keine Gewähr für Vollständigkeit, Richtigkeit und Aktualität übernehmen.","imprint.content2":"Änderungen an Texten, Leistungen, Preisen und Verfügbarkeiten sind jederzeit möglich.","imprint.linksTitle":"Haftung für externe Links","imprint.links1":"Diese Website kann Links zu externen Angeboten enthalten, zum Beispiel zu WhatsApp, Telefonfunktionen, E-Mail Programmen oder später zu einem Buchungstool. Für Inhalte und Datenschutz dieser externen Anbieter ist der jeweilige Anbieter verantwortlich.","imprint.copyrightTitle":"Urheberrechte","imprint.copyright1":"Texte, Bilder, Logos, Gestaltung und sonstige Inhalte dieser Website gehören Lumian Services oder werden mit entsprechender Berechtigung verwendet. Eine Verwendung, Kopie oder Veröffentlichung ist nur mit vorheriger Zustimmung erlaubt.","imprint.copyright2":"Bilder von Kundenobjekten werden nur zu Präsentationszwecken verwendet. Wenn ein Bild entfernt oder zusätzlich anonymisiert werden soll, genügt eine kurze Nachricht an Lumian Services.","imprint.privacyTitle":"Datenschutz","imprint.privacyText":"Informationen zur Bearbeitung von Personendaten stehen in der","privacy.kicker":"Datenschutz","privacy.title":"Datenschutzerklärung","privacy.s1Title":"1. Verantwortliche Stelle","privacy.s1p1":"Verantwortlich für die Bearbeitung von Personendaten ist Lumian Services, Inhaber Fares Aburok. Die vollständige Kontaktadresse steht im","privacy.s1p2":"Für Datenschutzanfragen erreichen Sie uns per E-Mail oder telefonisch:","privacy.s2Title":"2. Welche Daten wir bearbeiten","privacy.s2p1":"Wir bearbeiten Daten, die Sie uns freiwillig senden. Dazu gehören zum Beispiel Name, Telefonnummer, E-Mail Adresse, Ort, gewünschte Dienstleistung, Terminwunsch, Nachrichtentext und Fotos, die Sie uns für eine Offerte oder Rückfrage senden.","privacy.s2p2":"Beim Besuch der Website können technische Daten anfallen. Dazu gehören zum Beispiel IP Adresse, Datum und Uhrzeit des Zugriffs, verwendeter Browser, Betriebssystem und aufgerufene Seiten. Diese Daten helfen, die Website sicher und stabil zu betreiben.","privacy.s3Title":"3. Warum wir Daten bearbeiten","privacy.s3p1":"Wir verwenden Ihre Angaben, um Anfragen zu beantworten, Offerten zu erstellen, Termine zu koordinieren, Aufträge auszuführen, Rückfragen zu klären und das Referral Programm abzuwickeln.","privacy.s3p2":"Wir bearbeiten nur Daten, die für diese Zwecke sinnvoll oder notwendig sind.","privacy.s4Title":"4. Kontakt über WhatsApp, Telefon und E-Mail","privacy.s4p1":"Wenn Sie uns per WhatsApp, Telefon oder E-Mail kontaktieren, werden die von Ihnen übermittelten Daten über den jeweiligen Anbieter verarbeitet. Bitte senden Sie nur Informationen und Bilder, die für Ihre Anfrage nötig sind.","privacy.s5Title":"5. Hosting und technische Dienstleister","privacy.s5p1":"Diese Website kann über GitHub Pages oder einen ähnlichen statischen Hosting Dienst betrieben werden. Dabei können technische Zugriffsdaten durch den Hosting Anbieter verarbeitet werden.","privacy.s5p2":"Falls später externe Buchungstools wie Calendly oder Cal.com, Karten, Analytics oder weitere Dienste eingebunden werden, wird diese Datenschutzerklärung angepasst.","privacy.s6Title":"6. Cookies und Tracking","privacy.s6p1":"Diese Website ist bewusst schlank aufgebaut. Lumian Services setzt aktuell keine eigenen Marketing Cookies, kein Google Analytics und kein Tracking ein.","privacy.s6p2":"Falls später externe Tools eingebunden werden, können diese Anbieter Cookies oder ähnliche Technologien verwenden.","privacy.s7Title":"7. Referral Programm","privacy.s7p1":"Für Referral Codes bearbeiten wir die Angaben, die nötig sind, um eine Empfehlung einem Auftrag zuzuordnen und einen möglichen Vorteil korrekt auszugeben.","privacy.s7p2":"Eine Barauszahlung besteht nicht, sofern nichts anderes ausdrücklich schriftlich vereinbart wurde.","privacy.s8Title":"8. Weitergabe von Daten","privacy.s8p1":"Wir geben Personendaten nur weiter, wenn dies für die Bearbeitung einer Anfrage, die Ausführung eines Auftrags, den Betrieb der Website, gesetzliche Pflichten oder berechtigte Interessen notwendig ist.","privacy.s8p2":"Eine Weitergabe zu fremden Werbezwecken findet nicht statt.","privacy.s9Title":"9. Aufbewahrung","privacy.s9p1":"Wir bewahren Personendaten nur so lange auf, wie es für die Bearbeitung der Anfrage, die Ausführung des Auftrags, gesetzliche Pflichten oder berechtigte Geschäftsinteressen nötig ist.","privacy.s10Title":"10. Ihre Rechte","privacy.s10p1":"Sie können Auskunft über Ihre Personendaten verlangen. Soweit gesetzlich vorgesehen, können Sie auch Berichtigung, Löschung oder Einschränkung der Bearbeitung verlangen.","privacy.s10p2":"Kontaktieren Sie uns dafür über die oben genannte E-Mail Adresse.","privacy.s11Title":"11. Änderungen","privacy.s11p1":"Wir können diese Datenschutzerklärung jederzeit anpassen. Es gilt die jeweils auf dieser Website veröffentlichte Version.","privacy.s11p2":"Stand: Juli 2026","privacy.localTitle":"Cookie-Hinweise und lokale Speicherung","privacy.local1":"Wir verwenden keine eigenen Marketing-Cookies und kein Tracking. Damit der Cookie-Hinweis nicht bei jedem Besuch erneut erscheint, speichern wir lokal im Browser die Information, dass der Hinweis verstanden wurde. Diese Speicherung dient nur der Bedienbarkeit der Website.","privacy.local2":"Weitere Informationen finden Sie in den","cookies.kicker":"Cookies","cookies.title":"Cookie-Hinweise","cookies.s1Title":"Technisch notwendige Speicherung","cookies.s1p1":"Diese Website ist bewusst schlank aufgebaut. Lumian Services setzt keine Werbe-Cookies, kein Tracking und kein Google Analytics ein.","cookies.s1p2":"Damit der Cookie-Hinweis nicht bei jedem Besuch erneut erscheint, speichern wir lokal im Browser die Information, dass der Hinweis verstanden wurde. Diese Speicherung dient nur der Bedienbarkeit der Website.","cookies.s2Title":"Lokale App-Funktion","cookies.s2p1":"Wenn Sie Lumian Services auf dem Smartphone zum Home-Bildschirm hinzufügen, kann der Browser einzelne Dateien zwischenspeichern, damit die Website schneller startet und bei schlechter Verbindung besser reagiert.","cookies.s3Title":"Externe Dienste","cookies.s3p1":"Beim Kontakt über WhatsApp, Telefon oder E-Mail gelten zusätzlich die Bedingungen und Datenschutzhinweise der jeweiligen Anbieter. Externe Buchungstools oder Statistikdienste sind aktuell nicht eingebunden.","cookies.s4Title":"Änderungen","cookies.s4p1":"Falls später Statistik, Marketing oder externe Buchungstools eingebunden werden, werden diese Hinweise und die Datenschutzerklärung entsprechend angepasst.","cookies.s4p2":"Stand: Juli 2026"};
  const LEGAL_WEBSITE_VALUES_V104 = {"imprint.kicker":"Rechtliches","imprint.title":"Impressum","imprint.providerTitle":"Anbieter und Kontaktadresse","imprint.businessName":"Lumian Services","imprint.owner":"Fares Aburok","imprint.legalForm":"Einzelunternehmen","imprint.street":"Wilhalde 8A","imprint.city":"5504 Othmarsingen","imprint.country":"Schweiz","imprint.purposeTitle":"Angebot und Zweck der Website","imprint.purpose1":"Diese Website informiert über die Reinigungs- und Unterhaltsdienstleistungen von Lumian Services, insbesondere Fenster-, Storen-, Rollladen-, Dachrinnen-, Balkon-, Terrassen- und weitere Reinigungsarbeiten im Aussenbereich.","imprint.purpose2":"Anfragen über Website, WhatsApp, Telefon oder E-Mail sind unverbindlich. Ein Auftrag, ein Termin und ein Preis gelten erst als vereinbart, wenn Lumian Services die Anfrage ausdrücklich bestätigt. Individuelle Absprachen und die bestätigte Offerte gehen allgemeinen Website-Angaben vor.","imprint.pricesTitle":"Preise, Offerten und Verfügbarkeit","imprint.prices1":"Preisbeispiele, Aktionen, Rabatte und Verfügbarkeitsangaben auf dieser Website sind freibleibend, sofern sie nicht ausdrücklich als verbindlich bezeichnet werden. Der endgültige Preis richtet sich insbesondere nach Objekt, Fläche, Zugänglichkeit, Verschmutzungsgrad, Sicherheitsaufwand, Materialbedarf und Leistungsumfang.","imprint.prices2":"Offerten können auf Basis der übermittelten Angaben und Fotos erstellt werden. Stellt sich vor Ort heraus, dass die tatsächlichen Verhältnisse wesentlich abweichen, informiert Lumian Services den Kunden vor zusätzlichen oder geänderten Leistungen über eine erforderliche Anpassung.","imprint.contentTitle":"Haftung und Gewähr","imprint.content1":"Lumian Services erstellt und pflegt die Inhalte dieser Website mit angemessener Sorgfalt. Eine Gewähr für jederzeitige Verfügbarkeit sowie für die vollständige, fehlerfreie und stets aktuelle Darstellung wird jedoch nur im gesetzlich zulässigen Umfang übernommen.","imprint.content2":"Für Schäden aus der Nutzung oder vorübergehenden Nichtverfügbarkeit der Website wird die Haftung soweit gesetzlich zulässig ausgeschlossen. Zwingende gesetzliche Haftungsbestimmungen, insbesondere für vorsätzlich oder grobfahrlässig verursachte Schäden, bleiben vorbehalten.","imprint.linksTitle":"Externe Links und Dienste","imprint.links1":"Diese Website enthält Links oder Weiterleitungen zu externen Diensten, beispielsweise WhatsApp, Telefon-, E-Mail- oder Kartenfunktionen. Beim Aufruf verlassen Sie den Einflussbereich von Lumian Services. Für Inhalt, Verfügbarkeit und Datenbearbeitung des jeweiligen Drittanbieters ist dieser selbst verantwortlich.","imprint.copyrightTitle":"Urheberrechte und Bildmaterial","imprint.copyright1":"Texte, Bilder, Logos, Gestaltung, Daten und sonstige Inhalte dieser Website sind urheberrechtlich oder anderweitig geschützt und gehören Lumian Services oder werden mit entsprechender Berechtigung verwendet. Jede über den privaten Gebrauch hinausgehende Nutzung, Vervielfältigung, Bearbeitung oder Veröffentlichung bedarf der vorherigen Zustimmung.","imprint.copyright2":"Fotos von Kundenobjekten werden nur mit entsprechender Berechtigung und nach Möglichkeit ohne unnötige personenbezogene Merkmale veröffentlicht. Betroffene Personen können sich wegen Entfernung oder zusätzlicher Anonymisierung an Lumian Services wenden.","imprint.privacyTitle":"Datenschutz und anwendbares Recht","imprint.privacyText":"Für die Bearbeitung von Personendaten gilt die auf dieser Website veröffentlichte Datenschutzerklärung. Im Übrigen gilt schweizerisches Recht. Zwingende gesetzliche Gerichtsstände und Schutzbestimmungen bleiben vorbehalten. Weitere Informationen:","privacy.kicker":"Datenschutz","privacy.title":"Datenschutzerklärung","privacy.s1Title":"1. Verantwortliche Stelle und Kontakt","privacy.s1p1":"Verantwortlich für die Bearbeitung von Personendaten ist Lumian Services, Inhaber Fares Aburok, Wilhalde 8A, 5504 Othmarsingen, Schweiz. Die vollständigen Anbieterangaben stehen im","privacy.s1p2":"Datenschutzanfragen können an folgende Kontaktdaten gerichtet werden:","privacy.s2Title":"2. Umfang und Kategorien der bearbeiteten Daten","privacy.s2p1":"Wir bearbeiten diejenigen Personendaten, die Sie uns mitteilen oder die bei der Nutzung unserer Angebote anfallen. Dazu können Name, Telefonnummer, E-Mail-Adresse, Anschrift, gewünschte Dienstleistung, Terminangaben, Nachrichten, Empfehlungsdaten, Auftrags- und Zahlungsinformationen sowie Fotos eines Objekts gehören.","privacy.s2p2":"Beim Besuch der Website oder des geschützten Portals können technische Daten wie IP-Adresse, Datum und Uhrzeit, aufgerufene Seite, Browser, Betriebssystem, Geräteinformationen und Fehler- oder Sicherheitsprotokolle anfallen. Im Mitarbeiterportal werden zusätzlich Benutzerkonto, Rechte, Zuweisungen, Aktivitäten, Arbeitsstunden und Vergütungsinformationen verarbeitet.","privacy.s3Title":"3. Zwecke und Grundsätze der Bearbeitung","privacy.s3p1":"Wir bearbeiten Personendaten zur Beantwortung von Anfragen, Erstellung von Offerten, Terminplanung, Durchführung und Dokumentation von Aufträgen, Kundenbetreuung, Buchhaltung, Empfehlungsprogramm, Mitarbeiterkoordination, Sicherung des Betriebs sowie zur Erfüllung gesetzlicher Pflichten.","privacy.s3p2":"Die Bearbeitung erfolgt verhältnismässig und zweckgebunden, insbesondere zur Vertragsanbahnung und Vertragserfüllung, aufgrund gesetzlicher Pflichten, zur Wahrung berechtigter betrieblicher Interessen oder — soweit erforderlich — mit Einwilligung der betroffenen Person.","privacy.s4Title":"4. Kontakt, Formulare, WhatsApp und Fotos","privacy.s4p1":"Wenn Sie uns über ein Formular, WhatsApp, Telefon oder E-Mail kontaktieren, verarbeiten wir die übermittelten Angaben zur Bearbeitung Ihrer Anfrage. Bei WhatsApp und E-Mail werden Daten zusätzlich durch die jeweiligen Anbieter verarbeitet. Bitte übermitteln Sie nur erforderliche Angaben und keine besonders schützenswerten Informationen. Fotos sollten keine erkennbaren Personen, Nummernschilder, Dokumente oder sonstige unnötige personenbezogene Details zeigen.","privacy.s5Title":"5. Hosting und technische Zugriffsdaten","privacy.s5p1":"Die öffentliche Website wird als statische Website über GitHub Pages bereitgestellt. Der Hosting- und Infrastrukturbetreiber kann technisch notwendige Zugriffs- und Sicherheitsdaten verarbeiten. Diese Bearbeitung dient der sicheren, stabilen und effizienten Bereitstellung der Website.","privacy.s5p2":"Wir verwenden derzeit kein Google Analytics, keine Werbenetzwerke und kein eigenes verhaltensbasiertes Tracking. Externe Inhalte wie Karten werden nicht automatisch eingebettet, sondern grundsätzlich erst durch einen bewussten Klick auf einen entsprechenden Link aufgerufen.","privacy.s6Title":"6. Google-Dienste, Portal und Cloud-Speicherung","privacy.s6p1":"Zur operativen Verwaltung nutzen wir Google Apps Script, Google Sheets, Google Drive und Google Calendar. Dort können Kunden-, Lead-, Auftrags-, Mitarbeiter-, Foto-, Kalender-, Protokoll- und Buchhaltungsdaten gespeichert oder synchronisiert werden. Der Zugriff ist auf berechtigte Benutzer beschränkt.","privacy.s6p2":"Teile der Portaldaten werden zusätzlich lokal im Browser des verwendeten Geräts gespeichert und für Synchronisierung, Offline-Funktion, Backups und Konfliktvermeidung verarbeitet. Administratoren und Mitarbeiter sind verpflichtet, ihre Zugangsdaten und Geräte angemessen zu schützen.","privacy.s7Title":"7. Empfehlungsprogramm und veröffentlichte Bilder","privacy.s7p1":"Für Empfehlungs- und Danke-Codes bearbeiten wir die Daten, die erforderlich sind, um eine Empfehlung einem Kunden und Auftrag zuzuordnen, den Anspruch zu prüfen und einen Bonus oder Vorteil zu verwalten. Der Empfehlende erhält keine weitergehenden Informationen über den Neukunden oder dessen Auftrag.","privacy.s7p2":"Bilder für die Website oder Galerie werden nur mit entsprechender Berechtigung veröffentlicht. Erkennbare Personen werden grundsätzlich nur mit Einwilligung gezeigt. Ein Widerruf oder ein begründetes Löschbegehren kann über die oben genannten Kontaktdaten eingereicht werden.","privacy.s8Title":"8. Empfänger, Auftragsbearbeiter und Auslandbezug","privacy.s8p1":"Personendaten können an sorgfältig ausgewählte Dienstleister weitergegeben werden, soweit dies für Hosting, Kommunikation, Cloud-Speicherung, Kalender, IT-Support, Buchhaltung oder die Erfüllung eines Auftrags erforderlich ist. Diese Dienstleister dürfen Daten nur im Rahmen des jeweiligen Zwecks bearbeiten.","privacy.s8p2":"Einzelne Anbieter, insbesondere Google, GitHub, Meta/WhatsApp oder deren Unterauftragnehmer, können Daten auch ausserhalb der Schweiz bearbeiten. Wir achten auf die nach schweizerischem Datenschutzrecht erforderlichen Voraussetzungen, insbesondere anerkannte Angemessenheit, geeignete vertragliche Garantien oder eine gesetzliche Ausnahme.","privacy.s9Title":"9. Aufbewahrung und Löschung","privacy.s9p1":"Wir bewahren Personendaten nur so lange auf, wie dies für den jeweiligen Zweck, zur Durchsetzung oder Abwehr von Ansprüchen und zur Erfüllung gesetzlicher Pflichten erforderlich ist. Anfragen ohne Auftrag werden in der Regel gelöscht oder anonymisiert, sobald sie nicht mehr benötigt werden. Geschäfts- und Buchungsunterlagen werden entsprechend den gesetzlichen Aufbewahrungspflichten grundsätzlich zehn Jahre aufbewahrt.","privacy.s10Title":"10. Rechte betroffener Personen","privacy.s10p1":"Sie können im Rahmen des anwendbaren Datenschutzrechts insbesondere Auskunft über Ihre bearbeiteten Personendaten, Berichtigung unrichtiger Daten, Löschung oder Vernichtung, Einschränkung oder Unterlassung einer unzulässigen Bearbeitung sowie gegebenenfalls Herausgabe oder Übertragung Ihrer Daten verlangen.","privacy.s10p2":"Ein Begehren kann an die oben genannte E-Mail-Adresse gerichtet werden. Zur Verhinderung missbräuchlicher Auskünfte können wir einen geeigneten Identitätsnachweis verlangen. Gesetzliche Aufbewahrungspflichten und überwiegende berechtigte Interessen bleiben vorbehalten.","privacy.s11Title":"11. Datensicherheit und Änderungen","privacy.s11p1":"Wir treffen angemessene technische und organisatorische Massnahmen, um Personendaten vor unbefugtem Zugriff, Verlust, Missbrauch oder Veränderung zu schützen. Eine vollständig risikofreie Datenübertragung oder Speicherung kann jedoch nicht garantiert werden. Diese Datenschutzerklärung wird angepasst, wenn sich Bearbeitungen, Dienste oder rechtliche Anforderungen ändern.","privacy.s11p2":"Stand: 10. Juli 2026","privacy.localTitle":"Cookies, lokale Speicherung und PWA","privacy.local1":"Wir setzen keine Marketing- oder Analyse-Cookies ein. Für den Cookie-Hinweis, Referral-Code, Login-Sitzung, Portalbetrieb und die installierbare Web-App können technisch notwendige Cookies, Local Storage, Session Storage und Browser-Cache verwendet werden. Diese Informationen dienen der Bedienbarkeit, Sicherheit, Offline-Funktion und Synchronisierung.","privacy.local2":"Einzelheiten und Hinweise zur Löschung finden Sie in den","cookies.kicker":"Cookies & lokale Speicherung","cookies.title":"Cookie- und Speicherhinweise","cookies.s1Title":"Technisch notwendige Speicherung","cookies.s1p1":"Lumian Services verwendet aktuell keine Werbe-Cookies, kein Google Analytics und kein verhaltensbasiertes Tracking. Es werden nur technisch notwendige Speichermechanismen eingesetzt, damit Website und Portal zuverlässig funktionieren.","cookies.s1p2":"Für die Bestätigung des Cookie-Hinweises wird der Schlüssel „lumian_cookie_notice_ok_v1“ als Cookie und/oder im Local Storage gespeichert. Die vorgesehene Speicherdauer beträgt bis zu zwölf Monate. Dadurch erscheint der Hinweis nicht bei jedem Besuch erneut.","cookies.s2Title":"Session Storage, Portal und installierbare Web-App","cookies.s2p1":"Session Storage kann vorübergehend einen Empfehlungs-Code oder die aktive Portal-Sitzung speichern. Das geschützte Portal verwendet Local Storage für betriebliche Daten, Einstellungen, Offline-Arbeit und Synchronisierung. Ein Service Worker kann Website-Dateien im Browser-Cache speichern, damit die installierbare Web-App schneller startet und bei instabiler Verbindung nutzbar bleibt.","cookies.s3Title":"Externe Dienste und bewusste Weiterleitung","cookies.s3p1":"WhatsApp, E-Mail-, Telefon-, Karten- oder Google-Dienste werden nur genutzt, wenn Sie einen entsprechenden Link oder eine Funktion aktiv aufrufen beziehungsweise ein Formular absenden. Ab diesem Zeitpunkt gelten zusätzlich die Datenschutz- und Speicherregeln des jeweiligen Anbieters. Auf der öffentlichen Website sind derzeit keine externen Analyse- oder Werbeskripte eingebunden.","cookies.s4Title":"Verwaltung, Löschung und Änderungen","cookies.s4p1":"Sie können Cookies, Website-Daten, Local Storage und Cache jederzeit über die Datenschutz- oder Website-Einstellungen Ihres Browsers löschen oder blockieren. Einzelne Funktionen, insbesondere Login, Offline-Nutzung, gespeicherte Einstellungen oder Referral-Zuordnung, können danach eingeschränkt sein. Werden künftig nicht notwendige Analyse- oder Marketingtechnologien eingesetzt, werden diese Hinweise und — soweit erforderlich — die Auswahlmöglichkeiten vorab angepasst.","cookies.s4p2":"Stand: 10. Juli 2026"};
  Object.assign(DEFAULT_WEBSITE_VALUES, LEGAL_WEBSITE_VALUES_V104);
  function migrateLegalWebsiteValues(rawValues = {}) {
    const incoming = { ...(rawValues || {}) };
    Object.entries(LEGAL_WEBSITE_VALUES_V104).forEach(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(incoming, key) || incoming[key] === LEGACY_LEGAL_WEBSITE_VALUES_V103[key]) incoming[key] = value;
    });
    return incoming;
  }

  function canonicalWebsiteAssetUrl(value) {
    const src = String(value || '').trim();
    if (!src) return '';
    if (/^(data:|blob:)/i.test(src)) return src;
    if (/^https?:\/\//i.test(src)) return src.replace(/^https?:\/\/www\.lumianservices\.ch\//i, 'https://lumianservices.ch/');
    const clean = src.replace(/^\.\.\//, '').replace(/^\//, '');
    if (clean.startsWith('assets/')) return `https://lumianservices.ch/${clean}`;
    return src;
  }
  function approximateDataUrlBytes(dataUrl) {
    const value = String(dataUrl || '');
    const comma = value.indexOf(',');
    return comma < 0 ? 0 : Math.max(0, Math.round((value.length - comma - 1) * 0.75));
  }
  function humanFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024*1024) return `${Math.round(n/102.4)/10} KB`;
    return `${Math.round(n/1024/102.4)/10} MB`;
  }

  function defaultWebsiteContent() {
    return { values:{...DEFAULT_WEBSITE_VALUES}, media:JSON.parse(JSON.stringify(DEFAULT_WEBSITE_MEDIA)), gallery:JSON.parse(JSON.stringify(DEFAULT_GALLERY)), updatedAt:'', updatedBy:'' };
  }
  function normalizeWebsiteContent(raw = {}) {
    const base = defaultWebsiteContent();
    return {
      values:{...base.values,...migrateLegalWebsiteValues(raw.values || {})},
      media:Object.fromEntries(Object.entries({...base.media,...(raw.media || {})}).map(([key,item])=>{ const normalized = typeof item === 'string' ? { src:item } : (item || {}); return [key,{...normalized,src:canonicalWebsiteAssetUrl(normalized.src || normalized.url || '')}]; })),
      gallery:Array.isArray(raw.gallery) && raw.gallery.length ? raw.gallery.map((x,i)=>({ id:String(x.id || `g-${i+1}`), src:canonicalWebsiteAssetUrl(x.src || ''), title:String(x.title || ''), caption:String(x.caption || ''), dataUrl:x.dataUrl || '', name:x.name || '', size:Number(x.size || 0), width:Number(x.width || 0), height:Number(x.height || 0) })) : base.gallery.map(x=>({...x,src:canonicalWebsiteAssetUrl(x.src)})),
      updatedAt:raw.updatedAt || '', updatedBy:raw.updatedBy || ''
    };
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  let currentUser = sessionStorage.getItem(SESSION_KEY) || '';
  let activeTab = 'dashboard';
  const PAGE_SIZE = 10;
  let listPages = { today: 1, leads: 1, jobs: 1, customers: 1, income: 1, expenses: 1, activity: 1, rewards: 1 };
  let customerListMode = 'search';
  let stagedPhotos = { before: null, after: null };
  let editingCompensationLines = [];
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
      version: 10,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      users: USERS.map(u => normalizeEmployeeUser({ ...u, role:'admin', active:true, loginEnabled:true, employmentActive:true, employeeType:'fixed', passwordHash:'', salt:'', credentialId:'', credentialUserHandle:'', recoveryCode:`${u.name}-Reset-2026` }, u)),
      portalMode: 'test',
      goLiveAt: '',
      settings: { ...DEFAULT_SETTINGS },
      counters: { nextPerson: 1001, nextLead: 1, nextJob: 1, nextReward: 1, nextFinance: 1 },
      people: [],
      leads: [],
      jobs: [],
      rewards: [],
      finance: { manualIncome: [], expenses: [] },
      websiteContent: defaultWebsiteContent(),
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
    merged.version = 10;
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
      return normalizeEmployeeUser({ ...u, ...old, role:'admin', loginEnabled:old.loginEnabled !== false, employmentActive:true, recoveryCode:old.recoveryCode || s.settings?.recoveryCode || `${u.name}-Reset-2026` }, u);
    });
    const customUsers = incomingUsers
      .filter(u => u && u.id && !USERS.some(base => base.id === u.id))
      .map(u => normalizeEmployeeUser(u))
      .filter(u => u.id);
    merged.users = [...defaultUsers, ...customUsers];
    merged.people = Array.isArray(s.people) ? s.people.map(normalizePersonRecord) : [];
    merged.leads = Array.isArray(s.leads) ? s.leads.map(normalizeLeadRecord) : [];
    merged.jobs = Array.isArray(s.jobs) ? s.jobs.map(j => normalizeJobRecord(normalizeJobForNoUnpaidDone({ source:'', referredById:'', ...j }))) : [];
    merged.rewards = Array.isArray(s.rewards) ? s.rewards : [];
    // Protect the official LM/L/J/R numbering even when an older backup contains
    // stale counters. Existing records always determine the next free number.
    const maxNumber = (items, pattern, fallback) => (items || []).reduce((max, item) => {
      const match = String(item?.id || '').match(pattern);
      return match ? Math.max(max, Number(match[1]) || 0) : max;
    }, fallback);
    merged.counters.nextPerson = Math.max(merged.counters.nextPerson || 1001, maxNumber(merged.people, /^LM(\d+)$/i, 1000) + 1);
    merged.counters.nextLead = Math.max(merged.counters.nextLead || 1, maxNumber(merged.leads, /^L(\d+)$/i, 0) + 1);
    merged.counters.nextJob = Math.max(merged.counters.nextJob || 1, maxNumber(merged.jobs, /^J(\d+)$/i, 0) + 1);
    merged.counters.nextReward = Math.max(merged.counters.nextReward || 1, maxNumber(merged.rewards, /^R(\d+)$/i, 0) + 1);
    merged.finance = { manualIncome: [], expenses: [], ...(s.finance || {}) };
    if (!Array.isArray(merged.finance.manualIncome)) merged.finance.manualIncome = [];
    if (!Array.isArray(merged.finance.expenses)) merged.finance.expenses = [];
    merged.finance.expenses = merged.finance.expenses.map(x => ({ paymentStatus:x.paymentStatus || (x.automatic ? 'offen' : ''), ...x }));
    // Existing credited referral bonuses become visible in Buchhaltung as open, deferred costs.
    merged.rewards.forEach(r => {
      if (!r || !r.id || !r.status || r.status === 'offen') return;
      const id = `BONUS-${r.id}`;
      if (merged.finance.expenses.some(x => x.id === id && !x.deletedAt)) return;
      const receiver = merged.people.find(p => p.id === r.customerId) || {};
      const source = merged.people.find(p => p.id === r.fromPersonId) || {};
      merged.finance.expenses.push({
        id, sourceType:'referralReward', rewardId:r.id, automatic:true, category:'Kundenbonus & Empfehlungen', subtype:'Empfehlungsbonus',
        title:`Empfehlungsbonus ${receiver.name || r.customerId || ''} · Auftrag ${r.jobId || ''}`, amount:amountValue(r.amount || 0),
        jobId:r.jobId || '', personId:r.customerId || '', paymentStatus:r.status === 'eingelöst / ausbezahlt' ? 'bezahlt' : 'offen',
        date:String(r.redeemedAt || r.creditedAt || r.createdAt || new Date().toISOString()).slice(0,10),
        notes:`Empfehlung für ${source.name || r.fromPersonId || 'Neukunde'}`, createdAt:r.creditedAt || r.createdAt || new Date().toISOString(), createdBy:'system'
      });
    });
    reconcileRewardExpenseStates(merged);
    merged.websiteContent = normalizeWebsiteContent(s.websiteContent || {});
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
      [/lead in job|lead in auftrag/i, 'Lead in Auftrag umgewandelt', 'Jobs'],
      [/^job erstellt|^job gespeichert|^job$|^auftrag erstellt|^auftrag gespeichert/i, 'Auftrag gespeichert', 'Jobs'],
      [/^job geändert|^auftrag geändert/i, 'Auftrag geändert', 'Jobs'],
      [/job bezahlt|auftrag bezahlt|bezahlt\/abgeschlossen|complete paid/i, 'Auftrag bezahlt/abgeschlossen', 'Jobs'],
      [/job payment|auftrag.*zahlung offen|abschluss blockiert|payment still open|complete blocked/i, 'Auftrag Zahlung offen gelassen', 'Jobs'],
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
      [/user disable|benutzer deaktiviert|mitarbeiter deaktiviert/i, 'Mitarbeiter deaktiviert', 'Benutzer'],
      [/user save|benutzer gespeichert|mitarbeiter erstellt|mitarbeiter aktualisiert/i, 'Mitarbeiter gespeichert', 'Benutzer'],
      [/akquiseprovision|provision geändert/i, 'Akquiseprovision geändert', 'Buchhaltung'],
      [/customers import|kunden importiert/i, 'Kunden importiert', 'Import'],
      [/leads import|leads importiert/i, 'Leads importiert', 'Import'],
      [/website leads imported|website/i, 'Website-Leads importiert', 'Leads'],
      [/calendar sync/i, 'Kalender-Sync angefordert', 'Jobs']
    ];
    for (const [pattern, action, area] of rules) {
      if (pattern.test(r)) { meta.action = action; meta.area = area; break; }
    }
    // Prefer the stable business reference. This ensures Activities clearly show
    // Lead-, customer- and order numbers instead of generic words such as "Auftrag".
    const businessId = r.match(/\b(?:LM\d{3,}|L\d{3,}|J\d{3,}|F\d{3,}|R\d{3,})\b/i);
    const fallbackId = r.match(/:\s*([a-z0-9_-]{2,})\b/i);
    if (businessId) meta.objectId = businessId[0].toUpperCase();
    else if (fallbackId) meta.objectId = fallbackId[1];
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
      websiteContent: Date.parse(local.websiteContent?.updatedAt || '') >= Date.parse(cloud.websiteContent?.updatedAt || '') ? normalizeWebsiteContent(local.websiteContent || {}) : normalizeWebsiteContent(cloud.websiteContent || {}),
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
  function employeeById(id) { return state.users.find(u => u.id === id); }
  function jobTeamIds(job = {}) { return Array.from(new Set([job.assignedTo, ...(job.teamMemberIds || [])].filter(Boolean))); }
  function canViewLead(lead = {}, userId = currentUser) {
    if (!lead || !userId) return false;
    if (isAdmin(userId) || hasPermission('viewAllOperational', userId)) return true;
    if (canManageWebsiteLeads(userId) && (lead.websiteLeadKey || lead.createdBy === 'website')) return true;
    return [lead.createdBy, lead.updatedBy, lead.acquiredBy, lead.assignedTo].includes(userId);
  }
  function canEditLead(lead = {}, userId = currentUser) {
    if (isAdmin(userId) || hasPermission('viewAllOperational', userId)) return true;
    if (canManageWebsiteLeads(userId) && (lead.websiteLeadKey || lead.createdBy === 'website')) return true;
    return hasPermission('createLeads', userId) && [lead.createdBy, lead.acquiredBy, lead.assignedTo].includes(userId);
  }
  function canViewJob(job = {}, userId = currentUser) {
    if (!job || !userId) return false;
    if (isAdmin(userId) || hasPermission('viewAllOperational', userId)) return true;
    const operational = jobTeamIds(job).includes(userId) || job.createdBy === userId;
    const acquisitionView = job.acquiredBy === userId && hasPermission('viewOwnCompensation', userId);
    return operational || acquisitionView;
  }
  function canEditJob(job = {}, userId = currentUser) {
    if (isAdmin(userId)) return true;
    const operational = jobTeamIds(job).includes(userId) || job.createdBy === userId;
    return operational && (hasPermission('updateJobs', userId) || hasPermission('uploadPhotos', userId));
  }
  function canViewPerson(person = {}, userId = currentUser) {
    if (!person || !userId) return false;
    if (isAdmin(userId) || hasPermission('viewAllOperational', userId)) return true;
    return state.leads.some(l => l.personId === person.id && canViewLead(l, userId)) || state.jobs.some(j => j.personId === person.id && canViewJob(j, userId));
  }
  function visibleLeads() { return state.leads.filter(l => canViewLead(l)); }
  function visibleJobs() { return state.jobs.filter(j => canViewJob(j)); }
  function visibleCustomers() { return state.people.filter(p => p.status === 'customer' && canViewPerson(p)); }
  function allPeopleSorted() { return [...state.people].filter(p => canViewPerson(p) || isAdmin() || hasPermission('viewAllOperational')).sort((a,b)=>(a.name||'').localeCompare(b.name||'', 'de-CH')); }
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
      .filter(p => (isAdmin() || hasPermission('viewAllOperational') || canViewPerson(p)) && personSearchText(p).includes(needle))
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
    const loginOpts = loginUsers().map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)}${u.role === 'admin' ? ' · Admin' : ''}</option>`).join('');
    $$('[data-user-select]').forEach(sel => {
      const old = sel.value;
      sel.innerHTML = loginOpts;
      if (old && [...sel.options].some(o => o.value === old)) sel.value = old;
    });
    const employeeOpts = employeeUsers().map(u => `<option value="${esc(u.id)}">${esc(u.name || u.id)} · ${esc(roleLabel(u.role))}</option>`).join('');
    $$('[data-assigned-select],[data-employee-select]').forEach(sel => {
      const old = sel.value || currentUser;
      sel.innerHTML = `<option value="">– nicht zugewiesen –</option>${employeeOpts}`;
      if (old && [...sel.options].some(o => o.value === old)) sel.value = old;
    });
    renderTeamMemberOptions();
    renderExpenseEmployeeOptions($(`[data-expense-employee-select]`)?.value || '');
  }

  function renderTeamMemberOptions(selectedIds = null, primaryId = null) {
    const box = $('[data-team-member-options]');
    if (!box) return;
    const form = $('[data-job-form]');
    const primary = normalizeUserId(primaryId || form?.elements?.assignedTo?.value || '');
    const current = selectedIds || (editingCompensationLines || []).map(x=>x.employeeId);
    box.dataset.primaryId = primary;
    box.innerHTML = employeeUsers().map(u => {
      const isPrimary = u.id === primary;
      const checked = isPrimary || current.includes(u.id);
      return `<label class="employee-check ${isPrimary?'is-primary':''}"><input type="checkbox" name="teamMemberIds" value="${esc(u.id)}" ${checked?'checked':''} ${isPrimary?'disabled':''}><span>${esc(u.name || u.id)}</span><small>${isPrimary?'Hauptverantwortlich · ':''}${esc(roleLabel(u.role))}</small></label>`;
    }).join('');
    if (form && !isAdmin()) box.querySelectorAll('input').forEach(x => x.disabled = true);
  }
  $('[data-job-form] [name="assignedTo"]')?.addEventListener('change', event => {
    const box = $('[data-team-member-options]');
    if (!box) return;
    const previousPrimary = normalizeUserId(box.dataset.primaryId || '');
    const selected = Array.from(box.querySelectorAll('input:checked')).map(x => x.value).filter(id => id !== previousPrimary);
    renderTeamMemberOptions(selected, event.target.value);
    syncTeamCompensationFromSelection();
  });

  function renderPermissions() {
    const admin = isAdmin();
    $$('[data-tab]').forEach(btn => {
      const allowed = canAccessTab(btn.dataset.tab);
      btn.hidden = !allowed;
    });
    $$('[data-admin-only]').forEach(el => { el.hidden = !admin; });
    $$('[data-web-leads-permission]').forEach(el => { el.hidden = !canManageWebsiteLeads(); });
    if (!canManageWebsiteLeads()) { const status = $('[data-web-leads-status]'); if (status) status.hidden = true; }
    $('[data-settings-form]')?.classList.toggle('personal-settings-only', !admin);
    $('[data-panel="settings"]')?.classList.toggle('personal-settings-panel', !admin);
    $$('[data-open-lead]').forEach(el => { el.hidden = !(admin || hasPermission('createLeads')); });
    $$('[data-open-job]').forEach(el => { el.hidden = !canCreateJobs(); });
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
    $('[data-user-pill]').innerHTML = `<span>${esc(userEmoji(currentUser))}</span>${esc(u?.name || currentUser)} · ${esc(roleLabel(u?.role || 'staff'))}`;
    setTab(activeTab);
    setTimeout(setupSmartStickyNav, 120);
    if (isAdmin() && !renderLogin._checkedWebsiteLeads && getSetting('scriptUrl')) {
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
    if (!user || user.active === false || user.loginEnabled === false || user.employmentActive === false) return toast('Portal-Login ist für diesen Benutzer nicht aktiv.');
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
    const titles = { dashboard:'Übersicht', leads:'Leads', jobs:'Jobs', customers:'Kunden', finance:'Buchhaltung', rewards:'Bonus', employees:'Mitarbeiter', content:'Website-Inhalte', settings:'Einstellungen' };
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
    renderStats(); renderToday(); renderLeads(); renderJobs(); renderCustomers(); renderFinance(); renderRewards(); renderUsers(); renderWebsiteContentEditor(); fillSettings(false); updatePortalModeUi(); applySetupLocks(); compactPortalInfoTexts();
  }

  function renderStats() {
    const openLeadCount = activeLeads().filter(canViewLead).length;
    const openJobCount = visibleJobs().filter(isOpenJob).length;
    const customerCount = visibleCustomers().length;
    const openRewards = state.rewards.filter(r => r.status === 'offen').reduce((s,r)=>s+Number(r.amount||0),0);
    const cards = [['Offene Leads', openLeadCount], ['Offene Jobs', openJobCount], ['Kunden', customerCount]];
    if (isAdmin()) cards.push(['Offener Bonus', `CHF ${openRewards}`]);
    $('[data-stats]').innerHTML = cards.map(([label, value]) => `<div class="stat"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join('');
  }

  function renderToday() {
    const now = Date.now();
    const jobs = visibleJobs().filter(j => j.appointmentAt && isOpenJob(j))
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
    let leads = [...visibleLeads()].sort((a,b)=>(personById(a.personId)?.name||'').localeCompare(personById(b.personId)?.name||'', 'de-CH') || new Date(b.createdAt)-new Date(a.createdAt));
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
    const acquired = l.acquiredBy ? userName(l.acquiredBy) : 'nicht zugewiesen';
    const assigned = l.assignedTo ? userName(l.assignedTo) : 'nicht zugewiesen';
    const canEdit = canEditLead(l);
    const canConvert = canCreateJobs() && l.status === 'Offen';
    const contact = isAdmin() ? waLeadLink(p,l) : '';
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title"><span class="order-ref">Lead ${esc(l.id || '')}</span> · ${esc(p.name || 'Ohne Name')} <span class="badge badge-id">${esc(p.id || '')}</span></div><div class="item-sub">${esc(l.service || '')} · ${esc(p.place || '')} · erfasst von ${esc(userName(l.createdBy || currentUser))}</div></div>
        <div class="badges"><span class="badge ${l.status==='Verloren'?'danger':l.status==='Offen'?'warn':'ok'}">${esc(l.status)}</span><span class="badge">gewonnen: ${esc(acquired)}</span><span class="badge">zuständig: ${esc(assigned)}</span>${ref?`<span class="badge ok">Empfohlen von ${esc(ref.name)} · ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(fullAddressForPerson(p))}${l.expectedValue?` · Schätzung ${esc(money(l.expectedValue))}`:''}${l.appointmentAt?` · ${fmtDate(l.appointmentAt)}`:''}${l.notes?`<br>${esc(String(l.notes).slice(0,160))}`:''}</div>
      <div class="actions">${contact}${phoneLink(p.phone)}${mapLink(p)}${canEdit?`<button class="secondary" data-edit-lead="${esc(l.id)}">Bearbeiten</button>`:''}${canConvert?`<button class="primary" data-convert-lead="${esc(l.id)}">In Auftrag umwandeln</button><button class="secondary" data-mark-lead-lost="${esc(l.id)}">Verloren</button>`:(canCreateJobs()?`<button class="secondary" data-open-person-job="${esc(p.id || '')}">Neuer Auftrag</button>`:'')}</div>
    </article>`;
  }

  function renderJobs() {
    const q = ($('[data-job-search]')?.value || '').toLowerCase().trim();
    const filter = $('[data-job-filter]')?.value || 'open';
    let jobs = [...visibleJobs()].sort((a,b)=>new Date(a.appointmentAt || a.createdAt)-new Date(b.appointmentAt || b.createdAt));
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
    const showAmount = isAdmin() || hasPermission('viewJobAmount');
    const amountBadges = !showAmount ? '' : (p.status === 'customer'
      ? `${currentAmount ? `<span class="badge money-badge order">Auftrag ${esc(money(currentAmount))}</span>` : ''}<span class="badge money-badge total">Umsatz total ${esc(money(customerTotal))}</span>`
      : (currentAmount ? `<span class="badge money-badge order">Auftrag ${esc(money(currentAmount))}</span>` : ''));
    const syncBadges = jobSyncBadges(j);
    const photos = photoPreviewHtml([j.beforePhoto, j.afterPhoto], true);
    const team = jobTeamIds(j).map(userName).join(', ') || userName(j.assignedTo || j.createdBy || currentUser);
    const acquired = j.acquiredBy ? userName(j.acquiredBy) : '';
    const ownPay = !isAdmin() && hasPermission('viewOwnCompensation') ? compensationForEmployee(j, currentUser) : 0;
    const compBadge = ownPay > 0 ? `<span class="badge ok">Deine Vergütung ${esc(money(ownPay))}</span>` : '';
    const edit = canEditJob(j) ? `<button class="secondary" data-edit-job="${esc(j.id)}">Bearbeiten</button>` : '';
    const complete = isAdmin() && !cancelled && !paid ? `<button class="primary" data-complete-job="${esc(j.id)}">Job erledigt &amp; bezahlt</button>` : '';
    return `<article class="item-card">
      <div class="item-top">
        <div><div class="item-title"><span class="order-ref">Auftrag ${esc(j.id || '')}</span> · ${esc(p.name || 'Ohne Name')} <span class="badge badge-id">${esc(p.id || '')}</span> <span class="badge ${p.status==='customer'?'ok':'warn'}">${p.status==='customer'?'Kunde':'Lead'}</span></div><div class="item-sub">${fmtDate(j.appointmentAt)} · ${esc(j.service || '')} · verantwortlich: ${esc(userName(j.assignedTo || j.createdBy || currentUser))}</div></div>
        <div class="badges"><span class="badge ${statusClass}">${esc(statusLabel)}</span>${paid?`<span class="badge ok">Zahlung erledigt</span>`:'<span class="badge warn">Zahlung offen</span>'}${amountBadges}${compBadge}${syncBadges}${ref?`<span class="badge ok">Empfohlen von ${esc(ref.id)}</span>`:''}</div>
      </div>
      <div class="item-sub">${esc(fullAddressForPerson(p))}<br>Team: ${esc(team)}${acquired?` · Lead gewonnen durch ${esc(acquired)}`:''}</div>
      ${photos ? `<div class="photo-preview">${photos}</div>` : ''}
      <div class="actions">${isAdmin()?customerReminderLink(j):''}${calendarButtons(j)}${phoneLink(p.phone)}${mapLink(p)}${isAdmin()?reviewLink(p,j):''}${notifyTeamButton(j)}${edit}${complete}</div>
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
    let customers = visibleCustomers();
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
    const jobs = state.jobs.filter(j => j.personId === p.id && canViewJob(j));
    const paidJobsCount = jobs.filter(isPaidJob).length;
    const openJobsCount = jobs.filter(isOpenJob).length;
    const revenueTotal = jobs.filter(isPaidJob).reduce((sum,j)=>sum+amountValue(j.amount),0);
    const link = referralLink(p.id);
    const blocked = isContactBlocked(p);
    const warning = contactWarningText(p);
    const admin = isAdmin();
    const contactActions = blocked
      ? `<button class="secondary" data-show-contact-warning="${esc(p.id)}">Kontakt gesperrt</button>`
      : `${admin?whatsappLink(p.phone, referralInviteText(p), 'Empfehlungslink senden', true):''}${admin?reviewLink(p):''}${phoneLink(p.phone)}${admin?`<button class="secondary" data-copy-ref="${esc(p.id)}">Link kopieren</button>`:''}`;
    const agreement = p.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(p.acquisitionAgreement) : null;
    const commissionBadge = agreement ? `<span class="badge ${agreement.active?'ok':'warn'}">Provision: ${esc(userName(agreement.employeeId))} ${esc(String(agreement.firstPct))}% / ${esc(String(agreement.repeatPct))}%</span>` : '';
    return `<article class="item-card ${blocked ? 'contact-blocked' : ''}">
      <div class="item-top"><div><div class="item-title">${esc(p.name)} <span class="badge badge-id">${esc(p.id)}</span> ${contactBadge(p)}</div><div class="item-sub">${esc(fullAddressForPerson(p) || p.address || '')}</div>${warning ? `<div class="item-warning">${esc(warning)}</div>` : ''}</div><div class="badges"><span class="badge">${jobs.length} Auftrag/Aufträge</span><span class="badge ok">${paidJobsCount} bezahlt</span>${openJobsCount ? `<span class="badge warn">${openJobsCount} offen</span>` : ''}${(admin||hasPermission('viewJobAmount'))?`<span class="badge money-badge total">Umsatz total ${esc(money(revenueTotal))}</span>`:''}<span class="badge">${esc(p.source || 'Quelle offen')}</span>${admin?commissionBadge:''}</div></div>
      ${admin?`<div class="referral-link-line"><span>Empfehlungslink</span><strong>${esc(link)}</strong></div>`:''}
      <div class="actions">${contactActions}${mapLink(p)}${admin?`<button class="secondary" data-edit-customer="${esc(p.id)}">Bearbeiten</button><button class="secondary" data-edit-commission="${esc(p.id)}">Provision bearbeiten</button><button class="secondary" data-open-person-job="${esc(p.id)}">Neuer Auftrag</button>`:''}</div>
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
  function isEmployeeExpenseRecord(x = {}) {
    return x.category === 'Löhne & Mitarbeiter' || x.sourceType === 'employeeCompensation';
  }
  function isRewardExpenseRecord(x = {}) {
    return x.category === 'Kundenbonus & Empfehlungen' || x.sourceType === 'referralReward';
  }
  function isDeferredExpenseRecord(x = {}) { return isEmployeeExpenseRecord(x) || isRewardExpenseRecord(x); }
  function employeeExpensePaymentStatus(x = {}) {
    if (!isEmployeeExpenseRecord(x)) return '';
    if (x.paymentStatus === 'bezahlt' || x.paymentStatus === 'offen') return x.paymentStatus;
    // Bestehende manuell erfasste Löhne galten bisher bereits als Ausgabe.
    return x.automatic ? 'offen' : 'bezahlt';
  }
  function rewardExpensePaymentStatus(x = {}) {
    if (!isRewardExpenseRecord(x)) return '';
    return x.paymentStatus === 'bezahlt' ? 'bezahlt' : 'offen';
  }
  function deferredExpensePaymentStatus(x = {}) {
    return isEmployeeExpenseRecord(x) ? employeeExpensePaymentStatus(x) : (isRewardExpenseRecord(x) ? rewardExpensePaymentStatus(x) : '');
  }
  function expenseItems(range) {
    return (state.finance?.expenses || []).filter(x => !x.deletedAt).filter(x => dateInRange(x.date || x.createdAt, range.from, range.to)).map(x => ({ ...x, amount:amountValue(x.amount) }));
  }
  function financeSummary(range) {
    const jobs = jobIncomeItems(range);
    const manual = manualIncomeItems(range);
    const expenses = expenseItems(range);
    const countedExpenses = expenses.filter(x => !isDeferredExpenseRecord(x) || deferredExpensePaymentStatus(x) === 'bezahlt');
    const forecast = forecastJobs(range);
    const forecastLeads = forecastLeadItems(range);
    const forecastAll = [...forecast, ...forecastLeads];
    const jobIncome = jobs.reduce((s,x)=>s+amountValue(x.amount),0);
    const manualIncome = manual.reduce((s,x)=>s+amountValue(x.amount),0);
    const expenseTotal = countedExpenses.reduce((s,x)=>s+amountValue(x.amount),0);
    const employeeExpenses = expenses.filter(isEmployeeExpenseRecord);
    const employeePaidExpenses = employeeExpenses.filter(x => employeeExpensePaymentStatus(x) === 'bezahlt');
    const employeeOpenExpenses = employeeExpenses.filter(x => employeeExpensePaymentStatus(x) !== 'bezahlt');
    const employeeCostTotal = employeePaidExpenses.reduce((s,x)=>s+amountValue(x.amount),0);
    const employeeOpenTotal = employeeOpenExpenses.reduce((s,x)=>s+amountValue(x.amount),0);
    const rewardExpenses = expenses.filter(isRewardExpenseRecord);
    const rewardPaidExpenses = rewardExpenses.filter(x => rewardExpensePaymentStatus(x) === 'bezahlt');
    const rewardOpenExpenses = rewardExpenses.filter(x => rewardExpensePaymentStatus(x) !== 'bezahlt');
    const rewardPaidTotal = rewardPaidExpenses.reduce((sum,x)=>sum+amountValue(x.amount),0);
    const rewardOpenTotal = rewardOpenExpenses.reduce((sum,x)=>sum+amountValue(x.amount),0);
    const forecastTotal = forecastAll.reduce((s,x)=>s+amountValue(x.amount),0);
    return { jobs, manual, expenses, countedExpenses, employeeExpenses, employeePaidExpenses, employeeOpenExpenses, employeeCostTotal, employeeOpenTotal, rewardExpenses, rewardPaidExpenses, rewardOpenExpenses, rewardPaidTotal, rewardOpenTotal, forecast, forecastLeads, forecastAll, jobIncome, manualIncome, incomeTotal:jobIncome+manualIncome, expenseTotal, profit:jobIncome+manualIncome-expenseTotal, forecastTotal };
  }

  function canEditFinanceEntry(x) {
    return !!x && !x.automatic && (x.createdBy === currentUser);
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


  function applyFiveCardScroll(list) {
    if (!list) return;
    const cards = Array.from(list.children).filter(el => el.classList?.contains('item-card'));
    list.classList.toggle('scroll-after-five', cards.length > 5);
    list.style.maxHeight = '';
    if (cards.length <= 5) return;
    const style = getComputedStyle(list);
    const gap = parseFloat(style.rowGap || style.gap || 0) || 0;
    const height = cards.slice(0,5).reduce((sum, card) => sum + card.getBoundingClientRect().height, 0) + gap * 4 + 2;
    list.style.maxHeight = `${Math.ceil(height)}px`;
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
      ['Ausgaben', money(s.expenseTotal), `${s.countedExpenses.length} bezahlt/gebucht · ${s.employeeOpenExpenses.length} Lohn offen · ${s.rewardOpenExpenses.length} Bonus offen`],
      ['Löhne & Mitarbeiter bezahlt', money(s.employeeCostTotal), `${s.employeePaidExpenses.length} bezahlt · ${s.employeeOpenExpenses.length} offen`],
      ['Gewinn', money(s.profit), 'bezahlte Einnahmen minus Ausgaben']
    ].map(([label,val,sub]) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(val)}</strong><em>${esc(sub)}</em></div>`).join('');

    renderFinanceChart(s);
    const incomeQuery = String($('[data-income-search]')?.value || '').trim().toLowerCase();
    const incomeType = $('[data-income-type-filter]')?.value || 'all';
    const allIncomes = [...s.jobs, ...s.manual].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const incomes = allIncomes.filter(x => {
      if (incomeType === 'jobs' && x.type === 'Manuell') return false;
      if (incomeType === 'manual' && x.type !== 'Manuell') return false;
      if (!incomeQuery) return true;
      return [x.title,x.type,x.notes,x.jobId,userName(x.createdBy)].join(' ').toLowerCase().includes(incomeQuery);
    });
    $('[data-income-pager]').innerHTML = '';
    $('[data-income-count]').textContent = incomes.length === allIncomes.length ? `${allIncomes.length} Eintrag(e)` : `${incomes.length} von ${allIncomes.length}`;
    $('[data-income-list]').innerHTML = incomes.length ? incomes.map(x => {
      const by = x.createdBy ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const editBtns = x.type === 'Manuell' && canEditFinanceEntry(x) ? `<div class="actions"><button class="secondary" data-edit-manual-income="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-manual-income="${esc(x.id)}">Löschen</button></div>` : (x.jobId ? `<div class="actions"><button class="secondary" data-edit-job="${esc(x.jobId)}">Job/Zahlung bearbeiten</button></div>` : '');
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.type)} · ${esc(fmtDateOnly(x.date))}${by}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><span class="badge ok">${esc(money(x.amount))}</span></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine passenden Einnahmen im Zeitraum.</div>';

    const expenseQuery = String($('[data-expense-search]')?.value || '').trim().toLowerCase();
    const expenseType = $('[data-expense-type-filter]')?.value || 'all';
    const expenseStatus = $('[data-expense-status-filter]')?.value || 'all';
    const allSortedExpenses = [...s.expenses].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    const sortedExpenses = allSortedExpenses.filter(x => {
      const employee = isEmployeeExpenseRecord(x);
      const reward = isRewardExpenseRecord(x);
      const status = deferredExpensePaymentStatus(x);
      if (expenseType === 'wages' && !employee) return false;
      if (expenseType === 'bonus' && !reward) return false;
      if (expenseType === 'material' && !['Maschine / Gerät','Reinigungsmittel / Seife','Mops / Tücher / Material'].includes(x.category)) return false;
      if (expenseType === 'vehicle' && x.category !== 'Fahrzeug / Benzin') return false;
      if (expenseType === 'advertising' && x.category !== 'Werbung / Druck') return false;
      if (expenseType === 'other' && (employee || reward || ['Maschine / Gerät','Reinigungsmittel / Seife','Mops / Tücher / Material','Fahrzeug / Benzin','Werbung / Druck'].includes(x.category))) return false;
      if (expenseStatus === 'open' && (!isDeferredExpenseRecord(x) || status === 'bezahlt')) return false;
      if (expenseStatus === 'paid' && isDeferredExpenseRecord(x) && status !== 'bezahlt') return false;
      if (!expenseQuery) return true;
      return [x.title,x.category,x.subtype,x.notes,x.jobId,userName(x.employeeId),userName(x.createdBy)].join(' ').toLowerCase().includes(expenseQuery);
    });
    $('[data-expenses-pager]').innerHTML = '';
    $('[data-expense-count]').textContent = sortedExpenses.length === allSortedExpenses.length ? `${allSortedExpenses.length} Eintrag(e)` : `${sortedExpenses.length} von ${allSortedExpenses.length}`;
    $('[data-expense-list]').innerHTML = sortedExpenses.length ? sortedExpenses.map(x => {
      const by = x.createdBy && x.createdBy !== 'system' ? ` · eingetragen von ${userName(x.createdBy)}` : '';
      const isEmployeeExpense = isEmployeeExpenseRecord(x);
      const isRewardExpense = isRewardExpenseRecord(x);
      const paymentStatus = deferredExpensePaymentStatus(x);
      const paymentBadge = isEmployeeExpense ? `<span class="badge ${paymentStatus==='bezahlt'?'ok':'warn'}">Lohn ${paymentStatus==='bezahlt'?'bezahlt':'offen'}</span>` : (isRewardExpense ? `<span class="badge ${paymentStatus==='bezahlt'?'ok':'warn'}">Bonus ${paymentStatus==='bezahlt'?'eingelöst / ausbezahlt':'gutgeschrieben'}</span>` : '');
      const paymentToggle = isDeferredExpenseRecord(x) && isAdmin() ? `<button class="secondary" data-toggle-deferred-payment="${esc(x.id)}">${paymentStatus==='bezahlt'?'Als offen markieren':(isRewardExpense?'Als eingelöst / ausbezahlt markieren':'Als bezahlt markieren')}</button>` : '';
      const editBtns = canEditFinanceEntry(x) ? `<div class="actions">${paymentToggle}<button class="secondary" data-edit-expense="${esc(x.id)}">Bearbeiten</button><button class="secondary danger" data-delete-expense="${esc(x.id)}">Löschen</button></div>` : (isDeferredExpenseRecord(x) ? `<div class="actions">${paymentToggle}${x.jobId?`<button class="secondary" data-edit-job="${esc(x.jobId)}">Auftrag ${esc(x.jobId)} öffnen</button>`:''}</div>` : '');
      return `<article class="item-card mini"><div class="item-top"><div><div class="item-title">${esc(x.title)}</div><div class="item-sub">${esc(x.category || 'Ausgabe')} · ${esc(fmtDateOnly(x.date))}${by}${x.employeeId?` · Mitarbeiter ${esc(userName(x.employeeId))}`:''}${x.notes ? ' · ' + esc(x.notes) : ''}</div></div><div class="badges">${paymentBadge}<span class="badge danger">${esc(money(x.amount))}</span></div></div>${editBtns}</article>`;
    }).join('') : '<div class="empty">Keine passenden Ausgaben im Zeitraum.</div>';

    requestAnimationFrame(() => {
      applyFiveCardScroll($('[data-income-list]'));
      applyFiveCardScroll($('[data-expense-list]'));
    });

    renderEmployeeCostSummary(s);
    renderCustomerActivity(range);
  }
  function renderEmployeeCostSummary(summary) {
    const el = $('[data-employee-cost-summary]');
    if (!el || !isAdmin()) return;
    const rows = employeeUsers().map(u => {
      const entries = (summary.employeeExpenses || []).filter(x => x.employeeId === u.id);
      const paid = entries.filter(x => employeeExpensePaymentStatus(x) === 'bezahlt').reduce((sum,x)=>sum+amountValue(x.amount),0);
      const open = entries.filter(x => employeeExpensePaymentStatus(x) !== 'bezahlt').reduce((sum,x)=>sum+amountValue(x.amount),0);
      return { u, entries, paid, open };
    }).filter(r => r.entries.length).sort((a,b)=>b.paid-a.paid || b.open-a.open);
    el.innerHTML = rows.length ? rows.map(r => `<div class="employee-cost-row"><div><strong>${esc(r.u.name)}</strong><span>${r.entries.length} Position(en) · ${esc(roleLabel(r.u.role))}</span></div><div><strong>bezahlt ${esc(money(r.paid))}</strong>${r.open>0?`<span class="warn-text">offen ${esc(money(r.open))}</span>`:'<span class="ok-text">alles bezahlt</span>'}</div></div>`).join('') : '<div class="empty">Im gewählten Zeitraum noch keine Mitarbeiterkosten.</div>';
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
    reconcileRewardExpenseStates(state);
    const rewards = [...state.rewards].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const pageData = paginateItems(rewards, 'rewards');
    renderPager('rewards', pageData);
    $('[data-reward-list]').innerHTML = pageData.slice.length ? pageData.slice.map(r => {
      const receiver = personById(r.customerId); const from = personById(r.fromPersonId);
      return `<article class="item-card">
        <div class="item-top"><div><div class="item-title">CHF ${esc(r.amount)} Guthaben für ${esc(receiver?.name || r.customerId)}</div><div class="item-sub">Empfohlen hat: ${esc(receiver?.id || '')} · neuer Kunde: ${esc(from?.name || r.fromPersonId)} · Job ${esc(r.jobId || '')}</div></div><span class="badge ${r.status==='offen'?'warn':'ok'}">${esc(r.status || 'offen')}</span></div>
        <div class="actions">${r.status==='eingelöst / ausbezahlt'?'<button class="secondary" data-tab-go="finance">In Buchhaltung ansehen</button>':`<button class="secondary" data-toggle-reward="${esc(r.id)}">${r.status==='offen'?'Als gutgeschrieben markieren':'Wieder offen setzen'}</button>`}${whatsappLink(receiver?.phone, `Hoi ${receiver?.name || ''}, danke für deine Empfehlung. Dein CHF ${r.amount} Guthaben wurde bei Lumian Services notiert.`, 'WhatsApp')}</div>
      </article>`;
    }).join('') : '<div class="empty">Noch keine Boni. Sie entstehen automatisch, wenn ein Empfehlungs-Job erledigt wird und der Mindestauftrag erreicht ist.</div>';
  }

  function mapLink(target) {
    const q = typeof target === 'string' ? target : fullAddressForPerson(target || {});
    return q ? `<a class="secondary" href="https://maps.google.com/?q=${encodeURIComponent(q)}" target="_blank" rel="noopener">Maps</a>` : '';
  }
  function phoneLink(phone) { if (!isAdmin() && !hasPermission('contactCustomers')) return ''; const p = parseSwissPhone(phone); return p.ok && !p.empty ? `<a class="secondary" href="tel:${esc(p.tel)}">Anrufen</a>` : ''; }
  function smsLink(phone, text='') { return ''; }
  function isLikelySwissMobile(parsed) { return parsed?.ok && !parsed.empty && /^417[4-9]\d{7}$/.test(parsed.wa); }
  function waUrlFor(phone, text) { const p = parseSwissPhone(phone); if (!p.ok || p.empty || !p.wa) return ''; return `https://api.whatsapp.com/send?phone=${p.wa}&text=${encodeURIComponent(text)}`; }
  function whatsappLink(phone, text, label='WhatsApp', primary=false) { if (!isAdmin()) return ''; const url = waUrlFor(phone, text); return url ? `<a class="${primary?'primary':'secondary'}" href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : ''; }
  function waBusinessUrl(text) { const n = normalizeBusinessPhone(getSetting('businessPhone')); return n ? `https://api.whatsapp.com/send?phone=${n}&text=${encodeURIComponent(text)}` : '#'; }
  function customerReminderLink(job) { const p = personById(job.personId) || {}; return whatsappLink(p.phone, reminderText(job), 'Erinnerung senden', true); }
  function calendarButtons(job) {
    if (isCancelledJob(job)) return '';
    const personal = `<button class="secondary" data-personal-calendar-job="${esc(job.id)}">Mein Kalender</button>`;
    const company = isAdmin() && !isCompletedJob(job) ? `<button class="secondary" data-calendar-job="${esc(job.id)}">Firmenkalender</button>` : '';
    return company + personal;
  }
  function calendarButton(job) { return calendarButtons(job); }
  function canNotifyAssignedTeam(job) {
    if (!job) return false;
    return isAdmin() || job.assignedTo === currentUser;
  }
  function notifyTeamButton(job) {
    const recipients = jobTeamIds(job).filter(id => id !== currentUser);
    return canNotifyAssignedTeam(job) && recipients.length
      ? `<button class="secondary" data-notify-team="${esc(job.id)}">Team per WhatsApp informieren</button>`
      : '';
  }
  function compensationForEmployee(job, employeeId) { return (job.compensationLines || []).filter(x => x.employeeId === employeeId).reduce((sum,x)=>sum+compensationLineAmount(x),0); }
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

  function commissionAgreementForLead(acquiredBy, existing = null) {
    if (!acquiredBy) return null;
    if (existing?.employeeId === acquiredBy) return normalizeCommissionAgreement(existing, acquiredBy);
    const fresh = commissionAgreementFromEmployee(acquiredBy);
    return fresh.employeeId ? { ...fresh, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() } : null;
  }
  function renderLeadCommissionSummary(form, acquiredBy = '', existing = null) {
    const el = $('[data-lead-commission-summary]', form);
    if (!el) return;
    const a = commissionAgreementForLead(acquiredBy, existing);
    el.innerHTML = acquiredBy ? `<strong>Lead gewonnen durch:</strong> ${esc(userName(acquiredBy))}<br><span>${a?.active ? `Provision automatisch: ${esc(String(a.firstPct))}% erster Auftrag, ${esc(String(a.repeatPct))}% Folgeaufträge${a.maxJobs ? `, maximal ${esc(String(a.maxJobs))} Auftrag/ Aufträge` : ', unbegrenzt'}.` : 'Für diese Person ist keine aktive Akquiseprovision hinterlegt.'}</span>` : '<strong>Lead-Gewinnung:</strong> keine Person ausgewählt.';
  }

  function openLeadDialog(lead = null) {
    if (!isAdmin() && !hasPermission('createLeads')) return toast('Du hast kein Recht, Leads zu erstellen.');
    if (lead && !canEditLead(lead)) return toast('Dieser Lead ist dir nicht zugewiesen.');
    renderUserOptions();
    const form = $('[data-lead-form]');
    if (!form) return;
    form.reset();
    form.elements.source.value = 'WhatsApp';
    form.elements.referredById.value = '';
    form.elements.leadId.value = '';
    form.elements.personId.value = '';
    form.elements.acquiredBy.value = currentUser || '';
    form.elements.leadAssignedTo.value = currentUser || '';
    renderLeadCommissionSummary(form, currentUser);
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
      form.elements.acquiredBy.value = lead.acquiredBy || lead.createdBy || currentUser || '';
      form.elements.leadAssignedTo.value = lead.assignedTo || lead.createdBy || currentUser || '';
      form.elements.expectedValue.value = lead.expectedValue || '';
      form.elements.appointmentAt.value = nativeDateTimeValueFromField(lead.appointmentAt) || '';
      form.elements.referredById.value = lead.referredById || person.referredById || '';
      if (form.elements.referredById.value) setRefField('lead', form.elements.referredById.value);
      form.elements.notes.value = lead.notes || '';
      renderLeadCommissionSummary(form, form.elements.acquiredBy.value, lead.commissionAgreement || person.acquisitionAgreement);
      $('[data-lead-modal-title]').textContent = `Lead ${lead.id} bearbeiten: ${person.name || ''}`;
      $('[data-lead-submit]').textContent = 'Änderungen speichern';
    }
    [form.elements.acquiredBy, form.elements.leadAssignedTo].forEach(el => { if (el) el.disabled = !isAdmin(); });
    $('[data-ref-suggestions="lead"]').hidden = true;
    $('[data-lead-dialog]').showModal();
    requestAnimationFrame(() => syncAllCalendarControls(form));
  }

  $('[data-lead-form] [name="acquiredBy"]')?.addEventListener('change', event => {
    const form = event.target.form;
    renderLeadCommissionSummary(form, event.target.value);
  });

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

  function compensationLineAmount(line = {}) {
    if (line.type === 'none') return 0;
    if (line.type === 'hourly') return Math.round(amountValue(line.hours) * amountValue(line.rate) * 100) / 100;
    if (line.type === 'commission') return Math.round((amountValue(line.amount) || (amountValue(line.baseAmount) * amountValue(line.percent) / 100)) * 100) / 100;
    return Math.round(amountValue(line.amount) * 100) / 100;
  }
  function compensationTypeLabel(type) { return ({ none:'Keine Arbeitsvergütung', fixed:'Fixlohn', hourly:'Stundenlohn', commission:'Akquiseprovision' })[type] || 'Vergütung'; }
  function workLineForEmployee(employeeId, existing = null) {
    const d = normalizeCompensationDefaults(employeeById(employeeId)?.compensationDefaults || {});
    const previous = existing ? normalizeCompensationLine(existing) : null;
    const type = previous?.type && ['fixed','hourly','none'].includes(previous.type) ? previous.type : d.workPayType;
    return normalizeCompensationLine({
      id:previous?.id || `work-${employeeId}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      employeeId,
      type:type || 'none',
      hours:previous?.hours || 0,
      rate:previous?.rate || (type === 'hourly' ? d.hourlyRate : 0),
      amount:previous?.amount || 0,
      description:previous?.description || '', automatic:false
    });
  }
  function selectedTeamIdsFromDom() {
    const form = $('[data-job-form]');
    if (!form) return [];
    const primary = normalizeUserId(form.elements.assignedTo?.value || '');
    return Array.from(new Set([primary, ...Array.from(form.querySelectorAll('[name="teamMemberIds"]:checked')).map(x=>normalizeUserId(x.value))].filter(Boolean)));
  }
  function syncTeamCompensationFromSelection() {
    const selected = selectedTeamIdsFromDom();
    const old = new Map((editingCompensationLines || []).filter(x=>!x.automatic).map(x=>[x.employeeId,x]));
    editingCompensationLines = selected.map(id => workLineForEmployee(id, old.get(id)));
    renderTeamCompensationCards();
  }
  function syncTeamCompensationFromDom() {
    const cards = $$('[data-team-comp-card]');
    editingCompensationLines = cards.map(card => normalizeCompensationLine({
      id:card.dataset.lineId,
      employeeId:card.dataset.employeeId,
      type:card.querySelector('[data-team-pay-type]')?.value || 'none',
      hours:card.querySelector('[data-team-hours]')?.value || 0,
      rate:card.querySelector('[data-team-rate]')?.value || 0,
      amount:card.querySelector('[data-team-fixed]')?.value || 0,
      description:card.querySelector('[data-team-note]')?.value || '',
      automatic:false
    }));
    return editingCompensationLines;
  }
  function renderTeamCompensationCards() {
    const list = $('[data-team-compensation-list]');
    if (!list) return;
    list.innerHTML = editingCompensationLines.length ? editingCompensationLines.map(line => {
      const u = employeeById(line.employeeId) || {};
      const type = ['none','hourly','fixed'].includes(line.type) ? line.type : 'none';
      const amount = compensationLineAmount(line);
      return `<article class="team-comp-card" data-team-comp-card data-employee-id="${esc(line.employeeId)}" data-line-id="${esc(line.id)}">
        <div class="team-comp-head"><div><strong>${esc(u.name || line.employeeId)}</strong><span>${esc(roleLabel(u.role))}${u.phone ? ` · ${esc(u.phone)}` : ''}</span></div><span class="badge" data-team-line-total>${esc(money(amount))}</span></div>
        <div class="team-comp-grid">
          <label>Arbeitsstunden<input data-team-hours type="number" min="0" step="0.25" inputmode="decimal" value="${esc(line.hours || '')}" placeholder="z.B. 5"></label>
          <label>Vergütungsart<select data-team-pay-type><option value="none" ${type==='none'?'selected':''}>Keine Arbeitsvergütung</option><option value="hourly" ${type==='hourly'?'selected':''}>Stundenlohn</option><option value="fixed" ${type==='fixed'?'selected':''}>Fixbetrag für diesen Auftrag</option></select></label>
          <label data-team-rate-wrap ${type==='hourly'?'':'hidden'}>Stundenlohn CHF<input data-team-rate type="number" min="0" step="0.05" inputmode="decimal" value="${esc(line.rate || '')}"></label>
          <label data-team-fixed-wrap ${type==='fixed'?'':'hidden'}>Fixbetrag CHF<input data-team-fixed type="number" min="0" step="0.05" inputmode="decimal" value="${esc(line.amount || '')}"></label>
          <label class="wide">Notiz optional<input data-team-note value="${esc(line.description || '')}" placeholder="z.B. vereinbarter Pauschalbetrag"></label>
        </div>
      </article>`;
    }).join('') : '<div class="empty">Noch kein Mitarbeiter ausgewählt.</div>';
    updateJobCompensationPreview();
  }
  function updateTeamCardVisibility(card) {
    const type = card.querySelector('[data-team-pay-type]')?.value || 'none';
    const rateWrap = card.querySelector('[data-team-rate-wrap]');
    const fixedWrap = card.querySelector('[data-team-fixed-wrap]');
    if (rateWrap) rateWrap.hidden = type !== 'hourly';
    if (fixedWrap) fixedWrap.hidden = type !== 'fixed';
  }
  function updateJobCompensationPreview() {
    syncTeamCompensationFromDom();
    $$('[data-team-comp-card]').forEach((card,index) => {
      updateTeamCardVisibility(card);
      const total = card.querySelector('[data-team-line-total]');
      if (total) total.textContent = money(compensationLineAmount(editingCompensationLines[index] || {}));
    });
    const totalEl = $('[data-job-compensation-total]');
    if (!totalEl) return;
    const form = $('[data-job-form]');
    const amount = amountValue(form?.elements?.amount?.value || 0);
    const jobId = form?.elements?.jobId?.value || '';
    const personId = form?.elements?.personId?.value || '';
    const person = personById(personId) || {};
    const lead = form?.elements?.leadId?.value ? leadById(form.elements.leadId.value) : null;
    const agreement = lead?.commissionAgreement?.employeeId ? normalizeCommissionAgreement(lead.commissionAgreement) : (person.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(person.acquisitionAgreement) : null);
    const draft = { id:jobId || 'draft', personId, amount, commissionAgreement:agreement, acquiredBy:lead?.acquiredBy || agreement?.employeeId || '' };
    const commission = calculateCommissionLine(draft);
    const work = editingCompensationLines.reduce((sum,line)=>sum+compensationLineAmount(line),0);
    const commissionAmount = commission ? compensationLineAmount(commission) : 0;
    totalEl.innerHTML = `<strong>Arbeitsvergütung: ${esc(money(work))}</strong><span>Akquiseprovision separat: ${esc(money(commissionAmount))} · Mitarbeiterkosten gesamt: ${esc(money(work + commissionAmount))}</span>`;
  }
  $('[data-team-member-options]')?.addEventListener('change', syncTeamCompensationFromSelection);
  $('[data-team-compensation-list]')?.addEventListener('input', updateJobCompensationPreview);
  $('[data-team-compensation-list]')?.addEventListener('change', updateJobCompensationPreview);

  function agreementForJob(job = {}) {
    const p = personById(job.personId) || {};
    const lead = job.leadId ? leadById(job.leadId) : null;
    const raw = job.commissionAgreement?.employeeId ? job.commissionAgreement : (lead?.commissionAgreement?.employeeId ? lead.commissionAgreement : p.acquisitionAgreement);
    return raw?.employeeId ? normalizeCommissionAgreement(raw, raw.employeeId) : null;
  }
  function commissionOrderNumber(job = {}) {
    const completed = state.jobs.filter(j => j.personId === job.personId && isPaidJob(j) && j.id !== job.id)
      .sort((a,b)=>new Date(financeJobDate(a))-new Date(financeJobDate(b)));
    return completed.length + 1;
  }
  function calculateCommissionLine(job = {}) {
    const agreement = agreementForJob(job);
    if (!agreement?.employeeId || !agreement.active) return null;
    const orderNumber = commissionOrderNumber(job);
    if (agreement.maxJobs > 0 && orderNumber > agreement.maxJobs) return null;
    const percent = orderNumber === 1 ? agreement.firstPct : agreement.repeatPct;
    if (percent <= 0 || amountValue(job.amount) <= 0) return null;
    const amount = Math.round(amountValue(job.amount) * percent) / 100;
    return normalizeCompensationLine({
      id:`commission-${job.id || 'draft'}-${agreement.employeeId}`,
      employeeId:agreement.employeeId,
      type:'commission', percent, baseAmount:amountValue(job.amount), amount,
      orderNumber, automatic:true,
      description:orderNumber === 1 ? 'Provision erster Auftrag' : `Provision Folgeauftrag ${orderNumber}`
    });
  }
  function updateJobAcquisitionSummary(job = null) {
    const el = $('[data-job-acquisition-summary]');
    if (!el) return;
    const form = $('[data-job-form]');
    const personId = job?.personId || form?.elements.personId?.value || '';
    const lead = form?.elements.leadId?.value ? leadById(form.elements.leadId.value) : null;
    const p = personById(personId) || {};
    const acquiredBy = job?.acquiredBy || lead?.acquiredBy || p.acquisitionAgreement?.employeeId || '';
    const agreement = lead?.commissionAgreement?.employeeId ? normalizeCommissionAgreement(lead.commissionAgreement) : (p.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(p.acquisitionAgreement) : null);
    el.innerHTML = acquiredBy ? `<strong>Lead gewonnen durch:</strong> ${esc(userName(acquiredBy))}${agreement?` · Provision ${esc(String(agreement.firstPct))}% erster Auftrag / ${esc(String(agreement.repeatPct))}% Folgeaufträge · ${agreement.maxJobs?`max. ${agreement.maxJobs}`:'unbegrenzt'} · ${agreement.active?'aktiv':'gestoppt'}`:''}` : '<strong>Lead-Gewinnung:</strong> nicht zugewiesen';
  }
  $('[data-job-form] [name="amount"]')?.addEventListener('input', updateJobCompensationPreview);

  function configureJobFormAccess(form, job) {
    const admin = isAdmin();
    const update = admin || hasPermission('updateJobs');
    const upload = admin || hasPermission('uploadPhotos');
    const editableNames = new Set(['appointmentAt','status','notes']);
    Array.from(form.elements).forEach(el => {
      if (!el.name || ['jobId','leadId','personId'].includes(el.name)) return;
      if (admin) { el.disabled = false; return; }
      if (['beforePhoto','afterPhoto'].includes(el.name)) el.disabled = !upload;
      else if (editableNames.has(el.name)) el.disabled = !update;
      else el.disabled = true;
    });
    const paidOption = form.elements.status?.querySelector('option[value="Bezahlt"]');
    if (paidOption) {
      paidOption.disabled = !admin;
      paidOption.hidden = !admin;
    }
    const amountLabel = form.elements.amount?.closest('label');
    if (amountLabel) amountLabel.hidden = !admin && !hasPermission('viewJobAmount');
  }

  function configureJobSourceField(form, lead = null) {
    if (!form?.elements?.source) return;
    const note = $('[data-job-source-note]', form);
    const inherited = !!lead;
    form.elements.source.disabled = inherited;
    if (note) note.textContent = inherited ? `Automatisch übernommen aus Lead ${lead.id}.` : 'Bei direkt erstellten Aufträgen frei wählbar.';
  }

  function openJobDialog(job = null, lead = null, person = null) {
    if (!job && !canCreateJobs()) return toast('Nur Admins oder Teamleitung können neue Aufträge erstellen.');
    if (job && !canEditJob(job)) return toast('Dieser Auftrag ist dir nicht zugewiesen oder du hast keine Bearbeitungsrechte.');
    renderUserOptions();
    const form = $('[data-job-form]');
    form.reset();
    stagedPhotos = { before:null, after:null };
    editingCompensationLines = [];
    $('[data-photo-preview]').innerHTML = '';
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
      editingCompensationLines = (job.compensationLines || []).filter(x => !x.automatic && x.employeeId).map(normalizeCompensationLine);
      renderTeamMemberOptions(jobTeamIds(job), job.assignedTo || currentUser);
      $('[data-job-modal-title]').textContent = `Auftrag ${job.id} bearbeiten`;
      $('[data-job-order-number]').textContent = `Auftragsnummer: ${job.id} · Kundennummer: ${person?.id || job.personId || ''}`;
    } else {
      form.elements.jobId.value = '';
      form.elements.status.value = 'Geplant';
      form.elements.assignedTo.value = currentUser || 'noah';
      renderTeamMemberOptions([], currentUser);
      $('[data-job-modal-title]').textContent = lead ? `Lead ${lead.id} in Auftrag umwandeln` : 'Auftrag direkt erstellen';
      $('[data-job-order-number]').textContent = 'Neue Auftragsnummer wird beim Speichern automatisch vergeben';
    }
    if (!editingCompensationLines.length) syncTeamCompensationFromSelection(); else renderTeamCompensationCards();
    updateJobAcquisitionSummary(job);
    configureJobFormAccess(form, job);
    const notifySaveButton = $('[data-save-notify-team]', form);
    if (notifySaveButton) notifySaveButton.hidden = !(isAdmin() || (job && job.assignedTo === currentUser));
    configureJobSourceField(form, lead || (job?.leadId ? leadById(job.leadId) : null));
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
    if (!isAdmin()) return toast('Nur Admins können Kundenstammdaten bearbeiten.');
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
    const existingId = String(form.elements.leadId.value || '').trim();
    let lead = existingId ? leadById(existingId) : null;
    if (lead && !canEditLead(lead)) return toast('Dieser Lead kann von dir nicht bearbeitet werden.');
    const fd = new FormData(form);
    const p = findOrCreatePerson({
      personId: form.elements.personId.value, name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'), address: fd.get('address'), place: fd.get('place'), source: fd.get('source'), referredById: fd.get('referredById')
    });
    if (!lead) {
      lead = { id: nextId('lead'), createdAt: new Date().toISOString(), createdBy: currentUser, status: 'Offen' };
      state.leads.push(lead);
    } else {
      lead.updatedAt = new Date().toISOString();
      lead.updatedBy = currentUser;
    }
    const acquiredBy = isAdmin() ? (form.elements.acquiredBy.value || currentUser) : (lead.acquiredBy || currentUser);
    const assignedTo = isAdmin() ? (form.elements.leadAssignedTo.value || acquiredBy || currentUser) : (lead.assignedTo || currentUser);
    const agreement = commissionAgreementForLead(acquiredBy, lead.commissionAgreement || p.acquisitionAgreement);
    Object.assign(lead, {
      personId:p.id, service:fd.get('service'), source:fd.get('source'), acquiredBy, assignedTo,
      expectedValue:fd.get('expectedValue'), appointmentAt:isoDateTimeFromField(fd.get('appointmentAt')),
      referredById:fd.get('referredById'), status:lead.status || 'Offen', notes:fd.get('notes'),
      commissionAgreement:agreement,
      websiteLeadKey:lead.websiteLeadKey || p.websiteLeadKey || ''
    });
    p.acquisitionAgreement = agreement?.employeeId ? { ...agreement } : null;
    saveState(`${existingId ? 'Lead geändert' : 'Lead erstellt'}: ${lead.id} / ${p.id} / gewonnen durch ${acquiredBy || '-'}`);
    form.closest('dialog').close();
    setTab('leads');
    toast(existingId ? `Lead ${lead.id} geändert.` : `Lead ${lead.id} gespeichert · Kunde ${p.id}.`);
  });

  $('[data-job-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    const notifyAfterSave = !!event.submitter?.matches?.('[data-save-notify-team]');
    const existingJobId = String(form.elements.jobId.value || '').trim();
    let job = existingJobId ? jobById(existingJobId) : null;
    const admin = isAdmin();
    if (job && !canEditJob(job)) return toast('Dieser Auftrag kann von dir nicht bearbeitet werden.');
    if (!job && !canCreateJobs()) return toast('Du kannst keine neuen Aufträge erstellen.');
    if (markInvalidDateInput(form.elements.appointmentAt, 'Termin', true)) return;

    if (!admin) {
      if (!job) return;
      if (hasPermission('updateJobs')) {
        job.appointmentAt = isoDateTimeFromField(form.elements.appointmentAt.value);
        const requestedStatus = form.elements.status.value;
        if (requestedStatus !== 'Bezahlt') job.status = requestedStatus;
        job.notes = form.elements.notes.value || job.notes || '';
      }
      if (hasPermission('uploadPhotos')) {
        job.beforePhoto = stagedPhotos.before || job.beforePhoto || null;
        job.afterPhoto = stagedPhotos.after || job.afterPhoto || null;
      }
      job.updatedAt = new Date().toISOString();
      job.updatedBy = currentUser;
      saveState(`Auftrag geändert: ${job.id} / durch ${currentUser}`);
      form.closest('dialog').close();
      setTab('jobs');
      toast(`Auftrag ${job.id} aktualisiert.`);
      if (notifyAfterSave) notifyAssignedTeam(job);
      if ((job.beforePhoto?.dataUrl || job.afterPhoto?.dataUrl || job.appointmentAt) && currentScriptUrl()) setTimeout(() => syncCloud(false), 350);
      return;
    }

    if (!form.reportValidity() || !validateContactFields(form)) return;
    const fd = new FormData(form);
    const lead = form.elements.leadId.value ? leadById(form.elements.leadId.value) : null;
    const p = findOrCreatePerson({
      personId:form.elements.personId.value, name:fd.get('name'), phone:fd.get('phone'), email:fd.get('email'), address:fd.get('address'), place:fd.get('place'), source:form.elements.source.value || lead?.source || job?.source || '', referredById:fd.get('referredById') || lead?.referredById || job?.referredById || ''
    });
    if (!job) {
      job = { id:nextId('job'), personId:p.id, createdAt:new Date().toISOString(), createdBy:currentUser };
      state.jobs.push(job);
    }
    syncTeamCompensationFromDom();
    const assignedTo = fd.get('assignedTo') || currentUser;
    const teamMemberIds = Array.from(new Set([assignedTo, ...editingCompensationLines.map(x=>x.employeeId)].filter(Boolean)));
    const agreement = lead?.commissionAgreement?.employeeId ? normalizeCommissionAgreement(lead.commissionAgreement) : (p.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(p.acquisitionAgreement) : null);
    Object.assign(job, {
      personId:p.id, leadId:form.elements.leadId.value || job.leadId || '', service:fd.get('service'),
      appointmentAt:isoDateTimeFromField(fd.get('appointmentAt')), amount:fd.get('amount'), status:fd.get('status'),
      assignedTo, teamMemberIds, acquiredBy:lead?.acquiredBy || agreement?.employeeId || job.acquiredBy || '',
      commissionAgreement:agreement, compensationLines:editingCompensationLines.map(normalizeCompensationLine),
      source:form.elements.source.value || lead?.source || p.source || '', referredById:fd.get('referredById') || job.referredById || p.referredById || '',
      notes:fd.get('notes'), beforePhoto:stagedPhotos.before || job.beforePhoto || null, afterPhoto:stagedPhotos.after || job.afterPhoto || null,
      updatedAt:new Date().toISOString(), updatedBy:currentUser
    });
    job = Object.assign(job, normalizeJobRecord(normalizeJobForNoUnpaidDone(job)));
    if (job.status === 'Bezahlt') job.paidAt = job.paidAt || new Date().toISOString();
    else { delete job.paidAt; delete job.completedAt; removeEmployeeExpensesForJob(job.id); }
    if (lead) lead.status = 'Job erstellt';
    if (isCompletedJob(job)) completeJob(job.id, false);
    saveState(`${existingJobId ? 'Auftrag geändert' : (lead ? 'Lead in Auftrag umgewandelt' : 'Auftrag erstellt')}: ${job.id} / Kunde ${p.id}`);
    form.closest('dialog').close();
    setTab('jobs');
    const needsMediaSync = !!(job.beforePhoto?.dataUrl || job.afterPhoto?.dataUrl || job.appointmentAt);
    const calMsg = job.appointmentAt && calendarSyncTarget() ? ' Termin wird automatisch mit Google Calendar synchronisiert.' : '';
    toast(job.status === 'Bezahlt' ? `Auftrag ${job.id} bezahlt und abgeschlossen.${calMsg}` : `Auftrag ${job.id} gespeichert.${calMsg}`);
    if (notifyAfterSave) notifyAssignedTeam(job);
    if (needsMediaSync && currentScriptUrl()) setTimeout(() => syncCloud(false), 350);
  });

  function openCommissionDialog(personId) {
    if (!isAdmin()) return;
    renderUserOptions();
    const p = personById(personId);
    const form = $('[data-commission-form]');
    if (!p || !form) return;
    const agreement = p.acquisitionAgreement?.employeeId ? normalizeCommissionAgreement(p.acquisitionAgreement) : null;
    form.reset();
    form.elements.personId.value = p.id;
    form.elements.employeeId.value = agreement?.employeeId || '';
    form.elements.firstPct.value = agreement?.firstPct || '';
    form.elements.repeatPct.value = agreement?.repeatPct || '';
    form.elements.maxJobs.value = agreement?.maxJobs || '';
    form.elements.active.checked = !!agreement?.active;
    $('[data-commission-customer-label]').textContent = `${p.name || p.id} · ${p.id}. Bereits erzeugte Provisionen bleiben unverändert.`;
    $('[data-commission-dialog]').showModal();
  }

  $('[data-commission-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    if (!isAdmin()) return;
    const form = event.currentTarget;
    const p = personById(form.elements.personId.value);
    if (!p) return;
    const previous = p.acquisitionAgreement || {};
    const employeeId = form.elements.employeeId.value;
    p.acquisitionAgreement = employeeId ? normalizeCommissionAgreement({
      employeeId,
      firstPct:form.elements.firstPct.value,
      repeatPct:form.elements.repeatPct.value,
      maxJobs:form.elements.maxJobs.value,
      active:form.elements.active.checked,
      createdAt:previous.createdAt || new Date().toISOString(),
      updatedAt:new Date().toISOString(),
      stoppedAt:form.elements.active.checked ? '' : (previous.stoppedAt || new Date().toISOString())
    }, employeeId) : null;
    saveState(`Akquiseprovision geändert: ${p.id} / ${employeeId || 'entfernt'}`);
    form.closest('dialog').close();
    renderAll();
    toast(form.elements.active.checked ? 'Provision für neue Aufträge gespeichert.' : 'Provision für neue Aufträge gestoppt.');
  });

  function notifyAssignedTeam(job) {
    if (!job || !canNotifyAssignedTeam(job)) return toast('Nur Admins oder die hauptverantwortliche Person können das Team informieren.');
    const p = personById(job.personId) || {};
    const assigned = jobTeamIds(job).map(employeeById).filter(u => u && u.id !== currentUser);
    if (!assigned.length) return toast('Diesem Auftrag ist noch kein weiterer Mitarbeiter zugewiesen.');
    const recipients = assigned.filter(u => {
      const parsed = parseSwissPhone(u.phone);
      return parsed.ok && !parsed.empty;
    });
    if (!recipients.length) return toast('Bei den zugewiesenen Mitarbeitern ist keine gültige Telefonnummer gespeichert. Bitte zuerst unter Mitarbeiter ergänzen.');
    let chosen = recipients[0];
    if (recipients.length > 1) {
      const answer = prompt(`Welchen Mitarbeiter informieren?\n${recipients.map((u,i)=>`${i+1}. ${u.name}`).join('\n')}\n\nNummer eingeben:`, '1');
      if (answer === null) return;
      chosen = recipients[Math.max(0, Math.min(recipients.length-1, Number(answer)-1))] || recipients[0];
    }
    const portalUrl = `${window.location.origin}/portal/`;
    const loginLine = chosen.loginEnabled === false ? 'Für dich ist aktuell kein Portal-Login aktiviert.' : `Portal öffnen und einloggen: ${portalUrl}`;
    const text = `Hallo ${chosen.name || ''}, dir wurde der Lumian-Auftrag ${job.id} zugewiesen.\n\nTermin: ${fmtDate(job.appointmentAt)}\nKunde: ${p.name || ''} (${p.id || ''})\nService: ${job.service || ''}\nAdresse: ${fullAddressForPerson(p)}\n\n${loginLine}\nIm Portal kannst du den Auftrag auch zu deinem persönlichen Kalender hinzufügen.`;
    const url = waUrlFor(chosen.phone, text);
    if (!url) return toast('WhatsApp-Link konnte nicht erstellt werden.');
    window.open(url, '_blank', 'noopener');
  }


  function reconcileRewardExpenseStates(targetState = state) {
    const rewards = Array.isArray(targetState?.rewards) ? targetState.rewards : [];
    const expenses = Array.isArray(targetState?.finance?.expenses) ? targetState.finance.expenses : [];
    rewards.forEach(reward => {
      if (!reward?.id) return;
      const entry = expenses.find(x => !x.deletedAt && (x.rewardId === reward.id || x.id === `BONUS-${reward.id}`));
      if (!entry) return;
      const paid = entry.paymentStatus === 'bezahlt';
      const nextStatus = paid ? 'eingelöst / ausbezahlt' : 'gutgeschrieben';
      reward.status = nextStatus;
      if (paid) {
        reward.redeemedAt = reward.redeemedAt || entry.paidAt || entry.date || new Date().toISOString();
        reward.redeemedBy = reward.redeemedBy || entry.paidBy || entry.updatedBy || 'system';
      } else {
        reward.redeemedAt = ''; reward.redeemedBy = '';
        reward.creditedAt = reward.creditedAt || entry.createdAt || entry.date || new Date().toISOString();
      }
      entry.sourceType = 'referralReward';
      entry.rewardId = reward.id;
      entry.paymentStatus = paid ? 'bezahlt' : 'offen';
    });
  }

  function rewardExpenseId(rewardId) { return `BONUS-${String(rewardId || '').trim()}`; }
  function syncRewardExpense(reward) {
    if (!reward) return;
    state.finance = state.finance || { manualIncome:[], expenses:[] };
    state.finance.expenses = Array.isArray(state.finance.expenses) ? state.finance.expenses : [];
    const id = rewardExpenseId(reward.id);
    let entry = state.finance.expenses.find(x => x.id === id);
    if (reward.status === 'offen') {
      if (entry && !entry.deletedAt) { entry.deletedAt = new Date().toISOString(); entry.deletedBy = currentUser; }
      return;
    }
    const receiver = personById(reward.customerId) || {};
    const source = personById(reward.fromPersonId) || {};
    if (!entry) {
      entry = { id, createdAt:new Date().toISOString(), createdBy:'system' };
      state.finance.expenses.push(entry);
    }
    Object.assign(entry, {
      deletedAt:'', deletedBy:'', sourceType:'referralReward', rewardId:reward.id, automatic:true,
      category:'Kundenbonus & Empfehlungen', subtype:'Empfehlungsbonus',
      title:`Empfehlungsbonus ${receiver.name || reward.customerId || ''} · Auftrag ${reward.jobId || ''}`,
      amount:amountValue(reward.amount || 0), jobId:reward.jobId || '', personId:reward.customerId || '',
      paymentStatus:reward.status === 'eingelöst / ausbezahlt' ? 'bezahlt' : 'offen',
      date:(reward.redeemedAt || reward.creditedAt || reward.createdAt || new Date().toISOString()).slice(0,10),
      notes:`Empfehlung für ${source.name || reward.fromPersonId || 'Neukunde'}${reward.jobId ? ` · Auftrag ${reward.jobId}` : ''}`,
      updatedAt:new Date().toISOString(), updatedBy:currentUser
    });
  }

  document.addEventListener('click', event => {
    const convert = event.target.closest('[data-convert-lead]');
    if (convert) { const lead = leadById(convert.dataset.convertLead); if (lead && canCreateJobs()) openJobDialog(null, lead, personById(lead.personId)); }
    const lost = event.target.closest('[data-mark-lead-lost]');
    if (lost) { const lead = leadById(lost.dataset.markLeadLost); if (lead && canEditLead(lead)) { lead.status='Verloren'; saveState(`Lead verloren: ${lead.id}`); renderAll(); } }
    const editLead = event.target.closest('[data-edit-lead]');
    if (editLead) { const lead = leadById(editLead.dataset.editLead); if (lead) openLeadDialog(lead); }
    const edit = event.target.closest('[data-edit-job]');
    if (edit) { const job = jobById(edit.dataset.editJob); if (job) openJobDialog(job); }
    const done = event.target.closest('[data-complete-job]');
    if (done && isAdmin()) confirmCompleteJobPaid(done.dataset.completeJob);
    const paid = event.target.closest('[data-paid-job]');
    if (paid && isAdmin()) confirmCompleteJobPaid(paid.dataset.paidJob);
    const cal = event.target.closest('[data-calendar-job]');
    if (cal && isAdmin()) addCalendar(jobById(cal.dataset.calendarJob));
    const personalCal = event.target.closest('[data-personal-calendar-job]');
    if (personalCal) downloadCalendarIcs(jobById(personalCal.dataset.personalCalendarJob));
    const notify = event.target.closest('[data-notify-team]');
    if (notify) notifyAssignedTeam(jobById(notify.dataset.notifyTeam));
    const commission = event.target.closest('[data-edit-commission]');
    if (commission) openCommissionDialog(commission.dataset.editCommission);
    const copy = event.target.closest('[data-copy-ref]');
    if (copy && isAdmin()) { const link = referralLink(copy.dataset.copyRef); navigator.clipboard?.writeText(link); toast('Empfehlungslink kopiert.'); }
    const personJob = event.target.closest('[data-open-person-job]');
    if (personJob && canCreateJobs()) openJobDialog(null, null, personById(personJob.dataset.openPersonJob));
    const rew = event.target.closest('[data-toggle-reward]');
    if (rew && isAdmin()) {
      const r = state.rewards.find(x => x.id === rew.dataset.toggleReward);
      if (r) {
        if (r.status === 'eingelöst / ausbezahlt') return toast('Bereits eingelöste oder ausbezahlte Boni werden in der Buchhaltung verwaltet.');
        if (r.status === 'offen') { r.status = 'gutgeschrieben'; r.creditedAt = new Date().toISOString(); r.creditedBy = currentUser; }
        else { r.status = 'offen'; r.creditedAt = ''; r.redeemedAt = ''; r.redeemedBy = ''; }
        r.updatedAt = new Date().toISOString(); r.updatedBy = currentUser;
        syncRewardExpense(r);
        saveState(`Bonus geändert: ${r.id}`); renderAll();
      }
    }
  });

  function ensureJobCompensation(job) {
    const manual = (job.compensationLines || []).filter(x => !x.automatic).map(normalizeCompensationLine);
    const commission = calculateCommissionLine(job);
    job.compensationLines = commission ? [...manual, commission] : manual;
    return job.compensationLines;
  }
  function employeeExpenseId(jobId, lineId) { return `EMP-${jobId}-${String(lineId).replace(/[^a-zA-Z0-9_-]/g,'_')}`; }
  function syncEmployeeExpensesForJob(job) {
    state.finance = state.finance || { manualIncome:[], expenses:[] };
    const lines = ensureJobCompensation(job).filter(line => line.employeeId && compensationLineAmount(line) > 0);
    const validIds = new Set(lines.map(line => employeeExpenseId(job.id, line.id)));
    (state.finance.expenses || []).filter(x => x.automatic && x.jobId === job.id && !validIds.has(x.id)).forEach(x => {
      x.deletedAt = x.deletedAt || new Date().toISOString();
      x.deletedBy = currentUser;
    });
    lines.forEach(line => {
      const id = employeeExpenseId(job.id, line.id);
      let entry = state.finance.expenses.find(x => x.id === id);
      const amount = compensationLineAmount(line);
      const detail = line.type === 'hourly' ? `${line.hours} Std. × ${money(line.rate)}` : (line.type === 'commission' ? `${line.percent}% von ${money(line.baseAmount)} · Auftrag Nr. ${line.orderNumber}` : 'Fixbetrag');
      if (!entry) {
        entry = { id, createdAt:new Date().toISOString(), createdBy:'system', automatic:true, sourceType:'employeeCompensation', paymentStatus:'offen' };
        state.finance.expenses.push(entry);
      }
      Object.assign(entry, {
        deletedAt:'', date:ymd(parseDateValue(financeJobDate(job)) || new Date()),
        category:'Löhne & Mitarbeiter', subtype:compensationTypeLabel(line.type),
        title:`${userName(line.employeeId)} · ${compensationTypeLabel(line.type)} · Auftrag ${job.id}`,
        amount, employeeId:line.employeeId, jobId:job.id, personId:job.personId,
        compensationLineId:line.id, notes:`${detail}${line.description ? ' · '+line.description : ''}`,
        updatedAt:new Date().toISOString(), updatedBy:currentUser
      });
    });
  }
  function removeEmployeeExpensesForJob(jobId) {
    ((state.finance && state.finance.expenses) || []).filter(x => x.automatic && x.jobId === jobId && !x.deletedAt).forEach(x => {
      x.deletedAt = new Date().toISOString();
      x.deletedBy = currentUser;
    });
  }

  function confirmCompleteJobPaid(jobId) {
    if (!isAdmin()) return toast('Nur Admins können Zahlung und Abschluss bestätigen.');
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

    ensureJobCompensation(job);
    syncEmployeeExpensesForJob(job);

    const amount = amountValue(job.amount || lead?.expectedValue || 0);
    const refId = job.referredById || lead?.referredById || p.referredById;
    if (refId && refId !== p.id && amount >= Number(getSetting('minOrder'))) {
      const exists = state.rewards.some(r => r.jobId === job.id && r.customerId === refId);
      if (!exists) state.rewards.push({ id: nextId('reward'), customerId: refId, fromPersonId: p.id, jobId: job.id, amount: Number(getSetting('bonusAmount')), status: 'offen', createdAt: new Date().toISOString(), createdBy: currentUser });
    }
    saveState(`Auftrag bezahlt/abgeschlossen: ${job.id} / Mitarbeiterkosten automatisch verbucht`); renderAll();
    if (showMessage) toast(`Auftrag ${job.id} bezahlt und abgeschlossen. Mitarbeiterkosten wurden automatisch unter Löhne & Mitarbeiter verbucht.`);
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
      (isAdmin() || hasPermission('viewJobAmount')) ? `Betrag: CHF ${job.amount || ''}` : '',
      `Auftragsnummer: ${job.id}`,
      maps ? `Maps: ${maps}` : ''
    ].filter(Boolean).join('\n');
    const ics = [
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Lumian Services//Portal//DE','BEGIN:VEVENT',
      `UID:${clean(job.id)}@lumianservices.ch`,
      `DTSTAMP:${icsDate(new Date())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${clean(`Lumian Auftrag ${job.id}: ${p.name || 'Kunde'} - ${job.service || 'Reinigung'}`)}`,
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

  let activeContentPage = 'home';
  function contentFieldValue(key, type) {
    const c = normalizeWebsiteContent(state.websiteContent || {});
    if (type === 'image') return c.media[key] || { src:'', name:'' };
    return c.values[key] ?? '';
  }
  function renderContentField(field) {
    const [key,label,type] = field;
    if (type === 'image') {
      const media = contentFieldValue(key,type);
      const src = media.dataUrl || canonicalWebsiteAssetUrl(media.src || '');
      const sizeInfo = media.size ? ` · komprimiert ${humanFileSize(media.size)}${media.width&&media.height?` · ${media.width}×${media.height}px`:''}` : '';
      return `<label class="content-image-field" data-content-field-wrap="${esc(key)}"><span>${esc(label)}</span><div class="content-image-preview">${src?`<img src="${esc(src)}" alt="${esc(label)}" loading="lazy">`:'<div class="empty">Kein Bild</div>'}</div><input type="file" accept="image/jpeg,image/png,image/webp" data-content-image="${esc(key)}"><small>${esc(media.name || media.src || 'Bestehendes Bild bleibt erhalten, bis ein neues gewählt wird.')}${esc(sizeInfo)}</small><small class="image-guidance">Standard: längste Seite max. 1400 px, automatisch als komprimiertes WebP gespeichert. Zielgrösse ca. 350 KB oder kleiner; das Portal verkleinert sehr grosse Originale vor dem Upload.</small></label>`;
    }
    const value=contentFieldValue(key,type);
    if (type==='textarea') return `<label>${esc(label)}<textarea rows="4" data-content-value="${esc(key)}">${esc(value)}</textarea></label>`;
    return `<label>${esc(label)}<input type="${type==='url'?'text':'text'}" data-content-value="${esc(key)}" value="${esc(value)}"></label>`;
  }
  function renderWebsiteContentEditor(force = false) {
    const root=$('[data-content-editor]'); if (!root || !isAdmin()) return;
    if (!force && root.dataset.renderedPage===activeContentPage && root.children.length) return;
    root.dataset.renderedPage=activeContentPage;
    $$('[data-content-page]').forEach(b=>b.classList.toggle('active',b.dataset.contentPage===activeContentPage));
    const content=normalizeWebsiteContent(state.websiteContent || {});
    if (activeContentPage==='gallery') {
      root.innerHTML=`<article class="content-section-card"><div class="content-section-head"><div><h3>Homepage · Galerie</h3><p>Bilder hinzufügen, Titel und Beschreibung ändern oder Reihenfolge anpassen. Lokale Bilder verwenden vollständige HTTPS-Links; neue Uploads werden auf max. 1400 px und eine Zielgrösse von ca. 350 KB oder kleiner komprimiert.</p></div><button class="secondary" type="button" data-add-gallery-item>+ Bild hinzufügen</button></div><div class="gallery-editor-list" data-gallery-editor>${content.gallery.map((g,i)=>galleryEditorCard(g,i)).join('')}</div><div class="content-section-actions"><button class="primary" type="button" data-save-gallery>Galerie speichern & veröffentlichen</button></div></article>`;
      return;
    }
    const sections=WEBSITE_CONTENT_SECTIONS.filter(x=>x.page===activeContentPage);
    root.innerHTML=sections.map(sec=>`<article class="content-section-card" data-content-section="${esc(sec.id)}"><div class="content-section-head"><div><h3>${esc(sec.title)}</h3><p>Nur dieser Abschnitt wird gespeichert.</p></div></div><div class="content-fields">${sec.fields.map(renderContentField).join('')}</div><div class="content-section-actions"><button class="primary" type="button" data-save-content-section="${esc(sec.id)}">Abschnitt speichern & veröffentlichen</button></div></article>`).join('');
  }
  function galleryEditorCard(g,index) {
    const src=g.dataUrl || canonicalWebsiteAssetUrl(g.src || '');
    const meta = g.size ? `${humanFileSize(g.size)}${g.width&&g.height?` · ${g.width}×${g.height}px`:''}` : (g.src ? canonicalWebsiteAssetUrl(g.src) : 'Noch kein Bild gewählt');
    return `<article class="gallery-editor-card" data-gallery-item="${esc(g.id)}"><div class="gallery-editor-image">${src?`<img src="${esc(src)}" alt="${esc(g.title || 'Galerie')}" loading="lazy">`:'<div class="empty">Neues Bild wählen</div>'}</div><div class="gallery-editor-fields"><label>Titel<input data-gallery-title value="${esc(g.title || '')}"></label><label>Beschreibung<textarea rows="2" data-gallery-caption>${esc(g.caption || '')}</textarea></label><label>Bild<input type="file" accept="image/jpeg,image/png,image/webp" data-gallery-image><small>${esc(meta)}</small><small class="image-guidance">Automatische Komprimierung: max. 1400 px, WebP mit angepasster Qualität und Zielgrösse ca. 350 KB. Empfohlenes Original: JPG/PNG/WebP, möglichst unter 8 MB.</small></label><div class="button-row"><button class="secondary" type="button" data-gallery-move="up" ${index===0?'disabled':''}>Nach oben</button><button class="secondary" type="button" data-gallery-move="down">Nach unten</button><button class="secondary danger" type="button" data-gallery-remove>Entfernen</button></div></div></article>`;
  }
  async function compressContentImage(file,maxSize=1400,targetBytes=350*1024) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Bitte eine JPG-, PNG- oder WebP-Bilddatei wählen.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Das Originalbild ist grösser als 20 MB. Bitte zuerst ein kleineres Bild wählen.');
    const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
    const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=dataUrl;});
    const canvas=document.createElement('canvas');
    const drawAtMax=(limit)=>{const scale=Math.min(1,limit/Math.max(img.width,img.height));canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));const ctx=canvas.getContext('2d',{alpha:true});ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);};
    drawAtMax(maxSize);
    let quality=.84;
    let compressed=canvas.toDataURL('image/webp',quality);
    while (approximateDataUrlBytes(compressed)>targetBytes && quality>.58) { quality=Math.max(.58,quality-.07); compressed=canvas.toDataURL('image/webp',quality); }
    if (approximateDataUrlBytes(compressed)>targetBytes && Math.max(canvas.width,canvas.height)>1100) { drawAtMax(1100); quality=.72; compressed=canvas.toDataURL('image/webp',quality); while(approximateDataUrlBytes(compressed)>targetBytes && quality>.56){quality=Math.max(.56,quality-.06);compressed=canvas.toDataURL('image/webp',quality);} }
    const mime=compressed.startsWith('data:image/webp')?'image/webp':'image/jpeg';
    const ext=mime==='image/webp'?'.webp':'.jpg';
    return { dataUrl:compressed, name:String(file.name || 'website-image').replace(/\.[^.]+$/, '')+ext, type:mime, size:approximateDataUrlBytes(compressed), width:canvas.width, height:canvas.height };
  }
  async function publishWebsiteContent(reason) {
    state.websiteContent=normalizeWebsiteContent(state.websiteContent || {}); state.websiteContent.updatedAt=new Date().toISOString(); state.websiteContent.updatedBy=currentUser;
    saveState(reason,{cloud:false}); renderWebsiteContentEditor(true); toast('Inhalt gespeichert. Veröffentlichung wird synchronisiert.');
    if (currentScriptUrl()) await syncCloud(false); else toast('Gespeichert. Für die öffentliche Website zuerst Google Apps Script verbinden.');
  }
  $$('[data-content-page]').forEach(btn=>btn.addEventListener('click',()=>{activeContentPage=btn.dataset.contentPage;renderWebsiteContentEditor(true);}));
  $('[data-refresh-content]')?.addEventListener('click',()=>{renderWebsiteContentEditor(true);toast('Inhaltsansicht aktualisiert.');});
  $('[data-content-editor]')?.addEventListener('change', async event=>{
    const image=event.target.closest('[data-content-image]');
    if (image?.files?.[0]) { try { const compressed=await compressContentImage(image.files[0]); state.websiteContent=normalizeWebsiteContent(state.websiteContent||{}); state.websiteContent.media[image.dataset.contentImage]={...(state.websiteContent.media[image.dataset.contentImage]||{}),...compressed}; renderWebsiteContentEditor(true); } catch(e){toast(e.message||'Bild konnte nicht verarbeitet werden.');} }
    const galleryImage=event.target.closest('[data-gallery-image]');
    if (galleryImage?.files?.[0]) { try { const card=galleryImage.closest('[data-gallery-item]'); const item=state.websiteContent.gallery.find(x=>x.id===card.dataset.galleryItem); Object.assign(item,await compressContentImage(galleryImage.files[0])); renderWebsiteContentEditor(true); } catch(e){toast(e.message||'Bild konnte nicht verarbeitet werden.');} }
  });
  $('[data-content-editor]')?.addEventListener('click', async event=>{
    const save=event.target.closest('[data-save-content-section]');
    if (save) {
      const sec=WEBSITE_CONTENT_SECTIONS.find(x=>x.id===save.dataset.saveContentSection);
      if (!sec) return;
      if (!(await confirmSensitiveAction(`Website-Inhalt "${sec.title}" speichern und veröffentlichen?`))) return;
      state.websiteContent=normalizeWebsiteContent(state.websiteContent||{});
      sec.fields.forEach(([key,,type])=>{if(type==='image')return; const input=$(`[data-content-value="${CSS.escape(key)}"]`,save.closest('[data-content-section]')); if(input) state.websiteContent.values[key]=input.value;});
      await publishWebsiteContent(`Website-Inhalt veröffentlicht: ${sec.title}`);
      return;
    }
    if (event.target.closest('[data-add-gallery-item]')) { state.websiteContent=normalizeWebsiteContent(state.websiteContent||{}); state.websiteContent.gallery.push({id:`g-${Date.now()}`,src:'',title:'Neues Galeriebild',caption:'',dataUrl:'',name:'',size:0,width:0,height:0}); renderWebsiteContentEditor(true); return; }
    const card=event.target.closest('[data-gallery-item]');
    if (!card) { if(event.target.closest('[data-save-gallery]')) await saveGalleryFromEditor(); return; }
    if (event.target.closest('[data-gallery-remove]')) { state.websiteContent.gallery=state.websiteContent.gallery.filter(x=>x.id!==card.dataset.galleryItem); renderWebsiteContentEditor(true); return; }
    const move=event.target.closest('[data-gallery-move]'); if(move){ const arr=state.websiteContent.gallery; const i=arr.findIndex(x=>x.id===card.dataset.galleryItem); const n=move.dataset.galleryMove==='up'?i-1:i+1; if(n>=0&&n<arr.length){[arr[i],arr[n]]=[arr[n],arr[i]];renderWebsiteContentEditor(true);} return; }
  });
  async function saveGalleryFromEditor(){
    if (!(await confirmSensitiveAction('Website-Galerie speichern und veröffentlichen?'))) return;
    state.websiteContent=normalizeWebsiteContent(state.websiteContent||{});
    $$('[data-gallery-item]').forEach(card=>{const item=state.websiteContent.gallery.find(x=>x.id===card.dataset.galleryItem); if(item){item.title=card.querySelector('[data-gallery-title]')?.value||'';item.caption=card.querySelector('[data-gallery-caption]')?.value||'';}});
    await publishWebsiteContent('Website-Galerie veröffentlicht');
  }

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
    const admin = isAdmin();
    if (admin) {
      Object.keys(DEFAULT_SETTINGS).forEach(key => {
        if (!fd.has(key)) return;
        if (CLOUD_SETTING_KEYS.includes(key) && !includeCloud) return;
        state.settings[key] = String(fd.get(key) || '').trim();
      });
      state.settings.bonusAmount = Number(state.settings.bonusAmount || 0);
      state.settings.minOrder = Number(state.settings.minOrder || 0);
    }
    const u = state.users.find(x => x.id === currentUser);
    if (u && fd.has('userRecoveryCode')) u.recoveryCode = String(fd.get('userRecoveryCode') || '').trim() || defaultRecoveryCode(currentUser);
    const reason = admin ? (includeCloud ? 'Google/Drive Einstellungen geändert' : 'Einstellungen geändert') : 'Persönlichen Reset-Code geändert';
    saveState(reason);
    if (showToast) toast(admin ? (includeCloud ? 'Google/Drive Einstellungen gespeichert.' : 'Einstellungen gespeichert. Google/Drive bleibt separat geschützt.') : 'Persönlicher Reset-Code gespeichert.');
    fillSettings(true);
    applySetupLocks();
    return true;
  }
  $('[data-settings-form]')?.addEventListener('submit', event => {
    event.preventDefault();
    saveSettingsFromForm(true);
  });
  $('[data-save-cloud-settings]')?.addEventListener('click', async () => {
    if (!isAdmin()) return toast('Nur Admins können Google/Drive Einstellungen ändern.');
    if (!isSetupUnlocked('cloud') && !(await unlockSetupSection('cloud'))) return;
    saveSettingsFromForm(true, { includeCloud: true });
  });
  $('[data-save-personal-security]')?.addEventListener('click', () => saveSettingsFromForm(true));
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
  function excelXmlCell(value, style = 'Text') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const numberStyle = style === 'Header' || style === 'Title' ? style : (style === 'ProfitRow' ? 'ProfitNumber' : (style === 'ExpenseRow' ? 'ExpenseNumber' : (style === 'IncomeRow' ? 'IncomeNumber' : (value < 0 ? 'NegativeNumber' : 'Number'))));
      return `<Cell ss:StyleID="${numberStyle}"><Data ss:Type="Number">${value}</Data></Cell>`;
    }
    return `<Cell ss:StyleID="${style}"><Data ss:Type="String">${excelXmlEscape(value)}</Data></Cell>`;
  }
  function excelXmlWorkbook(sheets) {
    const styles = `<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/><Font ss:FontName="Aptos" ss:Size="10"/></Style>
<Style ss:ID="Title"><Font ss:Bold="1" ss:Size="17" ss:Color="#FFFFFF"/><Interior ss:Color="#06263A" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2" ss:Color="#36C5F0"/></Borders></Style>
<Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0B4F6C" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#7FDBFF"/></Borders></Style>
<Style ss:ID="Text"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDE7EC"/></Borders></Style>
<Style ss:ID="AltText"><Alignment ss:Vertical="Top" ss:WrapText="1"/><Interior ss:Color="#F3F8FA" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDE7EC"/></Borders></Style>
<Style ss:ID="Meta"><Font ss:Color="#3D5260"/><Interior ss:Color="#EEF6F8" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="Spacer"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/></Style>
<Style ss:ID="Number"><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right" ss:Vertical="Top"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDE7EC"/></Borders></Style>
<Style ss:ID="NegativeNumber"><NumberFormat ss:Format="[Red]-#,##0.00;[Red]-#,##0.00"/><Font ss:Color="#B42318"/><Alignment ss:Horizontal="Right"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#DDE7EC"/></Borders></Style>
<Style ss:ID="IncomeRow"><Font ss:Bold="1" ss:Color="#0A5A43"/><Interior ss:Color="#E7F8F1" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="IncomeNumber"><Font ss:Bold="1" ss:Color="#0A5A43"/><Interior ss:Color="#E7F8F1" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/></Style>
<Style ss:ID="ExpenseRow"><Font ss:Bold="1" ss:Color="#9F2D20"/><Interior ss:Color="#FFF0ED" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="ExpenseNumber"><Font ss:Bold="1" ss:Color="#9F2D20"/><Interior ss:Color="#FFF0ED" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/></Style>
<Style ss:ID="ProfitRow"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#087F5B" ss:Pattern="Solid"/><Alignment ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="ProfitNumber"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#087F5B" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/><Alignment ss:Horizontal="Right"/></Style>
</Styles>`;
    const body = sheets.map(([name, rows, widths = []]) => {
      const cols = widths.map(w => `<Column ss:Width="${Number(w) || 100}"/>`).join('');
      const tableRows = rows.map((row, ri) => {
        const nonEmpty = row.filter(v => String(v ?? '').trim() !== '').length;
        const first = String(row[0] ?? '');
        let style = ri === 0 ? (nonEmpty === 1 ? 'Title' : 'Header') : (nonEmpty === 0 ? 'Spacer' : (ri < 5 && rows[0]?.length === 1 ? 'Meta' : (ri % 2 === 0 ? 'AltText' : 'Text')));
        if (/^Gewinn$/i.test(first)) style = 'ProfitRow';
        else if (/^(Ausgaben|Löhne|Empfehlungsboni)/i.test(first)) style = 'ExpenseRow';
        else if (/^(Bezahlte Jobs|Manuell ergänzt|Einnahmen)/i.test(first)) style = 'IncomeRow';
        const height = style === 'Title' ? '30' : (style === 'Header' ? '28' : '22');
        return `<Row ss:AutoFitHeight="1" ss:Height="${height}">${row.map(cell => excelXmlCell(cell, style)).join('')}</Row>`;
      }).join('');
      return `<Worksheet ss:Name="${excelXmlEscape(String(name).slice(0,31))}"><Table>${cols}${tableRows}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios><PageSetup><Layout x:Orientation="Landscape"/><FitToPage/></PageSetup><Print><FitWidth>1</FitWidth><FitHeight>0</FitHeight></Print></WorksheetOptions></Worksheet>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${styles}${body}</Workbook>`;
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
  function resolveImportedEmployee(value, fallback = '') {
    const raw = String(value || '').trim();
    if (!raw) return fallback;
    const normalized = normalizeUserId(raw);
    const byId = employeeUsers().find(u => u.id === normalized);
    if (byId) return byId.id;
    const byName = employeeUsers().find(u => String(u.name || '').trim().toLowerCase() === raw.toLowerCase());
    return byName?.id || fallback;
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
      const acquiredBy = resolveImportedEmployee(o.leadgewonnendurch || o.gewonnendurch || o.acquiredby, currentUser);
      const assignedTo = resolveImportedEmployee(o.zustaendig || o.leadzustaendig || o.assignedto, acquiredBy || currentUser);
      const exists = state.leads.some(l => l.personId === person.id && l.service === (o.service || 'Fensterreinigung') && l.status === 'Offen');
      if (!exists) state.leads.push({
        id: nextId('lead'), personId: person.id,
        service: o.service || 'Fensterreinigung', source: o.quelle || o.source || 'Import',
        expectedValue: o.betrag || o.schaetzung || o.expectedvalue || '',
        appointmentAt: dateForInput(o.termin || o.appointment || o.appointmentat),
        referredById: person.referredById || '', status:'Offen', notes:o.notizen || o.notes || '',
        acquiredBy, assignedTo, commissionAgreement:commissionAgreementForLead(acquiredBy),
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
  function renderExpenseEmployeeOptions(selected = '') {
    const sel = $('[data-expense-employee-select]');
    if (!sel) return;
    sel.innerHTML = `<option value="">– Mitarbeiter wählen –</option>${employeeUsers().map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}`;
    sel.value = selected || '';
    renderExpenseJobOptions();
  }
  function renderExpenseJobOptions(selected = '') {
    const form = $('[data-expense-form]');
    const sel = $('[data-expense-job-select]');
    if (!form || !sel) return;
    const employeeId = form.elements.employeeId?.value || '';
    const jobs = employeeId ? state.jobs.filter(j=>jobTeamIds(j).includes(employeeId) || j.acquiredBy === employeeId) : [];
    sel.innerHTML = `<option value="">– optional / kein Auftrag –</option>${jobs.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(j=>{const p=personById(j.personId)||{}; return `<option value="${esc(j.id)}">${esc(j.id)} · ${esc(p.name || j.personId)} · ${esc(j.service || '')}</option>`}).join('')}`;
    if (selected && [...sel.options].some(o=>o.value===selected)) sel.value=selected;
    updateExpenseJobHint();
  }
  function updateExpenseJobHint() {
    const form = $('[data-expense-form]'); const el = $('[data-expense-job-hint]'); if (!form || !el) return;
    const job = jobById(form.elements.jobId?.value || ''); const employeeId=form.elements.employeeId?.value || '';
    if (!job) { el.innerHTML=''; return; }
    const auto = (state.finance.expenses || []).filter(x=>x.automatic && x.jobId===job.id && (!employeeId || x.employeeId===employeeId) && !x.deletedAt);
    el.innerHTML = auto.length ? `<strong>Bereits automatisch für diesen Auftrag:</strong> ${auto.map(x=>`${esc(x.subtype || x.title)} ${esc(money(x.amount))}`).join(' · ')}` : 'Für diese Kombination besteht noch keine automatische Lohnposition.';
  }
  function updateExpenseEmployeeFields() {
    const form=$('[data-expense-form]'); const box=$('[data-employee-expense-fields]'); if (!form || !box) return;
    const active=form.elements.category.value==='Löhne & Mitarbeiter'; box.hidden=!active;
    if (active) renderExpenseEmployeeOptions(form.elements.employeeId?.value || '');
  }
  $('[data-expense-form] [name="category"]')?.addEventListener('change', updateExpenseEmployeeFields);
  $('[data-expense-employee-select]')?.addEventListener('change', ()=>renderExpenseJobOptions());
  $('[data-expense-job-select]')?.addEventListener('change', updateExpenseJobHint);

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
      subtype: fd.get('category') === 'Löhne & Mitarbeiter' ? (fd.get('subtype') || 'Sonstige Mitarbeiterkosten') : '',
      employeeId: fd.get('category') === 'Löhne & Mitarbeiter' ? normalizeUserId(fd.get('employeeId') || '') : '',
      jobId: fd.get('category') === 'Löhne & Mitarbeiter' ? String(fd.get('jobId') || '') : '',
      paymentStatus: fd.get('category') === 'Löhne & Mitarbeiter' ? (fd.get('paymentStatus') === 'bezahlt' ? 'bezahlt' : 'offen') : '',
      employeePaidAt: fd.get('category') === 'Löhne & Mitarbeiter' && fd.get('paymentStatus') === 'bezahlt' ? (entry.employeePaidAt || new Date().toISOString()) : '',
      employeePaidBy: fd.get('category') === 'Löhne & Mitarbeiter' && fd.get('paymentStatus') === 'bezahlt' ? currentUser : '',
      title: fd.get('title'),
      amount: amountValue(fd.get('amount')),
      notes: fd.get('notes') || ''
    });
    saveState(`${entry.updatedBy ? 'Ausgabe geändert' : 'Ausgabe gespeichert'}: ${entry.id} / ${entry.title || ''}`);
    form.reset();
    setDefaultFinanceDates();
    updateExpenseEmployeeFields();
    renderFinance();
    toast(entry.updatedAt ? 'Ausgabe geändert.' : 'Ausgabe gespeichert.');
  }

  function userFormPermissionNames() {
    return {
      createLeads:'permCreateLeads', viewAllOperational:'permViewAllOperational', contactCustomers:'permContactCustomers',
      updateJobs:'permUpdateJobs', uploadPhotos:'permUploadPhotos', viewJobAmount:'permViewJobAmount',
      viewOwnCompensation:'permViewOwnCompensation', viewCustomerHistory:'permViewCustomerHistory',
      manageWebsiteLeads:'permManageWebsiteLeads'
    };
  }
  function userEditorFields(form = $('[data-user-form]')) {
    const fields = {};
    if (!form) return fields;
    $$('[name]', form).forEach(el => { fields[el.name] = el; });
    return fields;
  }
  function applyRolePresetToUserForm(role) {
    const form = $('[data-user-form]');
    const fields = userEditorFields(form);
    if (!form) return;
    const preset = defaultPermissionsForRole(role);
    Object.entries(userFormPermissionNames()).forEach(([key,name]) => { if (fields[name]) fields[name].checked = !!preset[key]; });
  }
  $('[data-user-form] [name="role"]')?.addEventListener('change', event => applyRolePresetToUserForm(event.target.value));
  function updateEmployeePayFields() { const form=$('[data-user-form]'); if (!form) return; const fields=userEditorFields(form); const wrap=$('[data-hourly-rate-field]',form); if (wrap) wrap.hidden = (fields.defaultPayType?.value || 'none') !== 'hourly'; }
  $('[data-user-form] [name="defaultPayType"]')?.addEventListener('change', updateEmployeePayFields);

  function resetUserEditor() {
    const form = $('[data-user-form]');
    if (!form) return;
    const fields = userEditorFields(form);
    $$('input, select, textarea', form).forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = false;
      else el.value = '';
    });
    fields.editingUserId.value = '';
    fields.role.value = 'staff';
    fields.employeeType.value = 'fixed';
    fields.defaultPayType.value = 'none';
    fields.loginEnabled.checked = true;
    applyRolePresetToUserForm('staff');
    $('[data-cancel-user-edit]').hidden = true;
    $('[data-save-user]').textContent = 'Mitarbeiter speichern';
    fields.userId.disabled = false;
    updateEmployeePayFields();
  }
  function editUserInForm(userId) {
    if (!isAdmin()) return;
    const u = employeeById(userId);
    const form = $('[data-user-form]');
    if (!u || !form) return;
    const fields = userEditorFields(form);
    const d = normalizeCompensationDefaults(u.compensationDefaults || {});
    fields.editingUserId.value = u.id;
    fields.userId.value = u.id;
    fields.userId.disabled = true;
    fields.name.value = u.name || '';
    fields.emoji.value = u.emoji || '';
    fields.phone.value = u.phone || '';
    fields.email.value = u.email || '';
    fields.employeeType.value = u.employeeType || 'fixed';
    fields.role.value = normalizedRole(u.role, u.id) === 'admin' ? 'teamlead' : normalizedRole(u.role, u.id);
    fields.loginEnabled.checked = u.loginEnabled !== false;
    fields.password.value = '';
    fields.recoveryCode.value = u.recoveryCode || '';
    fields.defaultPayType.value = d.workPayType || 'none';
    fields.defaultHourlyRate.value = d.hourlyRate || '';
    fields.firstCommissionPct.value = d.firstCommissionPct || '';
    fields.repeatCommissionPct.value = d.repeatCommissionPct || '';
    fields.maxCommissionJobs.value = d.maxCommissionJobs || '';
    fields.commissionActive.checked = d.commissionActive;
    const perms = userPermissions(u.id);
    Object.entries(userFormPermissionNames()).forEach(([key,name]) => { fields[name].checked = !!perms[key]; });
    $('[data-cancel-user-edit]').hidden = false;
    $('[data-save-user]').textContent = 'Mitarbeiter aktualisieren';
    updateEmployeePayFields();
    form.scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function renderUsers() {
    const list = $('[data-user-list]');
    if (!list) return;
    if (!isAdmin()) { list.innerHTML = ''; return; }
    list.innerHTML = (state.users || []).map(u => {
      const locked = ADMIN_IDS.includes(u.id);
      const d = normalizeCompensationDefaults(u.compensationDefaults || {});
      const status = u.employmentActive === false ? 'Inaktiv' : (u.loginEnabled === false ? 'Aktiv · ohne Login' : 'Aktiv · Login');
      const work = d.workPayType === 'hourly' ? `Stundenlohn ${money(d.hourlyRate)}/Std.` : (d.workPayType === 'fixed' ? 'Fixbetrag pro Auftrag' : 'Keine Standard-Arbeitsvergütung');
      const pay = [work, (d.firstCommissionPct||d.repeatCommissionPct)?`Akquise ${d.firstCommissionPct}% / ${d.repeatCommissionPct}%`:'' ].filter(Boolean).join(' · ');
      const specialRights = userPermissions(u.id).manageWebsiteLeads ? ' · Website-Leads' : '';
      return `<article class="item-card mini ${u.employmentActive===false?'employee-inactive':''}">
        <div class="item-top"><div><div class="item-title">${esc(u.name)} <span class="badge">${esc(u.id)}</span></div><div class="item-sub">${esc(roleLabel(u.role))}${specialRights} · ${u.employeeType==='temporary'?'Temporär / Hilfskraft':'Fest / regelmässig'} · ${esc(status)}<br>${esc(u.phone || 'keine Telefonnummer')} · ${esc(u.email || 'keine E-Mail')}<br>${esc(pay)}</div></div><span class="badge ${u.employmentActive===false?'danger':u.loginEnabled===false?'warn':'ok'}">${esc(u.emoji || '?')}</span></div>
        <div class="actions">${locked ? '<span class="hint">Admin-Benutzer geschützt</span>' : `<button class="secondary" data-edit-user="${esc(u.id)}">Bearbeiten</button><button class="secondary ${u.employmentActive===false?'':'danger'}" data-toggle-user-active="${esc(u.id)}">${u.employmentActive===false?'Reaktivieren':'Deaktivieren'}</button>`}</div>
      </article>`;
    }).join('');
  }

  async function saveUserFromSetup() {
    const form = $('[data-user-form]');
    if (!form || !isAdmin()) return toast('Nur Noah und Timo können Mitarbeiter verwalten.');
    const fields = userEditorFields(form);
    const editingId = normalizeUserId(fields.editingUserId.value || '');
    const id = editingId || normalizeUserId(fields.userId.value);
    if (!id || id.length < 2) return toast('Benutzername: mindestens 2 Zeichen.');
    if (ADMIN_IDS.includes(id)) return toast('Noah und Timo sind geschützte Admin-Benutzer.');
    const email = String(fields.email.value || '').trim();
    if (email && !validateEmail(email)) return toast('Bitte eine gültige Mitarbeiter-E-Mail eingeben.');
    const parsedPhone = parseSwissPhone(fields.phone.value || '');
    if (!parsedPhone.ok) return toast('Bitte eine gültige Schweizer Telefonnummer eingeben.');
    const pw = String(fields.password.value || '');
    let u = state.users.find(x => x.id === id);
    const isNew = !u;
    if (isNew && fields.loginEnabled.checked && pw.length < 4) return toast('Für einen neuen Portal-Login braucht es ein Start-Passwort mit mindestens 4 Zeichen.');
    if (pw && pw.length < 4) return toast('Passwort: mindestens 4 Zeichen.');
    if (!u) {
      u = normalizeEmployeeUser({ id, name:id, role:fields.role.value, employmentActive:true, loginEnabled:fields.loginEnabled.checked });
      state.users.push(u);
    }
    const role = normalizedRole(fields.role.value, id);
    const permissions = {};
    Object.entries(userFormPermissionNames()).forEach(([key,name]) => { permissions[key] = !!fields[name].checked; });
    Object.assign(u, normalizeEmployeeUser({
      ...u, id,
      name:String(fields.name.value || id).trim(),
      emoji:String(fields.emoji.value || fields.name.value.slice(0,1) || id.slice(0,1)).trim().slice(0,2),
      phone:parsedPhone.ok && !parsedPhone.empty ? parsedPhone.tel : '',
      email, employeeType:fields.employeeType.value, role,
      employmentActive:true, loginEnabled:fields.loginEnabled.checked, active:fields.loginEnabled.checked,
      recoveryCode:String(fields.recoveryCode.value || `${fields.name.value || id}-Reset-2026`).trim(),
      permissions,
      compensationDefaults:{
        workPayType:fields.defaultPayType.value,
        hourlyRate:fields.defaultHourlyRate.value,
        firstCommissionPct:fields.firstCommissionPct.value,
        repeatCommissionPct:fields.repeatCommissionPct.value,
        maxCommissionJobs:fields.maxCommissionJobs.value,
        commissionActive:fields.commissionActive.checked
      }
    }));
    if (pw) await setPassword(id, pw);
    saveState(`Mitarbeiter ${isNew?'erstellt':'aktualisiert'}: ${u.id}`);
    resetUserEditor();
    renderUserOptions();
    renderUsers();
    toast(`Mitarbeiter ${u.name} ${isNew?'gespeichert':'aktualisiert'}.`);
  }
  $('[data-save-user]')?.addEventListener('click', saveUserFromSetup);
  $('[data-cancel-user-edit]')?.addEventListener('click', resetUserEditor);

  document.addEventListener('click', event => {
    const edit = event.target.closest('[data-edit-user]');
    if (edit) editUserInForm(edit.dataset.editUser);
    const toggle = event.target.closest('[data-toggle-user-active]');
    if (!toggle) return;
    if (!isAdmin()) return toast('Nur Admins können Mitarbeiter deaktivieren.');
    const u = state.users.find(x => x.id === toggle.dataset.toggleUserActive);
    if (!u || ADMIN_IDS.includes(u.id)) return;
    const activate = u.employmentActive === false;
    if (!activate && !confirm(`${u.name} wirklich deaktivieren? Bestehende Aufträge und Lohnbuchungen bleiben erhalten.`)) return;
    u.employmentActive = activate;
    u.loginEnabled = activate ? u.loginEnabled !== false : false;
    u.active = u.loginEnabled;
    saveState(`Mitarbeiter ${activate?'reaktiviert':'deaktiviert'}: ${u.id}`);
    renderUserOptions(); renderUsers();
    toast(`Mitarbeiter ${activate?'reaktiviert':'deaktiviert'}.`);
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

  ['[data-income-search]','[data-income-type-filter]','[data-expense-search]','[data-expense-type-filter]','[data-expense-status-filter]'].forEach(selector => {
    const el = $(selector);
    if (!el) return;
    el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => renderFinance());
  });
  let financeScrollResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(financeScrollResizeTimer);
    financeScrollResizeTimer = setTimeout(() => {
      if (activeTab === 'finance') { applyFiveCardScroll($('[data-income-list]')); applyFiveCardScroll($('[data-expense-list]')); }
    }, 120);
  });

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

    const deferredPayment = event.target.closest('[data-toggle-deferred-payment]');
    if (deferredPayment) {
      const entry = (state.finance.expenses || []).find(x => x.id === deferredPayment.dataset.toggleDeferredPayment);
      if (!entry || !isDeferredExpenseRecord(entry) || !isAdmin()) return;
      entry.paymentStatus = deferredExpensePaymentStatus(entry) === 'bezahlt' ? 'offen' : 'bezahlt';
      entry.paidAt = entry.paymentStatus === 'bezahlt' ? new Date().toISOString() : '';
      entry.paidBy = currentUser;
      if (isEmployeeExpenseRecord(entry)) { entry.employeePaidAt = entry.paidAt; entry.employeePaidBy = currentUser; }
      if (isRewardExpenseRecord(entry) && entry.rewardId) {
        const reward = (state.rewards || []).find(r => r.id === entry.rewardId);
        if (reward) {
          reward.status = entry.paymentStatus === 'bezahlt' ? 'eingelöst / ausbezahlt' : 'gutgeschrieben';
          reward.redeemedAt = entry.paymentStatus === 'bezahlt' ? entry.paidAt : '';
          reward.redeemedBy = entry.paymentStatus === 'bezahlt' ? currentUser : '';
          reward.updatedAt = new Date().toISOString(); reward.updatedBy = currentUser;
        }
      }
      saveState(`${isEmployeeExpenseRecord(entry)?'Mitarbeiterlohn':'Empfehlungsbonus'} ${entry.paymentStatus}: ${entry.id} / Auftrag ${entry.jobId || ''}`);
      renderAll();
      toast(isEmployeeExpenseRecord(entry) ? (entry.paymentStatus === 'bezahlt' ? 'Mitarbeiterlohn als bezahlt markiert.' : 'Mitarbeiterlohn wieder als offen markiert.') : (entry.paymentStatus === 'bezahlt' ? 'Empfehlungsbonus als eingelöst / ausbezahlt markiert.' : 'Empfehlungsbonus wieder als gutgeschrieben markiert.'));
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
      updateExpenseEmployeeFields();
      if (form.elements.employeeId) { renderExpenseEmployeeOptions(entry.employeeId || ''); form.elements.employeeId.value = entry.employeeId || ''; }
      if (form.elements.subtype) form.elements.subtype.value = entry.subtype || 'Sonstige Mitarbeiterkosten';
      if (form.elements.paymentStatus) form.elements.paymentStatus.value = employeeExpensePaymentStatus(entry) || 'offen';
      renderExpenseJobOptions(entry.jobId || '');
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
      ['Löhne & Mitarbeiter bezahlt', -s.employeeCostTotal, `${s.employeePaidExpenses.length} bezahlt · ${s.employeeOpenExpenses.length} offen (${money(s.employeeOpenTotal)})`],
      ['Empfehlungsboni eingelöst / ausbezahlt', -s.rewardPaidTotal, `${s.rewardPaidExpenses.length} bezahlt · ${s.rewardOpenExpenses.length} gutgeschrieben/offen (${money(s.rewardOpenTotal)})`],
      ['Ausgaben gesamt', -s.expenseTotal, `${s.countedExpenses.length} gebuchte Kostenposition(en)`],
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
      ['Datum','Kategorie','Unterart','Titel','Betrag CHF','Mitarbeiter','Auftrags-Nr.','Kunden-Nr.','Zahlstatus','Automatisch','Eingetragen von','Notiz','ID'],
      ...s.expenses.map(x => [fmtDateOnly(x.date), x.category || 'Ausgabe', x.subtype || '', x.title, amountValue(x.amount), x.employeeId ? userName(x.employeeId) : '', x.jobId || '', x.personId || '', deferredExpensePaymentStatus(x) || x.paymentStatus || '', x.automatic ? 'Ja' : 'Nein', userName(x.createdBy), x.notes || '', x.id])
    ];
    const rewardRows = [
      ['BonusID','Empfänger','Empfänger LumianNr','Neukunde','Auftrags-Nr.','Betrag CHF','Bonusstatus','Buchhaltung Zahlstatus','Gutgeschrieben am','Eingelöst / ausbezahlt am'],
      ...(state.rewards || []).filter(r => !r.deletedAt).map(r => {
        const receiver = personById(r.customerId) || {};
        const source = personById(r.fromPersonId) || {};
        const expense = (state.finance?.expenses || []).find(x => x.rewardId === r.id && !x.deletedAt);
        return [r.id || '', receiver.name || '', r.customerId || '', source.name || '', r.jobId || '', amountValue(r.amount || 0), r.status || 'offen', expense ? deferredExpensePaymentStatus(expense) : '', r.creditedAt ? fmtDate(r.creditedAt) : '', r.redeemedAt ? fmtDate(r.redeemedAt) : ''];
      })
    ];
    const employeeCostRows = [
      ['Mitarbeiter','Mitarbeiter-ID','Auftrags-Nr.','Kunden-Nr.','Vergütungsart','Stunden','Ansatz/Fix CHF','Betrag CHF','Zahlstatus','Datum'],
      ...s.employeeExpenses.map(x => {
        const job = x.jobId ? jobById(x.jobId) : null;
        const line = job?.compensationLines?.find(l => l.id === x.compensationLineId);
        return [x.employeeId ? userName(x.employeeId) : '', x.employeeId || '', x.jobId || '', x.personId || '', x.subtype || '', line?.hours || '', line?.type === 'hourly' ? amountValue(line.rate) : (line?.type === 'fixed' ? amountValue(line.amount) : ''), amountValue(x.amount), employeeExpensePaymentStatus(x), fmtDateOnly(x.date || x.createdAt)];
      })
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
      ['Ausgaben', expenseRows, [90,150,130,240,90,150,100,100,120,90,130,260,130]],
      ['Mitarbeiterkosten', employeeCostRows, [160,110,110,110,150,80,100,100,120,100]],
      ['Empfehlungsbonus', rewardRows, [90,170,110,170,110,100,130,140,140,150]],
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
    return [['LumianNr','Status','Name','Telefon','Email','Strasse/Nr','PLZ/Ort','Quelle','EmpfohlenVon','Kontaktstatus','Kontaktgrund','Kontaktnotiz','KundeSeit','Jobs bezahlt','Umsatz CHF','Lead gewonnen durch','Provisionsvereinbarung JSON','Notizen','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...allPeopleSorted().map(p => {
        const pj = paid.filter(j => j.personId === p.id);
        const revenue = pj.reduce((sum,j)=>sum + amountValue(j.amount), 0);
        return [p.id, personStatusLabel(p), p.name || '', p.phone || '', p.email || '', p.address || '', p.place || '', p.source || '', p.referredById || '', contactStatus(p), p.contactReason || '', p.contactNote || '', p.customerSince ? fmtDateOnly(p.customerSince) : '', pj.length, revenue, p.acquisitionAgreement?.employeeId ? userName(p.acquisitionAgreement.employeeId) : '', JSON.stringify(p.acquisitionAgreement || null), p.notes || '', p.createdAt ? fmtDate(p.createdAt) : '', userName(p.createdBy), p.updatedAt ? fmtDate(p.updatedAt) : '', userName(p.updatedBy), p.deletedAt ? fmtDate(p.deletedAt) : ''];
      })
    ];
  }
  function emergencyLeadsRows() {
    const sorted = [...(state.leads || [])].sort((a,b)=>String(a.id||'').localeCompare(String(b.id||''), 'de-CH'));
    return [['LeadID','LumianNr','Name','Telefon','Email','Service','Status','Termin','Schätzung CHF','Quelle','EmpfohlenVon','Lead gewonnen durch','Lead zuständig','Provisionsvereinbarung JSON','Notizen','WebsiteLeadKey','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(l => {
        const p = personById(l.personId) || {};
        return [l.id || '', l.personId || '', p.name || '', p.phone || '', p.email || '', l.service || '', l.status || '', l.appointmentAt ? fmtDate(l.appointmentAt) : '', amountValue(l.expectedValue || 0), l.source || '', l.referredById || p.referredById || '', userName(l.acquiredBy), userName(l.assignedTo), JSON.stringify(l.commissionAgreement || null), l.notes || '', l.websiteLeadKey || '', l.createdAt ? fmtDate(l.createdAt) : '', userName(l.createdBy), l.updatedAt ? fmtDate(l.updatedAt) : '', userName(l.updatedBy), l.deletedAt ? fmtDate(l.deletedAt) : ''];
      })
    ];
  }
  function emergencyJobsRows() {
    const sorted = [...(state.jobs || [])].sort((a,b)=>String(a.appointmentAt || a.createdAt || '').localeCompare(String(b.appointmentAt || b.createdAt || '')) || String(a.id||'').localeCompare(String(b.id||'')));
    return [['Auftrags-Nr.','LumianNr','Name','Telefon','LeadID','Service','Termin','Betrag CHF','Status','Hauptverantwortlich','Team','Lead gewonnen durch','Mitarbeiterkosten CHF','Vergütungspositionen JSON','Quelle','EmpfohlenVon','Notizen','Bezahlt am','Abgeschlossen am','Vorher Foto','Nachher Foto','Calendar Event ID','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(j => {
        const p = personById(j.personId) || {};
        const lines = Array.isArray(j.compensationLines) ? j.compensationLines : [];
        const employeeCost = lines.reduce((sum,line)=>sum + compensationLineAmount(line), 0);
        return [j.id || '', j.personId || '', p.name || '', p.phone || '', j.leadId || '', j.service || '', j.appointmentAt ? fmtDate(j.appointmentAt) : '', amountValue(j.amount || 0), j.status || '', userName(j.assignedTo), (j.teamMemberIds || []).map(userName).join(', '), userName(j.acquiredBy), employeeCost, JSON.stringify(lines), j.source || '', j.referredById || p.referredById || '', j.notes || '', j.paidAt ? fmtDate(j.paidAt) : '', j.completedAt ? fmtDate(j.completedAt) : '', photoBackupInfo(j.beforePhoto), photoBackupInfo(j.afterPhoto), j.calendarEventId || '', j.createdAt ? fmtDate(j.createdAt) : '', userName(j.createdBy), j.updatedAt ? fmtDate(j.updatedAt) : '', userName(j.updatedBy), j.deletedAt ? fmtDate(j.deletedAt) : ''];
      })
    ];
  }
  function emergencyRewardsRows() {
    const sorted = [...(state.rewards || [])].sort((a,b)=>String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    return [['BonusID','Empfänger LumianNr','Empfänger Name','Von LumianNr','Von Name','JobID','Betrag CHF','Status','Buchhaltung Zahlstatus','Gutgeschrieben am','Gutgeschrieben von','Eingelöst / ausbezahlt am','Eingelöst / ausbezahlt von','Notiz','Erstellt am','Erstellt von','Geändert am','Geändert von','Gelöscht am'],
      ...sorted.map(r => {
        const receiver = personById(r.customerId) || {};
        const source = personById(r.fromPersonId) || {};
        const expense = (state.finance?.expenses || []).find(x => x.rewardId === r.id && !x.deletedAt);
        return [r.id || '', r.customerId || '', receiver.name || '', r.fromPersonId || '', source.name || '', r.jobId || '', amountValue(r.amount || 0), r.status || '', expense ? deferredExpensePaymentStatus(expense) : '', r.creditedAt ? fmtDate(r.creditedAt) : '', userName(r.creditedBy), r.redeemedAt ? fmtDate(r.redeemedAt) : '', userName(r.redeemedBy), r.notes || '', r.createdAt ? fmtDate(r.createdAt) : '', userName(r.createdBy), r.updatedAt ? fmtDate(r.updatedAt) : '', userName(r.updatedBy), r.deletedAt ? fmtDate(r.deletedAt) : ''];
      })
    ];
  }
  function emergencyEmployeesRows() {
    return [['Mitarbeiter-ID','Name','Telefon','E-Mail','Typ','Rolle','Beschäftigung aktiv','Portal-Login aktiv','Rechte JSON','Standardvergütung JSON'],
      ...(state.users || []).map(u => [u.id || '',u.name || '',u.phone || '',u.email || '',u.employeeType || '',roleLabel(u.role),u.employmentActive === false ? 'Nein' : 'Ja',u.loginEnabled === false ? 'Nein' : 'Ja',JSON.stringify(u.permissions || {}),JSON.stringify(u.compensationDefaults || {})])
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
      ['Löhne & Mitarbeiter bezahlt', -s.employeeCostTotal, `${s.employeePaidExpenses.length} bezahlt · ${s.employeeOpenExpenses.length} offen (${money(s.employeeOpenTotal)})`],
      ['Empfehlungsboni eingelöst / ausbezahlt', -s.rewardPaidTotal, `${s.rewardPaidExpenses.length} bezahlt · ${s.rewardOpenExpenses.length} gutgeschrieben/offen (${money(s.rewardOpenTotal)})`],
      ['Ausgaben gesamt', -s.expenseTotal, `${s.countedExpenses.length} gebuchte Kostenposition(en)`],
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
      ['Datum','Kategorie','Unterart','Titel','Betrag CHF','Mitarbeiter','Auftrags-Nr.','Kunden-Nr.','Zahlstatus','Automatisch','Eingetragen von','Notiz','ID','Gelöscht am'],
      ...(state.finance?.expenses || []).map(x => [x.date ? fmtDateOnly(x.date) : fmtDateOnly(x.createdAt), x.category || 'Ausgabe', x.subtype || '', x.title || '', amountValue(x.amount), x.employeeId ? userName(x.employeeId) : '', x.jobId || '', x.personId || '', deferredExpensePaymentStatus(x) || x.paymentStatus || '', x.automatic ? 'Ja' : 'Nein', userName(x.createdBy), x.notes || '', x.id || '', x.deletedAt ? fmtDate(x.deletedAt) : ''])
    ];
    return [
      ['Zusammenfassung', summary, [220,160,300]],
      ['Einnahmen', incomeRows, [150,90,90,220,140,90,130,240,100,120]],
      ['Pipeline offen', forecastRows, [130,90,240,130,90,130,120]],
      ['Ausgaben', expenseRows, [90,140,120,220,90,150,100,100,100,90,130,240,110,120]],
      ['Bonus', emergencyRewardsRows(), [90,90,170,90,170,90,90,100,120,140,130,160,150,220,130,120,130,120,120]]
    ];
  }
  function emergencyWebsiteContentSheets() {
    const content = normalizeWebsiteContent(state.websiteContent || {});
    const values = [['Schlüssel','Wert'], ...Object.entries(content.values || {}).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,value])=>[key,value])];
    const media = [['Schlüssel','Bild-URL','Dateiname','Drive File ID','Aktualisiert am'], ...Object.entries(content.media || {}).sort((a,b)=>a[0].localeCompare(b[0])).map(([key,item])=>[key,canonicalWebsiteAssetUrl(item?.src || ''),item?.name || '',item?.fileId || '',item?.updatedAt || ''])];
    const gallery = [['Reihenfolge','Galerie-ID','Titel','Beschreibung','Bild-URL','Dateiname','Dateigrösse Byte','Breite px','Höhe px','Drive File ID'], ...(content.gallery || []).map((item,index)=>[index+1,item.id || '',item.title || '',item.caption || '',canonicalWebsiteAssetUrl(item.src || ''),item.name || '',Number(item.size || 0),Number(item.width || 0),Number(item.height || 0),item.fileId || ''])];
    return [['Texte & Links', values, [260,620]], ['Bilder', media, [240,520,180,170,150]], ['Galerie', gallery, [90,110,180,380,520,180,110,90,90,170]]];
  }
  function emergencyWorkbookFiles() {
    return {
      'excel/lumian-mitarbeiter.xls': excelXmlWorkbook([['Mitarbeiter', emergencyEmployeesRows(), [110,180,130,190,110,130,110,110,300,300]]]),
      'excel/lumian-kunden.xls': excelXmlWorkbook([['Kunden', emergencyCustomersRows(), [90,80,180,130,190,190,130,130,110,120,170,220,100,90,90,150,300,260,130,120,130,120,120]]]),
      'excel/lumian-leads.xls': excelXmlWorkbook([['Leads', emergencyLeadsRows(), [90,90,180,130,190,150,100,130,100,120,110,150,150,300,260,180,130,120,130,120,120]]]),
      'excel/lumian-jobs.xls': excelXmlWorkbook([['Jobs', emergencyJobsRows(), [100,90,180,130,90,150,130,90,100,150,220,150,110,320,120,110,260,130,130,260,260,180,130,120,130,120,120]]]),
      'excel/lumian-buchhaltung-und-bonus.xls': excelXmlWorkbook(emergencyFinanceSheets()),
      'excel/lumian-website-inhalte.xls': excelXmlWorkbook(emergencyWebsiteContentSheets())
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
      'README-WIEDERHERSTELLUNG.txt': `Lumian Services lokales Komplettbackup\nErstellt: ${new Date().toLocaleString('de-CH')}\n\nZum Wiederherstellen im Portal unter Einstellungen > Daten, Import & Backup den gesperrten Bereich entsperren und diese ZIP-Datei bei "Lokales Komplettbackup importieren" auswählen. Die JSON-Datei enthält den vollständigen Portalstand inklusive Mitarbeiter, Rechte, Leads, Aufträge, Vergütungen, Buchhaltung, Empfehlungsboni, Website-Inhalte, Galerie und Einstellungen. Die Excel-Dateien dienen zusätzlich zur Kontrolle und Lesbarkeit.`,
      'lumian-portal-full-backup.json': JSON.stringify(full, null, 2),
      'lumian-portal-meta.json': JSON.stringify({ createdAt:new Date().toISOString(), createdBy:currentUser, portalMode:state.portalMode || '', users:(state.users||[]).length, people:(state.people||[]).length, leads:(state.leads||[]).length, jobs:(state.jobs||[]).length, rewards:(state.rewards||[]).length, manualIncome:(state.finance?.manualIncome||[]).length, expenses:(state.finance?.expenses||[]).length, websiteContentUpdatedAt:state.websiteContent?.updatedAt || '', galleryItems:(state.websiteContent?.gallery||[]).length }, null, 2),
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

  function cloudRequestUrls(preferredUrl = '') {
    const urls = [preferredUrl, currentScriptUrl(), DEFAULT_SETTINGS.scriptUrl]
      .map(u => String(u || '').trim())
      .filter(Boolean);
    return Array.from(new Set(urls));
  }

  function rememberWorkingScriptUrl(url) {
    const working = String(url || '').trim();
    if (!working || working === currentScriptUrl()) return;
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}), scriptUrl: working };
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    const input = document.querySelector('[name="scriptUrl"]');
    if (input) input.value = working;
  }

  function autoLoadCloudThenCheckWebsiteLeads() {
    if (!isAdmin()) return;
    const url = currentScriptUrl();
    if (!url && !DEFAULT_SETTINGS.scriptUrl) return;
    if (autoLoadCloudThenCheckWebsiteLeads._busy) return;
    autoLoadCloudThenCheckWebsiteLeads._busy = true;

    jsonpRequest(url || DEFAULT_SETTINGS.scriptUrl, 'load')
      .then(data => {
        const cloudState = data?.state;
        if (data?._usedUrl) rememberWorkingScriptUrl(data._usedUrl);
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
      })
      .catch(() => {})
      .finally(() => {
        autoLoadCloudThenCheckWebsiteLeads._busy = false;
        checkWebsiteLeads(true);
      });
  }

  function checkWebsiteLeads(silent = false) {
    if (!canManageWebsiteLeads()) {
      if (!silent) toast('Keine Berechtigung zum Prüfen und Importieren von Website-Leads.');
      return;
    }
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl() || DEFAULT_SETTINGS.scriptUrl;
    if (!url) {
      const msg = 'Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.';
      if (!silent) { toast(msg); setWebLeadsStatus(msg, 'error'); }
      return;
    }

    const btn = document.activeElement?.matches?.('[data-check-website-leads]') ? document.activeElement : null;
    const oldText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = 'Prüfe...'; }
    if (!silent) setWebLeadsStatus('Web-Leads werden geprüft...', 'loading');

    const finish = (message, tone = '') => {
      if (btn) { btn.disabled = false; btn.textContent = oldText || 'Web-Leads prüfen'; }
      if (!silent && message) { toast(message); setWebLeadsStatus(message, tone); }
    };

    jsonpRequest(url, 'websiteLeads')
      .then(data => {
        if (data?._usedUrl) rememberWorkingScriptUrl(data._usedUrl);
        const rows = data?.leads || [];
        const count = importWebsiteLeads(rows);
        if (count) finish(`${count} neue Website-/Danke-Code-Anfrage(n) importiert.`, 'ok');
        else finish(`Keine neuen Web-Leads gefunden. Gesamt in Cloud: ${rows.length}.`, rows.length ? 'ok' : '');
      })
      .catch(err => {
        finish('Web-Leads konnten nicht geladen werden: ' + String(err?.message || err).slice(0,120), 'error');
      });
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
  async function loadCloud() {
    suppressAutoCloudSync = true;
    saveSettingsFromForm(false);
    suppressAutoCloudSync = false;
    const url = currentScriptUrl() || DEFAULT_SETTINGS.scriptUrl;
    if (!url) return toast('Bitte zuerst Google Apps Script URL in den Einstellungen eintragen.');
    try {
      const data = await jsonpRequest(url, 'load');
      if (!data || !data.state) throw new Error('empty');
      if (data._usedUrl) rememberWorkingScriptUrl(data._usedUrl);
      suppressAutoCloudSync = true;
      const imported = mergeCloudStatePreserveLocalMedia(state, data.state);
      state = migrateState(imported);
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      suppressAutoCloudSync = false;
      renderAll();
      queueActivity('Refresh / Cloud geladen', 'Sync', '', 'Aktuelle Cloud-Daten wurden auf dieses Gerät geladen.', { flush: true });
      toast('Cloud geladen und mit diesem Gerät abgeglichen.');
    } catch (err) {
      toast('Cloud laden fehlgeschlagen. Bitte Web-App Cache erneuern oder Apps Script URL prüfen.');
    }
  }

  function jsonpRequestOnce(url, action, params = {}, timeoutMs = 14000) {
    return new Promise((resolve, reject) => {
      const callbackName = `lumianJsonp_${action}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
      const script = document.createElement('script');
      let done = false;
      let timer = null;
      const cleanup = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { delete window[callbackName]; } catch {}
        script.remove();
      };
      const qs = new URLSearchParams(Object.assign({}, params, { action, callback: callbackName, t: Date.now() }));
      window[callbackName] = data => {
        cleanup();
        if (data && typeof data === 'object') data._usedUrl = url;
        resolve(data);
      };
      timer = setTimeout(() => { cleanup(); reject(new Error('Keine Antwort vom Google Script.')); }, timeoutMs);
      script.onerror = () => { cleanup(); reject(new Error('Apps Script konnte nicht geladen werden. URL/Deployment prüfen.')); };
      script.src = `${url}${url.includes('?')?'&':'?'}${qs.toString()}`;
      document.body.appendChild(script);
    });
  }

  async function jsonpRequest(url, action, params = {}) {
    const urls = cloudRequestUrls(url);
    let lastError = null;
    for (const candidate of urls) {
      try {
        return await jsonpRequestOnce(candidate, action, params);
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('Apps Script konnte nicht geladen werden.');
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
    queueActivity('Web-App Cache erneuert', 'Cache', '', 'Technischer App-Cache und alter Service Worker auf diesem Gerät wurden erneuert.', { flush: true });
    let cleared = 0;
    let unregistered = 0;
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key).then(ok => { if (ok) cleared += 1; })));
      }
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(reg => reg.unregister().then(ok => { if (ok) unregistered += 1; }).catch(() => {})));
      }
      toast(`Web-App Cache erneuert (${cleared} Cache, ${unregistered} Service Worker). Portal lädt neu...`);
    } catch (err) {
      toast('Portal lädt neu...');
    }
    const url = new URL(window.location.href);
    url.searchParams.set('v', String(Date.now()));
    url.searchParams.set('swreset', '1');
    setTimeout(() => window.location.replace(url.toString()), 900);
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
    const typed = prompt('Letzte Bestätigung: Schreibe PRODUKTIV, um Test-Leads/Jobs/Kunden/Buchhaltung zu löschen. Benutzer, Passwörter, Einstellungen und veröffentlichte Website-Inhalte bleiben erhalten.');
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
    if (!document.hidden && currentUser && isAdmin() && currentScriptUrl()) {
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

  resetUserEditor();
  setDefaultFinanceDates();
  renderLogin();
  setupSmartStickyNav();
})();
