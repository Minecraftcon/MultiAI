/* ============================================================
   Maison Aurèle — Interactions
   ============================================================ */

const products = [
  { id:1, name:'Silk Wrap Dress', cat:'dresses', price:1240, old:1480, color:'#d8cfc4', accent:'#a89888', desc:'Bias-cut silk charmeuse with hand-rolled hems. A silhouette that moves like water.' },
  { id:2, name:'Cashmere Overcoat', cat:'outerwear', price:2180, color:'#c9b8a3', accent:'#8a7a6a', desc:'Double-faced cashmere, single-button closure. Tailored in our Milan atelier.' },
  { id:3, name:'Ribbed Knit Dress', cat:'knitwear', price:890, color:'#e8e0d4', accent:'#b8a898', desc:'Fine-gauge merino rib, midi length, side slit. Effortless everyday elegance.' },
  { id:4, name:'Leather Tote', cat:'accessories', price:1650, color:'#d4c4b0', accent:'#9a8a7a', desc:'Vegetable-tanned calfskin with hand-stitched detailing. Lifetime repair guarantee.' },
  { id:5, name:'Linen Blazer', cat:'outerwear', price:1320, color:'#c4b4a0', accent:'#7a6a5a', desc:'Unstructured shoulder, breathable linen. The cornerstone of a summer wardrobe.' },
  { id:6, name:'Silk Slip Skirt', cat:'dresses', price:760, color:'#e0d4c4', accent:'#b8a898', desc:'Fluid bias cut, elasticated waist. Pairs with everything, endures forever.' },
  { id:7, name:'Cashmere Turtleneck', cat:'knitwear', price:640, old:780, color:'#d8cfc4', accent:'#a89888', desc:'Two-ply Scottish cashmere, ribbed collar. The quietest kind of luxury.' },
  { id:8, name:'Silk Scarf', cat:'accessories', price:320, color:'#c9b8a3', accent:'#8a7a6a', desc:'Hand-rolled 90cm square, printed in Como. A signature finishing touch.' },
  { id:9, name:'Wool Trench', cat:'outerwear', price:1980, color:'#e8e0d4', accent:'#b8a898', desc:'Water-repellent wool gabardine, storm flap. Built for decades of rain.' },
  { id:10, name:'Silk Blouse', cat:'dresses', price:980, color:'#d4c4b0', accent:'#9a8a7a', desc:'Crêpe de chine, mother-of-pearl buttons. Understated, endlessly versatile.' },
  { id:11, name:'Merino Cardigan', cat:'knitwear', price:720, color:'#c4b4a0', accent:'#7a6a5a', desc:'Fine merino, horn buttons, relaxed fit. Layered or worn alone.' },
  { id:12, name:'Gold Hoops', cat:'accessories', price:480, color:'#e0d4c4', accent:'#b8925a', desc:'18k gold vermeil, hand-polished. Subtle, warm, timeless.' },
];

// ---------- Preloader ----------
window.addEventListener('load', () => {
  setTimeout(() => document.getElementById('preloader').classList.add('is-done'), 1200);
});

// ---------- Nav scroll ----------
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('is-scrolled', window.scrollY > 40);
});

// ---------- Mobile menu ----------
const burger = document.getElementById('burger');
burger.addEventListener('click', () => nav.classList.toggle('is-open'));

// ---------- Reveal on scroll ----------
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); }
  });
}, { threshold: 0.15 });
revealEls.forEach(el => io.observe(el));

// ---------- Product rendering ----------
const grid = document.getElementById('productGrid');
function renderProducts(filter = 'all') {
  grid.innerHTML = '';
  const list = filter === 'all' ? products : products.filter(p => p.cat === filter);
  list.forEach((p, i) => {
    const card = document.createElement('article');
    card.className = 'product reveal';
    card.style.transitionDelay = `${i * 60}ms`;
    card.innerHTML = `
      <div class="product__media">
        <div class="product__img" style="background: linear-gradient(135deg, ${p.color}, ${p.accent})">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(26,24,22,.25)" stroke-width="1"><path d="M12 3l9 6-9 12-9-12 9-6z"/></svg>
        </div>
        ${p.old ? '<span class="product__badge">Sale</span>' : ''}
        <div class="product__quick">Quick View</div>
      </div>
      <p class="product__cat">${p.cat}</p>
      <h3 class="product__name">${p.name}</h3>
      <p class="product__price">${p.old ? `<s>€${p.old.toLocaleString()}</s>` : ''}€${p.price.toLocaleString()}</p>
    `;
    card.addEventListener('click', () => openModal(p));
    grid.appendChild(card);
    io.observe(card);
  });
}
renderProducts();

// ---------- Filters ----------
document.querySelectorAll('.filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    renderProducts(btn.dataset.filter);
  });
});

// ---------- Modal ----------
const modal = document.getElementById('modal');
const modalImg = document.getElementById('modalImg');
const modalCat = document.getElementById('modalCat');
const modalName = document.getElementById('modalName');
const modalPrice = document.getElementById('modalPrice');
const modalDesc = document.getElementById('modalDesc');

function openModal(p) {
  modalImg.style.background = `linear-gradient(135deg, ${p.color}, ${p.accent})`;
  modalCat.textContent = p.cat;
  modalName.textContent = p.name;
  modalPrice.textContent = `€${p.price.toLocaleString()}`;
  modalDesc.textContent = p.desc;
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}
document.getElementById('modalBackdrop').addEventListener('click', closeModal);
document.getElementById('modalClose').addEventListener('click', closeModal);
function closeModal() { modal.classList.remove('is-open'); document.body.style.overflow = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// size selection
document.querySelectorAll('.modal__sizes button').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.modal__sizes button').forEach(x => x.classList.remove('is-active'));
    b.classList.add('is-active');
  });
});

// add to bag
let bagCount = 0;
document.querySelector('.modal__add').addEventListener('click', () => {
  bagCount++;
  document.querySelector('.nav__count').textContent = bagCount;
  closeModal();
});

// ---------- Newsletter ----------
document.getElementById('newsletterForm').addEventListener('submit', e => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.textContent = 'Subscribed ✓';
  btn.style.background = 'var(--gold)';
  e.target.querySelector('input').value = '';
});

// ---------- Parallax hero orbs ----------
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const y = window.scrollY;
    document.querySelector('.hero__orb--1').style.transform = `translate(${y*0.05}px, ${y*0.1}px)`;
    document.querySelector('.hero__orb--2').style.transform = `translate(${-y*0.04}px, ${y*0.08}px)`;
    ticking = false;
  });
});