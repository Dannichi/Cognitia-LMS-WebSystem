package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.ActivityData;
import data.AnnouncementData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.Map;

/**
 * AnnouncementHandler: /api/announcements, /api/announcements/{id},
 * /api/announcements/{id}/read
 * Tables used (through data classes): announcements, announcement_reads, activity_log.
 * Main must register this handler on "/api/announcements".
 */
public class AnnouncementHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/announcements/4/read" -> ["announcements","4","read"]
            String[] parts = ex.getRequestURI().getPath().substring(5).split("/");

            // Step 3: route by number of path parts + method
            if (parts.length == 1 && method.equals("GET")) {
                list(ex);
            } else if (parts.length == 1 && method.equals("POST")) {
                create(ex);
            } else if (parts.length == 2 && method.equals("PUT")) {
                update(ex, parseId(parts[1]));
            } else if (parts.length == 2 && method.equals("DELETE")) {
                delete(ex, parseId(parts[1]));
            } else if (parts.length == 3 && parts[2].equals("read") && method.equals("POST")) {
                markRead(ex, parseId(parts[1]));
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // GET /api/announcements (any logged-in user)
    // Admin sees all. Others see published ones for their audience. Each has read true/false.
    private void list(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor", "student");
        if (session == null) return;

        Reply.ok(ex, AnnouncementData.list(session.role, session.userId));
    }

    // POST /api/announcements (admin)
    private void create(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> announcement = AnnouncementData.create(session.userId, body);

        log(session, announcement, "created");
        Reply.ok(ex, announcement);
    }

    // PUT /api/announcements/{id} (admin)
    private void update(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> announcement = AnnouncementData.update(id, session.userId, body);
        if (announcement == null) {
            Reply.error(ex, 404, "Announcement not found");
            return;
        }

        log(session, announcement, "updated");
        Reply.ok(ex, announcement);
    }

    // DELETE /api/announcements/{id} (admin)
    private void delete(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        // Read first so we still know the title after it is deleted
        Map<String, Object> old = AnnouncementData.get(id, session.userId);
        if (old == null) {
            Reply.error(ex, 404, "Announcement not found");
            return;
        }

        int rows = AnnouncementData.delete(id);
        if (rows == 0) {
            Reply.error(ex, 404, "Announcement not found");
            return;
        }

        log(session, old, "deleted");
        Reply.ok(ex, Map.of());
    }

    // POST /api/announcements/{id}/read (any logged-in user). Not logged in the activity log.
    private void markRead(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor", "student");
        if (session == null) return;

        boolean found = AnnouncementData.markRead(session.userId, id);
        if (!found) {
            Reply.error(ex, 404, "Announcement not found");
            return;
        }
        Reply.ok(ex, Map.of());
    }

    // Write one activity row. Called only AFTER the save succeeded.
    private static void log(Auth.Session session, Map<String, Object> announcement, String action) {
        long id = ((Number) announcement.get("id")).longValue();
        String title = String.valueOf(announcement.get("title"));
        ActivityData.log(session.userId, "announcement", id, title,
                action, action + " announcement " + title, null);
    }

    // Text -> number. A bad number becomes a 400 error.
    private static long parseId(String text) {
        try {
            return Long.parseLong(text);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Bad id in the URL");
        }
    }

    // Turn an exception into the right error reply (the agreed error mapping).
    private static void fail(HttpExchange ex, Exception e) throws IOException {
        if (e instanceof IllegalArgumentException) {
            Reply.error(ex, 400, e.getMessage());
        } else if (Database.isDuplicate(e)) {
            Reply.error(ex, 409, "That record already exists");
        } else if (Database.isForeignKeyError(e)) {
            Reply.error(ex, 400, "That record is linked to other data");
        } else {
            Reply.error(ex, 500, "Server error");
        }
    }
}
