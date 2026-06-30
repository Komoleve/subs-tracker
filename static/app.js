'use strict';

// ── Constants ────────────────────────────────────────────────────────────────
const API = '/api/subscriptions';

const CYCLE_LABEL  = { MONTHLY: '月額', YEARLY: '年額' };
const STATUS_LABEL = { ACTIVE: '利用中', PAUSED: '停止中', CANCELED: '解約済み' };
const STATUS_CLASS = { ACTIVE: 'badge-active', PAUSED: 'badge-paused', CANCELED: 'badge-canceled' };

// ── State ────────────────────────────────────────────────────────────────────
let allSubs = [];
let deleteModal = null;
let pendingDeleteId = null;
let activeFilter = '';
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

  // CSV Export
  document.getElementById('btnExport').addEventListener('click', () => {
    window.location.href = `${API}/export`;
  });

  // CSV Import
  document.getElementById('importFile').addEventListener('change', handleImport);

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

// Subscriptions counted for aggregation (ACTIVE + PAUSED)
function aggregateSubs() {
  return allSubs.filter(s => s.status !== 'CANCELED');
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function renderDashboard() {
  const subs = aggregateSubs();

  // Count (all non-canceled)
  document.getElementById('dashCount').textContent = subs.length;

  // Monthly / Yearly totals
  let monthly = 0, yearly = 0;
  subs.forEach(s => {
    monthly += monthlyAmount(s);
    yearly  += yearlyAmount(s);
  });
  document.getElementById('dashMonthly').textContent = monthly.toLocaleString();
  document.getElementById('dashYearly').textContent  = yearly.toLocaleString();

  // Category counts
  const catMap = {};
  subs.forEach(s => { catMap[s.category] = (catMap[s.category] || 0) + 1; });
  const catEl = document.getElementById('dashCategories');
  if (Object.keys(catMap).length === 0) {
    catEl.innerHTML = '<span class="text-muted">データなし</span>';
  } else {
    catEl.innerHTML = Object.entries(catMap)
      .map(([cat, cnt]) =>
        `<span class="cat-badge">${escHtml(cat)}<span class="count">${cnt}</span></span>`
      ).join('');
  }

  // Recent (up to 3, all statuses)
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
  subs.forEach(s => {
    if (!catSpendMap[s.category]) catSpendMap[s.category] = { monthly: 0, yearly: 0 };
    catSpendMap[s.category].monthly += monthlyAmount(s);
    catSpendMap[s.category].yearly  += yearlyAmount(s);
  });

  const catSpendEl = document.getElementById('dashCatSpending');
  if (Object.keys(catSpendMap).length === 0) {
    catSpendEl.innerHTML = '<li class="list-group-item text-muted">データなし</li>';
  } else {
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
  if (subs.length === 0) {
    rankingEl.innerHTML = '<li class="list-group-item text-muted">データなし</li>';
  } else {
    const ranked = [...subs]
      .sort((a, b) => yearlyAmount(b) - yearlyAmount(a))
      .slice(0, 5);
    rankingEl.innerHTML = ranked.map(s => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <span class="fw-semibold">${escHtml(s.name)}</span>
        <span class="fw-bold text-primary">${yearlyAmount(s).toLocaleString()}円/年</span>
      </li>
    `).join('');
  }

  // ── Payment schedule ───────────────────────────────────────────────────────
  const paymentsEl = document.getElementById('dashPayments');
  const withPayDay = subs
    .filter(s => s.payment_day && s.billing_cycle === 'MONTHLY')
    .sort((a, b) => a.payment_day - b.payment_day);

  if (withPayDay.length === 0) {
    paymentsEl.innerHTML = '<li class="list-group-item text-muted">支払日が登録されているサービスはありません。</li>';
  } else {
    paymentsEl.innerHTML = withPayDay.map(s => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <div>
          <span class="badge bg-light text-dark border me-2">${s.payment_day}日</span>
          <span class="fw-semibold">${escHtml(s.name)}</span>
        </div>
        <span class="text-muted small">${s.price.toLocaleString()}円</span>
      </li>
    `).join('');
  }

  // ── Renewal schedule ───────────────────────────────────────────────────────
  const renewalsEl = document.getElementById('dashRenewals');
  const withRenewal = allSubs
    .filter(s => s.renewal_date)
    .sort((a, b) => a.renewal_date.localeCompare(b.renewal_date));

  if (withRenewal.length === 0) {
    renewalsEl.innerHTML = '<li class="list-group-item text-muted">更新日が登録されているサービスはありません。</li>';
  } else {
    renewalsEl.innerHTML = withRenewal.map(s => {
      const d = new Date(s.renewal_date);
      const label = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
      return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <span class="badge bg-light text-dark border me-2">${label}</span>
            <span class="fw-semibold">${escHtml(s.name)}</span>
          </div>
          <span class="badge rounded-pill ${STATUS_CLASS[s.status] || ''}">${STATUS_LABEL[s.status] || s.status}</span>
        </li>
      `;
    }).join('');
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
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">該当するサブスクリプションはありません。</td></tr>';
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
      <td class="text-center">${s.payment_day ? s.payment_day + '日' : '—'}</td>
      <td>${s.start_date ? fmtDate(s.start_date) : '—'}</td>
      <td>${s.renewal_date ? fmtDate(s.renewal_date) : '—'}</td>
      <td>
        <span class="badge rounded-pill ${STATUS_CLASS[s.status] || ''}">
          ${STATUS_LABEL[s.status] || escHtml(s.status)}
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
  document.getElementById('fieldPaymentDay').value = '';
  document.getElementById('fieldStatus').value = 'ACTIVE';
  document.getElementById('fieldStartDate').value = '';
  document.getElementById('fieldRenewalDate').value = '';
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
  document.getElementById('fieldPaymentDay').value = s.payment_day || '';
  document.getElementById('fieldStatus').value = s.status || 'ACTIVE';
  document.getElementById('fieldStartDate').value = s.start_date || '';
  document.getElementById('fieldRenewalDate').value = s.renewal_date || '';
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

  const id           = document.getElementById('formId').value;
  const name         = document.getElementById('fieldName').value.trim();
  const price        = document.getElementById('fieldPrice').value;
  const billing_cycle = document.querySelector('input[name="billing_cycle"]:checked').value;
  const category     = document.getElementById('fieldCategory').value;
  const payment_day  = document.getElementById('fieldPaymentDay').value || null;
  const status       = document.getElementById('fieldStatus').value;
  const start_date   = document.getElementById('fieldStartDate').value || null;
  const renewal_date = document.getElementById('fieldRenewalDate').value || null;

  // Client-side validation
  const errors = [];
  if (!name)     errors.push('サービス名は必須です。');
  if (!price || parseInt(price) <= 0) errors.push('料金は正の整数を入力してください。');
  if (!category) errors.push('カテゴリを選択してください。');
  if (payment_day && (parseInt(payment_day) < 1 || parseInt(payment_day) > 31)) {
    errors.push('支払日は1〜31の整数を入力してください。');
  }
  if (errors.length) { showFormErrors(errors); return; }

  const payload = {
    name, price: parseInt(price), billing_cycle, category,
    payment_day: payment_day ? parseInt(payment_day) : null,
    status, start_date, renewal_date,
  };

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

// ── CSV Import ────────────────────────────────────────────────────────────────
async function handleImport(e) {
  const file = e.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  const alertEl = document.getElementById('importAlert');
  alertEl.className = 'alert d-none mb-3';
  alertEl.textContent = '';

  try {
    const res  = await fetch(`${API}/import`, { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      alertEl.className = 'alert alert-danger mb-3';
      alertEl.textContent = data.error || 'インポートに失敗しました。';
    } else {
      let msg = `${data.imported}件をインポートしました。`;
      if (data.errors && data.errors.length > 0) {
        msg += ` （${data.errors.length}件のエラーをスキップ）`;
        alertEl.className = 'alert alert-warning mb-3';
      } else {
        alertEl.className = 'alert alert-success mb-3';
      }
      alertEl.textContent = msg;
      fetchAndRender('list');
    }
  } catch (err) {
    alertEl.className = 'alert alert-danger mb-3';
    alertEl.textContent = '通信エラーが発生しました。';
  }

  // Reset file input so same file can be re-imported
  e.target.value = '';
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

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
