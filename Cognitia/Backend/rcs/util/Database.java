package util;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Database - the "JDBC bridge" between our Java server and MariaDB.
 *
 * What it does:
 *   - holds the database settings (url, user, password) in ONE place
 *   - opens connections
 *   - runs SQL with PreparedStatement, so values are passed as parameters
 *     and NEVER glued into the SQL text (this is what stops SQL injection)
 *
 * The data classes (UserData, LessonData, ...) hold the actual SQL text and
 * call the methods below. Example:
 *
 *   List<Map<String,Object>> rows = Database.query(
 *       "SELECT id, first_name AS firstName FROM users WHERE email = ?", email);
 *
 * Tip: write "column_name AS camelName" in your SELECT. The map keys then
 * match the names in API-CONTRACT.md and can go straight into JSON.
 *
 * Errors: every method throws an unchecked RuntimeException when the
 * database fails, so you do not need try/catch everywhere. The original
 * SQLException is kept inside it (see isDuplicate).
 *
 * The MariaDB driver .jar must be on the classpath. Java finds the driver
 * by itself, so there is no Class.forName(...) line.
 */
public class Database {

    // ---------- Settings (change here only) ----------

    // 3306 is the default MariaDB port in XAMPP. "cognitia" is created by schema.sql.
    private static final String URL = "jdbc:mariadb://localhost:3306/cognitia";

    // XAMPP defaults: user "root" with an EMPTY password.
    private static final String USER = "root";
    private static final String PASSWORD = "";

    // Nobody should create a Database object, everything is static.
    private Database() {
    }

    // ==================================================================
    // PART 1 - CONNECTIONS
    // ==================================================================

    /** Opens a new connection. Plan says: each request opens its own (simple, fine for a class project). */
    public static Connection getConnection() {
        try {
            return DriverManager.getConnection(URL, USER, PASSWORD);
        } catch (SQLException e) {
            throw new RuntimeException("Cannot connect to the database: " + e.getMessage(), e);
        }
    }

    /** Closes a connection quietly. Safe to call with null. */
    public static void close(Connection c) {
        try {
            if (c != null) {
                c.close();
            }
        } catch (SQLException e) {
            // nothing useful to do if closing fails
        }
    }

    // ==================================================================
    // PART 2 - TRANSACTIONS ("all or nothing")
    //
    // Use these when one save touches several tables, for example a section
    // plus its course links and professor links. Pattern for a data class:
    //
    //   Connection c = Database.begin();
    //   try {
    //       long id = Database.insert(c, "INSERT INTO sections ...", ...);
    //       Database.update(c, "INSERT INTO section_courses ...", ...);
    //       Database.commit(c);
    //   } catch (RuntimeException e) {
    //       Database.rollback(c);   // undo everything
    //       throw e;
    //   } finally {
    //       Database.close(c);
    //   }
    // ==================================================================

    /** Opens a connection and switches off auto-save, so nothing is final until commit(). */
    public static Connection begin() {
        Connection c = getConnection();
        try {
            c.setAutoCommit(false);
            return c;
        } catch (SQLException e) {
            close(c);
            throw new RuntimeException("Cannot start a transaction: " + e.getMessage(), e);
        }
    }

    /** Makes all changes of the transaction permanent. */
    public static void commit(Connection c) {
        try {
            c.commit();
        } catch (SQLException e) {
            throw new RuntimeException("Commit failed: " + e.getMessage(), e);
        }
    }

    /** Throws away all changes of the transaction. Never fails loudly. */
    public static void rollback(Connection c) {
        try {
            c.rollback();
        } catch (SQLException e) {
            // nothing useful to do
        }
    }

    // ==================================================================
    // PART 3 - RUNNING SQL
    //
    // Every "?" in the SQL text is filled by the next value in "params".
    // Each method has two forms:
    //   - without a Connection: opens one, runs the SQL, closes it
    //   - with a Connection: used inside a transaction (you close it yourself)
    // ==================================================================

    /**
     * SELECT. Returns a list of rows. Each row is a Map: column name -> value.
     * Use the Connection form inside a transaction.
     */
    public static List<Map<String, Object>> query(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                ResultSetMetaData meta = rs.getMetaData();
                int columns = meta.getColumnCount();
                List<Map<String, Object>> rows = new ArrayList<>();
                while (rs.next()) {
                    Map<String, Object> row = new LinkedHashMap<>();
                    for (int i = 1; i <= columns; i++) {      // JDBC columns start at 1
                        row.put(meta.getColumnLabel(i), rs.getObject(i));
                    }
                    rows.add(row);
                }
                return rows;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Database error: " + e.getMessage(), e);
        }
    }

    /** SELECT on its own connection. */
    public static List<Map<String, Object>> query(String sql, Object... params) {
        Connection c = getConnection();
        try {
            return query(c, sql, params);
        } finally {
            close(c);
        }
    }

    /** SELECT that expects at most one row. Returns that row, or null if nothing was found. */
    public static Map<String, Object> queryOne(String sql, Object... params) {
        List<Map<String, Object>> rows = query(sql, params);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * INSERT into a table with an AUTO_INCREMENT id.
     * Returns the new id (0 if the table has no auto id, like link tables).
     */
    public static long insert(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            bind(ps, params);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                return keys.next() ? keys.getLong(1) : 0;
            }
        } catch (SQLException e) {
            throw new RuntimeException("Database error: " + e.getMessage(), e);
        }
    }

    /** INSERT on its own connection. */
    public static long insert(String sql, Object... params) {
        Connection c = getConnection();
        try {
            return insert(c, sql, params);
        } finally {
            close(c);
        }
    }

    /**
     * UPDATE, DELETE, or an INSERT where you do not need the id.
     * Returns how many rows changed (0 means "nothing matched", useful for 404).
     */
    public static int update(Connection c, String sql, Object... params) {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            bind(ps, params);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new RuntimeException("Database error: " + e.getMessage(), e);
        }
    }

    /** UPDATE / DELETE on its own connection. */
    public static int update(String sql, Object... params) {
        Connection c = getConnection();
        try {
            return update(c, sql, params);
        } finally {
            close(c);
        }
    }

    // Fills the "?" marks of the SQL with the given values, in order.
    private static void bind(PreparedStatement ps, Object[] params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            if (params[i] == null) {
                ps.setNull(i + 1, Types.NULL);     // SQL NULL
            } else {
                ps.setObject(i + 1, params[i]);    // JDBC counts "?" from 1, not 0
            }
        }
    }

    // ==================================================================
    // PART 4 - SMALL HELPERS
    // ==================================================================

    /**
     * Converts the browser's date text (2026-10-20T08:00:00 or 2026-10-20T08:00)
     * into a value MariaDB accepts for a DATETIME column.
     * Returns null for empty text. Throws IllegalArgumentException for bad text
     * (the handler should answer 400).
     */
    public static Timestamp toTimestamp(String iso) {
        if (iso == null || iso.trim().isEmpty()) {
            return null;
        }
        try {
            return Timestamp.valueOf(LocalDateTime.parse(iso.trim()));
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Invalid date: " + iso);
        }
    }

    /** True if the error is "duplicate entry" (for example an email that already exists). Handler answers 409. */
    public static boolean isDuplicate(Exception e) {
        return hasErrorCode(e, 1062);
    }

    /** True if the error is a foreign key problem (the row is still used, or the linked row does not exist). */
    public static boolean isForeignKeyError(Exception e) {
        return hasErrorCode(e, 1451) || hasErrorCode(e, 1452);
    }

    // Looks through the error and the errors inside it for a MariaDB error number.
    private static boolean hasErrorCode(Throwable e, int code) {
        while (e != null) {
            if (e instanceof SQLException && ((SQLException) e).getErrorCode() == code) {
                return true;
            }
            e = e.getCause();
        }
        return false;
    }
}
