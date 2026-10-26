package util;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Json - turns JSON text into Java objects and back.
 *
 * WHY WE NEED IT
 *   The browser and the server talk in JSON text, for example:
 *       {"email":"ana@school.edu","password":"secret"}
 *   Java has no built-in JSON reader, so this small class does two jobs:
 *       Json.parse(text)       TEXT         -> Java objects
 *       Json.stringify(object) Java objects -> TEXT
 *
 * HOW JSON MAPS TO JAVA (this is the whole idea)
 *       JSON                     Java
 *       { "a": 1 }   (object)    Map<String,Object>
 *       [ 1, 2, 3 ]  (array)     List<Object>
 *       "hello"      (string)    String
 *       12  or  12.5 (number)    Long  or  Double
 *       true / false             Boolean
 *       null                     null
 *
 * HOW TO USE
 *       Map<String,Object> body = Json.asMap(Json.parse(text));
 *       String email = Json.getString(body, "email");
 *       String reply = Json.stringify(Json.map("ok", true, "id", 5));
 */
public class Json {

    // Nobody needs a Json object, everything is static.
    private Json() {
    }

    // ==================================================================
    // PART 1 - PARSING (text -> Java objects)
    //
    // The parser walks through the text from left to right and keeps its
    // place in a number called "pos". It looks at the character at "pos"
    // and decides what kind of value starts there:
    //     {  object      [  array      "  string
    //     digit or -  number      t / f / n  true / false / null
    // Objects and arrays can contain other values, so their methods call
    // readValue() again. (A method that calls itself is "recursion".)
    // ==================================================================

    /** Turns JSON text into Java objects. Throws IllegalArgumentException if the text is not valid JSON. */
    public static Object parse(String text) {
        if (text == null) {
            throw new IllegalArgumentException("JSON text is null");
        }
        Parser p = new Parser(text);
        p.skipSpaces();
        Object value = p.readValue();
        p.skipSpaces();
        if (p.pos < text.length()) {
            throw p.error("Extra text after the JSON value");
        }
        return value;
    }

    // Small helper class: holds the text and the current position.
    private static class Parser {
        private final String text;  // the whole JSON text
        private int pos = 0;        // which character we are looking at now

        Parser(String text) {
            this.text = text;
        }

        // Builds an error message that says WHERE the problem is.
        IllegalArgumentException error(String message) {
            return new IllegalArgumentException(message + " (at character " + pos + ")");
        }

        // Skips spaces, tabs and new lines (JSON ignores them).
        void skipSpaces() {
            while (pos < text.length() && Character.isWhitespace(text.charAt(pos))) {
                pos++;
            }
        }

        // Looks at the current character WITHOUT moving forward.
        char peek() {
            if (pos >= text.length()) {
                throw error("Unexpected end of JSON text");
            }
            return text.charAt(pos);
        }

        // Demands that the current character is 'expected', then moves forward.
        void expect(char expected) {
            if (peek() != expected) {
                throw error("Expected '" + expected + "' but found '" + peek() + "'");
            }
            pos++;
        }

        // Reads ANY value. The first character tells us what it is.
        Object readValue() {
            char c = peek();
            if (c == '{') return readObject();
            if (c == '[') return readArray();
            if (c == '"') return readString();
            if (c == '-' || (c >= '0' && c <= '9')) return readNumber();
            if (text.startsWith("true", pos))  { pos += 4; return Boolean.TRUE; }
            if (text.startsWith("false", pos)) { pos += 5; return Boolean.FALSE; }
            if (text.startsWith("null", pos))  { pos += 4; return null; }
            throw error("Unexpected character '" + c + "'");
        }

        // { "key": value, "key2": value2 }
        Map<String, Object> readObject() {
            Map<String, Object> map = new LinkedHashMap<>();   // keeps the order
            expect('{');
            skipSpaces();
            if (peek() == '}') {            // empty object {}
                pos++;
                return map;
            }
            while (true) {
                skipSpaces();
                String key = readString();  // keys are always strings
                skipSpaces();
                expect(':');
                skipSpaces();
                map.put(key, readValue());
                skipSpaces();
                char c = peek();
                pos++;
                if (c == '}') {             // end of the object
                    return map;
                }
                if (c != ',') {             // anything else than a comma is wrong
                    throw error("Expected ',' or '}' in object");
                }
            }
        }

        // [ value, value2, value3 ]
        List<Object> readArray() {
            List<Object> list = new ArrayList<>();
            expect('[');
            skipSpaces();
            if (peek() == ']') {            // empty array []
                pos++;
                return list;
            }
            while (true) {
                skipSpaces();
                list.add(readValue());
                skipSpaces();
                char c = peek();
                pos++;
                if (c == ']') {             // end of the array
                    return list;
                }
                if (c != ',') {
                    throw error("Expected ',' or ']' in array");
                }
            }
        }

        // "some text" - including escapes like backslash-n or backslash-quote.
        String readString() {
            expect('"');
            StringBuilder sb = new StringBuilder();   // builds the result
            while (true) {
                char c = peek();
                pos++;
                if (c == '"') {                       // closing quote: finished
                    return sb.toString();
                }
                if (c != '\\') {                      // a normal character
                    sb.append(c);
                    continue;
                }
                // A backslash: the NEXT character says what it stands for.
                char e = peek();
                pos++;
                switch (e) {
                    case '"':  sb.append('"');  break;
                    case '\\': sb.append('\\'); break;
                    case '/':  sb.append('/');  break;
                    case 'n':  sb.append('\n'); break;
                    case 'r':  sb.append('\r'); break;
                    case 't':  sb.append('\t'); break;
                    case 'b':  sb.append('\b'); break;
                    case 'f':  sb.append('\f'); break;
                    case 'u':                         // backslash-u + 4 hex digits
                        if (pos + 4 > text.length()) {
                            throw error("Bad unicode escape");
                        }
                        try {
                            sb.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16));
                        } catch (NumberFormatException ex) {
                            throw error("Bad unicode escape");
                        }
                        pos += 4;
                        break;
                    default:
                        throw error("Unknown escape '" + e + "'");
                }
            }
        }

        // 12  or  -3  or  12.5  or  1e5
        // Whole numbers become Long (so ids stay exact), others become Double.
        Object readNumber() {
            int start = pos;
            while (pos < text.length() && "+-0123456789.eE".indexOf(text.charAt(pos)) >= 0) {
                pos++;
            }
            String number = text.substring(start, pos);
            try {
                if (number.contains(".") || number.contains("e") || number.contains("E")) {
                    return Double.valueOf(number);
                }
                return Long.valueOf(number);
            } catch (NumberFormatException ex) {
                throw error("Bad number '" + number + "'");
            }
        }
    }

    // ==================================================================
    // PART 2 - WRITING (Java objects -> text)
    //
    // We look at what kind of object we were given and write it the way
    // JSON expects. Maps and Lists contain other objects, so write() calls
    // itself again for every item inside them.
    // NOTE: byte[] (raw files) is NOT supported. Files travel as base64 text.
    // ==================================================================

    // Dates from the database are written like 2026-10-20T08:00:00
    private static final DateTimeFormatter ISO = DateTimeFormatter.ISO_LOCAL_DATE_TIME;

    /** Turns a Java object (Map, List, String, number, boolean, null) into JSON text. */
    public static String stringify(Object value) {
        StringBuilder sb = new StringBuilder();
        write(sb, value);
        return sb.toString();
    }

    private static void write(StringBuilder sb, Object v) {
        if (v == null) {
            sb.append("null");
        } else if (v instanceof String) {
            writeString(sb, (String) v);
        } else if (v instanceof Boolean) {
            sb.append(v.toString());                       // true / false
        } else if (v instanceof Number) {
            double d = ((Number) v).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) {
                sb.append("null");                         // JSON has no NaN
            } else {
                sb.append(v.toString());                   // Long, Integer, Double, BigDecimal
            }
        } else if (v instanceof Map) {
            sb.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : ((Map<?, ?>) v).entrySet()) {
                if (!first) sb.append(',');
                first = false;
                writeString(sb, String.valueOf(entry.getKey()));
                sb.append(':');
                write(sb, entry.getValue());
            }
            sb.append('}');
        } else if (v instanceof Collection) {
            sb.append('[');
            boolean first = true;
            for (Object item : (Collection<?>) v) {
                if (!first) sb.append(',');
                first = false;
                write(sb, item);
            }
            sb.append(']');
        } else if (v instanceof Timestamp) {               // DATETIME column from JDBC
            writeString(sb, ((Timestamp) v).toLocalDateTime().format(ISO));
        } else if (v instanceof LocalDateTime) {
            writeString(sb, ((LocalDateTime) v).format(ISO));
        } else {
            writeString(sb, v.toString());                 // anything else (like a DATE) as text
        }
    }

    // Writes "text" with quotes, adding backslashes where JSON requires them.
    private static void writeString(StringBuilder sb, String text) {
        sb.append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                case '\b': sb.append("\\b");  break;
                case '\f': sb.append("\\f");  break;
                default:
                    if (c < 0x20) {                        // other invisible characters
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);                      // letters, emoji... stay as they are
                    }
            }
        }
        sb.append('"');
    }

    // ==================================================================
    // PART 3 - SMALL HELPERS (so handlers stay short)
    // ==================================================================

    /**
     * Builds a Map from pairs, so an answer fits on one line:
     *     Json.map("ok", true, "error", "Wrong password")
     * The arguments go: key, value, key, value, ...
     */
    public static Map<String, Object> map(Object... keysAndValues) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keysAndValues.length; i += 2) {
            m.put(String.valueOf(keysAndValues[i]), keysAndValues[i + 1]);
        }
        return m;
    }

    /** Treats a parsed value as an object (Map). Gives an empty Map if it is not one. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object value) {
        if (value instanceof Map) {
            return (Map<String, Object>) value;
        }
        return new LinkedHashMap<>();
    }

    /** Treats a parsed value as an array (List). Gives an empty List if it is not one. */
    @SuppressWarnings("unchecked")
    public static List<Object> asList(Object value) {
        if (value instanceof List) {
            return (List<Object>) value;
        }
        return new ArrayList<>();
    }

    /** Text value of a key, or null if the key is missing or null. */
    public static String getString(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? null : v.toString();
    }

    /** Whole-number value of a key (ids!), or null if missing or not a number. */
    public static Long getLong(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v instanceof Number) {
            return ((Number) v).longValue();
        }
        if (v instanceof String) {
            try {
                return Long.valueOf(((String) v).trim());
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return null;
    }

    /** Decimal value of a key (points, grades), or null if missing or not a number. */
    public static Double getDouble(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v instanceof Number) {
            return ((Number) v).doubleValue();
        }
        if (v instanceof String) {
            try {
                return Double.valueOf(((String) v).trim());
            } catch (NumberFormatException ex) {
                return null;
            }
        }
        return null;
    }

    /** true/false value of a key, or null if missing. */
    public static Boolean getBoolean(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v instanceof Boolean ? (Boolean) v : null;
    }

    /** List value of a key. Always a List (empty if missing), so loops never crash. */
    public static List<Object> getList(Map<String, Object> m, String key) {
        return asList(m.get(key));
    }

    /** Object value of a key. Always a Map (empty if missing). */
    public static Map<String, Object> getMap(Map<String, Object> m, String key) {
        return asMap(m.get(key));
    }
}
