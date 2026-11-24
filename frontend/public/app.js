// Client-side SPA controller for Expense Tracker — Personal Expense Ledger.
// Auth tokens are held strictly in JavaScript memory (never localStorage/sessionStorage).

const MONTH_LABELS = {
  '2026-09': 'September 2026',
  '2026-10': 'October 2026',
  '2026-11': 'November 2026',
};

const state = {
  token: null,
  user: null,
  selectedMonth: '2026-11',
  modeFilter: 'all',
  searchQuery: '',
  expenses: [],
  summary: {
    monthlyBudget: 0,
    totalSpent: 0,
    balanceRemaining: 0,
  },
  categoryTotals: [],
};

function formatINR(value) {
  const num = Number(value) || 0;
  return `₹${Math.abs(Math.round(num)).toLocaleString('en-IN')}`;
}

function formatDateDisplay(isoDate) {
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return isoDate;
  const year = Number(parts[0]);
  const monthIdx = Number(parts[1]) - 1;
  const day = parts[2];
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const monthName = months[monthIdx] || parts[1];
  return `${day} ${monthName} ${year}`;
}

function getInitials(name) {
  const words = String(name || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'U';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

async function apiRequest(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({}));

  if (response.status === 401 && state.token) {
    signOutUser();
    throw new Error(payload.error || 'Session expired. Please sign in again.');
  }

  if (!response.ok) {
    throw new Error(payload.error || 'Request failed. Please try again.');
  }

  return payload;
}

function showView(viewName) {
  const authView = document.getElementById('auth-view');
  const dashboardView = document.getElementById('dashboard-view');
  if (!authView || !dashboardView) return;

  if (viewName === 'dashboard') {
    authView.hidden = true;
    dashboardView.hidden = false;
  } else {
    dashboardView.hidden = true;
    authView.hidden = false;
  }
}

function setAuthMode(mode) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const headerCta = document.getElementById('auth-header-cta');
  const loginError = document.getElementById('login-error');
  const registerError = document.getElementById('register-error');

  if (!loginForm || !registerForm) return;

  const isLogin = mode === 'login';
  loginForm.hidden = !isLogin;
  registerForm.hidden = isLogin;

  if (loginError) loginError.hidden = true;
  if (registerError) registerError.hidden = true;

  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    const active = btn.getAttribute('data-auth-tab') === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('[data-auth-nav]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-auth-nav') === mode);
  });

  if (headerCta) {
    headerCta.textContent = isLogin ? 'Create Account' : 'Sign In';
    headerCta.setAttribute('data-target-mode', isLogin ? 'register' : 'login');
  }
}

function signOutUser() {
  state.token = null;
  state.user = null;
  state.expenses = [];
  state.categoryTotals = [];
  state.summary = { monthlyBudget: 0, totalSpent: 0, balanceRemaining: 0 };

  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  if (loginForm instanceof HTMLFormElement) loginForm.reset();
  if (registerForm instanceof HTMLFormElement) registerForm.reset();

  setAuthMode('login');
  showView('auth');
}

function renderSummary() {
  const greetingEl = document.getElementById('user-greeting-line');
  const footerLabelEl = document.getElementById('footer-user-label');
  const initialsEl = document.getElementById('avatar-initials');

  const monthLabel = MONTH_LABELS[state.selectedMonth] || state.selectedMonth;
  if (greetingEl && state.user) {
    greetingEl.textContent = `Welcome, ${state.user.name} · ${monthLabel} · Indian Rupee (INR)`;
  }
  if (footerLabelEl && state.user) {
    footerLabelEl.textContent = `${state.user.name} (${state.user.email}) · Personal Expense Ledger`;
  }
  if (initialsEl && state.user) {
    initialsEl.textContent = getInitials(state.user.name);
  }

  const budgetEl = document.getElementById('summary-budget');
  const budgetNoteEl = document.getElementById('summary-budget-note');
  const spentEl = document.getElementById('summary-spent');
  const spentNoteEl = document.getElementById('summary-spent-note');
  const balanceEl = document.getElementById('summary-balance');
  const balanceNoteEl = document.getElementById('summary-balance-note');

  const { monthlyBudget, totalSpent, balanceRemaining } = state.summary;

  if (budgetEl) budgetEl.textContent = formatINR(monthlyBudget);
  if (budgetNoteEl) budgetNoteEl.textContent = `Target limit for ${monthLabel}`;

  if (spentEl) spentEl.textContent = formatINR(totalSpent);
  if (spentNoteEl) {
    const pct =
      monthlyBudget > 0 ? Math.round((totalSpent / monthlyBudget) * 100) : 0;
    spentNoteEl.textContent = `${pct}% of monthly budget used`;
  }

  if (balanceEl && balanceNoteEl) {
    if (balanceRemaining >= 0) {
      balanceEl.textContent = formatINR(balanceRemaining);
      balanceEl.classList.add('amount-balance');
      balanceEl.classList.remove('amount-over');
      balanceNoteEl.textContent = 'Within monthly budget';
    } else {
      balanceEl.textContent = `− ${formatINR(balanceRemaining)}`;
      balanceEl.classList.remove('amount-balance');
      balanceEl.classList.add('amount-over');
      balanceNoteEl.textContent = `Over budget by ${formatINR(balanceRemaining)}`;
    }
  }
}

function renderCategories() {
  const listEl = document.getElementById('category-list');
  const subtitleEl = document.getElementById('category-subtitle');
  if (!listEl) return;

  const monthLabel = MONTH_LABELS[state.selectedMonth] || state.selectedMonth;
  if (subtitleEl) {
    subtitleEl.textContent = `${monthLabel} breakdown in ₹`;
  }

  listEl.replaceChildren();

  if (state.categoryTotals.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'passbook-empty';
    emptyLi.textContent = 'No category spending recorded for this month yet.';
    listEl.appendChild(emptyLi);
    return;
  }

  for (const cat of state.categoryTotals) {
    const li = document.createElement('li');
    li.className = 'category-row';

    const top = document.createElement('div');
    top.className = 'category-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'category-name';
    nameSpan.textContent = cat.name;

    const valSpan = document.createElement('span');
    valSpan.className = 'category-value tabular-nums';
    valSpan.textContent = `${formatINR(cat.amount)} · ${cat.percent}%`;

    top.append(nameSpan, valSpan);

    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('aria-hidden', 'true');

    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    const clampedPct = Math.max(0, Math.min(100, Number(cat.percent) || 0));
    fill.style.width = `${clampedPct}%`;

    track.appendChild(fill);
    li.append(top, track);
    listEl.appendChild(li);
  }
}

function renderPassbook() {
  const listEl = document.getElementById('passbook-list');
  const countEl = document.getElementById('passbook-count');
  const emptyBox = document.getElementById('passbook-empty-box');
  if (!listEl || !emptyBox) return;

  listEl.replaceChildren();

  if (state.expenses.length === 0) {
    emptyBox.hidden = false;
    if (countEl) countEl.textContent = '0 entries';
    return;
  }

  emptyBox.hidden = true;

  const query = state.searchQuery.trim().toLowerCase();
  const visible = state.expenses.filter((item) => {
    const matchesMode =
      state.modeFilter === 'all' ||
      (state.modeFilter === 'bank'
        ? item.mode === 'Bank Transfer' || item.mode === 'RuPay Card'
        : item.mode === state.modeFilter);

    const matchesQuery =
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.category.toLowerCase().includes(query) ||
      (item.notes && item.notes.toLowerCase().includes(query));

    return matchesMode && matchesQuery;
  });

  if (countEl) {
    countEl.textContent = `Showing ${visible.length} of ${state.expenses.length} ${
      state.expenses.length === 1 ? 'entry' : 'entries'
    }`;
  }

  if (visible.length === 0) {
    const emptyLi = document.createElement('li');
    emptyLi.className = 'passbook-empty';
    emptyLi.textContent = 'No entries match your search or payment mode filter.';
    listEl.appendChild(emptyLi);
    return;
  }

  for (const item of visible) {
    const li = document.createElement('li');
    li.className = 'passbook-item';

    const infoDiv = document.createElement('div');
    infoDiv.className = 'passbook-info';

    const merchantSpan = document.createElement('span');
    merchantSpan.className = 'passbook-merchant';
    merchantSpan.textContent = item.title;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'passbook-meta';
    metaSpan.textContent = `${item.category} · ${formatDateDisplay(item.date)} · ${item.mode}`;

    infoDiv.append(merchantSpan, metaSpan);

    if (item.notes) {
      const noteSpan = document.createElement('span');
      noteSpan.className = 'passbook-note';
      noteSpan.textContent = item.notes;
      infoDiv.appendChild(noteSpan);
    }

    const rightDiv = document.createElement('div');
    rightDiv.className = 'passbook-right';

    const amountSpan = document.createElement('span');
    amountSpan.className = 'passbook-amount tabular-nums';
    amountSpan.textContent = `− ${formatINR(item.amount)}`;

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'delete-entry-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', `Delete ${item.title}`);
    deleteBtn.addEventListener('click', () => handleDeleteExpense(item.id));

    rightDiv.append(amountSpan, deleteBtn);
    li.append(infoDiv, rightDiv);
    listEl.appendChild(li);
  }
}

async function loadExpensesForMonth() {
  if (!state.token) return;
  const data = await apiRequest(
    `/api/expenses?month=${encodeURIComponent(state.selectedMonth)}`,
  );
  state.expenses = data.expenses || [];
  state.summary = data.summary || {
    monthlyBudget: state.user?.monthlyBudget || 0,
    totalSpent: 0,
    balanceRemaining: state.user?.monthlyBudget || 0,
  };
  state.categoryTotals = data.categoryTotals || [];

  renderSummary();
  renderCategories();
  renderPassbook();
}

async function handleDeleteExpense(expenseId) {
  try {
    await apiRequest(`/api/expenses/${encodeURIComponent(expenseId)}`, {
      method: 'DELETE',
    });
    await loadExpensesForMonth();
  } catch (err) {
    const errorEl = document.getElementById('expense-form-error');
    if (errorEl) {
      errorEl.textContent =
        err instanceof Error ? err.message : 'Unable to delete expense.';
      errorEl.hidden = false;
    }
  }
}

function setupAuthHandlers() {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-auth-tab') || 'login';
      setAuthMode(mode);
    });
  });

  document.querySelectorAll('[data-auth-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-auth-nav') || 'login';
      setAuthMode(mode);
    });
  });

  const headerCta = document.getElementById('auth-header-cta');
  if (headerCta) {
    headerCta.addEventListener('click', () => {
      const target = headerCta.getAttribute('data-target-mode') || 'register';
      setAuthMode(target);
    });
  }

  const switchToReg = document.getElementById('switch-to-register');
  if (switchToReg) {
    switchToReg.addEventListener('click', () => setAuthMode('register'));
  }

  const switchToLogin = document.getElementById('switch-to-login');
  if (switchToLogin) {
    switchToLogin.addEventListener('click', () => setAuthMode('login'));
  }

  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const loginBtn = document.getElementById('login-submit-btn');

  if (loginForm instanceof HTMLFormElement) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (loginError) loginError.hidden = true;

      const formData = new FormData(loginForm);
      const email = String(formData.get('email') || '').trim();
      const password = String(formData.get('password') || '');

      if (loginBtn instanceof HTMLButtonElement) {
        loginBtn.disabled = true;
        loginBtn.textContent = 'Signing in...';
      }

      try {
        const result = await apiRequest('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        state.token = result.token;
        state.user = result.user;
        showView('dashboard');
        await loadExpensesForMonth();
      } catch (err) {
        if (loginError) {
          loginError.textContent =
            err instanceof Error ? err.message : 'Unable to sign in.';
          loginError.hidden = false;
        }
      } finally {
        if (loginBtn instanceof HTMLButtonElement) {
          loginBtn.disabled = false;
          loginBtn.textContent = 'Sign In to Expense Tracker';
        }
      }
    });
  }

  const registerForm = document.getElementById('register-form');
  const registerError = document.getElementById('register-error');
  const registerBtn = document.getElementById('register-submit-btn');

  if (registerForm instanceof HTMLFormElement) {
    registerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (registerError) registerError.hidden = true;

      const formData = new FormData(registerForm);
      const name = String(formData.get('name') || '').trim();
      const email = String(formData.get('email') || '').trim();
      const monthlyBudget = Number(formData.get('monthlyBudget') || 45000);
      const password = String(formData.get('password') || '');
      const confirmPassword = String(formData.get('confirmPassword') || '');

      if (password !== confirmPassword) {
        if (registerError) {
          registerError.textContent = 'Passwords do not match.';
          registerError.hidden = false;
        }
        return;
      }

      if (registerBtn instanceof HTMLButtonElement) {
        registerBtn.disabled = true;
        registerBtn.textContent = 'Creating account...';
      }

      try {
        const result = await apiRequest('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ name, email, monthlyBudget, password }),
        });
        state.token = result.token;
        state.user = result.user;
        showView('dashboard');
        await loadExpensesForMonth();
      } catch (err) {
        if (registerError) {
          registerError.textContent =
            err instanceof Error ? err.message : 'Unable to create account.';
          registerError.hidden = false;
        }
      } finally {
        if (registerBtn instanceof HTMLButtonElement) {
          registerBtn.disabled = false;
          registerBtn.textContent = 'Create Account';
        }
      }
    });
  }
}

function setupDashboardHandlers() {
  // Avatar fallback handler
  const avatarImg = document.getElementById('profile-avatar');
  const avatarBox = document.getElementById('avatar-box');
  if (avatarImg && avatarBox) {
    avatarImg.addEventListener('error', () => {
      avatarBox.classList.add('is-fallback');
    });
  }

  // Logout
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      signOutUser();
    });
  }

  // Top nav active highlight
  const navLinks = document.querySelectorAll('.topnav-link');
  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.forEach((l) => l.classList.remove('is-active'));
      link.classList.add('is-active');
    });
  });

  // Month switcher
  const monthBtns = document.querySelectorAll('[data-month]');
  monthBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const nextMonth = btn.getAttribute('data-month');
      if (!nextMonth || nextMonth === state.selectedMonth) return;

      monthBtns.forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      state.selectedMonth = nextMonth;

      const dateInput = document.getElementById('expense-date');
      if (dateInput instanceof HTMLInputElement) {
        dateInput.value = `${nextMonth}-24`;
      }

      await loadExpensesForMonth();
    });
  });

  // Budget inline edit
  const editBudgetBtn = document.getElementById('edit-budget-btn');
  const budgetForm = document.getElementById('budget-edit-form');
  const budgetInput = document.getElementById('budget-edit-input');
  const cancelBudgetBtn = document.getElementById('cancel-budget-btn');

  if (
    editBudgetBtn &&
    budgetForm instanceof HTMLFormElement &&
    budgetInput instanceof HTMLInputElement
  ) {
    editBudgetBtn.addEventListener('click', () => {
      budgetInput.value = String(state.summary.monthlyBudget || 45000);
      budgetForm.hidden = false;
      budgetInput.focus();
    });

    if (cancelBudgetBtn) {
      cancelBudgetBtn.addEventListener('click', () => {
        budgetForm.hidden = true;
      });
    }

    budgetForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const nextBudget = Number(budgetInput.value);
      if (!Number.isFinite(nextBudget) || nextBudget <= 0) return;

      try {
        const res = await apiRequest('/api/budget', {
          method: 'PUT',
          body: JSON.stringify({ monthlyBudget: nextBudget }),
        });
        state.user = res.user;
        budgetForm.hidden = true;
        await loadExpensesForMonth();
      } catch {
        budgetForm.hidden = true;
      }
    });
  }

  // Add Expense form
  const expenseForm = document.getElementById('expense-form');
  const formError = document.getElementById('expense-form-error');
  const formSuccess = document.getElementById('expense-form-success');
  const saveBtn = document.getElementById('save-expense-btn');

  if (expenseForm instanceof HTMLFormElement) {
    expenseForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (formError) formError.hidden = true;
      if (formSuccess) formSuccess.hidden = true;

      const formData = new FormData(expenseForm);
      const title = String(formData.get('title') || '').trim();
      const amount = Number(formData.get('amount') || 0);
      const date = String(formData.get('date') || '').trim();
      const category = String(formData.get('category') || '').trim();
      const mode = String(formData.get('mode') || '').trim();
      const notes = String(formData.get('notes') || '').trim();

      if (saveBtn instanceof HTMLButtonElement) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        await apiRequest('/api/expenses', {
          method: 'POST',
          body: JSON.stringify({ title, amount, date, category, mode, notes }),
        });

        const entryMonth = date.slice(0, 7);
        if (MONTH_LABELS[entryMonth] && entryMonth !== state.selectedMonth) {
          state.selectedMonth = entryMonth;
          monthBtns.forEach((b) => {
            b.classList.toggle(
              'is-active',
              b.getAttribute('data-month') === entryMonth,
            );
          });
        }

        expenseForm.reset();
        const dateInput = document.getElementById('expense-date');
        if (dateInput instanceof HTMLInputElement) {
          dateInput.value = `${state.selectedMonth}-24`;
        }

        if (formSuccess) {
          formSuccess.textContent = 'Expense added to your ledger.';
          formSuccess.hidden = false;
        }
        await loadExpensesForMonth();
      } catch (err) {
        if (formError) {
          formError.textContent =
            err instanceof Error ? err.message : 'Could not save expense.';
          formError.hidden = false;
        }
      } finally {
        if (saveBtn instanceof HTMLButtonElement) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save Expense';
        }
      }
    });

    expenseForm.addEventListener('reset', () => {
      if (formError) formError.hidden = true;
      if (formSuccess) formSuccess.hidden = true;
    });
  }

  // Payment mode filter & search
  document.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-mode]').forEach((b) => {
        b.classList.remove('is-active');
      });
      btn.classList.add('is-active');
      state.modeFilter = btn.getAttribute('data-mode') || 'all';
      renderPassbook();
    });
  });

  const searchInput = document.getElementById('search-input');
  if (searchInput instanceof HTMLInputElement) {
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value;
      renderPassbook();
    });
  }

  // Empty state actions
  const focusAddBtn = document.getElementById('focus-add-btn');
  const titleInput = document.getElementById('expense-title');
  if (focusAddBtn && titleInput) {
    focusAddBtn.addEventListener('click', () => {
      titleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      titleInput.focus();
    });
  }

  const seedBtn = document.getElementById('seed-samples-btn');
  if (seedBtn instanceof HTMLButtonElement) {
    seedBtn.addEventListener('click', async () => {
      seedBtn.disabled = true;
      seedBtn.textContent = 'Loading...';
      try {
        await apiRequest('/api/expenses/seed', {
          method: 'POST',
          body: JSON.stringify({ month: state.selectedMonth }),
        });
        await loadExpensesForMonth();
      } finally {
        seedBtn.disabled = false;
        seedBtn.textContent = 'Load Sample Entries';
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupAuthHandlers();
  setupDashboardHandlers();
  setAuthMode('login');
  showView('auth');
});
