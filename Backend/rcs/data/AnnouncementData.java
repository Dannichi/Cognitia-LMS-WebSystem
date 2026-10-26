package data;

// ============================================================================
// AnnouncementData.java  (folder: backend/rcs/data/)
//
// Covers tables : announcements, announcement_reads
// Used by       : AnnouncementHandler
//                 (/api/announcements[/{id}] and /api/announcements/{id}/read)
//
// Rules for this file:
//  - This is the ONLY place with SQL about announcements.
//  - The admin sees every announcement. Everyone else sees only PUBLISHED ones
//    meant for their audience.
//  - Every announcement in a list has "read": true/false for the caller.
//  - The server sets author, created_at and published_at. The browser never sends them.
//  - Bad input -> IllegalArgumentException (handler -> 400).
//  - Dates: a plain "2026-10-20" is accepted. For scheduledAt (DATETIME) it
//    becomes 2026-10-20 00:00:00. eventDate is a DATE column (no time).
// ============================================================================

import util.Database;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AnnouncementData {

    // Columns sent to the browser (keys match API-CONTRACT.md).
    // event_date is a DATE, so DATE_FORMAT turns it into plain text "2026-10-20".
    // "r.read_at" comes from the LEFT JOIN below; it is NULL when the caller has not read it.
    private static final String COLUMNS =
            "a.id, " +
            "a.author_id AS authorId, " +
            "a.title, " +
            "a.body, " +
            "a.type, " +
            "a.category, " +
            "a.audience, " +
            "a.featured, " +
            "a.status, " +
            "a.created_at AS createdAt, " +
            "a.published_at AS publishedAt, " +
            "a.scheduled_at AS scheduledAt, " +
            "DATE_FORMAT(a.event_date, '%Y-%m-%d') AS eventDate, " +
            "r.read_at AS readAt";

    // FROM part: join the "read" table, but only the row of the caller.
    // The "?" in it is the caller's user id.
    private static final String FROM_SQL =
            " FROM announcements a " +
            "LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.user_id = ? ";

    // ==================================================================
    // READ
    // ==================================================================

    // GET /api/announcements. Newest first.
    //   admin     -> all announcements (drafts and scheduled too)
    //   student   -> published ones whose audience is 'all' or 'students'
    //   professor -> published ones whose audience is 'all' or 'professors'
    // Note: "scheduled" announcements are NOT published automatically;
    // an admin must change the status to 'published'.
    public static List<Map<String, Object>> list(String role, long userId) {
        List<Map<String, Object>> rows;

        if ("admin".equals(role)) {
            rows = Database.query(
                    "SELECT " + COLUMNS + FROM_SQL + "ORDER BY a.created_at DESC, a.id DESC",
                    userId);

        } else if ("student".equals(role)) {
            rows = Database.query(
                    "SELECT " + COLUMNS + FROM_SQL +
                    "WHERE a.status = 'published' AND a.audience IN ('all', 'students') " +
                    "ORDER BY a.created_at DESC, a.id DESC",
                    userId);

        } else if ("professor".equals(role)) {
            rows = Database.query(
                    "SELECT " + COLUMNS + FROM_SQL +
                    "WHERE a.status = 'published' AND a.audience IN ('all', 'professors') " +
                    "ORDER BY a.created_at DESC, a.id DESC",
                    userId);

        } else {
            throw new IllegalArgumentException("Unknown role");
        }

        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            result.add(tidy(row));
        }
        return result;
    }

    // One announcement (with the "read" flag for userId), or null if not found.
    public static Map<String, Object> get(long id, long userId) {
        Map<String, Object> row = Database.queryOne(
                "SELECT " + COLUMNS + FROM_SQL + "WHERE a.id = ?",
                userId, id);
        if (row == null) {
            return null;
        }
        return tidy(row);
    }

    // Cleans one row before it goes to the browser:
    //   - replaces "readAt" by "read": true/false
    //   - makes sure "featured" is true/false (not 0/1)
    private static Map<String, Object> tidy(Map<String, Object> row) {
        // Copy the row so we are sure we can change it.
        Map<String, Object> a = new LinkedHashMap<>(row);

        a.put("read", a.get("readAt") != null);
        a.remove("readAt");

        Object featured = a.get("featured");
        boolean isFeatured;
        if (featured instanceof Boolean) {
            isFeatured = (Boolean) featured;
        } else if (featured instanceof Number) {
            isFeatured = ((Number) featured).intValue() != 0;
        } else {
            isFeatured = false;
        }
        a.put("featured", isFeatured);

        return a;
    }

    // ==================================================================
    // CREATE / UPDATE / DELETE  (admin only; the handler checks the role)
    // ==================================================================

    // POST /api/announcements. authorId = the logged-in admin.
    // Returns the new announcement.
    public static Map<String, Object> create(long authorId, Map<String, Object> input) {
        Fields f = readFields(input);

        // published_at is set by the server: now, if it is created already published.
        String publishedPart = f.status.equals("published") ? "NOW()" : "NULL";

        long newId = Database.insert(
                "INSERT INTO announcements (author_id, title, body, type, category, audience, " +
                "featured, status, published_at, scheduled_at, event_date) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + publishedPart + ", ?, ?)",
                authorId, f.title, f.bodyText, f.type, f.category, f.audience,
                f.featured, f.status, f.scheduledAt, f.eventDate);

        return get(newId, authorId);
    }

    // PUT /api/announcements/{id}. adminId = the logged-in admin (for the "read" flag).
    // Returns the updated announcement, or null if the id does not exist.
    public static Map<String, Object> update(long id, long adminId, Map<String, Object> input) {
        // Look at the current row first (we need its old published_at).
        Map<String, Object> current = Database.queryOne(
                "SELECT status, published_at AS publishedAt FROM announcements WHERE id = ?", id);
        if (current == null) {
            return null;
        }

        Fields f = readFields(input);

        // If it becomes 'published' and was never published before, stamp the time now.
        // Otherwise leave published_at as it is.
        String publishedPart = "";
        if (f.status.equals("published") && current.get("publishedAt") == null) {
            publishedPart = ", published_at = NOW()";
        }

        Database.update(
                "UPDATE announcements SET title = ?, body = ?, type = ?, category = ?, audience = ?, " +
                "featured = ?, status = ?, scheduled_at = ?, event_date = ?" + publishedPart +
                " WHERE id = ?",
                f.title, f.bodyText, f.type, f.category, f.audience,
                f.featured, f.status, f.scheduledAt, f.eventDate, id);

        return get(id, adminId);
    }

    // DELETE /api/announcements/{id}. Returns rows deleted (0 = not found).
    // The read marks go away by cascade.
    public static int delete(long id) {
        return Database.update("DELETE FROM announcements WHERE id = ?", id);
    }

    // ==================================================================
    // MARK AS READ
    // ==================================================================

    // POST /api/announcements/{id}/read (any logged-in user).
    // Returns false if the announcement does not exist (handler -> 404), otherwise true.
    // Marking the same announcement twice is fine: INSERT IGNORE skips the duplicate.
    public static boolean markRead(long userId, long announcementId) {
        Map<String, Object> exists = Database.queryOne(
                "SELECT id FROM announcements WHERE id = ?", announcementId);
        if (exists == null) {
            return false;
        }

        // announcement_reads has no auto id, so we use Database.update, not insert.
        Database.update(
                "INSERT IGNORE INTO announcement_reads (user_id, announcement_id) VALUES (?, ?)",
                userId, announcementId);
        return true;
    }

    // ==================================================================
    // Reading and checking the input (used by create and update)
    // ==================================================================

    // A small box that holds the checked values of one announcement.
    private static class Fields {
        String title;
        String bodyText;
        String type;
        String category;
        String audience;
        boolean featured;
        String status;
        java.sql.Timestamp scheduledAt; // null when not set
        String eventDate;               // "yyyy-MM-dd" or null
    }

    // Reads and validates the input. Throws IllegalArgumentException when something is wrong.
    private static Fields readFields(Map<String, Object> input) {
        Fields f = new Fields();

        // ---- required text ----
        f.title = text(input, "title");
        f.bodyText = text(input, "body");
        if (f.title == null || f.bodyText == null) {
            throw new IllegalArgumentException("title and body are required");
        }
        if (f.title.length() > 200) {
            throw new IllegalArgumentException("title is too long (max 200 characters)");
        }

        // ---- optional text (the columns hold 30 characters) ----
        f.type = text(input, "type");
        f.category = text(input, "category");
        if ((f.type != null && f.type.length() > 30) || (f.category != null && f.category.length() > 30)) {
            throw new IllegalArgumentException("type and category are too long (max 30 characters)");
        }

        // ---- audience: all / students / professors (default all) ----
        f.audience = text(input, "audience");
        if (f.audience == null) {
            f.audience = "all";
        }
        if (!f.audience.equals("all") && !f.audience.equals("students") && !f.audience.equals("professors")) {
            throw new IllegalArgumentException("audience must be all, students or professors");
        }

        // ---- status: draft / scheduled / published (default draft) ----
        f.status = text(input, "status");
        if (f.status == null) {
            f.status = "draft";
        }
        if (!f.status.equals("draft") && !f.status.equals("scheduled") && !f.status.equals("published")) {
            throw new IllegalArgumentException("status must be draft, scheduled or published");
        }

        // ---- featured: true / false (default false) ----
        Object featuredValue = input.get("featured");
        if (featuredValue instanceof Boolean) {
            f.featured = (Boolean) featuredValue;
        } else if (featuredValue != null) {
            f.featured = "true".equalsIgnoreCase(featuredValue.toString());
        } else {
            f.featured = false;
        }

        // ---- scheduledAt (date and time) ----
        String scheduledText = text(input, "scheduledAt");
        if (scheduledText != null) {
            // A date-only value like 2026-10-20 becomes 2026-10-20T00:00:00
            if (scheduledText.length() == 10) {
                scheduledText = scheduledText + "T00:00:00";
            }
            try {
                f.scheduledAt = Database.toTimestamp(scheduledText);
            } catch (RuntimeException e) {
                throw new IllegalArgumentException("scheduledAt is not a valid date");
            }
        }
        if (f.status.equals("scheduled") && f.scheduledAt == null) {
            throw new IllegalArgumentException("scheduledAt is required when status is scheduled");
        }

        // ---- eventDate (date only) ----
        String eventText = text(input, "eventDate");
        if (eventText != null) {
            // Keep only the first 10 characters (yyyy-MM-dd) and check they are a real date.
            if (eventText.length() > 10) {
                eventText = eventText.substring(0, 10);
            }
            try {
                LocalDate.parse(eventText);
            } catch (RuntimeException e) {
                throw new IllegalArgumentException("eventDate must look like 2026-10-20");
            }
            f.eventDate = eventText;
        }

        return f;
    }

    // Text value from the input. Returns null when missing or blank.
    private static String text(Map<String, Object> input, String key) {
        Object value = input.get(key);
        if (value == null) {
            return null;
        }
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
    }
}
