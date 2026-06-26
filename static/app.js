'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const API = '/api/subscriptions';

const CYCLE_LABEL = { MONTHLY: '月額', YEARLY: '年額' };

// ── State ────────────────────────────────────────────────────────────────────
let allSubs = [];
let deleteModal = null;
let pendingDeleteId = null;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));

  // Nav
  document.getElementById('navDashboard').addEventListener('click', () => showView('dashboard'));
  document.getElementById('navList').addEventListener('click', () => showView('list'));

  // List view
  document.getElementById('btnAdd').addEventListener('click', openAddForm);

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

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  // Count
  document.getElementById('dashCount').textContent = allSubs.length;

  // Monthly / Yearly totals
  let monthly = 0, yearly = 0;
  allSubs.forEach(s => {
    if (s.billing_cycle === 'MONTHLY') {
      monthly += s.price;
      yearly  += s.price * 12;
    } else {
      monthly += Math.round(s.price / 12);
      yearly  += s.price;
    }
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
}

// ── List ──────────────────────────────────────────────────────────────────────
function renderList() {
  const tbody = document.getElementById('subsList');
  if (allSubs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">登録されているサブスクリプションはありません。</td></tr>';
    return;
  }
  tbody.innerHTML = allSubs.map(s => `
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
