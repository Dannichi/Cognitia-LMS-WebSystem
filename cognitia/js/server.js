const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "..")));

const pool = mysql.createPool({
  host: "127.0.0.1",
  user: "root",
  password: "",
  database: "lms_data",
  port: 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

/* ═══════════════════════════════════════════
   Helpers
═══════════════════════════════════════════ */
const str = (v, max) => {
  if (v === null || v === undefined || v === "") return null;
  return String(v).trim().slice(0, max);
};
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const isId = (v) => Number.isInteger(v) && v >= 0;
const list = (v) => (Array.isArray(v) ? v : []);
const parseJSON = (s, fallback) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

async function pruneNotIn(conn, table, ids) {
  if (ids.length === 0) await conn.query(`DELETE FROM ${table}`);
  else await conn.query(`DELETE FROM ${table} WHERE id NOT IN (?)`, [ids]);
}

// bcrypt is slow, so only re-hash when the password actually changed
const hashCache = new Map(); // userId -> { plain, hash }
function passwordHashFor(user, existingHash) {
  const plain = String(user.password ?? "");
  if (!plain) return existingHash || "";
  const cached = hashCache.get(user.id);
  if (cached && cached.plain === plain) return cached.hash;
  if (
    existingHash &&
    existingHash.length === 60 &&
    bcrypt.compareSync(plain, existingHash)
  ) {
    hashCache.set(user.id, { plain, hash: existingHash });
    return existingHash;
  }
  const hash = bcrypt.hashSync(plain, 10);
  hashCache.set(user.id, { plain, hash });
  return hash;
}

// Never keep plaintext passwords in the stored JSON
function stripPasswords(state) {
  return {
    ...state,
    users: list(state.users).map((u) => {
      const { password, ...rest } = u || {};
      return rest;
    }),
  };
}

/* ═══════════════════════════════════════════
   READ: build the app state from the tables
═══════════════════════════════════════════ */
async function loadTables() {
  const [programs] = await pool.query("SELECT * FROM programs ORDER BY id");
  const [sections] = await pool.query("SELECT * FROM sections ORDER BY id");
  const [courses] = await pool.query("SELECT * FROM courses ORDER BY id");
  const [pc] = await pool.query(
    "SELECT program_id, course_id FROM program_courses ORDER BY program_id",
  );
  const [users] = await pool.query("SELECT * FROM users ORDER BY id");
  const [uc] = await pool.query(
    "SELECT user_id, course_id FROM user_courses ORDER BY course_id",
  );
  const [ps] = await pool.query(
    "SELECT user_id, section_id FROM professor_sections ORDER BY section_id",
  );

  const group = (rows, key, val) => {
    const m = new Map();
    for (const r of rows) {
      if (!m.has(r[key])) m.set(r[key], []);
      m.get(r[key]).push(r[val]);
    }
    return m;
  };
  const coursePrograms = group(pc, "course_id", "program_id");
  const userCourses = group(uc, "user_id", "course_id");
  const userSections = group(ps, "user_id", "section_id");

  return {
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      desc: p.description ?? "",
      color: p.color,
      status: p.status,
    })),
    sections: sections.map((s) => ({
      id: s.id,
      programId: s.program_id,
      year: s.year,
      letter: s.letter,
      capacity: s.capacity,
    })),
    courses: courses.map((c) => {
      const pids = coursePrograms.get(c.id) || [];
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        programIds: pids,
        programId: pids[0] ?? null,
        year: c.year,
        semester: c.semester,
        units: c.units,
        status: c.status,
      };
    }),
    users: users.map((u) => {
      const o = {
        id: u.id,
        firstname: u.firstname,
        middlename: u.middlename,
        lastname: u.lastname,
        displayName:
          u.display_name || [u.firstname, u.lastname].filter(Boolean).join(" "),
        email: u.email,
        role: u.role,
        status: u.status,
        joined: u.joined,
        programId: u.program_id,
        sectionId: u.section_id,
        courseIds: userCourses.get(u.id) || [],
        sectionIds: userSections.get(u.id) || [],
      };
      if (u.student_id) o.studentId = u.student_id;
      return o;
    }),
  };
}

async function readBlob() {
  const [rows] = await pool.query(
    "SELECT state_json FROM app_state WHERE state_key = 'cognitia_state'",
  );
  return rows.length ? parseJSON(rows[0].state_json, {}) : null;
}

async function assembleState() {
  const blob = (await readBlob()) || {};
  const t = await loadTables();
  const maxId = Math.max(
    0,
    ...[t.programs, t.sections, t.courses, t.users].flatMap((a) =>
      a.map((x) => x.id),
    ),
  );
  // Tables win for programs/sections/courses/users; the JSON supplies everything else
  return {
    ...blob,
    ...t,
    nextId: Math.max(Number(blob.nextId) || 1, maxId + 1),
  };
}

/* ═══════════════════════════════════════════
   WRITE: save the app state into the tables
═══════════════════════════════════════════ */
async function syncNormalized(state) {
  const programs = list(state.programs).filter(
    (p) => p && isId(p.id) && p.id > 0,
  );
  const sections = list(state.sections).filter(
    (s) => s && isId(s.id) && s.id > 0,
  );
  const courses = list(state.courses).filter(
    (c) => c && isId(c.id) && c.id > 0,
  );
  // Real ids first; the seeded admin (id 0) last so it never steals another user's id
  const users = list(state.users)
    .filter((u) => u && isId(u.id) && u.email)
    .sort((a, b) => (a.id === 0) - (b.id === 0));

  const programIds = new Set(programs.map((p) => p.id));
  const validSections = sections.filter((s) => programIds.has(s.programId));
  const sectionIds = new Set(validSections.map((s) => s.id));
  const courseIds = new Set(courses.map((c) => c.id));

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [oldUsers] = await conn.query("SELECT id, password_hash FROM users");
    const oldHash = new Map(oldUsers.map((r) => [r.id, r.password_hash]));

    for (const p of programs) {
      await conn.query(
        `INSERT INTO programs (id, code, name, description, color, status) VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE code=VALUES(code), name=VALUES(name),
           description=VALUES(description), color=VALUES(color), status=VALUES(status)`,
        [
          p.id,
          str(p.code, 30) || "",
          str(p.name, 150) || "",
          str(p.desc, 65000),
          str(p.color, 20),
          str(p.status, 20),
        ],
      );
    }

    for (const s of validSections) {
      await conn.query(
        `INSERT INTO sections (id, program_id, year, letter, capacity) VALUES (?,?,?,?,?)
         ON DUPLICATE KEY UPDATE program_id=VALUES(program_id), year=VALUES(year),
           letter=VALUES(letter), capacity=VALUES(capacity)`,
        [
          s.id,
          s.programId,
          str(s.year, 20),
          str(s.letter, 10),
          num(s.capacity),
        ],
      );
    }

    for (const c of courses) {
      await conn.query(
        `INSERT INTO courses (id, code, name, year, semester, units, status) VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE code=VALUES(code), name=VALUES(name), year=VALUES(year),
           semester=VALUES(semester), units=VALUES(units), status=VALUES(status)`,
        [
          c.id,
          str(c.code, 30) || "",
          str(c.name, 150) || "",
          str(c.year, 20),
          str(c.semester, 20),
          num(c.units),
          str(c.status, 20),
        ],
      );
    }

    await conn.query("DELETE FROM program_courses");
    for (const c of courses) {
      const pids = Array.isArray(c.programIds)
        ? c.programIds
        : c.programId != null
          ? [c.programId]
          : [];
      for (const pid of new Set(pids)) {
        if (programIds.has(pid)) {
          await conn.query(
            "INSERT IGNORE INTO program_courses (program_id, course_id) VALUES (?,?)",
            [pid, c.id],
          );
        }
      }
    }

    // Users — one bad row (e.g. duplicate email) doesn't block the others
    const idMap = new Map(); // state id -> real database id
    const skipped = []; // users that could not be written, with the reason
    for (const u of users) {
      const role = ["student", "professor", "admin"].includes(u.role)
        ? u.role
        : null;
      if (!role) continue;
      const email = String(u.email).trim().toLowerCase().slice(0, 150);
      const studentId = role === "student" ? str(u.studentId, 10) : null;
      try {
        let id = u.id;
        if (id === 0) {
          const [f] = await conn.query("SELECT id FROM users WHERE email = ?", [
            email,
          ]);
          id = f.length ? f[0].id : null; // null → MySQL assigns the next id
        }
        // Never let one user overwrite another through a shared email / student id
        const [clash] = await conn.query(
          "SELECT id FROM users WHERE (email = ? OR (? IS NOT NULL AND student_id = ?)) AND id <> ?",
          [email, studentId, studentId, id ?? -1],
        );
        if (clash.length) {
          const why = "email or student ID already used by another user";
          console.warn(`Skipped user ${u.id} (${email}): ${why}`);
          skipped.push({ email, reason: why });
          continue;
        }
        const [r] = await conn.query(
          `INSERT INTO users (id, student_id, firstname, middlename, lastname, display_name,
             email, password_hash, role, status, program_id, section_id, joined)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON DUPLICATE KEY UPDATE student_id=VALUES(student_id), firstname=VALUES(firstname),
             middlename=VALUES(middlename), lastname=VALUES(lastname),
             display_name=VALUES(display_name), email=VALUES(email),
             password_hash=VALUES(password_hash), role=VALUES(role), status=VALUES(status),
             program_id=VALUES(program_id), section_id=VALUES(section_id), joined=VALUES(joined)`,
          [
            id,
            studentId,
            str(u.firstname, 60) || "",
            str(u.middlename, 60) || "",
            str(u.lastname, 60) || "",
            str(u.displayName, 150),
            email,
            passwordHashFor(u, oldHash.get(id ?? u.id)),
            role,
            str(u.status, 20) || "active",
            programIds.has(u.programId) ? u.programId : null,
            sectionIds.has(u.sectionId) ? u.sectionId : null,
            str(u.joined, 40),
          ],
        );
        idMap.set(u.id, id ?? r.insertId);
      } catch (err) {
        console.warn(`Skipped user ${u.id} (${u.email}): ${err.message}`);
        skipped.push({ email: u.email, reason: err.message });
      }
    }

    await conn.query("DELETE FROM user_courses");
    await conn.query("DELETE FROM professor_sections");
    for (const u of users) {
      const realId = idMap.get(u.id);
      if (realId === undefined) continue;
      for (const cid of new Set(list(u.courseIds))) {
        if (courseIds.has(cid)) {
          await conn.query(
            "INSERT IGNORE INTO user_courses (user_id, course_id) VALUES (?,?)",
            [realId, cid],
          );
        }
      }
      for (const sid of new Set(list(u.sectionIds))) {
        if (sectionIds.has(sid)) {
          await conn.query(
            "INSERT IGNORE INTO professor_sections (user_id, section_id) VALUES (?,?)",
            [realId, sid],
          );
        }
      }
    }

    // Remove rows the admin deleted (children first)
    await pruneNotIn(conn, "users", [...idMap.values()]);
    await pruneNotIn(conn, "sections", [...sectionIds]);
    await pruneNotIn(conn, "courses", [...courseIds]);
    await pruneNotIn(conn, "programs", [...programIds]);

    await conn.commit();
    console.log(
      `Saved to tables: ${idMap.size} users, ${programs.length} programs, ${validSections.length} sections, ${courses.length} courses.`,
    );
    return skipped;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// A professor/student may only update their own profile row
async function syncSelf(state, userId) {
  const me = list(state.users).find((u) => u && u.id === userId);
  if (!me) return false;
  const [rows] = await pool.query(
    "SELECT password_hash FROM users WHERE id = ?",
    [userId],
  );
  if (!rows.length) return false;
  await pool.query(
    "UPDATE users SET firstname=?, middlename=?, lastname=?, display_name=?, password_hash=? WHERE id=?",
    [
      str(me.firstname, 60) || "",
      str(me.middlename, 60) || "",
      str(me.lastname, 60) || "",
      str(me.displayName, 150),
      passwordHashFor(me, rows[0].password_hash),
      userId,
    ],
  );
  return true;
}

/* ═══════════════════════════════════════════
   Startup / first run
═══════════════════════════════════════════ */
async function countUsers() {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM users");
  return row.n;
}

// Empty tables + existing JSON → import the JSON into the tables once
async function bootstrapIfEmpty() {
  if ((await countUsers()) > 0) return;
  const blob = await readBlob();
  if (blob && list(blob.users).length) await syncNormalized(blob);
}

async function ensureAdmin() {
  const [[row]] = await pool.query(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'",
  );
  if (row.n > 0) return;
  const joined = new Date().toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  await pool.query(
    `INSERT INTO users (firstname, lastname, display_name, email, password_hash, role, status, joined)
     VALUES ('Admin', '', 'Admin', 'admin@cognitia.edu', ?, 'admin', 'active', ?)`,
    [bcrypt.hashSync("admin123", 10), joined],
  );
  console.log(
    "Created default admin: admin@cognitia.edu / admin123 (change this password!)",
  );
}

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to XAMPP MySQL database successfully.");
  } catch (err) {
    console.error(
      "Database connection failed:",
      err.code,
      err.message,
      err.errors || "",
    );
    return;
  }
  try {
    await bootstrapIfEmpty();
    await ensureAdmin();
  } catch (err) {
    console.error(
      "Startup failed (did you run schema_users.sql?):",
      err.message,
    );
  }
})();

/* ═══════════════════════════════════════════
   Routes
═══════════════════════════════════════════ */
const ALLOWED_KEYS = new Set([
  "cognitia_state",
  "cognitia_student_data",
  "cognitia_next_student_id",
]);

function checkKey(req, res, next) {
  if (!ALLOWED_KEYS.has(req.params.key))
    return res.status(400).json({ error: "Unknown state key" });
  next();
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "index.html"));
});

// Login checks the bcrypt hash in the users table
app.post("/api/login", async (req, res) => {
  try {
    const credential = String(req.body?.credential ?? "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? "");
    if (!credential || !password)
      return res.status(400).json({ error: "Enter your credentials." });

    const [rows] = await pool.query(
      "SELECT id, password_hash, status FROM users WHERE LOWER(email) = ? OR (role = 'student' AND student_id = ?) LIMIT 1",
      [credential, credential],
    );
    const row = rows[0];
    if (
      !row ||
      !row.password_hash ||
      !bcrypt.compareSync(password, row.password_hash)
    ) {
      return res
        .status(401)
        .json({ error: "Incorrect credentials. Please try again." });
    }
    if (row.status === "inactive") {
      return res.status(403).json({
        error: "Your account is inactive. Contact your administrator.",
      });
    }
    const { users } = await loadTables();
    res.json({ user: users.find((u) => u.id === row.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/state/:key", checkKey, async (req, res) => {
  try {
    const { key } = req.params;

    if (key === "cognitia_state") {
      await bootstrapIfEmpty();
      await ensureAdmin();
      return res.json({ value: JSON.stringify(await assembleState()) });
    }

    const [rows] = await pool.query(
      "SELECT state_json FROM app_state WHERE state_key = ?",
      [key],
    );
    let value = rows.length ? rows[0].state_json : null;

    if (key === "cognitia_next_student_id") {
      // Never hand out an ID that already exists in the users table
      const [[m]] = await pool.query(
        "SELECT MAX(CAST(student_id AS UNSIGNED)) AS mx FROM users WHERE student_id IS NOT NULL",
      );
      const best = Math.max(Number(value) || 0, m.mx ? Number(m.mx) + 1 : 0);
      value = best > 0 ? String(best) : null;
    }
    res.json({ value });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/state/:key", checkKey, async (req, res) => {
  const { value } = req.body;
  if (typeof value !== "string")
    return res.status(400).json({ error: "value must be a JSON string" });

  const { key } = req.params;
  const state = key === "cognitia_state" ? parseJSON(value, null) : null;
  if (key === "cognitia_state" && !state)
    return res.status(400).json({ error: "Invalid JSON" });

  try {
    const stored =
      key === "cognitia_state" ? JSON.stringify(stripPasswords(state)) : value;
    await pool.query(
      `INSERT INTO app_state (state_key, state_json) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)`,
      [key, stored],
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  let synced = false;
  let skipped = [];
  if (key === "cognitia_state") {
    try {
      const role = req.get("x-cognitia-role");
      const userId = Number(req.get("x-cognitia-user-id"));
      console.log(
        `[save] cognitia_state from role=${role ?? "none"} user=${req.get("x-cognitia-user-id") ?? "none"} (${list(state.users).length} users in this save)`,
      );
      if (role === "admin" || (await countUsers()) === 0) {
        skipped = await syncNormalized(state); // admin saves update every table
        synced = skipped.length === 0;
      } else if (role && Number.isInteger(userId)) {
        synced = await syncSelf(state, userId); // others only touch their own profile
        console.log(
          `[save] role=${role}: only that user's own profile was updated`,
        );
      } else {
        console.warn(
          "[save] NOT written to the tables: the request had no login role. " +
            "Press Ctrl+F5 on the page (old db-sync.js cached?) and log in again.",
        );
      }
    } catch (err) {
      console.error("Table sync failed:", err.message);
    }
  }
  res.json({ ok: true, synced, skipped });
});

// Create ONE user straight in MySQL (called by the admin "Add user" button)
app.post("/api/users", async (req, res) => {
  if (req.get("x-cognitia-role") !== "admin")
    return res
      .status(403)
      .json({ error: "Only an administrator can add users." });

  const b = req.body || {};
  const role = ["student", "professor", "admin"].includes(b.role)
    ? b.role
    : null;
  const firstname = str(b.firstname, 60);
  const lastname = str(b.lastname, 60);
  const email = str(b.email, 150)?.toLowerCase();
  const password = String(b.password ?? "").trim();
  if (!role) return res.status(400).json({ error: "Invalid role." });
  if (!firstname || !lastname)
    return res.status(400).json({ error: "First and last name are required." });
  if (!email) return res.status(400).json({ error: "Email is required." });
  if (password.length < 6)
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [dup] = await conn.query("SELECT id FROM users WHERE email = ?", [
      email,
    ]);
    if (dup.length) {
      await conn.rollback();
      return res
        .status(409)
        .json({ error: "This email is already registered." });
    }

    // Only keep program / section / course ids that really exist
    const programId = num(b.programId);
    const sectionId = num(b.sectionId);
    const [[p]] = await conn.query(
      "SELECT COUNT(*) AS n FROM programs WHERE id = ?",
      [programId],
    );
    const [[sec]] = await conn.query(
      "SELECT COUNT(*) AS n FROM sections WHERE id = ?",
      [sectionId],
    );
    const validProgram = role === "student" && p.n ? programId : null;
    const validSection = role === "student" && sec.n ? sectionId : null;

    // Next student ID = highest existing + 1 (never below 2026000)
    let studentId = null;
    if (role === "student") {
      const [[m]] = await conn.query(
        "SELECT MAX(CAST(student_id AS UNSIGNED)) AS mx FROM users WHERE student_id IS NOT NULL FOR UPDATE",
      );
      studentId = String(Math.max(2026000, (Number(m.mx) || 0) + 1));
    }

    const displayName =
      str(b.displayName, 150) ||
      [firstname, lastname].filter(Boolean).join(" ");
    const joined =
      str(b.joined, 40) ||
      new Date().toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

    const [r] = await conn.query(
      `INSERT INTO users (student_id, firstname, middlename, lastname, display_name,
         email, password_hash, role, status, program_id, section_id, joined)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        studentId,
        firstname,
        str(b.middlename, 60) || "",
        lastname,
        displayName,
        email,
        bcrypt.hashSync(password, 10),
        role,
        str(b.status, 20) || "active",
        validProgram,
        validSection,
        joined,
      ],
    );
    const id = r.insertId;

    const courseIds = [];
    const sectionIds = [];
    if (role === "professor") {
      for (const cid of new Set(list(b.courseIds))) {
        const [[c]] = await conn.query(
          "SELECT COUNT(*) AS n FROM courses WHERE id = ?",
          [cid],
        );
        if (c.n) {
          await conn.query(
            "INSERT IGNORE INTO user_courses (user_id, course_id) VALUES (?,?)",
            [id, cid],
          );
          courseIds.push(cid);
        }
      }
      for (const sid of new Set(list(b.sectionIds))) {
        const [[c]] = await conn.query(
          "SELECT COUNT(*) AS n FROM sections WHERE id = ?",
          [sid],
        );
        if (c.n) {
          await conn.query(
            "INSERT IGNORE INTO professor_sections (user_id, section_id) VALUES (?,?)",
            [id, sid],
          );
          sectionIds.push(sid);
        }
      }
    }

    await conn.commit();
    console.log(`[users] inserted user ${id} (${email}, ${role}) into MySQL`);

    const user = {
      id,
      firstname,
      middlename: str(b.middlename, 60) || "",
      lastname,
      displayName,
      email,
      role,
      status: str(b.status, 20) || "active",
      joined,
      programId: validProgram,
      sectionId: validSection,
      courseIds,
      sectionIds,
    };
    if (studentId) user.studentId = studentId;
    res.json({ user });
  } catch (err) {
    await conn.rollback();
    console.error("[users] insert failed:", err.message);
    res.status(500).json({ error: "Database error: " + err.message });
  } finally {
    conn.release();
  }
});

// Open http://localhost:5000/api/health to see whether the database side works
app.get("/api/health", async (req, res) => {
  const out = { server: "ok", database: "unknown", tables: {}, last_saved: {} };
  try {
    await pool.query("SELECT 1");
    out.database = "connected";
    const names = [
      "programs",
      "sections",
      "courses",
      "users",
      "program_courses",
      "user_courses",
      "professor_sections",
      "app_state",
    ];
    for (const t of names) {
      try {
        const [[r]] = await pool.query(`SELECT COUNT(*) AS n FROM ${t}`);
        out.tables[t] = r.n;
      } catch (e) {
        out.tables[t] = `MISSING (${e.code})`;
      }
    }
    const [rows] = await pool.query(
      "SELECT state_key, updated_at FROM app_state",
    );
    for (const r of rows) out.last_saved[r.state_key] = r.updated_at;
  } catch (e) {
    out.database = `FAILED: ${e.code} ${e.message}`;
  }
  res.json(out);
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
