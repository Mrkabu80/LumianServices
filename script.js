const business = {
  phoneHuman: '+41 77 279 47 07',
  phoneWhatsApp: '41772794707',
  email: 'info@lumianservices.ch'
};

const navToggle = document.querySelector('[data-nav-toggle]');
const nav = document.querySelector('[data-nav]');
if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
  nav.addEventListener('click', event => {
    if (event.target.tagName === 'A') {
      nav.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 }) : null;

document.querySelectorAll('.reveal').forEach(element => {
  if (observer) observer.observe(element);
  else element.classList.add('in-view');
});

const form = document.querySelector('[data-booking-form]');
if (form) {
  const isReferralPage = document.body.classList.contains('referral-page') || !!form.dataset.referralForm;
  const detectedRefEl = document.querySelector('[data-referral-detected]');
  const refCard = document.querySelector('[data-ref-code-card]');
  const refDisplay = document.querySelector('[data-ref-code-display]');
  const referralInput = form.elements.referral;

  const normalizeReferral = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

  function referralFromUrl() {
    try {
      const search = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
      const candidates = [
        search.get('ref'),
        search.get('code'),
        search.get('danke'),
        search.get('dankecode'),
        hash.get('ref'),
        hash.get('code'),
        hash.get('danke')
      ];
      for (const value of candidates) {
        const code = normalizeReferral(value);
        if (code) return code;
      }
      const match = window.location.pathname.match(/(?:ref|code|danke)[-/]([A-Za-z0-9_-]+)/i);
      if (match) return normalizeReferral(match[1]);
    } catch (error) {}
    return '';
  }

  function showReferralCode(code) {
    code = normalizeReferral(code);
    const missing = document.querySelector('[data-ref-code-missing]');
    if (referralInput && code && referralInput.value !== code) referralInput.value = code;
    if (detectedRefEl) detectedRefEl.hidden = !code;
    if (refCard) refCard.hidden = !code;
    if (missing) missing.hidden = !!code;
    if (refDisplay && code) refDisplay.textContent = code;
    document.body.classList.toggle('has-referral-code', !!code);
    referralInput?.classList.toggle('is-filled-referral', !!code);
  }

  const currentReferralCode = () => {
    if (isReferralPage) return normalizeReferral(referralFromUrl() || referralInput?.value || sessionStorage.getItem('lumianReferralCode') || '');
    return normalizeReferral(referralInput?.value || '');
  };

  // Referral support only for the dedicated referral page, e.g. /empfehlung/?ref=LM1001
  try {
    const ref = isReferralPage ? referralFromUrl() : '';
    if (ref) {
      sessionStorage.setItem('lumianReferralCode', ref);
      showReferralCode(ref);
    } else {
      showReferralCode(currentReferralCode());
    }
  } catch (error) {}

  referralInput?.addEventListener('input', () => showReferralCode(currentReferralCode()));

  async function sendLeadWebhook(lead) {
    // Optional: set window.LUMIAN_LEAD_WEBHOOK to the Google Apps Script URL if direct website-to-sheet capture is wanted.
    if (form.dataset.noLeadWebhook === 'true') return { skipped: true };
    const webhook = window.LUMIAN_LEAD_WEBHOOK || form.dataset.leadWebhook || document.querySelector('meta[name="lumian-lead-webhook"]')?.content || '';
    if (!webhook) return { skipped: true };
    try {
      const response = await fetch(webhook, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'websiteLead', lead })
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const referral = currentReferralCode();
    const lead = {
      name: data.get('name') || '',
      phone: data.get('phone') || '',
      address: data.get('address') || '',
      place: data.get('place') || '',
      service: data.get('service') || '',
      desiredDate: data.get('date') || '',
      referral,
      message: data.get('message') || '',
      source: referral ? 'Website Empfehlung' : 'Website Anfrage',
      createdAt: new Date().toISOString(),
      websiteLeadKey: `WL-${Date.now()}-${Math.random().toString(36).slice(2,8)}`
    };

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Anfrage wird vorbereitet...'; }

    // Store in webhook if configured, but always open WhatsApp so the Anfrage is not lost.
    sendLeadWebhook(lead).then(result => { try { sessionStorage.setItem('lumianLastLeadWebhook', JSON.stringify({ at: new Date().toISOString(), result })); } catch (e) {} });

    const lines = [
      isReferralPage ? 'Hoi Lumian Services, ich komme über eine Empfehlung und möchte eine Reinigung anfragen:' : 'Hoi Lumian Services, ich möchte eine Reinigung anfragen:',
      '',
      `Name: ${lead.name || '-'}`
    ];
    if (lead.phone) lines.push(`Telefon / WhatsApp: ${lead.phone}`);
    if (lead.address) lines.push(`Adresse: ${lead.address}`);
    lines.push(
      `Ort: ${lead.place || '-'}`,
      `Service: ${lead.service || '-'}`,
      `Wunsch-Termin: ${lead.desiredDate || '-'}`
    );
    if (referral) lines.push(`Empfehlungs-/Danke-Code: ${referral}`);
    lines.push(
      '',
      `Beschreibung: ${lead.message || '-'}`,
      '',
      'Fotos kann ich direkt hier senden.'
    );

    const url = `https://wa.me/${business.phoneWhatsApp}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Anfrage per WhatsApp senden'; }
  });
}


function initDateInputs() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  document.querySelectorAll('input[type="date"][data-date-input]').forEach(input => {
    input.min = `${yyyy}-${mm}-${dd}`;
  });
}
initDateInputs();

function buildGallery() {
  const track = document.querySelector('[data-gallery-track]');
  const items = Array.isArray(window.LUMIAN_GALLERY) ? window.LUMIAN_GALLERY : [];
  if (!track || !items.length) return;

  track.innerHTML = items.map((item, index) => `
    <button type="button" class="gallery-slide${index === 0 ? ' is-featured' : ''}" data-img="${item.src}" data-caption="${item.caption || item.title || 'Lumian Services Galerie'}">
      <img src="${item.src}" alt="${item.title || 'Lumian Services Galerie'}" loading="${index < 2 ? 'eager' : 'lazy'}">
      <span>${item.title || 'Lumian Services'}</span>
    </button>
  `).join('');

  const slider = document.querySelector('[data-gallery]');
  const prev = document.querySelector('[data-gallery-prev]');
  const next = document.querySelector('[data-gallery-next]');
  let timer;

  const slideWidth = () => {
    const slide = track.querySelector('.gallery-slide');
    return slide ? slide.getBoundingClientRect().width + 16 : 320;
  };

  const go = direction => {
    const maxScroll = track.scrollWidth - track.clientWidth - 4;
    if (direction > 0 && track.scrollLeft >= maxScroll) {
      track.scrollTo({ left: 0, behavior: 'smooth' });
      return;
    }
    if (direction < 0 && track.scrollLeft <= 0) {
      track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
      return;
    }
    track.scrollBy({ left: slideWidth() * direction, behavior: 'smooth' });
  };

  prev?.addEventListener('click', () => go(-1));
  next?.addEventListener('click', () => go(1));

  const start = () => {
    stop();
    timer = window.setInterval(() => go(1), 4200);
  };
  const stop = () => {
    if (timer) window.clearInterval(timer);
  };

  slider?.addEventListener('mouseenter', stop);
  slider?.addEventListener('mouseleave', start);
  slider?.addEventListener('touchstart', stop, { passive: true });
  slider?.addEventListener('touchend', start, { passive: true });
  start();
}

buildGallery();

const gallery = document.querySelector('[data-gallery]');
const lightbox = document.querySelector('[data-lightbox]');
if (gallery && lightbox) {
  const lightboxImg = lightbox.querySelector('[data-lightbox-img]');
  const lightboxCaption = lightbox.querySelector('[data-lightbox-caption]');
  const closeBtn = lightbox.querySelector('[data-lightbox-close]');

  gallery.addEventListener('click', event => {
    const button = event.target.closest('[data-img]');
    if (!button) return;
    lightboxImg.src = button.dataset.img;
    lightboxImg.alt = button.dataset.caption || 'Lumian Services Galerie';
    lightboxCaption.textContent = button.dataset.caption || '';
    lightbox.hidden = false;
    document.body.style.overflow = 'hidden';
  });

  const closeLightbox = () => {
    lightbox.hidden = true;
    lightboxImg.src = '';
    document.body.style.overflow = '';
  };
  closeBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', event => {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !lightbox.hidden) closeLightbox();
  });
}

// Optional: Setze hier im HTML data-calendar-url="https://cal.com/..." oder "https://calendly.com/...".
// Sobald ein Link eingetragen ist, öffnet der Button den Online-Kalender statt WhatsApp.
document.querySelectorAll('[data-calendar-url]').forEach(box => {
  const url = box.dataset.calendarUrl;
  const link = box.querySelector('a');
  if (url && link) {
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Online-Slot öffnen';
  }
});


// Cookie notice: necessary storage only, no marketing/tracking cookies.
const cookieNotice = document.querySelector('[data-cookie-notice]');
const cookieAccept = document.querySelector('[data-cookie-accept]');
const cookieKey = 'lumian_cookie_notice_ok_v1';

function hasCookieConsent() {
  try {
    if (localStorage.getItem(cookieKey) === 'yes') return true;
  } catch (error) {}
  return document.cookie.split(';').some(part => part.trim() === `${cookieKey}=yes`);
}
function setCookieConsent() {
  try { localStorage.setItem(cookieKey, 'yes'); } catch (error) {}
  document.cookie = `${cookieKey}=yes; Max-Age=31536000; Path=/; SameSite=Lax`;
}
if (cookieNotice) {
  cookieNotice.hidden = hasCookieConsent();
}
cookieAccept?.addEventListener('click', () => {
  setCookieConsent();
  if (cookieNotice) cookieNotice.hidden = true;
});

// Add to Home Screen / PWA install support.
let deferredInstallPrompt = null;
const installButton = document.querySelector('[data-install-app]');
const installHelp = document.querySelector('[data-install-help]');
const installHelpText = document.querySelector('[data-install-help-text]');
const installClose = document.querySelector('[data-install-close]');

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installButton) installButton.textContent = 'Lumian als App installieren';
});

installButton?.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(() => null);
    deferredInstallPrompt = null;
    if (installButton) installButton.textContent = 'App-Hinweis anzeigen';
    return;
  }

  const ua = navigator.userAgent || '';
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  if (installHelpText) {
    installHelpText.textContent = isIOS
      ? 'Auf dem iPhone: Teilen-Symbol in Safari öffnen und «Zum Home-Bildschirm» wählen.'
      : 'Im Browser-Menü «App installieren» oder «Zum Startbildschirm hinzufügen» wählen. Falls diese Option nicht erscheint, öffnen Sie die Seite direkt im Browser.';
  }
  if (installHelp) installHelp.hidden = false;
});

installClose?.addEventListener('click', () => {
  if (installHelp) installHelp.hidden = true;
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
