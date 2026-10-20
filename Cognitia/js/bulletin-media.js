"use strict";

/* Binary announcement attachments live in IndexedDB; cognitia_state keeps only metadata. */
(() => {
	const DATABASE = "cognitia_bulletin_media";
	const STORE = "attachments";
	let databasePromise;

	function openDatabase() {
		if (!("indexedDB" in window)) return Promise.reject(new Error("IndexedDB is unavailable."));
		if (!databasePromise) {
			const opening = new Promise((resolve, reject) => {
				const request = indexedDB.open(DATABASE, 1);
				request.onupgradeneeded = () => {
					const db = request.result;
					if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "announcementId" });
				};
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error || new Error("Could not open announcement media storage."));
				request.onblocked = () => reject(new Error("Announcement media storage is blocked by another tab."));
			});
			databasePromise = opening.catch((error) => { databasePromise = null; throw error; });
		}
		return databasePromise;
	}

	async function get(announcementId) {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const request = db.transaction(STORE, "readonly").objectStore(STORE).get(String(announcementId));
			request.onsuccess = () => resolve(request.result || null);
			request.onerror = () => reject(request.error || new Error("Could not read announcement media."));
		});
	}

	async function save(announcementId, fileOrBlob, metadata = {}) {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			transaction.objectStore(STORE).put({
				announcementId: String(announcementId),
				blob: fileOrBlob,
				type: metadata.type || fileOrBlob.type || "application/octet-stream",
				name: metadata.name || fileOrBlob.name || "attachment",
				updatedAt: Date.now(),
			});
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error || new Error("Could not save announcement media."));
			transaction.onabort = () => reject(transaction.error || new Error("Announcement media save was cancelled."));
		});
	}

	async function remove(announcementId) {
		const db = await openDatabase();
		return new Promise((resolve, reject) => {
			const transaction = db.transaction(STORE, "readwrite");
			transaction.objectStore(STORE).delete(String(announcementId));
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error || new Error("Could not remove announcement media."));
			transaction.onabort = () => reject(transaction.error || new Error("Announcement media removal was cancelled."));
		});
	}

	window.CognitiaBulletinMedia = Object.freeze({ get, save, remove });
})();
