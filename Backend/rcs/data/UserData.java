package data;

// ============================================================================
// UserData.java  (folder: backend/rcs/data/)
//
// Covers table : users
// Used by      : AuthHandler (register, login, me) and UserHandler (/api/users...)
//
// Rules for this file:
//  - This is the ONLY place that holds SQL about users.
//  - Every method is static and returns Maps / Lists that are ready for JSON.
//  - password_hash is NEVER put in a returned Map.
//  - All SQL uses "?" placeholders (prepared statements), never glued text.
//  - Bad input -> IllegalArgumentException (the handler turns it into 400).
//  - Duplicate email -> the database throws; the handler checks Database.isDuplicate (409).
// ============================================================================

import util.Database;
import util.PasswordHashing;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class UserData {

    // ------------------------------------------------------------------
    // The columns we send to the browser. "AS camelName" makes the keys
    // match API-CONTRACT.md. password_hash is deliberately NOT in this list.
    // ------------------------------------------------------------------
    private static final String USER_COLUMNS =
            "id, " +
            "student_no AS studentNo, " +
            "first_name AS firstname, " +
            "middle_name AS middlename, " +
            "last_name AS lastname, " +
            "email, " +
            "phone, " +
            "role, " +
            "program_id AS programId, " +
            "section_id AS sectionId, " +
            "status, " +
            "approval_status AS approvalStatus, " +
            "registered_at AS registeredAt, " +
            "reviewed_at AS reviewedAt, " +
            "reviewed_by AS reviewedBy";

    // ==================================================================
    // 1) FIRST ADMIN  (called once by Main at startup)
    // ==================================================================

    // Creates ONE admin only if there is no admin in the table yet.
    // Email admin@cognitia.edu / password admin123 (stored hashed).
    public static void ensureFirstAdmin() {
        // Is there already an admin?
        Map<String, Object> existing =
                Database.queryOne("SELECT id FROM users WHERE role = 'admin'");

        if (existing != null) {
            return; // yes -> nothing to do
        }

        // No admin yet -> insert one. The password is hashed, never stored as plain text.
        Database.insert(
                "INSERT INTO users (first_name, last_name, email, password_hash, " +
                "role, approval_status, status) " +
                "VALUES (?, ?, ?, ?, 'admin', 'approved', 'active')",
                "System", "Admin", "admin@cognitia.edu", PasswordHashing.hash("admin123"));
    }

    // ==================================================================
    // 2) LOGIN
    // ==================================================================

    // Checks email + password.
    //   wrong email or wrong password -> returns null
    //   correct                       -> returns the user Map (no hash)
    // The handler then looks at "approvalStatus" and "status" to decide 403.
    public static Map<String, Object> checkLogin(String email, String password) {
        if (email == null || email.trim().isEmpty() || password == null || password.isEmpty()) {
            throw new IllegalArgumentException("Email and password are required");
        }
        email = email.trim();

        // Step 1: get ONLY the stored "salt:hash" for this email.
        Map<String, Object> row = Database.queryOne(
                "SELECT password_hash AS passwordHash FROM users WHERE email = ?", email);
        if (row == null) {
            return null; // unknown email
        }

        // Step 2: PasswordHashing hashes the typed password with the stored salt and compares.
        String stored = (String) row.get("passwordHash");
        if (!PasswordHashing.verify(password, stored)) {
            return null; // wrong password
        }

        // Step 3: load the safe user data (this query has no password_hash column).
        return Database.queryOne(
                "SELECT " + USER_COLUMNS + " FROM users WHERE email = ?", email);
    }

    // ==================================================================
    // 3) READ
    // ==================================================================

    // One user by id, or null if not found. Used by /api/me and by the other methods.
    public static Map<String, Object> getById(long id) {
        return Database.queryOne(
                "SELECT " + USER_COLUMNS + " FROM users WHERE id = ?", id);
    }

    // List of users. Both filters are optional (pass null or "" to skip a filter).
    //   role     : "admin" / "professor" / "student"
    //   approval : "pending" / "approved" / "rejected"
    public static List<Map<String, Object>> list(String role, String approval) {
        // Start with a SQL that matches everyone, then add filters one by one.
        StringBuilder sql = new StringBuilder("SELECT " + USER_COLUMNS + " FROM users WHERE 1 = 1");
        List<Object> params = new ArrayList<>();

        if (role != null && !role.isEmpty()) {
            sql.append(" AND role = ?");
            params.add(role);
        }
        if (approval != null && !approval.isEmpty()) {
            sql.append(" AND approval_status = ?");
            params.add(approval);
        }
        sql.append(" ORDER BY id");

        return Database.query(sql.toString(), params.toArray());
    }

    // ==================================================================
    // 4) CREATE
    // ==================================================================

    // POST /api/register (public). Students and professors may self-register;
    // both start as 'pending'. Admin accounts can only be created by an admin.
    // Returns {id} and studentNo for students.
    public static Map<String, Object> register(Map<String, Object> body) {
        String role = text(body, "role");
        if (!"student".equals(role) && !"professor".equals(role)) {
            throw new IllegalArgumentException("Public registration is available to students and professors only");
        }
        return insertUser(body, role, "pending");
    }

    // POST /api/users (admin). Role comes from the body. Inserted as 'approved'.
    // Returns {id} and also studentNo when the new user is a student.
    public static Map<String, Object> create(Map<String, Object> body) {
        String role = text(body, "role");
        return insertUser(body, role, "approved");
    }

    // Shared insert used by register() and create().
    private static Map<String, Object> insertUser(Map<String, Object> body, String role, String approvalStatus) {
        // ---- validate input ----
        String firstname = text(body, "firstname");
        String lastname = text(body, "lastname");
        String email = text(body, "email");
        String password = text(body, "password");

        if (firstname == null || lastname == null || email == null || password == null) {
            throw new IllegalArgumentException("firstname, lastname, email and password are required");
        }
        checkRole(role);

        // status is optional; default 'active'
        String status = text(body, "status");
        if (status == null) {
            status = "active";
        }
        checkStatus(status);

        // ---- the server decides the student number (students only) ----
        Integer studentNo = null;
        if (role.equals("student")) {
            studentNo = nextStudentNo();
        }

        // ---- insert (password is hashed first) ----
        long newId = Database.insert(
                "INSERT INTO users (student_no, first_name, middle_name, last_name, email, phone, " +
                "password_hash, role, program_id, section_id, status, approval_status) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                studentNo,
                firstname,
                text(body, "middlename"),
                lastname,
                email,
                text(body, "phone"),
                PasswordHashing.hash(password),
                role,
                number(body, "programId"),
                number(body, "sectionId"),
                status,
                approvalStatus);

        // ---- build the reply ----
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", newId);
        if (studentNo != null) {
            result.put("studentNo", studentNo);
        }
        return result;
    }

    // Next student number = highest existing + 1. Starts at 2026001 when there are none.
    private static int nextStudentNo() {
        Map<String, Object> row = Database.queryOne("SELECT MAX(student_no) AS maxNo FROM users");

        // MAX() of an empty column is NULL
        if (row == null || row.get("maxNo") == null) {
            return 2026001;
        }
        return ((Number) row.get("maxNo")).intValue() + 1;
    }

    // ==================================================================
    // 5) UPDATE
    // ==================================================================

    // PUT /api/users/{id} by an ADMIN: may change any of the fields below.
    // Only the fields that are present in the body are changed.
    // Note: changing a user's role to "student" does not create a studentNo.
    // Returns the updated user, or null if the id does not exist.
    public static Map<String, Object> update(long id, Map<String, Object> body) {
        return updateFields(id, body, false);
    }

    // PUT /api/users/{id} by the user THEMSELVES: only name, phone and password.
    // Returns the updated user, or null if the id does not exist.
    public static Map<String, Object> updateProfile(long id, Map<String, Object> body) {
        return updateFields(id, body, true);
    }

    // Builds "UPDATE users SET a = ?, b = ? WHERE id = ?" from only the fields that were sent.
    // The column names below are written by us (not by the user), so this is safe.
    private static Map<String, Object> updateFields(long id, Map<String, Object> body, boolean profileOnly) {
        // Does this user exist?
        if (getById(id) == null) {
            return null;
        }

        List<String> sets = new ArrayList<>();   // pieces like "first_name = ?"
        List<Object> params = new ArrayList<>(); // the matching values, same order

        // ---- fields everyone may change on their own profile ----
        if (body.containsKey("firstname")) {
            String v = text(body, "firstname");
            if (v == null) throw new IllegalArgumentException("firstname cannot be empty");
            sets.add("first_name = ?");
            params.add(v);
        }
        if (body.containsKey("middlename")) {
            sets.add("middle_name = ?");
            params.add(text(body, "middlename")); // may be null (clears it)
        }
        if (body.containsKey("lastname")) {
            String v = text(body, "lastname");
            if (v == null) throw new IllegalArgumentException("lastname cannot be empty");
            sets.add("last_name = ?");
            params.add(v);
        }
        if (body.containsKey("phone")) {
            sets.add("phone = ?");
            params.add(text(body, "phone"));
        }
        if (body.containsKey("password")) {
            String v = text(body, "password");
            if (v == null) throw new IllegalArgumentException("password cannot be empty");
            sets.add("password_hash = ?");
            params.add(PasswordHashing.hash(v)); // always store the hash
        }

        // ---- fields only an admin may change ----
        if (!profileOnly) {
            if (body.containsKey("email")) {
                String v = text(body, "email");
                if (v == null) throw new IllegalArgumentException("email cannot be empty");
                sets.add("email = ?");
                params.add(v);
            }
            if (body.containsKey("role")) {
                String v = text(body, "role");
                checkRole(v);
                sets.add("role = ?");
                params.add(v);
            }
            if (body.containsKey("programId")) {
                sets.add("program_id = ?");
                params.add(number(body, "programId")); // may be null
            }
            if (body.containsKey("sectionId")) {
                sets.add("section_id = ?");
                params.add(number(body, "sectionId")); // may be null
            }
            if (body.containsKey("status")) {
                String v = text(body, "status");
                checkStatus(v);
                sets.add("status = ?");
                params.add(v);
            }
        }

        // Nothing allowed was sent
        if (sets.isEmpty()) {
            throw new IllegalArgumentException("Nothing to update");
        }

        // Join the pieces with commas and add the id for the WHERE part.
        params.add(id);
        Database.update("UPDATE users SET " + String.join(", ", sets) + " WHERE id = ?",
                params.toArray());

        return getById(id);
    }

    // PUT /api/users/{id}/approval (admin).
    // Sets only approval_status, reviewed_at and reviewed_by.
    // Returns the updated user, or null if the id does not exist.
    public static Map<String, Object> setApproval(long id, String approvalStatus, long adminId) {
        if (!"approved".equals(approvalStatus) && !"rejected".equals(approvalStatus)) {
            throw new IllegalArgumentException("approvalStatus must be 'approved' or 'rejected'");
        }
        if (getById(id) == null) {
            return null;
        }

        Database.update(
                "UPDATE users SET approval_status = ?, reviewed_at = NOW(), reviewed_by = ? WHERE id = ?",
                approvalStatus, adminId, id);

        return getById(id);
    }

    // ==================================================================
    // 6) DELETE
    // ==================================================================

    // DELETE /api/users/{id} (admin). Returns how many rows were deleted (0 = not found).
    // The database cascades to the user's lessons, submissions, attempts, etc.
    public static int delete(long id) {
        return Database.update("DELETE FROM users WHERE id = ?", id);
    }

    // ==================================================================
    // Small private helpers (only used inside this file)
    // ==================================================================

    // Reads a text value from the body. Returns null when missing or blank.
    private static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (value == null) {
            return null;
        }
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
    }

    // Reads a whole number from the body (JSON numbers arrive as Long).
    // Returns null when missing; throws IllegalArgumentException when it is not a number.
    private static Integer number(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (value == null) {
            return null;
        }
        if (value instanceof Number) {
            return ((Number) value).intValue();
        }
        try {
            return Integer.parseInt(value.toString().trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(key + " must be a number");
        }
    }

    // Role must be exactly one of the three allowed words.
    private static void checkRole(String role) {
        if (!"admin".equals(role) && !"professor".equals(role) && !"student".equals(role)) {
            throw new IllegalArgumentException("role must be admin, professor or student");
        }
    }

    // Status must be 'active' or 'inactive'.
    private static void checkStatus(String status) {
        if (!"active".equals(status) && !"inactive".equals(status)) {
            throw new IllegalArgumentException("status must be active or inactive");
        }
    }
}
