package util;

import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Reply - the "reply helper" of the server. It talks to the browser.
 *
 * Writing replies (same shape as API-CONTRACT.md):
 *     success  {"ok":true,"data":...}      Reply.ok(ex, data)
 *     failure  {"ok":false,"error":"..."}  Reply.error(ex, 400, "message")
 *   Every reply also carries the CORS headers (see addHeaders).
 *
 * Reading requests (small helpers every handler needs):
 *     Reply.readJson(ex)          the request body as a Map
 *     Reply.pathParts(ex)         /api/lessons/5/file -> ["lessons","5","file"]
 *     Reply.queryParam(ex, name)  /api/lessons?courseId=3 -> "3"
 *
 * "ex" is the HttpExchange: Java's object that holds ONE request and lets
 * us answer it.
 */
public class Reply {

    // Nobody should create a Reply object, everything is static.
    private Reply() {
    }

    // ==================================================================
    // PART 1 - WRITING REPLIES
    // ==================================================================

    /** Success reply with data (status 200): {"ok":true,"data":...} */
    public static void ok(HttpExchange ex, Object data) {
        send(ex, 200, Json.map("ok", true, "data", data));
    }

    /** Success reply with nothing to return: {"ok":true,"data":{}} */
    public static void ok(HttpExchange ex) {
        ok(ex, Json.map());
    }

    /** Failure reply: {"ok":false,"error":"message"}. Status: 400, 401, 403, 404, 409, 500... */
    public static void error(HttpExchange ex, int status, String message) {
        send(ex, status, Json.map("ok", false, "error", message));
    }

    /**
     * Browsers first send an "OPTIONS" question (a "preflight") before the real
     * call when the page comes from another port. We must answer it with the
     * CORS headers. Every handler starts with:
     *
     *     if (Reply.handlePreflight(ex)) return;
     *
     * Returns true if it was an OPTIONS request (already answered).
     */
    public static boolean handlePreflight(HttpExchange ex) {
        if (!"OPTIONS".equalsIgnoreCase(ex.getRequestMethod())) {
            return false;
        }
        addHeaders(ex);
        try {
            ex.sendResponseHeaders(204, -1);     // 204 = "no content", -1 = no body
        } catch (IOException e) {
            System.out.println("Could not answer OPTIONS: " + e.getMessage());
        } finally {
            ex.close();
        }
        return true;
    }

    // Turns the body into JSON text and writes it with the status code.
    private static void send(HttpExchange ex, int status, Object body) {
        byte[] bytes = Json.stringify(body).getBytes(StandardCharsets.UTF_8);
        addHeaders(ex);
        try {
            ex.sendResponseHeaders(status, bytes.length);   // status + size of the body
            try (OutputStream out = ex.getResponseBody()) {
                out.write(bytes);                           // closing "out" finishes the reply
            }
        } catch (IOException e) {
            // Usually the browser went away. Nothing else to do.
            System.out.println("Could not send reply: " + e.getMessage());
        }
    }

    // Headers added to EVERY reply.
    private static void addHeaders(HttpExchange ex) {
        // The reply is JSON text.
        ex.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");

        // CORS: lets pages opened from another port (e.g. VS Code Live Server)
        // call this server. "*" means any origin. This is fine here because the
        // token travels in the Authorization header, not in cookies.
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, Authorization");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    }

    // ==================================================================
    // PART 2 - READING THE REQUEST
    // ==================================================================

    /**
     * Reads the request body (JSON) as a Map. An empty body gives an empty Map.
     * Throws IllegalArgumentException if the text is not valid JSON
     * (the handler should answer 400).
     */
    public static Map<String, Object> readJson(HttpExchange ex) {
        String body;
        try {
            body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException("Could not read the request body", e);
        }
        if (body.trim().isEmpty()) {
            return Json.map();
        }
        return Json.asMap(Json.parse(body));
    }

    /**
     * Splits the URL path into pieces, without the "/api" start:
     *     /api/lessons/5/file  ->  ["lessons", "5", "file"]
     *     /api/login           ->  ["login"]
     */
    public static String[] pathParts(HttpExchange ex) {
        String path = ex.getRequestURI().getPath();
        if (path.startsWith("/api")) {
            path = path.substring(4);
        }
        List<String> parts = new ArrayList<>();
        for (String piece : path.split("/")) {
            if (!piece.isEmpty()) {              // the first piece is empty, skip it
                parts.add(piece);
            }
        }
        return parts.toArray(new String[0]);
    }

    /** Turns text like "5" into a number. Returns null if it is not a number (handler answers 400 or 404). */
    public static Long toLong(String text) {
        try {
            return Long.valueOf(text.trim());
        } catch (NumberFormatException | NullPointerException e) {
            return null;
        }
    }

    /**
     * Value of a query parameter: /api/lessons?courseId=3 -> queryParam(ex, "courseId") = "3".
     * Returns null if the parameter is not in the URL. Empty value gives "".
     */
    public static String queryParam(HttpExchange ex, String name) {
        String query = ex.getRequestURI().getRawQuery();   // the part after the "?"
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            String[] keyAndValue = pair.split("=", 2);
            if (keyAndValue[0].equals(name)) {
                return keyAndValue.length == 2
                        ? URLDecoder.decode(keyAndValue[1], StandardCharsets.UTF_8)
                        : "";
            }
        }
        return null;
    }
}
