package data;

// ============================================================================
// ActivityData.java  (folder: backend/rcs/data/)
//
// Covers table : activity_log
// Used by      : every admin handler (to WRITE a log row after an admin action)
//                ActivityHandler (to READ the newest 500 rows)
//
// Rules for this file:
//  - Only admin actions are logged (users, programs, sections, courses,
//    announcements). Registration is NOT logged.
//  - Log rows are never deleted or edited. There is no delete/update method.
//  - All SQL uses "?" placeholders (prepared statements).
// ============================================================================

import util.Database;

import java.sql.Connection;
import java.util.List;
import java.util.Map;

public class ActivityData {

    // The one INSERT used by both log() methods below.
    // created_at is not listed because the database fills it with the current time.
    private static final String INSERT_SQL =
            "INSERT INTO activity_log " +
            "(actor_id, entity_type, entity_id, entity_label, action, description, details) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)";

    // ==================================================================
    // 1) WRITE a log row
    // ==================================================================

    // Normal version: opens its own connection, writes one row, done.
    //   actorId     : the admin who did it (from Auth.Session.userId)
    //   entityType  : "user", "program", "section", "course" or "announcement"
    //   entityId    : id of the thing that changed (may be null)
    //   entityLabel : a readable name, e.g. "BSCS" or "Juan Dela Cruz"
    //   action      : "created", "updated", "deleted", "approved" ...
    //   description : one short sentence, e.g. "Created program BSCS"
    //   details     : optional longer text (may be null)
    public static void log(long actorId, String entityType, Long entityId,
                           String entityLabel, String action,
                           String description, String details) {
        checkInput(entityType, action);

        Database.insert(INSERT_SQL,
                actorId,
                entityType,
                entityId,
                cut(entityLabel, 200),
                cut(action, 30),
                cut(description, 255),
                details);
    }

    // Transaction version: use this when the admin action itself runs inside
    // Database.begin/commit/rollback (for example saving a section).
    // The log row then uses the SAME connection, so it is saved or undone
    // together with the rest of the action.
    public static void log(Connection c, long actorId, String entityType, Long entityId,
                           String entityLabel, String action,
                           String description, String details) {
        checkInput(entityType, action);

        Database.insert(c, INSERT_SQL,
                actorId,
                entityType,
                entityId,
                cut(entityLabel, 200),
                cut(action, 30),
                cut(description, 255),
                details);
    }

    // ==================================================================
    // 2) READ the log
    // ==================================================================

    // GET /api/activity (admin): the newest 500 entries, newest first.
    // The actor's name comes from a JOIN with users.
    // LEFT JOIN keeps the row even if that admin was deleted (actor_id is then NULL).
    public static List<Map<String, Object>> list() {
        return Database.query(
                "SELECT a.id, " +
                "a.actor_id AS actorId, " +
                "CONCAT(u.first_name, ' ', u.last_name) AS actorName, " +
                "a.entity_type AS entityType, " +
                "a.entity_id AS entityId, " +
                "a.entity_label AS entityLabel, " +
                "a.action, " +
                "a.description, " +
                "a.details, " +
                "a.created_at AS createdAt " +
                "FROM activity_log a " +
                "LEFT JOIN users u ON u.id = a.actor_id " +
                "ORDER BY a.created_at DESC, a.id DESC " +
                "LIMIT 500");
    }

    // ==================================================================
    // Small private helpers (only used inside this file)
    // ==================================================================

    // entity_type is an ENUM in the table, so only these five words are allowed.
    // action is required (NOT NULL in the table).
    private static void checkInput(String entityType, String action) {
        boolean validType =
                "user".equals(entityType) ||
                "program".equals(entityType) ||
                "section".equals(entityType) ||
                "course".equals(entityType) ||
                "announcement".equals(entityType);

        if (!validType) {
            throw new IllegalArgumentException(
                    "entityType must be user, program, section, course or announcement");
        }
        if (action == null || action.trim().isEmpty()) {
            throw new IllegalArgumentException("action is required");
        }
    }

    // Cuts a text to the column size so a long name can never make the INSERT fail.
    // Returns null if the text is null.
    private static String cut(String text, int maxLength) {
        if (text == null) {
            return null;
        }
        if (text.length() <= maxLength) {
            return text;
        }
        return text.substring(0, maxLength);
    }
}
