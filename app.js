// ── SUPABASE CONFIG ───────────────────────────────────────────────────────────
// Credentials are loaded via <script src="config.js"> in the HTML (not imported).
// config.js sets window.SUPABASE_URL and window.SUPABASE_KEY
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_KEY = window.SUPABASE_KEY;

// Keep settings page fields in sync
function loadConfig() { return { url: SUPABASE_URL, key: SUPABASE_KEY }; }
function saveConfig() {}

// ── SUPABASE CLIENT ───────────────────────────────────────────────────────────
let supabase = null;

async function initSupabase() {
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'
  );
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── Auth guard: redirect to login if not signed in
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    location.replace('login.html');
    return false;
  }

  // Show user email in sidebar
  const userEl = document.getElementById('user-email');
  if (userEl) userEl.textContent = session.user.email;

  try {
    const { error } = await supabase.from('products').select('id').limit(1);
    if (error) throw error;
    setStatus('Connected', 'connected');
    return true;
  } catch (e) {
    setStatus('Connection failed', 'error');
    console.error(e);
    return false;
  }
}

function setStatus(text, state) {
  const dot  = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  dot.className = 'status-dot ' + (state || '');
  label.textContent = text;
}

// ── NAVIGATION ────────────────────────────────────────────────────────────────
const VIEWS = ['dashboard', 'entry', 'inventory', 'alerts', 'settings'];
const TITLES = {
  dashboard: 'Dashboard', entry: 'Stock Entry',
  inventory: 'Inventory', alerts: 'Alerts', settings: 'Settings'
};

function showView(name) {
  VIEWS.forEach(v => {
    document.getElementById('view-' + v).classList.toggle('active', v === name);
    document.getElementById('nav-' + v).classList.toggle('active', v === name);
    const bnav = document.getElementById('bnav-' + v);
    if (bnav) bnav.classList.toggle('active', v === name);
  });
  document.getElementById('page-title').textContent = TITLES[name] || name;
  if (name === 'dashboard')  loadDashboard();
  if (name === 'inventory')  loadInventory();
  if (name === 'alerts')     loadAlerts();
}
window.showView = showView;

document.querySelectorAll('.nav-item[data-view], .bnav-item[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

// Mobile sidebar toggle
const sidebar = document.getElementById('sidebar');
document.getElementById('menu-toggle').addEventListener('click', () =>
  sidebar.classList.toggle('open')
);
document.addEventListener('click', e => {
  if (window.innerWidth <= 768 && !sidebar.contains(e.target) &&
      e.target !== document.getElementById('menu-toggle')) {
    sidebar.classList.remove('open');
  }
});

// ── DATE ──────────────────────────────────────────────────────────────────────
document.getElementById('current-date').textContent =
  new Date().toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' });

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('products').select('*').order('created_at', { ascending: false });
  if (error) { console.error(error); return; }

  const total = data.length;
  const low   = data.filter(p => p.quantity > 0 && p.quantity <= (p.reorder_level || 10)).length;
  const out   = data.filter(p => p.quantity === 0).length;
  const val   = data.reduce((s, p) => s + (p.sell_price || 0) * (p.quantity || 0), 0);

  document.getElementById('stat-total-val').textContent = total;
  document.getElementById('stat-low-val').textContent   = low;
  document.getElementById('stat-out-val').textContent   = out;
  document.getElementById('stat-value-val').textContent = '₹' + val.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  // Alert badge (sidebar + bottom nav)
  const alertCount = low + out;
  const badge = document.getElementById('alert-badge');
  badge.textContent = alertCount;
  badge.dataset.count = alertCount;
  badge.style.display = alertCount ? 'inline-flex' : 'none';
  const bnavBadge = document.getElementById('bnav-alert-count');
  if (bnavBadge) {
    bnavBadge.textContent = alertCount;
    bnavBadge.classList.toggle('hidden', alertCount === 0);
  }

  // Recent table (last 7)
  const tbody = document.getElementById('recent-tbody');
  if (!data.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No products yet.</td></tr>'; return; }
  tbody.innerHTML = data.slice(0, 7).map(p => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.category || '—')}</td>
      <td>${stockBadge(p)}</td>
      <td>₹${(p.sell_price || 0).toFixed(2)}</td>
      <td>${fmtDate(p.created_at)}</td>
    </tr>`).join('');

  // Category chart
  const cats = {};
  data.forEach(p => { const c = p.category || 'other'; cats[c] = (cats[c] || 0) + 1; });
  const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]).slice(0, 8);
  const max = sorted[0]?.[1] || 1;
  document.getElementById('category-chart').innerHTML = sorted.map(([cat, cnt]) => `
    <div class="cat-row">
      <div class="cat-label-row">
        <span class="cat-name">${catLabel(cat)}</span>
        <span class="cat-count">${cnt}</span>
      </div>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(cnt/max*100).toFixed(1)}%"></div></div>
    </div>`).join('');
}

// ── INVENTORY ─────────────────────────────────────────────────────────────────
let allProducts = [];
let invPage = 1;
const PAGE_SIZE = 12;
let filteredProducts = [];

async function loadInventory() {
  if (!supabase) return;
  const tbody = document.getElementById('inventory-tbody');
  tbody.innerHTML = '<tr><td colspan="9" class="loading-row">Loading…</td></tr>';
  const { data, error } = await supabase
    .from('products').select('*').order('created_at', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="9" class="loading-row">Error: ${esc(error.message)}</td></tr>`; return; }
  allProducts = data;
  applyFilters();
}

function applyFilters() {
  const q    = document.getElementById('search-input').value.toLowerCase();
  const cat  = document.getElementById('filter-category').value;
  const stat = document.getElementById('filter-status').value;
  filteredProducts = allProducts.filter(p => {
    const matchQ   = !q || p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
    const matchCat = !cat || p.category === cat;
    const ps       = productStatus(p);
    const matchSt  = !stat || ps === stat;
    return matchQ && matchCat && matchSt;
  });
  invPage = 1;
  renderInventoryPage();
}

function renderInventoryPage() {
  const isMobile = window.innerWidth <= 768;
  const tableWrap   = document.getElementById('inv-table-wrap');
  const mobileCards = document.getElementById('mobile-cards');
  const tbody = document.getElementById('inventory-tbody');

  const start = (invPage - 1) * PAGE_SIZE;
  const slice = filteredProducts.slice(start, start + PAGE_SIZE);

  if (!slice.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">No products found.</td></tr>';
    if (mobileCards) mobileCards.innerHTML = '<div class="empty-row">No products found.</div>';
    document.getElementById('pagination').innerHTML = '';
    return;
  }

  // ── Desktop table
  tbody.innerHTML = slice.map(p => `
    <tr id="row-${p.id}">
      <td><strong>${esc(p.name)}</strong><br><small style="color:var(--text-3)">${esc(p.sku||'')}</small></td>
      <td>${catLabel(p.category)}</td>
      <td>
        <div class="qty-stepper">
          <button class="qty-btn minus" onclick="adjustQty('${p.id}', -1)" ${p.quantity<=0?'disabled':''}>−</button>
          <span class="qty-val" id="qty-${p.id}">${p.quantity ?? 0}</span>
          <button class="qty-btn plus" onclick="adjustQty('${p.id}', 1)">+</button>
        </div>
      </td>
      <td>₹${(p.cost_price||0).toFixed(2)}</td>
      <td>₹${(p.sell_price||0).toFixed(2)}</td>
      <td><span class="badge-status ${productStatus(p)}" id="status-${p.id}">${statusLabel(productStatus(p))}</span></td>
      <td>${p.expiry_date ? fmtDate(p.expiry_date) : '—'}</td>
      <td>
        <button class="action-btn edit" onclick="openEdit('${p.id}')">Edit</button>
        <button class="action-btn delete" onclick="openDelete('${p.id}')">Delete</button>
      </td>
    </tr>`).join('');

  // ── Mobile cards
  if (mobileCards) {
    mobileCards.innerHTML = slice.map(p => {
      const ps = productStatus(p);
      return `
      <div class="product-card">
        <div class="pc-header">
          <div>
            <div class="pc-name">${esc(p.name)}</div>
            <div class="pc-meta">${catLabel(p.category)}${p.sku ? ' · ' + esc(p.sku) : ''}</div>
          </div>
          <span class="badge-status ${ps}" id="status-${p.id}">${statusLabel(ps)}</span>
        </div>
        <div class="pc-body">
          <div class="qty-stepper">
            <button class="qty-btn minus" onclick="adjustQty('${p.id}', -1)" ${p.quantity<=0?'disabled':''}>−</button>
            <span class="qty-val" id="qty-${p.id}">${p.quantity ?? 0}</span>
            <button class="qty-btn plus" onclick="adjustQty('${p.id}', 1)">+</button>
          </div>
          <div class="pc-price">₹${(p.sell_price||0).toFixed(0)} <span class="pc-unit">/${p.unit||'unit'}</span></div>
          <div class="pc-btns">
            <button class="action-btn edit" onclick="openEdit('${p.id}')">Edit</button>
            <button class="action-btn delete" onclick="openDelete('${p.id}')">×</button>
          </div>
        </div>
        ${p.expiry_date ? `<div class="pc-expiry">📅 Expires ${fmtDate(p.expiry_date)}</div>` : ''}
      </div>`;
    }).join('');
  }

  // Pagination
  const total = filteredProducts.length;
  const pages = Math.ceil(total / PAGE_SIZE);
  const pg = document.getElementById('pagination');
  if (pages <= 1) { pg.innerHTML = `<span>${total} item${total!==1?'s':''}</span>`; return; }
  let html = `<span>${total} items</span>`;
  html += `<button class="pg-btn" onclick="goPage(${invPage-1})" ${invPage===1?'disabled':''}>‹ Prev</button>`;
  for (let i = 1; i <= pages; i++) {
    html += `<button class="pg-btn ${i===invPage?'active':''}" onclick="goPage(${i})">${i}</button>`;
  }
  html += `<button class="pg-btn" onclick="goPage(${invPage+1})" ${invPage===pages?'disabled':''}>Next ›</button>`;
  pg.innerHTML = html;
}

window.goPage = function(p) { invPage = p; renderInventoryPage(); };

// ── QTY STEPPER ───────────────────────────────────────────────────────────────
window.adjustQty = async function(id, delta) {
  const product = allProducts.find(p => p.id === id);
  if (!product || !supabase) return;

  const newQty = Math.max(0, (product.quantity || 0) + delta);

  // Optimistic UI update
  product.quantity = newQty;
  const qtyEl    = document.getElementById('qty-' + id);
  const statusEl = document.getElementById('status-' + id);
  const minusBtn = qtyEl?.previousElementSibling;
  if (qtyEl)    qtyEl.textContent = newQty;
  if (minusBtn) minusBtn.disabled = newQty <= 0;
  if (statusEl) {
    const ps = productStatus(product);
    statusEl.className = 'badge-status ' + ps;
    statusEl.textContent = statusLabel(ps);
  }

  const { error } = await supabase
    .from('products')
    .update({ quantity: newQty })
    .eq('id', id);

  if (error) {
    // Revert on failure
    product.quantity = product.quantity - delta;
    if (qtyEl) qtyEl.textContent = product.quantity;
    showToast('Update failed: ' + error.message, 'error');
    return;
  }

  // Refresh dashboard stats silently
  loadDashboard();
};

document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('filter-category').addEventListener('change', applyFilters);
document.getElementById('filter-status').addEventListener('change', applyFilters);

// ── ALERTS ────────────────────────────────────────────────────────────────────
async function loadAlerts() {
  if (!supabase) return;
  const list = document.getElementById('alerts-list');
  list.innerHTML = '<div class="loading-row">Loading…</div>';
  const { data } = await supabase.from('products').select('*');
  // Merge into allProducts so openEdit() works from any view
  if (data) allProducts = data;
  const alerts = [];
  const today  = new Date();
  (data || []).forEach(p => {
    if (p.quantity === 0) {
      alerts.push({ type: 'critical', icon: 'red', p, msg: 'Out of stock — reorder immediately' });
    } else if (p.quantity <= (p.reorder_level || 10)) {
      alerts.push({ type: 'warning', icon: 'amber', p, msg: `Only ${p.quantity} ${p.unit||'units'} left (reorder ≤ ${p.reorder_level||10})` });
    }
    if (p.expiry_date) {
      const days = Math.ceil((new Date(p.expiry_date) - today) / 86400000);
      if (days >= 0 && days <= 30) {
        alerts.push({ type: 'expiry', icon: 'blue', p, msg: `Expires in ${days} day${days!==1?'s':''} (${fmtDate(p.expiry_date)})` });
      }
    }
  });
  if (!alerts.length) { list.innerHTML = '<div class="alert-item"><span style="color:var(--green)">✅ No alerts — all products are healthy!</span></div>'; return; }
  list.innerHTML = alerts.map(a => `
    <div class="alert-item ${a.type}">
      <div class="alert-icon ${a.icon}">
        ${a.type==='expiry'
          ? '<svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'}
      </div>
      <div class="alert-info">
        <div class="alert-name">${esc(a.p.name)}</div>
        <div class="alert-desc">${a.msg}</div>
      </div>
      <button class="alert-action" onclick="openEdit('${a.p.id}')">Update</button>
    </div>`).join('');
}

// ── STOCK ENTRY FORM ──────────────────────────────────────────────────────────
const form = document.getElementById('stock-form');

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validateForm()) return;
  if (!supabase) { showToast('Not connected to Supabase. Please configure in Settings.', 'error'); return; }

  setSubmitting(true);
  const payload = buildPayload();
  const { error } = await supabase.from('products').insert([payload]);
  setSubmitting(false);

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('✅ Product saved successfully!', 'success');
  form.reset();
  document.getElementById('received-date').value = new Date().toISOString().split('T')[0];
});

document.getElementById('clear-btn').addEventListener('click', () => {
  form.reset();
  clearErrors();
});

function buildPayload() {
  const now = new Date().toISOString();
  return {
    name:          val('product-name'),
    sku:           val('product-sku') || null,
    category:      val('product-category'),
    quantity:      intVal('quantity'),
    reorder_level: intVal('reorder-level') || 10,
    unit:          val('unit'),
    cost_price:    floatVal('cost-price'),
    sell_price:    floatVal('sell-price'),
    expiry_date:   val('expiry-date') || null,
    supplier_name: val('supplier-name') || null,
    received_at:   now,
    status:        'active',
  };
}

function validateForm() {
  clearErrors();
  let ok = true;
  if (!val('product-name')) { setErr('err-name', 'Product name is required'); ok = false; }
  if (!val('product-category')) { setErr('err-cat', 'Please select a category'); ok = false; }
  if (val('quantity') === '' || isNaN(intVal('quantity'))) { setErr('err-qty', 'Enter a valid quantity'); ok = false; }
  if (!val('cost-price') || floatVal('cost-price') < 0) { setErr('err-cost', 'Enter a valid cost price'); ok = false; }
  if (!val('sell-price') || floatVal('sell-price') < 0) { setErr('err-sell', 'Enter a valid selling price'); ok = false; }
  return ok;
}
function setErr(id, msg) {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.previousElementSibling?.classList.add('invalid'); }
}
function clearErrors() {
  document.querySelectorAll('.error-msg').forEach(e => e.textContent = '');
  document.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
}
function setSubmitting(on) {
  document.getElementById('submit-label').classList.toggle('hidden', on);
  document.getElementById('submit-spinner').classList.toggle('hidden', !on);
  document.getElementById('submit-btn').disabled = on;
}

// ── EDIT MODAL ────────────────────────────────────────────────────────────────
let editId = null;

window.openEdit = function(id) {
  editId = id;
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  const body = document.getElementById('edit-form-body');
  body.innerHTML = `
    <div class="form-grid" style="margin-top:0">
      ${editField('edit-name','Product Name','text',p.name||'')}
      ${editField('edit-sku','SKU / Barcode','text',p.sku||'')}
      ${editSelect('edit-category','Category',p.category)}
      ${editField('edit-brand','Brand','text',p.brand||'')}
      ${editField('edit-qty','Quantity','number',p.quantity??0)}
      ${editField('edit-reorder','Reorder Level','number',p.reorder_level||10)}
      ${editField('edit-cost','Cost Price (₹)','number',p.cost_price||0)}
      ${editField('edit-sell','Selling Price (₹)','number',p.sell_price||0)}
      ${editField('edit-expiry','Expiry Date','date',p.expiry_date||'')}
      ${editField('edit-supplier','Supplier','text',p.supplier_name||'')}
      ${editField('edit-location','Storage Location','text',p.storage_location||'')}
      ${editStatusSelect('edit-status',p.status||'active')}
    </div>`;
  document.getElementById('edit-modal').classList.remove('hidden');
};

function editField(id, label, type, value) {
  return `<div class="field"><label for="${id}">${label}</label><input type="${type}" id="${id}" value="${esc(String(value))}" /></div>`;
}
function editSelect(id, label, current) {
  const opts = [['dairy','Dairy & Eggs'],['produce','Produce'],['meat','Meat & Seafood'],['bakery','Bakery'],['frozen','Frozen Foods'],['beverages','Beverages'],['snacks','Snacks'],['pantry','Pantry'],['personal_care','Personal Care'],['household','Household'],['other','Other']];
  return `<div class="field"><label for="${id}">${label}</label><select id="${id}">${opts.map(([v,l]) => `<option value="${v}" ${v===current?'selected':''}>${l}</option>`).join('')}</select></div>`;
}
function editStatusSelect(id, current) {
  const opts = [['active','Active'],['inactive','Inactive'],['discontinued','Discontinued']];
  return `<div class="field"><label for="${id}">Status</label><select id="${id}">${opts.map(([v,l]) => `<option value="${v}" ${v===current?'selected':''}>${l}</option>`).join('')}</select></div>`;
}

document.getElementById('close-edit-modal').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});
document.getElementById('cancel-edit').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});

document.getElementById('confirm-edit').addEventListener('click', async () => {
  if (!editId || !supabase) return;
  const updates = {
    name:             gv('edit-name'),
    sku:              gv('edit-sku') || null,
    category:         gv('edit-category'),
    brand:            gv('edit-brand') || null,
    quantity:         parseInt(gv('edit-qty')) || 0,
    reorder_level:    parseInt(gv('edit-reorder')) || 10,
    cost_price:       parseFloat(gv('edit-cost')) || 0,
    sell_price:       parseFloat(gv('edit-sell')) || 0,
    expiry_date:      gv('edit-expiry') || null,
    supplier_name:    gv('edit-supplier') || null,
    storage_location: gv('edit-location') || null,
    status:           gv('edit-status'),
  };
  const { error } = await supabase.from('products').update(updates).eq('id', editId);
  document.getElementById('edit-modal').classList.add('hidden');
  if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
  showToast('Product updated successfully.', 'success');
  // Refresh whichever views are currently relevant
  loadInventory();
  loadDashboard();
  if (document.getElementById('view-alerts').classList.contains('active')) loadAlerts();
});

// ── DELETE MODAL ──────────────────────────────────────────────────────────────
let deleteId = null;

window.openDelete = function(id) {
  deleteId = id;
  document.getElementById('delete-modal').classList.remove('hidden');
};

document.getElementById('cancel-delete').addEventListener('click', () => {
  document.getElementById('delete-modal').classList.add('hidden');
});
document.getElementById('confirm-delete').addEventListener('click', async () => {
  if (!deleteId || !supabase) return;
  const { error } = await supabase.from('products').delete().eq('id', deleteId);
  document.getElementById('delete-modal').classList.add('hidden');
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
  showToast('Product deleted.', 'success');
  allProducts = allProducts.filter(p => p.id !== deleteId);
  applyFilters();
  loadDashboard();
  if (document.getElementById('view-alerts').classList.contains('active')) loadAlerts();
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
const SQL = `-- Run this in Supabase SQL Editor
create table if not exists products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  sku              text,
  category         text,
  brand            text,
  description      text,
  quantity         integer default 0,
  reorder_level    integer default 10,
  unit             text default 'piece',
  cost_price       numeric(10,2) default 0,
  sell_price       numeric(10,2) default 0,
  discount         numeric(5,2) default 0,
  expiry_date      date,
  received_date    date,
  supplier_name    text,
  supplier_contact text,
  storage_location text,
  status           text default 'active',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Optional: auto-update updated_at
create or replace function update_timestamp()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger set_updated_at
before update on products
for each row execute function update_timestamp();`;

document.getElementById('sql-schema').textContent = SQL;

// Pre-fill settings fields with hardcoded values
document.getElementById('sb-url').value = SUPABASE_URL;
document.getElementById('sb-key').value = SUPABASE_KEY;

document.getElementById('save-config-btn').addEventListener('click', async () => {
  const url = document.getElementById('sb-url').value.trim();
  const key = document.getElementById('sb-key').value.trim();
  if (!url || !key) { showToast('Please enter both URL and Key.', 'error'); return; }
  saveConfig(url, key);
  setStatus('Connecting…', '');
  const ok = await initSupabase();
  showToast(ok ? '✅ Connected to Supabase!' : '❌ Connection failed. Check your credentials.', ok ? 'success' : 'error');
});

document.getElementById('test-conn-btn').addEventListener('click', async () => {
  const ok = await initSupabase();
  showToast(ok ? '✅ Connection successful!' : '❌ Could not connect.', ok ? 'success' : 'error');
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function val(id) { return document.getElementById(id)?.value?.trim() ?? ''; }
function gv(id)  { return document.getElementById(id)?.value?.trim() ?? ''; }
function intVal(id)   { return parseInt(val(id)); }
function floatVal(id) { return parseFloat(val(id)); }

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

function productStatus(p) {
  if (!p.quantity || p.quantity === 0) return 'out_of_stock';
  if (p.quantity <= (p.reorder_level || 10)) return 'low_stock';
  return p.status || 'active';
}

function statusLabel(s) {
  return { active:'Active', low_stock:'Low Stock', out_of_stock:'Out of Stock', inactive:'Inactive', discontinued:'Discontinued' }[s] || s;
}

function stockBadge(p) {
  const ps = productStatus(p);
  return `<span class="badge-status ${ps}">${p.quantity ?? 0}</span>`;
}

const CAT_LABELS = {
  dairy:'Dairy & Eggs', produce:'Produce', meat:'Meat', bakery:'Bakery',
  frozen:'Frozen', beverages:'Beverages', snacks:'Snacks', pantry:'Pantry',
  personal_care:'Personal Care', household:'Household', other:'Other'
};
function catLabel(c) { return CAT_LABELS[c] || (c || '—'); }

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

// ── INIT ──────────────────────────────────────────────────────────────────────

// Live clock on the entry timestamp strip
function updateEntryTimestamp() {
  const el = document.getElementById('entry-time-display');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
  }
}
updateEntryTimestamp();
setInterval(updateEntryTimestamp, 1000);

// ── LOGOUT ───────────────────────────────────────────────────────────────────
document.getElementById('logout-btn')?.addEventListener('click', async () => {
  if (supabase) await supabase.auth.signOut();
  location.replace('login.html');
});

// ── INIT ──────────────────────────────────────────────────────────────────────
(async () => {
  const ok = await initSupabase();
  if (ok) loadDashboard();
})();
