import com.sun.net.httpserver.HttpServer;
import data.UserData;
import handlers.ActivityHandler;
import handlers.AcademicHandler;
import handlers.AnnouncementHandler;
import handlers.AssignmentHandler;
import handlers.AuthHandler;
import handlers.GradeHandler;
import handlers.LessonHandler;
import handlers.QuizHandler;
import handlers.UserHandler;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

/**
 * Starts the Cognitia API server and connects each API path to its handler.
 * The API listens on port 8000. Database access and first-admin setup use UserData.
 */
public class Main {

    private static final int PORT = 8000;

    public static void main(String[] args) throws IOException {
        Path frontendRoot = (args.length > 0 ? Path.of(args[0]) : Path.of("..", "..", "Frontend"))
                .toRealPath();

        // Create the demo admin if the users table does not already have one.
        UserData.ensureFirstAdmin();

        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);

        AuthHandler authHandler = new AuthHandler();
        server.createContext("/api/register", authHandler);
        server.createContext("/api/login", authHandler);
        server.createContext("/api/logout", authHandler);
        server.createContext("/api/me", authHandler);

        server.createContext("/api/users", new UserHandler());

        AcademicHandler academicHandler = new AcademicHandler();
        server.createContext("/api/programs", academicHandler);
        server.createContext("/api/sections", academicHandler);
        server.createContext("/api/courses", academicHandler);

        server.createContext("/api/announcements", new AnnouncementHandler());
        server.createContext("/api/lessons", new LessonHandler());

        AssignmentHandler assignmentHandler = new AssignmentHandler();
        server.createContext("/api/assignments", assignmentHandler);
        server.createContext("/api/submissions", assignmentHandler);

        QuizHandler quizHandler = new QuizHandler();
        server.createContext("/api/quizzes", quizHandler);
        server.createContext("/api/attempts", quizHandler);

        server.createContext("/api/grades", new GradeHandler());
        server.createContext("/api/activity", new ActivityHandler());
        server.createContext("/", exchange -> serveFrontend(exchange, frontendRoot));

        server.start();
        System.out.println("Cognitia API server is running at http://localhost:" + PORT);
        System.out.println("Frontend login: http://localhost:" + PORT + "/login.html");
    }

    /** Serves static frontend files from Frontend; /api routes use their more specific contexts. */
    private static void serveFrontend(com.sun.net.httpserver.HttpExchange exchange, Path frontendRoot)
            throws IOException {
        String method = exchange.getRequestMethod();
        if (!method.equals("GET") && !method.equals("HEAD")) {
            sendText(exchange, 405, "Method not allowed");
            return;
        }

        String requestPath = exchange.getRequestURI().getPath();
        if (requestPath == null || requestPath.equals("/")) requestPath = "/index.html";
        Path requested = frontendRoot.resolve(requestPath.substring(1)).normalize();
        if (!requested.startsWith(frontendRoot)) {
            sendText(exchange, 403, "Forbidden");
            return;
        }

        if (!Files.isRegularFile(requested)) {
            sendText(exchange, 404, "Not found");
            return;
        }

        Path realFile = requested.toRealPath();
        if (!realFile.startsWith(frontendRoot)) {
            sendText(exchange, 403, "Forbidden");
            return;
        }

        byte[] content = Files.readAllBytes(realFile);
        exchange.getResponseHeaders().set("Content-Type", contentType(realFile));
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.sendResponseHeaders(200, method.equals("HEAD") ? -1 : content.length);
        if (method.equals("GET")) {
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(content);
            }
        } else {
            exchange.close();
        }
    }

    private static String contentType(Path file) {
        String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
        if (name.endsWith(".html")) return "text/html; charset=utf-8";
        if (name.endsWith(".css")) return "text/css; charset=utf-8";
        if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (name.endsWith(".json")) return "application/json; charset=utf-8";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".ico")) return "image/x-icon";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        if (name.endsWith(".ttf")) return "font/ttf";
        return "application/octet-stream";
    }

    private static void sendText(com.sun.net.httpserver.HttpExchange exchange, int status, String message)
            throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(body);
        }
    }
}
