'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const API = '/api/subscriptions';

const CYCLE_LABEL = { MONTHLY: '月額', YEARLY: '年額' };

// ── State ────────────────────────────────────────────────────────────────────
let allSubs = [];
let deleteModal = null;
let pendingDeleteId = null;
let activeFilter = '';   // '' = すべて
let activeSort   = 'created_desc';

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

  // Nav
  document.getElementById('navDashboard').addEventListener('click', () => showView('dashboard'));
  document.getElementById('navList').addEventListener('click', () => showView('list'));

  // List view
  document.getElementById('btnAdd').addEventListener('click', openAddForm);

  // Filter buttons
  document.getElementById('filterBtns').addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.remove('active', 'btn-primary');
      b.classList.add('btn-outline-secondary');
    });
    btn.classList.add('active', 'btn-primary');
    btn.classList.remove('btn-outline-secondary');
    activeFilter = btn.dataset.cat;
    renderList();
  });

  // Sort select
  document.getElementById('sortSelect').addEventListener('change', e => {
    activeSort = e.target.value;
    renderList();
  });

  // Form
  document.getElementById('subForm').addEventListener('submit', handleFormSubmit);
  document.getElementById('btnCancel').addEventListener('click', () => showView('list'));

  // Delete confirm
  document.getElementById('btnConfirmDelete').addEventListener('click', confirmDelete);

  // Initial load
  fetchAndRender('dashboard');
});

// ── View switching ────────────────────────────────────────────────────────────
function showView(view) {
  document.getElementById('viewDashboard').classList.add('d-none');
  document.getElementById('viewList').classList.add('d-none');
  document.getElementById('viewForm').classList.add('d-none');

  if (view === 'dashboard') {
    document.getElementById('viewDashboard').classList.remove('d-none');
    fetchAndRender('dashboard');
  } else if (view === 'list') {
    document.getElementById('viewList').classList.remove('d-none');
    fetchAndRender('list');
  } else if (view === 'form') {
    document.getElementById('viewForm').classList.remove('d-none');
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAndRender(target) {
  try {
    const res = await fetch(API);
    allSubs = await res.json();
    if (target === 'dashboard') renderDashboard();
    else renderList();
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function monthlyAmount(s) {
  return s.billing_cycle === 'MONTHLY' ? s.price : Math.round(s.price / 12);
}

function yearlyAmount(s) {
  return s.billing_cycle === 'MONTHLY' ? s.price * 12 : s.price;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  // Count
  document.getElementById('dashCount').textContent = allSubs.length;

  // Monthly / Yearly totals
  let monthly = 0, yearly = 0;
  allSubs.forEach(s => {
    monthly += monthlyAmount(s);
    yearly  += yearlyAmount(s);
  });
  document.getElementById('dashMonthly').textContent = monthly.toLocaleString();
  document.getElementById('dashYearly').textContent  = yearly.toLocaleString();

  // Category counts
  const catMap = {};
  allSubs.forEach(s => { catMap[s.category] = (catMap[s.category] || 0) + 1; });
  const catEl = document.getElementById('dashCategories');
  if (Object.keys(catMap).length === 0) {
    catEl.innerHTML = '<span class="text-muted">データなし</span>';
  } else {
    catEl.innerHTML = Object.entries(catMap)
      .map(([cat, cnt]) =>
        `<span class="cat-badge">${escHtml(cat)}<span class="count">${cnt}</span></span>`
      ).join('');
  }

  // Recent (up to 3)
  const recentEl = document.getElementById('dashRecent');
  const recent = allSubs.slice(0, 3);
  if (recent.length === 0) {
    recentEl.innerHTML = '<li class="list-group-item text-muted">データなし</li>';
  } else {
    recentEl.innerHTML = recent.map(s => `
      <li class="list-group-item">
        <div>
          <span class="fw-semibold">${escHtml(s.name)}</span>
          <span class="ms-2 badge rounded-pill bg-secondary">${escHtml(s.category)}</span>
        </div>
        <div class="text-end">
          <span class="fw-bold">${s.price.toLocaleString()}円</span>
          <span class="ms-2 badge ${s.billing_cycle === 'MONTHLY' ? 'badge-monthly' : 'badge-yearly'} rounded-pill">
            ${CYCLE_LABEL[s.billing_cycle]}
          </span>
        </div>
      </li>
    `).join('');
  }

  // ── Category spending ──────────────────────────────────────────────────────
  const catSpendMap = {};
  allSubs.forEach(s => {
    if (!catSpendMap[s.category]) catSpendMap[s.category] = { monthly: 0, yearly: 0 };
    catSpendMap[s.category].monthly += monthlyAmount(s);
    catSpendMap[s.category].yearly  += yearlyAmount(s);
  });

  const catSpendEl = document.getElementById('dashCatSpending');
  if (Object.keys(catSpendMap).length === 0) {
    catSpendEl.innerHTML = '<li class="list-group-item text-muted">データなし</li>';
  } else {
    // Sort by monthly desc
    const sorted = Object.entries(catSpendMap).sort((a, b) => b[1].monthly - a[1].monthly);
    catSpendEl.innerHTML = sorted.map(([cat, val]) => `
      <li class="list-group-item cat-spending-item">
        <div class="fw-semibold">${escHtml(cat)}</div>
        <div class="d-flex gap-3 mt-1">
          <span class="text-muted small">月額換算: <span class="fw-bold text-dark">${val.monthly.toLocaleString()}円</span></span>
          <span class="text-muted small">年額換算: <span class="fw-bold text-dark">${val.yearly.toLocaleString()}円</span></span>
        </div>
      </li>
    `).join('');
  }

  // ── Annual cost ranking (top 5) ────────────────────────────────────────────
  const rankingEl = document.getElementById('dashRanking');
  if (allSubs.length === 0) {
    rankingEl.innerHTML = '<li class="list-group-item text-muted">データなし</li>';
  } else {
    const ranked = [...allSubs]
      .sort((a, b) => yearlyAmount(b) - yearlyAmount(a))
      .slice(0, 5);
    rankingEl.innerHTML = ranked.map(s => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span class="fw-semibold">${escHtml(s.name)}</span>
        <span class="fw-bold text-primary">${yearlyAmount(s).toLocaleString()}円/年</span>
      </li>
    `).join('');
  }
}

// ── List ──────────────────────────────────────────────────────────────────────
function renderList() {
  // Filter
  let subs = activeFilter
    ? allSubs.filter(s => s.category === activeFilter)
    : [...allSubs];

  // Sort
  switch (activeSort) {
    case 'created_desc':
      subs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      break;
    case 'created_asc':
      subs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      break;
    case 'price_monthly_desc':
      subs.sort((a, b) => monthlyAmount(b) - monthlyAmount(a));
      break;
    case 'price_monthly_asc':
      subs.sort((a, b) => monthlyAmount(a) - monthlyAmount(b));
      break;
    case 'name_asc':
      subs.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
      break;
  }

  const tbody = document.getElementById('subsList');
  if (subs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">該当するサブスクリプションはありません。</td></tr>';
    return;
  }
  tbody.innerHTML = subs.map(s => `
    <tr>
      <td class="fw-semibold">${escHtml(s.name)}</td>
      <td><span class="badge rounded-pill bg-secondary">${escHtml(s.category)}</span></td>
      <td class="text-end">${s.price.toLocaleString()}円</td>
      <td>
        <span class="badge rounded-pill ${s.billing_cycle === 'MONTHLY' ? 'badge-monthly' : 'badge-yearly'}">
          ${CYCLE_LABEL[s.billing_cycle]}
        </span>
      </td>
      <td class="text-center">
        <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditForm(${s.id})">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger" onclick="openDeleteModal(${s.id}, '${escAttr(s.name)}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

// ── Form helpers ──────────────────────────────────────────────────────────────
function openAddForm() {
  document.getElementById('formTitle').textContent = '新規登録';
  document.getElementById('formId').value = '';
  document.getElementById('fieldName').value = '';
  document.getElementById('fieldPrice').value = '';
  document.getElementById('cycleMonthly').checked = true;
  document.getElementById('fieldCategory').value = '';
  clearFormErrors();
  showView('form');
}

function openEditForm(id) {
  const s = allSubs.find(x => x.id === id);
  if (!s) return;
  document.getElementById('formTitle').textContent = '編集';
  document.getElementById('formId').value = s.id;
  document.getElementById('fieldName').value = s.name;
  document.getElementById('fieldPrice').value = s.price;
  document.querySelector(`input[name="billing_cycle"][value="${s.billing_cycle}"]`).checked = true;
  document.getElementById('fieldCategory').value = s.category;
  clearFormErrors();
  showView('form');
}

function clearFormErrors() {
  const el = document.getElementById('formErrors');
  el.classList.add('d-none');
  el.innerHTML = '';
}

function showFormErrors(errors) {
  const el = document.getElementById('formErrors');
  el.innerHTML = errors.map(e => `<div>${escHtml(e)}</div>`).join('');
  el.classList.remove('d-none');
}

// ── Form submit ───────────────────────────────────────────────────────────────
async function handleFormSubmit(e) {
  e.preventDefault();
  clearFormErrors();

  const id    = document.getElementById('formId').value;
  const name  = document.getElementById('fieldName').value.trim();
  const price = document.getElementById('fieldPrice').value;
  const billing_cycle = document.querySelector('input[name="billing_cycle"]:checked').value;
  const category = document.getElementById('fieldCategory').value;

  // Client-side validation
  const errors = [];
  if (!name)     errors.push('サービス名は必須です。');
  if (!price || parseInt(price) <= 0) errors.push('料金は正の整数を入力してください。');
  if (!category) errors.push('カテゴリを選択してください。');
  if (errors.length) { showFormErrors(errors); return; }

  const payload = { name, price: parseInt(price), billing_cycle, category };

  try {
    let res;
    if (id) {
      res = await fetch(`${API}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const data = await res.json();
      showFormErrors(data.errors || ['エラーが発生しました。']);
      return;
    }

    showView('list');
  } catch (err) {
    showFormErrors(['通信エラーが発生しました。']);
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
function openDeleteModal(id, name) {
  pendingDeleteId = id;
  document.getElementById('deleteMessage').textContent = `${name} を削除しますか？`;
  deleteModal.show();
}

async function confirmDelete() {
  if (!pendingDeleteId) return;
  try {
    await fetch(`${API}/${pendingDeleteId}`, { method: 'DELETE' });
    deleteModal.hide();
    pendingDeleteId = null;
    fetchAndRender('list');
  } catch (err) {
    console.error('Delete error:', err);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str).replace(/'/g, "\\'");
}
