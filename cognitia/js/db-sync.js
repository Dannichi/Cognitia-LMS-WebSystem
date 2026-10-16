"use strict";

/**
 * db-sync.js — keeps localStorage in step with the MySQL-backed server.
 * Place in cognitia/js/ and load it FIRST on every page:
 *   <script src="js/db-sync.js"></script>
 * Pages must be opened via http://localhost:5000 (served by server.js).
 *
 *  • On load:  pulls the latest data FROM the database into localStorage.
 *  • On write: pushes changes TO the database (with the user's role, so the
 *              server knows whether this save may change users/programs/etc).
 */
(function () {
  const API = "/api/state/";
  const KEYS = [
    "cognitia_state",
    "cognitia_student_data",
    "cognitia_next_student_id",
  ];
  const RELOAD_FLAG = "cognitia_synced_once";

  let ready = false; // no pushes until the first pull has finished
  const origSet = Storage.prototype.setItem;
  const timers = {};
  const pending = {};

  /* Compare two JSON strings ignoring key order */
  function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      return Object.keys(v)
        .sort()
        .reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {});
    }
    return v;
  }
  function canon(s) {
    try {
      return JSON.stringify(sortKeys(JSON.parse(s)));
    } catch {
      return s;
    }
  }

  function authHeaders() {
    try {
      const u = JSON.parse(
        localStorage.getItem("cognitia_current_user") || "null",
      );
      return u
        ? { "X-Cognitia-Role": u.role, "X-Cognitia-User-Id": String(u.id) }
        : {};
    } catch {
      return {};
    }
  }

  /* ─── Visible status, so a failed save is never silent ─── */
  function banner(msg, ok) {
    const show = () => {
      let el = document.getElementById("cognitia-sync-status");
      if (!el) {
        el = document.createElement("div");
        el.id = "cognitia-sync-status";
        el.style.cssText =
          "position:fixed;left:12px;bottom:12px;z-index:2147483647;max-width:380px;padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);";
        document.body.appendChild(el);
      }
      el.style.background = ok ? "#2a8a4a" : "#b00020";
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(el._t);
      if (ok) el._t = setTimeout(() => (el.style.display = "none"), 2500);
    };
    if (document.body) show();
    else document.addEventListener("DOMContentLoaded", show);
  }
  const NO_SERVER =
    "Cannot reach the database server, so nothing is being saved. Open the site at http://localhost:5000 (not a file or Live Server) and make sure the server is running (node cognitia/js/server.js).";

  /* ─── PUSH: intercept localStorage writes ─── */
  Storage.prototype.setItem = function (key, value) {
    origSet.call(this, key, value);
    if (ready && this === localStorage && KEYS.includes(key)) {
      pending[key] = value;
      clearTimeout(timers[key]);
      timers[key] = setTimeout(() => push(key, value), 400);
    }
  };

  function push(key, value, keepalive) {
    delete pending[key];
    return fetch(API + key, {
      method: "PUT",
      keepalive: !!keepalive,
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ value }),
    })
      .then(async (res) => {
        let data = {};
        try {
          data = await res.json();
        } catch {}
        if (!res.ok) {
          banner(
            data.error
              ? `Not saved to the database: ${data.error}`
              : `Not saved to the database (server answered ${res.status}). ${NO_SERVER}`,
            false,
          );
          return;
        }
        if (key === "cognitia_state") {
          const role = authHeaders()["X-Cognitia-Role"];
          if (!role) {
            banner(
              "Saved only as backup data, not to the tables: please log in again.",
              false,
            );
            return;
          }
          if (data.skipped && data.skipped.length) {
            banner(
              "Some users were NOT saved to the database: " +
                data.skipped.map((x) => `${x.email} (${x.reason})`).join("; "),
              false,
            );
            return;
          }
          if (role === "admin" && data.synced === false) {
            banner(
              "The database tables were NOT updated. Check the server terminal for the reason.",
              false,
            );
            return;
          }
        }
        banner("Saved to database \u2713", true);
      })
      .catch((e) => {
        console.warn("DB sync push failed:", key, e.message);
        banner(NO_SERVER, false);
      });
  }

  // Don't lose a change made less than 400 ms before leaving the page
  window.addEventListener("pagehide", () => {
    Object.keys(pending).forEach((key) => {
      clearTimeout(timers[key]);
      push(key, pending[key], true);
    });
  });

  /* ─── PULL: hydrate localStorage from MySQL on page load ─── */
  async function pullAll() {
    let changed = false;
    try {
      for (const key of KEYS) {
        const res = await fetch(API + key);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const { value } = await res.json();

        if (value === null || value === undefined) {
          // Database has nothing for this key yet → seed it from this browser
          const local = localStorage.getItem(key);
          if (local) await push(key, local);
          continue;
        }
        const local = localStorage.getItem(key);
        if (local === null || canon(local) !== canon(value)) {
          clearTimeout(timers[key]);
          delete pending[key];
          origSet.call(localStorage, key, value); // don't re-push
          changed = true;
        }
      }
    } catch (e) {
      console.warn("DB sync pull failed (using local data):", e.message);
      banner(
        /^HTTP \d+$|fetch|Failed|JSON|Unexpected/i.test(e.message)
          ? NO_SERVER
          : `Database problem: ${e.message}`,
        false,
      );
    } finally {
      ready = true;
    }

    // Page scripts already ran with older data → reload once to use fresh data
    if (changed && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      location.reload();
    } else {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  }

  pullAll();
})();
