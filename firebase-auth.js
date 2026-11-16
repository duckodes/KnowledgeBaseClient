import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

export { onAuthStateChanged };
let initialization;
export function initializeFirebaseAuth() {
	return initialization ||= (async () => {
		const response = await fetch("./config/firebaseConfig.json", { cache: "no-store" });
		if (!response.ok) throw new Error("無法讀取 Firebase 設定。");
		const config = await response.json();
		if (!config.apiKey || !config.projectId) throw new Error("Firebase 設定不完整。");
		const app = getApps().length ? getApp() : initializeApp(config);
		const auth = getAuth(app);
		await setPersistence(auth, browserLocalPersistence);
		return { auth, config };
	})();
}
