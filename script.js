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
  const detectedRefEl = document.querySelector('[data-referral-detected]');
  const normalizeReferral = value => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const currentReferralCode = () => normalizeReferral(form.elements.referral?.value || new URLSearchParams(window.location.search).get('ref') || '');

  // Referral support for Lumian Portal links, e.g. /?ref=LM1001#booking
  try {
    const ref = normalizeReferral(new URLSearchParams(window.location.search).get('ref'));
    if (ref && form.elements.referral) {
      form.elements.referral.value = ref;
      if (detectedRefEl) detectedRefEl.hidden = false;
      const booking = document.getElementById('booking');
      if (booking) setTimeout(() => booking.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
    }
  } catch (error) {}

  form.elements.referral?.addEventListener('input', () => {
    const code = currentReferralCode();
    if (detectedRefEl) detectedRefEl.hidden = !code;
  });

  async function sendLeadWebhook(lead) {
    // Optional: set window.LUMIAN_LEAD_WEBHOOK to the Google Apps Script URL if direct website-to-sheet capture is wanted.
    const webhook = window.LUMIAN_LEAD_WEBHOOK || form.dataset.leadWebhook || '';
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
      place: data.get('place') || '',
      service: data.get('service') || '',
      desiredDate: data.get('date') || '',
      referral,
      message: data.get('message') || '',
      source: referral ? 'Website Empfehlung' : 'Website Anfrage',
      createdAt: new Date().toISOString()
    };

    // Store in webhook if configured, but always open WhatsApp so the Anfrage is not lost.
    sendLeadWebhook(lead);

    const lines = [
      'Hoi Lumian Services, ich möchte eine Reinigung anfragen:',
      '',
      `Name: ${lead.name || '-'}`,
      `Telefon / WhatsApp: ${lead.phone || '-'}`,
      `Ort / Adresse: ${lead.place || '-'}`,
      `Service: ${lead.service || '-'}`,
      `Wunsch-Termin: ${lead.desiredDate || '-'}`,
      referral ? `Empfehlungscode: ${referral}` : 'Empfehlungscode: -',
      '',
      `Beschreibung: ${lead.message || '-'}`,
      '',
      'Fotos kann ich direkt hier senden.'
    ];

    const url = `https://wa.me/${business.phoneWhatsApp}?text=${encodeURIComponent(lines.join('\n'))}`;
    window.open(url, '_blank', 'noopener');
  });
}

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

try {
  if (cookieNotice && localStorage.getItem(cookieKey) !== 'yes') {
    cookieNotice.hidden = false;
  }
  cookieAccept?.addEventListener('click', () => {
    localStorage.setItem(cookieKey, 'yes');
    if (cookieNotice) cookieNotice.hidden = true;
  });
} catch (error) {
  if (cookieNotice) cookieNotice.hidden = false;
}

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
