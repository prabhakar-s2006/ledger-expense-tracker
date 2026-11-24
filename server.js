import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import {Pool} from 'pg';

const PORT = Number(process.env.PORT) || 3000;
const JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length > 0
    ? process.env.JWT_SECRET
    : crypto.randomBytes(32).toString('hex');

const DATABASE_URL = process.env.DATABASE_URL?.trim() || '';

const ALLOWED_CATEGORIES = [
  'Kirana & Groceries',
  'House Rent',
  'Food & Chai',
  'Electricity & Bills',
  'Travel & Auto',
  'Mobile & WiFi',
  'Medical',
  'Shopping',
];

const ALLOWED_MODES = ['UPI', 'Cash', 'RuPay Card', 'Bank Transfer'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_REGEX = /^\d{4}-\d{2}$/;

// PostgreSQL pool (used whenever DATABASE_URL is configured in environment/Secrets)
const pgPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 10,
      connectionTimeoutMillis: 15000,
    })
  : null;

if (pgPool) {
  pgPool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
  });
}

let schemaReadyPromise = null;

async function ensurePostgresSchema() {
  if (!pgPool) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          monthly_budget INTEGER NOT NULL DEFAULT 45000,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          amount INTEGER NOT NULL,
          date TEXT NOT NULL,
          category TEXT NOT NULL,
          mode TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pgPool.query(`
        CREATE INDEX IF NOT EXISTS idx_expenses_user_date
        ON expenses(user_id, date DESC);
      `);
    })().catch((err) => {
      schemaReadyPromise = null;
      throw err;
    });
  }
  await schemaReadyPromise;
}

// In-memory fallback stores when DATABASE_URL is not yet configured
const usersById = new Map();
const userIdByEmail = new Map();
const expensesByUserId = new Map();

function mapUserRow(row) {
  return {
    id: String(row.id),
    name: String(row.name),
    email: String(row.email),
    passwordHash: String(row.password_hash),
    monthlyBudget: Number(row.monthly_budget),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

function mapExpenseRow(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    amount: Number(row.amount),
    date: String(row.date),
    category: String(row.category),
    mode: String(row.mode),
    notes: String(row.notes ?? ''),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

async function findUserByEmail(email) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `SELECT id, name, email, password_hash, monthly_budget, created_at
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [email],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  const userId = userIdByEmail.get(email);
  return userId ? usersById.get(userId) : undefined;
}

async function findUserById(id) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `SELECT id, name, email, password_hash, monthly_budget, created_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  return usersById.get(id);
}

async function createUser(user) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `INSERT INTO users (id, name, email, password_hash, monthly_budget, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, password_hash, monthly_budget, created_at`,
      [
        user.id,
        user.name,
        user.email,
        user.passwordHash,
        user.monthlyBudget,
        user.createdAt,
      ],
    );
    return mapUserRow(result.rows[0]);
  }

  usersById.set(user.id, user);
  userIdByEmail.set(user.email, user.id);
  expensesByUserId.set(user.id, []);
  return user;
}

async function updateUserBudget(userId, monthlyBudget) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `UPDATE users
       SET monthly_budget = $1
       WHERE id = $2
       RETURNING id, name, email, password_hash, monthly_budget, created_at`,
      [monthlyBudget, userId],
    );
    return result.rows[0] ? mapUserRow(result.rows[0]) : undefined;
  }

  const user = usersById.get(userId);
  if (!user) return undefined;
  user.monthlyBudget = monthlyBudget;
  return user;
}

async function listUserExpenses(userId, monthFilter) {
  if (pgPool) {
    await ensurePostgresSchema();
    if (monthFilter) {
      const result = await pgPool.query(
        `SELECT id, user_id, title, amount, date, category, mode, notes, created_at
         FROM expenses
         WHERE user_id = $1 AND date LIKE $2
         ORDER BY date DESC, created_at DESC`,
        [userId, `${monthFilter}%`],
      );
      return result.rows.map(mapExpenseRow);
    }

    const result = await pgPool.query(
      `SELECT id, user_id, title, amount, date, category, mode, notes, created_at
       FROM expenses
       WHERE user_id = $1
       ORDER BY date DESC, created_at DESC`,
      [userId],
    );
    return result.rows.map(mapExpenseRow);
  }

  const userExpenses = expensesByUserId.get(userId) ?? [];
  const filtered = monthFilter
    ? userExpenses.filter((item) => item.date.startsWith(monthFilter))
    : userExpenses;

  return [...filtered].sort((a, b) => {
    if (a.date !== b.date) {
      return b.date.localeCompare(a.date);
    }
    return b.createdAt.localeCompare(a.createdAt);
  });
}

async function createExpense(expense) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `INSERT INTO expenses (id, user_id, title, amount, date, category, mode, notes, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, title, amount, date, category, mode, notes, created_at`,
      [
        expense.id,
        expense.userId,
        expense.title,
        expense.amount,
        expense.date,
        expense.category,
        expense.mode,
        expense.notes,
        expense.createdAt,
      ],
    );
    return mapExpenseRow(result.rows[0]);
  }

  const list = expensesByUserId.get(expense.userId) ?? [];
  list.unshift(expense);
  expensesByUserId.set(expense.userId, list);
  return expense;
}

async function seedMonthExpenses(userId, month, samples) {
  const now = new Date().toISOString();

  if (pgPool) {
    await ensurePostgresSchema();
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT 1 FROM expenses WHERE user_id = $1 AND date LIKE $2 LIMIT 1`,
        [userId, `${month}%`],
      );
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query('ROLLBACK');
        return false;
      }

      for (const sample of samples) {
        await client.query(
          `INSERT INTO expenses (id, user_id, title, amount, date, category, mode, notes, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            crypto.randomUUID(),
            userId,
            sample.title,
            sample.amount,
            sample.date,
            sample.category,
            sample.mode,
            sample.notes,
            now,
          ],
        );
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  const existing = expensesByUserId.get(userId) ?? [];
  const hasMonthEntries = existing.some((item) => item.date.startsWith(month));
  if (hasMonthEntries) {
    return false;
  }

  for (const sample of samples) {
    existing.push({
      id: crypto.randomUUID(),
      userId,
      createdAt: now,
      ...sample,
    });
  }
  expensesByUserId.set(userId, existing);
  return true;
}

async function deleteUserExpense(userId, expenseId) {
  if (pgPool) {
    await ensurePostgresSchema();
    const result = await pgPool.query(
      `DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id`,
      [expenseId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  const list = expensesByUserId.get(userId) ?? [];
  const index = list.findIndex((item) => item.id === expenseId);
  if (index === -1) return false;
  list.splice(index, 1);
  expensesByUserId.set(userId, list);
  return true;
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    monthlyBudget: user.monthlyBudget,
  };
}

function signAuthToken(user) {
  return jwt.sign({sub: user.id, email: user.email}, JWT_SECRET, {
    expiresIn: '12h',
  });
}

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({error: 'Authentication required.'});
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({error: 'Authentication required.'});
    return;
  }

  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      typeof decoded.sub !== 'string'
    ) {
      res.status(401).json({error: 'Invalid or expired session.'});
      return;
    }
    userId = decoded.sub;
  } catch {
    res.status(401).json({error: 'Invalid or expired session.'});
    return;
  }

  try {
    const user = await findUserById(userId);
    if (!user) {
      res.status(401).json({error: 'Invalid or expired session.'});
      return;
    }

    req.user = {id: user.id, email: user.email};
    next();
  } catch (err) {
    console.error('Database error during authentication:', err);
    res
      .status(500)
      .json({error: 'Database error occurred while verifying session.'});
  }
}

async function buildExpensesResponse(user, monthFilter) {
  const sorted = await listUserExpenses(user.id, monthFilter);
  const totalSpent = sorted.reduce((sum, item) => sum + item.amount, 0);
  const balanceRemaining = user.monthlyBudget - totalSpent;

  const categoryTotalsMap = new Map();
  for (const item of sorted) {
    categoryTotalsMap.set(
      item.category,
      (categoryTotalsMap.get(item.category) ?? 0) + item.amount,
    );
  }

  const categoryTotals = Array.from(categoryTotalsMap.entries())
    .map(([name, amount]) => ({
      name,
      amount,
      percent: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    expenses: sorted,
    summary: {
      monthlyBudget: user.monthlyBudget,
      totalSpent,
      balanceRemaining,
    },
    categoryTotals,
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '16kb'}));

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({status: 'ok', storage: pgPool ? 'postgresql' : 'memory'});
  });

  // Register a new user account
  app.post('/api/auth/register', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const rawEmail =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';
    const rawBudget =
      body.monthlyBudget !== undefined ? Number(body.monthlyBudget) : 45000;

    if (rawName.length < 2 || rawName.length > 60) {
      res
        .status(400)
        .json({error: 'Full name must be between 2 and 60 characters.'});
      return;
    }

    if (!EMAIL_REGEX.test(rawEmail) || rawEmail.length > 120) {
      res.status(400).json({error: 'Please enter a valid email address.'});
      return;
    }

    if (rawPassword.length < 6 || rawPassword.length > 128) {
      res
        .status(400)
        .json({error: 'Password must be between 6 and 128 characters.'});
      return;
    }

    if (!Number.isFinite(rawBudget) || rawBudget <= 0 || rawBudget > 100000000) {
      res
        .status(400)
        .json({error: 'Monthly budget must be a valid positive amount.'});
      return;
    }

    try {
      const existing = await findUserByEmail(rawEmail);
      if (existing) {
        res
          .status(409)
          .json({error: 'An account with this email already exists.'});
        return;
      }

      const passwordHash = await bcrypt.hash(rawPassword, 10);
      const newUser = await createUser({
        id: crypto.randomUUID(),
        name: rawName,
        email: rawEmail,
        passwordHash,
        monthlyBudget: Math.round(rawBudget),
        createdAt: new Date().toISOString(),
      });

      const token = signAuthToken(newUser);
      res.status(201).json({
        token,
        user: toPublicUser(newUser),
      });
    } catch (err) {
      const pgCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? err.code
          : undefined;
      if (pgCode === '23505') {
        res
          .status(409)
          .json({error: 'An account with this email already exists.'});
        return;
      }
      console.error('Registration error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while creating account.'});
    }
  });

  // Log in with existing credentials
  app.post('/api/auth/login', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const rawEmail =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawPassword = typeof body.password === 'string' ? body.password : '';

    if (!EMAIL_REGEX.test(rawEmail) || rawPassword.length === 0) {
      res.status(400).json({error: 'Email and password are required.'});
      return;
    }

    try {
      const user = await findUserByEmail(rawEmail);
      if (!user) {
        res.status(401).json({error: 'Invalid email or password.'});
        return;
      }

      const isMatch = await bcrypt.compare(rawPassword, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({error: 'Invalid email or password.'});
        return;
      }

      const token = signAuthToken(user);
      res.json({
        token,
        user: toPublicUser(user),
      });
    } catch (err) {
      console.error('Login error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while signing in.'});
    }
  });

  // Get current authenticated user profile
  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const user = await findUserById(req.user.id);
      if (!user) {
        res.status(404).json({error: 'User not found.'});
        return;
      }
      res.json({user: toPublicUser(user)});
    } catch (err) {
      console.error('Profile lookup error:', err);
      res.status(500).json({error: 'Database error occurred.'});
    }
  });

  // Update user's monthly budget
  app.put('/api/budget', requireAuth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const nextBudget = Number(body.monthlyBudget);

    if (
      !Number.isFinite(nextBudget) ||
      nextBudget <= 0 ||
      nextBudget > 100000000
    ) {
      res
        .status(400)
        .json({error: 'Monthly budget must be a positive number.'});
      return;
    }

    try {
      const updated = await updateUserBudget(
        req.user.id,
        Math.round(nextBudget),
      );
      if (!updated) {
        res.status(404).json({error: 'User not found.'});
        return;
      }
      res.json({user: toPublicUser(updated)});
    } catch (err) {
      console.error('Update budget error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while updating budget.'});
    }
  });

  // List authenticated user's expenses (optionally filtered by YYYY-MM)
  app.get('/api/expenses', requireAuth, async (req, res) => {
    const monthParam =
      typeof req.query.month === 'string' ? req.query.month.trim() : '';

    if (monthParam && !MONTH_REGEX.test(monthParam)) {
      res.status(400).json({error: 'Invalid month format. Use YYYY-MM.'});
      return;
    }

    try {
      const user = await findUserById(req.user.id);
      if (!user) {
        res.status(404).json({error: 'User not found.'});
        return;
      }

      const payload = await buildExpensesResponse(
        user,
        monthParam || undefined,
      );
      res.json(payload);
    } catch (err) {
      console.error('List expenses error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while loading expenses.'});
    }
  });

  // Create a new expense for the authenticated user
  app.post('/api/expenses', requireAuth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const amount = Number(body.amount);
    const date = typeof body.date === 'string' ? body.date.trim() : '';
    const category =
      typeof body.category === 'string' ? body.category.trim() : '';
    const mode = typeof body.mode === 'string' ? body.mode.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

    if (title.length < 1 || title.length > 100) {
      res
        .status(400)
        .json({error: 'Expense title must be between 1 and 100 characters.'});
      return;
    }

    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
      res
        .status(400)
        .json({error: 'Amount must be greater than 0 and valid.'});
      return;
    }

    if (!DATE_REGEX.test(date)) {
      res.status(400).json({error: 'Please provide a valid date.'});
      return;
    }

    if (!ALLOWED_CATEGORIES.includes(category)) {
      res.status(400).json({error: 'Invalid expense category.'});
      return;
    }

    if (!ALLOWED_MODES.includes(mode)) {
      res.status(400).json({error: 'Invalid payment mode.'});
      return;
    }

    if (notes.length > 200) {
      res.status(400).json({error: 'Notes cannot exceed 200 characters.'});
      return;
    }

    try {
      const newExpense = await createExpense({
        id: crypto.randomUUID(),
        userId: req.user.id,
        title,
        amount: Math.round(amount),
        date,
        category,
        mode,
        notes,
        createdAt: new Date().toISOString(),
      });

      res.status(201).json({expense: newExpense});
    } catch (err) {
      console.error('Create expense error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while saving expense.'});
    }
  });

  // Seed sample entries for the authenticated user's selected month
  app.post('/api/expenses/seed', requireAuth, async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const month =
      typeof body.month === 'string' && MONTH_REGEX.test(body.month.trim())
        ? body.month.trim()
        : '2026-11';

    const samples = [
      {
        title: 'Flat Rent — Koramangala',
        amount: 14000,
        date: `${month}-24`,
        category: 'House Rent',
        mode: 'Bank Transfer',
        notes: 'Monthly rent via NEFT',
      },
      {
        title: 'DMart Superstore',
        amount: 3240,
        date: `${month}-22`,
        category: 'Kirana & Groceries',
        mode: 'UPI',
        notes: 'Monthly household groceries',
      },
      {
        title: 'BESCOM Electricity Bill',
        amount: 1420,
        date: `${month}-20`,
        category: 'Electricity & Bills',
        mode: 'UPI',
        notes: '',
      },
      {
        title: 'Jio Fiber Broadband',
        amount: 999,
        date: `${month}-18`,
        category: 'Mobile & WiFi',
        mode: 'UPI',
        notes: 'Unlimited plan',
      },
      {
        title: 'Namma Metro & Auto',
        amount: 460,
        date: `${month}-16`,
        category: 'Travel & Auto',
        mode: 'Cash',
        notes: '',
      },
      {
        title: 'Apollo Pharmacy',
        amount: 645,
        date: `${month}-14`,
        category: 'Medical',
        mode: 'RuPay Card',
        notes: '',
      },
      {
        title: 'Darshini Tiffin & Chai',
        amount: 185,
        date: `${month}-12`,
        category: 'Food & Chai',
        mode: 'Cash',
        notes: '',
      },
    ];

    try {
      const seeded = await seedMonthExpenses(req.user.id, month, samples);
      if (!seeded) {
        res.status(400).json({
          error: 'Sample entries can only be added to an empty month.',
        });
        return;
      }
      res.status(201).json({added: samples.length});
    } catch (err) {
      console.error('Seed expenses error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while loading sample entries.'});
    }
  });

  // Delete an expense owned by the authenticated user
  app.delete('/api/expenses/:id', requireAuth, async (req, res) => {
    const expenseId = String(req.params.id || '');
    try {
      const deleted = await deleteUserExpense(req.user.id, expenseId);
      if (!deleted) {
        res.status(404).json({error: 'Expense entry not found.'});
        return;
      }
      res.json({deleted: true, id: expenseId});
    } catch (err) {
      console.error('Delete expense error:', err);
      res
        .status(500)
        .json({error: 'Database error occurred while deleting expense.'});
    }
  });

  // Serve pure HTML, CSS, and JavaScript files directly from public/
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const publicDir = path.resolve(__dirname, 'public');

  //app.use(express.static(publicDir));

  app.use('/api', (_req, res) => {
    res.status(404).json({error: 'API route not found.'});
  });

  // app.get('*', (_req, res) => {
  //   const indexPath = path.join(publicDir, 'index.html');
  //   if (fs.existsSync(indexPath)) {
  //     res.sendFile(indexPath);
  //   } else {
  //     res.status(404).send('Frontend files not found.');
  //   }
  // });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Server listening on http://0.0.0.0:${PORT} (${pgPool ? 'PostgreSQL' : 'In-Memory'} storage)`,
    );
  });
}

startServer();
