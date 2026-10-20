package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.ActivityData;
import data.UserData;
import util.Auth;
import util.Database;
import util.Reply;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * UserHandler: /api/users, /api/users/{id}, /api/users/{id}/approval
 * Tables used (through data classes): users, activity_log.
 * Main must register this handler on "/api/users".
 */
public class UserHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            String method = ex.getRequestMethod();
            // "/api/users/5/approval" -> "users/5/approval" -> ["users","5","approval"]
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
            } else if (parts.length == 3 && parts[2].equals("approval") && method.equals("PUT")) {
                approval(ex, parseId(parts[1]));
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // GET /api/users?role=&approval=   (admin: all, professor: students only)
    private void list(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor");
        if (session == null) return;

        String role = emptyToNull(Reply.queryParam(ex, "role"));
        String approval = emptyToNull(Reply.queryParam(ex, "approval"));

        // A professor may only look at students
        if (session.role.equals("professor")) {
            if (role != null && !role.equals("student")) {
                Reply.error(ex, 403, "Professors can only list students");
                return;
            }
            role = "student";
        }

        List<Map<String, Object>> users = UserData.list(role, approval);
        Reply.ok(ex, users);
    }

    // POST /api/users (admin). Admin-created users are already approved.
    private void create(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> result = UserData.create(body);   // {id, studentNo?}

        // Log AFTER the save worked
        long newId = ((Number) result.get("id")).longValue();
        String label = body.get("firstname") + " " + body.get("lastname");
        ActivityData.log(session.userId, "user", newId, label,
                "created", "Created user " + label, null);

        Reply.ok(ex, result);
    }

    // PUT /api/users/{id}
    // Admin: any user, any field. Everyone else: only their own id, via updateProfile.
    private void update(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor", "student");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        boolean isAdmin = session.role.equals("admin");
        Map<String, Object> user;

        // Step 4: ownership check
        if (isAdmin) {
            user = UserData.update(id, body);
        } else if (session.userId == id) {
            user = UserData.updateProfile(id, body);   // name, phone, password only
        } else {
            Reply.error(ex, 403, "You can only edit your own profile");
            return;
        }

        if (user == null) {
            Reply.error(ex, 404, "User not found");
            return;
        }

        // Only admin actions are logged
        if (isAdmin) {
            String label = label(user);
            ActivityData.log(session.userId, "user", id, label,
                    "updated", "Updated user " + label, null);
        }
        Reply.ok(ex, user);
    }

    // PUT /api/users/{id}/approval (admin). Body: approvalStatus = approved or rejected.
    private void approval(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        Map<String, Object> body = Reply.readJson(ex);
        Object value = body.get("approvalStatus");
        String status = value == null ? null : value.toString();
        if (status == null || !(status.equals("approved") || status.equals("rejected"))) {
            Reply.error(ex, 400, "approvalStatus must be approved or rejected");
            return;
        }

        // The server sets reviewedAt and reviewedBy (the admin's id)
        Map<String, Object> user = UserData.setApproval(id, status, session.userId);
        if (user == null) {
            Reply.error(ex, 404, "User not found");
            return;
        }

        String label = label(user);
        // The action name is the same word: "approved" or "rejected"
        ActivityData.log(session.userId, "user", id, label,
                status, "Registration " + status + " for " + label, null);

        Reply.ok(ex, user);
    }

    // DELETE /api/users/{id} (admin)
    private void delete(HttpExchange ex, long id) throws IOException {
        Auth.Session session = Auth.check(ex, "admin");
        if (session == null) return;

        // Read first so we still know the name after it is gone
        Map<String, Object> user = UserData.getById(id);
        if (user == null) {
            Reply.error(ex, 404, "User not found");
            return;
        }

        int rows = UserData.delete(id);
        if (rows == 0) {
            Reply.error(ex, 404, "User not found");
            return;
        }

        String label = label(user);
        ActivityData.log(session.userId, "user", id, label,
                "deleted", "Deleted user " + label, null);

        Reply.ok(ex, Map.of());
    }

    // "Juan Dela Cruz" - used for the activity log
    private static String label(Map<String, Object> user) {
        return user.get("firstname") + " " + user.get("lastname");
    }

    private static String emptyToNull(String s) {
        return (s == null || s.isEmpty()) ? null : s;
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
            Reply.error(ex, 409, "That record already exists (for example, the email is taken)");
        } else if (Database.isForeignKeyError(e)) {
            Reply.error(ex, 400, "That record is linked to other data");
        } else {
            Reply.error(ex, 500, "Server error");
        }
    }
}
