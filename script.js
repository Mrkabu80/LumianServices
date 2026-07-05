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
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    const lines = [
      'Hoi Lumian Services, ich möchte eine Reinigung anfragen:',
      '',
      `Name: ${data.get('name') || '-'}`,
      `Ort: ${data.get('place') || '-'}`,
      `Service: ${data.get('service') || '-'}`,
      `Wunsch-Termin: ${data.get('date') || '-'}`,
      `Referral-Code: ${data.get('referral') || '-'}`,
      '',
      `Beschreibung: ${data.get('message') || '-'}`,
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
