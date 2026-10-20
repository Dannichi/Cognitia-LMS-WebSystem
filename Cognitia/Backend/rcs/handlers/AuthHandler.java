package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.UserData;
import util.Auth;
import util.Database;
import util.Json;
import util.Reply;

import java.io.IOException;
import java.util.Map;

/**
 * AuthHandler: /api/register, /api/login, /api/logout, /api/me
 * Table used (through UserData): users.
 * Main must register this handler on all four paths.
 */
public class AuthHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: browsers send an OPTIONS "preflight" first (CORS). Answer it and stop.
        if (Reply.handlePreflight(ex)) return;

        try {
            String path = ex.getRequestURI().getPath();   // example: "/api/login"
            String method = ex.getRequestMethod();        // example: "POST"

            // Step 3: route by path + method
            if (path.equals("/api/register") && method.equals("POST")) {
                register(ex);
            } else if (path.equals("/api/login") && method.equals("POST")) {
                login(ex);
            } else if (path.equals("/api/logout") && method.equals("POST")) {
                logout(ex);
            } else if (path.equals("/api/me") && method.equals("GET")) {
                me(ex);
            } else {
                Reply.error(ex, 404, "Not found");
            }
        } catch (Exception e) {
            fail(ex, e);
        }
    }

    // POST /api/register (public). New student/professor account = pending.
    private void register(HttpExchange ex) throws IOException {
        Map<String, Object> body = Reply.readJson(ex);
        Map<String, Object> result = UserData.register(body);   // {id, studentNo?}
        // The contract says the reply is only {id}
        Reply.ok(ex, Json.map("id", result.get("id")));
    }

    // POST /api/login (public). Returns {token, user}.
    private void login(HttpExchange ex) throws IOException {
        Map<String, Object> body = Reply.readJson(ex);
        String email = text(body, "email");
        String password = text(body, "password");

        // Step 5: validate input
        if (email == null || password == null) {
            Reply.error(ex, 400, "Email and password are required");
            return;
        }

        // checkLogin returns null when the email or password is wrong
        Map<String, Object> user = UserData.checkLogin(email, password);
        if (user == null) {
            Reply.error(ex, 401, "Wrong email or password");
            return;
        }

        // Pending, rejected or inactive accounts may not log in
        boolean approved = "approved".equals(user.get("approvalStatus"));
        boolean active = "active".equals(user.get("status"));
        if (!approved || !active) {
            Reply.error(ex, 403, "Your account is not approved or not active");
            return;
        }

        long userId = ((Number) user.get("id")).longValue();
        String role = (String) user.get("role");
        String token = Auth.createToken(userId, role);

        Reply.ok(ex, Json.map("token", token, "user", user));
    }

    // POST /api/logout (any logged-in user). Forget the token.
    private void logout(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor", "student");
        if (session == null) return;   // Auth already sent 401/403

        Auth.removeToken(Auth.getToken(ex));
        Reply.ok(ex, Json.map());
    }

    // GET /api/me (any logged-in user). Returns the caller's own user record.
    private void me(HttpExchange ex) throws IOException {
        Auth.Session session = Auth.check(ex, "admin", "professor", "student");
        if (session == null) return;

        Map<String, Object> user = UserData.getById(session.userId);
        if (user == null) {
            Reply.error(ex, 404, "User not found");
            return;
        }
        Reply.ok(ex, user);
    }

    // Read one text field from the request map. Missing or empty -> null.
    private static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (value == null) return null;
        String s = value.toString().trim();
        return s.isEmpty() ? null : s;
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
