package util;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * PasswordHashing - the "password helper" of the Cognitia server.
 *
 * What it does:
 *   1. hash(password)           -> makes the text we store in users.password_hash
 *   2. verify(password, stored) -> checks a typed password at login
 *
 * Stored format (matches schema.sql): "salt:hash"
 *   - salt = random bytes, different for every user (Base64 text)
 *   - hash = the scrambled password (Base64 text)
 *   Base64 never contains the ':' character, so it is safe to split on it.
 *
 * We do NOT write our own algorithm. We use PBKDF2, which is built into Java.
 * Both methods are "static", so you call them without creating an object:
 *     String stored = PasswordHashing.hash("secret123");
 *     boolean ok    = PasswordHashing.verify("secret123", stored);
 */
public class PasswordHashing {

    // ---------- Settings (change here only) ----------

    // Which built-in Java algorithm to use.
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";

    // How many times the algorithm repeats itself.
    // More repeats = slower for an attacker who guesses passwords.
    private static final int ITERATIONS = 65536;

    // Size of the random salt in bytes (16 bytes = 128 bits).
    private static final int SALT_BYTES = 16;

    // Size of the final hash in bits (256 bits = 32 bytes).
    private static final int HASH_BITS = 256;

    // Java's secure random number generator (safe to use for salts).
    // Made once and reused, because creating it every time is wasteful.
    private static final SecureRandom RANDOM = new SecureRandom();

    // Nobody should create a PasswordHashing object, so the constructor is private.
    private PasswordHashing() {
    }

    // ---------- Public method 1: make a stored password ----------

    /**
     * Turns a plain password into "salt:hash" text, ready for the database.
     * Use this when registering a user or when an admin creates a user.
     */
    public static String hash(String password) {
        // Step 1: make a new random salt.
        // The salt makes sure two users with the same password
        // end up with DIFFERENT hashes.
        byte[] salt = new byte[SALT_BYTES];
        RANDOM.nextBytes(salt); // fills the array with random bytes

        // Step 2: scramble the password together with the salt.
        byte[] hash = pbkdf2(password, salt);

        // Step 3: turn both byte arrays into text and join them with ':'
        String saltText = Base64.getEncoder().encodeToString(salt);
        String hashText = Base64.getEncoder().encodeToString(hash);
        return saltText + ":" + hashText;
    }

    // ---------- Public method 2: check a typed password ----------

    /**
     * Checks a typed password against the "salt:hash" text from the database.
     * Returns true only if they match. Use this in the login handler.
     */
    public static boolean verify(String password, String stored) {
        // Safety: if something is missing, the answer is simply "no".
        if (password == null || stored == null) {
            return false;
        }

        // Step 1: split "salt:hash" into its two parts.
        String[] parts = stored.split(":");
        if (parts.length != 2) {
            return false; // the stored text is not in the expected format
        }

        // Step 2: turn the Base64 text back into bytes.
        byte[] salt;
        byte[] expectedHash;
        try {
            salt = Base64.getDecoder().decode(parts[0]);
            expectedHash = Base64.getDecoder().decode(parts[1]);
        } catch (IllegalArgumentException e) {
            return false; // the stored text was not valid Base64
        }

        // Step 3: hash the typed password with the SAME salt.
        byte[] typedHash = pbkdf2(password, salt);

        // Step 4: compare the two hashes.
        // MessageDigest.isEqual takes the same time no matter where the
        // bytes differ, so an attacker cannot learn anything from timing.
        return MessageDigest.isEqual(expectedHash, typedHash);
    }

    // ---------- Private helper: the actual scrambling ----------

    /**
     * Runs Java's built-in PBKDF2 on (password + salt) and returns the hash bytes.
     * Both hash() and verify() use this, so the logic lives in one place.
     */
    private static byte[] pbkdf2(String password, byte[] salt) {
        try {
            // Put all settings into one "spec" object.
            // PBEKeySpec wants the password as a char array.
            PBEKeySpec spec = new PBEKeySpec(
                    password.toCharArray(), salt, ITERATIONS, HASH_BITS);

            // Ask Java for the algorithm and run it.
            SecretKeyFactory factory = SecretKeyFactory.getInstance(ALGORITHM);
            return factory.generateSecret(spec).getEncoded();

        } catch (Exception e) {
            // This should never happen on a normal Java 21 install.
            // We turn it into a RuntimeException so callers don't need try/catch.
            throw new RuntimeException("Password hashing failed", e);
        }
    }
}
