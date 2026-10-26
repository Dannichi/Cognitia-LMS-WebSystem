package handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import data.ActivityData;
import util.Auth;
import util.Reply;

import java.io.IOException;

/**
 * ActivityHandler: GET /api/activity (admin only)
 * Table used (through ActivityData): activity_log.
 * Main must register this handler on "/api/activity".
 * This handler only READS the log. The other handlers write to it.
 */
public class ActivityHandler implements HttpHandler {

    @Override
    public void handle(HttpExchange ex) throws IOException {
        // Step 1: CORS preflight
        if (Reply.handlePreflight(ex)) return;

        try {
            // Step 2: only admins may read the log (Auth sends 401/403 itself)
            Auth.Session session = Auth.check(ex, "admin");
            if (session == null) return;

            // Step 3: the only route is GET
            if (!ex.getRequestMethod().equals("GET")) {
                Reply.error(ex, 404, "Not found");
                return;
            }

            // The newest 500 log entries
            Reply.ok(ex, ActivityData.list());
        } catch (Exception e) {
            Reply.error(ex, 500, "Server error");
        }
    }
}
