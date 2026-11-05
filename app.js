import {initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const authPanel = document.querySelector("#auth-panel");
const authForm = document.querySelector("#auth-form");
const authTitle = document.querySelector("#auth-title");
const authDescription = document.querySelector("#auth-description");
const authSubmit = document.querySelector("#auth-submit");
const authSwitch = document.querySelector("#auth-switch");
const authMessage = document.querySelector("#auth-message");
const emailInput = document.querySelector("#email");
const passwordInput = document.querySelector("#password");
const questionForm = document.querySelector("#question-form");
const questionInput = document.querySelector("#question");
const sendButton = document.querySelector("#send-button");
const characterCount = document.querySelector("#character-count");
const messages = document.querySelector("#messages");
const welcome = document.querySelector("#welcome");
const userEmail = document.querySelector("#user-email");
const accountStatus = document.querySelector("#account-status");
const userAvatar = document.querySelector("#user-avatar");
const signOutButton = document.querySelector("#sign-out");
const mobileSignOutButton = document.querySelector("#mobile-sign-out");

let auth = null;
let currentUser = null;
let authMode = "sign-in";
let isSending = false;
let conversationHistory = [];
const MAX_CONVERSATION_MESSAGES = 8;

const setAuthMessage = (message) => {
  authMessage.textContent = message || "";
};

const setAuthMode = (mode) => {
  authMode = mode;
  const isSignUp = mode === "sign-up";
  authTitle.textContent = isSignUp ? "建立 Jacfit 帳號" : "登入後開始對話";
  authDescription.textContent = isSignUp ?
    "建立帳號後即可使用知識庫助理" : "使用你的 Jacfit 帳號安全登入";
  authSubmit.textContent = isSignUp ? "建立帳號" : "登入";
  authSwitch.textContent = isSignUp ? "已有帳號？登入" : "建立帳號";
  passwordInput.autocomplete = isSignUp ? "new-password" : "current-password";
  setAuthMessage("");
};

const getAuthErrorMessage = (error) => {
  const messagesByCode = {
    "auth/invalid-email": "電子郵件格式不正確。",
    "auth/user-disabled": "此帳號目前已停用，請聯絡管理員。",
    "auth/user-not-found": "找不到這個帳號，請確認電子郵件或建立帳號。",
    "auth/wrong-password": "密碼錯誤，請再試一次。",
    "auth/invalid-credential": "電子郵件或密碼不正確。",
    "auth/email-already-in-use": "這個電子郵件已經註冊，請直接登入。",
    "auth/weak-password": "密碼至少需要 6 個字元。",
    "auth/operation-not-allowed": "Firebase 尚未啟用電子郵件/密碼登入，請聯絡管理員。",
    "auth/network-request-failed": "網路連線失敗，請檢查網路後重試。",
    "auth/too-many-requests": "嘗試次數過多，請稍後再試。",
  };
  return messagesByCode[error.code] || "登入目前無法完成，請稍後再試。";
};

const appendInlineMarkdown = (parent, text) => {
  const markdownPattern =
    /(\*\*|__)(.+?)\1|(\*|_)([^*_]+)\3|`([^`]+)`|~~(.+?)~~/g;
  let lastIndex = 0;
  let match;
  while ((match = markdownPattern.exec(text)) !== null) {
    parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    const element = document.createElement(match[5] ? "code" :
      (match[6] ? "del" : (match[1] ? "strong" : "em")));
    element.textContent = match[2] || match[4] || match[5] || match[6];
    parent.append(element);
    lastIndex = markdownPattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(lastIndex)));
};

const renderAnswer = (container, text) => {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  let list = null;
  let codeLines = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement("p");
    paragraphLines.forEach((line, index) => {
      if (index) paragraph.append(document.createElement("br"));
      appendInlineMarkdown(paragraph, line);
    });
    container.append(paragraph);
    paragraphLines = [];
  };

  const closeList = () => {
    list = null;
  };

  lines.forEach((line) => {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      closeList();
      if (codeLines) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.append(code);
        container.append(pre);
        codeLines = null;
      } else {
        codeLines = [];
      }
      return;
    }
    if (codeLines) {
      codeLines.push(line);
      return;
    }
    if (!line.trim() || /^\s*(?:([-*_])\s*){3,}$/.test(line)) {
      flushParagraph();
      closeList();
      return;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      closeList();
      const element = document.createElement(
          `h${Math.min(3, heading[1].length + 1)}`);
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      return;
    }

    const listItem = line.match(/^\s*(?:[*+-]\s+|\d+[.)]\s+)(.+)$/);
    if (listItem) {
      flushParagraph();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const listType = ordered ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== listType) {
        closeList();
        list = document.createElement(listType);
        container.append(list);
      }
      const item = document.createElement("li");
      appendInlineMarkdown(item, listItem[1].trim());
      list.append(item);
      return;
    }

    closeList();
    paragraphLines.push(line.trim());
  });

  flushParagraph();
  if (codeLines) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.append(code);
    container.append(pre);
  }
};

const appendMessage = (role, text, sources = [], isError = false) => {
  const article = document.createElement("article");
  article.className = `message ${role}${isError ? " error" : ""}`;

  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "assistant" ? "J" :
    (currentUser?.email?.charAt(0).toUpperCase() || "你");

  const content = document.createElement("div");
  content.className = "message-content";

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "assistant" ? "Jacfit 助理" : "你";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  if (role === "assistant" && !isError) {
    renderAnswer(bubble, text);
  } else {
    bubble.textContent = text;
  }
  content.append(label, bubble);

  if (sources.length) {
    const sourceList = document.createElement("div");
    sourceList.className = "sources";
    const sourceLabel = document.createElement("span");
    sourceLabel.className = "sources-label";
    sourceLabel.textContent = "參考來源";
    sourceList.append(sourceLabel);
    sources.forEach((source) => {
      const chip = document.createElement("span");
      chip.className = "source-chip";
      chip.textContent = source;
      sourceList.append(chip);
    });
    content.append(sourceList);
  }

  article.append(avatar, content);
  messages.append(article);
  article.scrollIntoView({behavior: "smooth", block: "nearest"});
  return article;
};

const appendTypingIndicator = () => {
  const article = document.createElement("article");
  article.className = "message assistant typing-message";
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "J";
  const content = document.createElement("div");
  content.className = "message-content";
  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = "正在整理知識庫資料…";
  const dots = document.createElement("div");
  dots.className = "typing-dots";
  dots.setAttribute("aria-label", "正在產生回答");
  for (let index = 0; index < 3; index++) {
    dots.append(document.createElement("span"));
  }
  content.append(label, dots);
  article.append(avatar, content);
  messages.append(article);
  article.scrollIntoView({behavior: "smooth", block: "nearest"});
  return article;
};

const requestAnswer = async (query, history) => {
  const idToken = await currentUser.getIdToken();
  const endpoint =
    `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/` +
    "knowledgeBaseAgent";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      data: {
        operation: "answer",
        query,
        conversationHistory: history,
      },
    }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("伺服器回應格式不正確，請稍後再試。");
  }
  if (!response.ok || payload.error) {
    const code = payload.error?.status;
    if (code === "UNAUTHENTICATED") {
      throw new Error("登入狀態已過期，請重新登入後再試。");
    }
    if (code === "PERMISSION_DENIED") {
      throw new Error("目前帳號沒有使用知識庫的權限。");
    }
    throw new Error(payload.error?.message || "知識庫目前無法回應，請稍後再試。");
  }
  if (!payload.result || typeof payload.result.answer !== "string") {
    throw new Error("伺服器沒有回傳有效的回答。");
  }
  return payload.result;
};

const submitQuestion = async (rawQuestion) => {
  const query = rawQuestion.trim();
  if (!query || !currentUser || isSending) return;
  if (query.length > 500) {
    appendMessage("assistant", "問題請控制在 500 個字以內。", [], true);
    return;
  }

  isSending = true;
  welcome.hidden = true;
  questionInput.value = "";
  questionInput.style.height = "auto";
  characterCount.textContent = "0 / 500";
  questionInput.disabled = true;
  sendButton.disabled = true;
  appendMessage("user", query);
  const typing = appendTypingIndicator();

  try {
    const result = await requestAnswer(query, conversationHistory);
    typing.remove();
    appendMessage("assistant", result.answer, result.sources || []);
    conversationHistory = [
      ...conversationHistory,
      {role: "user", text: query},
      {role: "assistant", text: result.answer},
    ].slice(-MAX_CONVERSATION_MESSAGES);
  } catch (error) {
    typing.remove();
    appendMessage(
        "assistant",
        error.message || "知識庫目前無法回應，請稍後再試。",
        [],
        true,
    );
  } finally {
    isSending = false;
    questionInput.disabled = !currentUser;
    sendButton.disabled = !currentUser || !questionInput.value.trim();
    if (currentUser) questionInput.focus();
  }
};

const updateSignedInUi = (user) => {
  if (currentUser?.uid !== user?.uid) {
    conversationHistory = [];
    messages.replaceChildren();
    welcome.hidden = false;
  }
  currentUser = user;
  const signedIn = Boolean(user);
  authPanel.hidden = signedIn;
  questionInput.disabled = !signedIn || isSending;
  sendButton.disabled = !signedIn || isSending || !questionInput.value.trim();
  signOutButton.hidden = !signedIn;
  mobileSignOutButton.hidden = !signedIn;
  userEmail.textContent = user?.email || "尚未登入";
  accountStatus.textContent = signedIn ? "Jacfit 知識庫成員" : "登入後開始提問";
  userAvatar.textContent = user?.email?.charAt(0).toUpperCase() || "J";
};

authSwitch.addEventListener("click", () => {
  setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth) {
    setAuthMessage("Firebase 尚未完成初始化，請重新整理頁面或聯絡管理員。");
    return;
  }

  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const isSignUp = authMode === "sign-up";
  authSubmit.disabled = true;
  authSwitch.disabled = true;
  authSubmit.textContent = isSignUp ? "建立中…" : "登入中…";
  setAuthMessage("");

  try {
    if (isSignUp) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    authForm.reset();
  } catch (error) {
    setAuthMessage(getAuthErrorMessage(error));
    authSubmit.textContent = isSignUp ? "建立帳號" : "登入";
  } finally {
    authSubmit.disabled = false;
    authSwitch.disabled = false;
  }
});

questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitQuestion(questionInput.value);
});

questionInput.addEventListener("input", () => {
  characterCount.textContent = `${questionInput.value.length} / 500`;
  sendButton.disabled = !currentUser || isSending ||
    !questionInput.value.trim();
  questionInput.style.height = "auto";
  questionInput.style.height =
    `${Math.min(questionInput.scrollHeight, 150)}px`;
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    questionForm.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt || "";
    if (!currentUser) {
      setAuthMessage("請先登入，再開始詢問知識庫。");
      authPanel.scrollIntoView({behavior: "smooth", block: "center"});
      emailInput.focus();
      return;
    }
    questionInput.value = prompt;
    questionInput.dispatchEvent(new Event("input"));
    questionForm.requestSubmit();
  });
});

const handleSignOut = async () => {
  if (!auth) return;
  try {
    await signOut(auth);
  } catch (error) {
    setAuthMessage("登出失敗，請稍後再試。");
  }
};

signOutButton.addEventListener("click", handleSignOut);
mobileSignOutButton.addEventListener("click", handleSignOut);

let firebaseConfig;
try {
  const configResponse = await fetch("./config/firebaseConfig.json");
  if (!configResponse.ok) {
    throw new Error("找不到 config/firebaseConfig.json。");
  }
  firebaseConfig = await configResponse.json();
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    throw new Error("Firebase 設定缺少 apiKey 或 projectId。");
  }
  const firebaseApp = initializeApp(firebaseConfig);
  auth = getAuth(firebaseApp);
  await setPersistence(auth, browserLocalPersistence);
  onAuthStateChanged(auth, updateSignedInUi, (error) => {
    console.error("Firebase Auth state error:", error);
    setAuthMessage("無法確認登入狀態，請重新整理頁面。");
  });
} catch (error) {
  console.error("Firebase initialization failed:", error);
  setAuthMessage(
      `${error.message} 請使用本機網頁伺服器開啟此頁，而非直接開啟 HTML 檔案。`,
  );
  authSubmit.disabled = true;
  authSwitch.disabled = true;
}
