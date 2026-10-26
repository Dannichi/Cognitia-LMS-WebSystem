package util;

import com.sun.net.httpserver.HttpExchange;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Auth - the token store AND the login/role check.
 *
 * How sessions work (simple on purpose):
 *   1. At login the server calls createToken(userId, role). That makes a long
 *      random text (the token) and remembers: token -> who it belongs to.
 *   2. The browser sends the token on every request in the header
 *          Authorization: Bearer <token>
 *   3. Each handler starts by calling check(...). It finds the token in our
 *      memory and compares the role with the roles allowed for that endpoint.
 *
 * Handler usage (check() already sends the 401/403 reply for you):
 *
 *     Auth.Session me = Auth.check(ex, "admin", "professor");
 *     if (me == null) return;          // reply was already sent, stop here
 *     // from here on: me.userId and me.role can be trusted
 *
 *     Auth.check(ex)                   // no roles listed = any logged-in user
 *
 * Known limits (say them before you are asked):
 *   - Tokens live only in memory: a server restart logs everyone out.
 *   - Tokens never expire.
 */
public class Auth {

    /** Who a token belongs to. "role" is exactly: admin, professor or student. */
    public static class Session {
        public final long userId;
        public final String role;

        Session(long userId, String role) {
            this.userId = userId;
            this.role = role;
        }
    }

    // token -> session. ConcurrentHashMap is a Map that is safe when several
    // requests use it at the same time.
    private static final Map<String, Session> tokens = new ConcurrentHashMap<>();

    // Java's secure random generator (same idea as the salt in PasswordHashing).
    private static final SecureRandom RANDOM = new SecureRandom();

    // Nobody should create an Auth object, everything is static.
    private Auth() {
    }

    // ==================================================================
    // PART 1 - TOKENS
    // ==================================================================

    /** Makes a new random token for this user and remembers it. Call this after a successful login. */
    public static String createToken(long userId, String role) {
        byte[] bytes = new byte[32];                  // 32 random bytes = very hard to guess
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        tokens.put(token, new Session(userId, role));
        return token;
    }

    /** Forgets a token. Call this on logout. */
    public static void removeToken(String token) {
        if (token != null) {
            tokens.remove(token);
        }
    }

    /** Reads the token from the header "Authorization: Bearer abc123". Returns null if there is none. */
    public static String getToken(HttpExchange ex) {
        String header = ex.getRequestHeaders().getFirst("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            return null;
        }
        return header.substring(7).trim();            // "Bearer " is 7 characters
    }

    // ==================================================================
    // PART 2 - THE CHECK EVERY HANDLER RUNS FIRST
    // ==================================================================

    /**
     * Checks that the caller is logged in and has one of the allowed roles.
     *   - no token or unknown token -> sends 401 "Not logged in", returns null
     *   - wrong role                -> sends 403, returns null
     *   - OK                        -> returns the Session (userId + role)
     * Pass no roles to accept any logged-in user.
     */
    public static Session check(HttpExchange ex, String... allowedRoles) {
        String token = getToken(ex);
        Session session = (token == null) ? null : tokens.get(token);

        if (session == null) {
            Reply.error(ex, 401, "Not logged in");
            return null;
        }

        if (allowedRoles.length > 0) {
            boolean allowed = false;
            for (String role : allowedRoles) {
                if (role.equals(session.role)) {
                    allowed = true;
                }
            }
            if (!allowed) {
                Reply.error(ex, 403, "You are not allowed to do this");
                return null;
            }
        }
        return session;
    }
}
