// ============================================================
// app.js — ChatFire ana uygulama mantığı
// ============================================================
import {
  auth,
  registerUser,
  loginUser,
  logoutUser,
  getUser,
  subscribeUsers,
  sendMessage,
  sendImageMessage,
  sendVoiceMessage,
  uploadChatPhoto,
  uploadVoiceMessage,
  subscribeMessages,
  markRead,
  markDelivered,
  setTyping,
  subscribeTyping,
  onAuth,
  getConvId,
  formatLastSeen,
  uploadProfilePhoto,
  setPresence,
  subscribeConversations,
  addReaction,
  postStatus,
  subscribeStatuses,
  blockUser,
  unblockUser,
} from "./firebase.js";

// ─── Upload timeout yardımcısı ────────────────────────────
function withTimeout(promise, ms = 15000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("İşlem zaman aşımına uğradı, tekrar deneyin.")),
      ms
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ─── Durum ────────────────────────────────────────────────
const state = {
  currentUser: null,
  currentProfile: null,
  selectedUid: null,
  selectedProfile: null,
  convId: null,
  users: [],
  messages: [],
  unsubMessages: null,
  unsubTyping: null,
  unsubUsers: null,
  unsubConversations: null,
  unsubStatuses: null,
  typingTimer: null,
  isTyping: false,
  theme: localStorage.getItem("cf-theme") || "light",
  pendingImageFile: null,
  pendingImageURL: null,
  unreadCounts: {},
  statuses: [],
  blockedUsers: [],
  storyPendingImage: null,
};

// ─── Ses kaydı durumu ─────────────────────────────────────
const voiceRec = {
  mediaRecorder: null,
  chunks: [],
  startTime: null,
  timer: null,
  isRecording: false,
  cancelled: false,
  mimeType: "audio/webm",
};

// ─── DOM ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const el = {
  authScreen: $("auth-screen"),
  chatScreen: $("chat-screen"),
  loginForm: $("login-form"),
  registerForm: $("register-form"),
  loginUsername: $("login-username"),
  loginPassword: $("login-password"),
  loginError: $("login-error"),
  loginBtn: $("login-btn"),
  regUsername: $("reg-username"),
  regPassword: $("reg-password"),
  registerError: $("register-error"),
  registerBtn: $("register-btn"),
  myAvatarWrap: $("my-avatar-wrap"),
  myAvatar: $("my-avatar"),
  photoUpload: $("photo-upload"),
  photoLoading: $("photo-loading"),
  myUsername: $("my-username"),
  userSearch: $("user-search"),
  userList: $("user-list"),
  emptyState: $("empty-state"),
  chatView: $("chat-view"),
  partnerAvatar: $("partner-avatar"),
  partnerName: $("partner-name"),
  partnerStatus: $("partner-status"),
  messages: $("messages"),
  typingIndicator: $("typing-indicator"),
  typingText: $("typing-text"),
  messageInput: $("message-input"),
  sendBtn: $("send-btn"),
  emojiBtn: $("emoji-btn"),
  emojiPicker: $("emoji-picker"),
  emojiSearch: $("emoji-search"),
  emojiGrid: $("emoji-grid"),
  themeToggle: $("theme-toggle"),
  logoutBtn: $("logout-btn"),
  backBtn: $("back-btn"),
  voiceCallBtn: $("voice-call-btn"),
  voiceModal: $("voice-call-modal"),
  callAvatar: $("call-avatar"),
  callName: $("call-name"),
  endCallBtn: $("end-call-btn"),
  muteBtn: $("mute-btn"),
  sunIcon: $("sun-icon"),
  moonIcon: $("moon-icon"),
  photoChatBtn: $("photo-chat-btn"),
  photoChatUpload: $("photo-chat-upload"),
  imagePreviewBar: $("image-preview-bar"),
  imagePreviewThumb: $("image-preview-thumb"),
  imagePreviewName: $("image-preview-name"),
  imagePreviewCancel: $("image-preview-cancel"),
  micBtn: $("mic-btn"),
  recordingIndicator: $("recording-indicator"),
  recordingTimer: $("recording-timer"),
  cancelRecordingBtn: $("cancel-recording-btn"),
  lightbox: $("lightbox"),
  lightboxImg: $("lightbox-img"),
  lightboxClose: $("lightbox-close"),
  storyRow: $("story-row"),
  storyViewer: $("story-viewer"),
  svUserInfo: $("sv-user-info"),
  svContent: $("sv-content"),
  svClose: $("sv-close"),
  svProgressFill: $("sv-progress-fill"),
  storyCreator: $("story-creator"),
  scClose: $("sc-close"),
  scTextInput: $("sc-text-input"),
  scImageInput: $("sc-image-input"),
  scImagePick: $("sc-image-pick"),
  scImagePreview: $("sc-image-preview"),
  scPostBtn: $("sc-post-btn"),
  reactPicker: $("react-picker"),
  blockUserBtn: $("block-user-btn"),
  optionsMenu: $("options-menu"),
  optionsBlockBtn: $("options-block-btn"),
  optionsUnblockBtn: $("options-unblock-btn"),
  blockDialog: $("block-dialog"),
  blockConfirmBtn: $("block-confirm-btn"),
  blockCancelBtn: $("block-cancel-btn"),
};

// ─── Toast Bildirimleri ───────────────────────────────────
function showToast(message, type = "info", duration = 4000) {
  const container = $("toast-container");
  const toast = document.createElement("div");
  const icons = { success: "✅", error: "🚨", warning: "⚠️", info: "ℹ️" };
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <span class="toast-msg">${safeHtml(message)}</span>
    <button class="toast-close" aria-label="Kapat">✕</button>
  `;
  toast.querySelector(".toast-close").addEventListener("click", () => dismissToast(toast));
  container.appendChild(toast);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("toast-show"));
  });
  if (duration > 0) setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  toast.classList.remove("toast-show");
  toast.addEventListener("transitionend", () => toast.remove(), { once: true });
}

// ─── Emoji Listesi ────────────────────────────────────────
const EMOJIS = [
  "😀","😂","🤣","😊","😍","🥰","😘","😁","😎","🤩","🥳","😜",
  "😅","😇","🤔","😴","😤","😭","😱","🤯","🙃","😏","😒","🙄",
  "😔","😢","😡","🥺","😳","🤗","😌","😋","🤤","🤭","🤫","🤥",
  "🤑","😈","👿","💀","☠️","👻","🤖","💩","👋","🤚","🖐","✋",
  "🤙","💪","🦾","✌️","🤞","🖖","🤟","🤘","👍","👎","🙌","👏",
  "🤝","🙏","✍️","💅","❤️","🧡","💛","💚","💙","💜","🖤","🤍",
  "🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","🔥",
  "⭐","✨","💫","💥","🎉","🎊","🎈","🎁","🎂","🍕","🍔","🍟",
  "🌮","🍜","🍣","🍦","🧁","🍩","☕","🧃","🚗","✈️","🌈","🌺",
  "🌸","🌼","🌻","🍀","🌴","🦋","🐶","🐱","🐭","🐸","🦊","🐺",
  "🦁","🐯","🐮","🦄","🐙","🦑","🦈","🐬","🎮","📱","💻","🎵",
];

let filteredEmojis = [...EMOJIS];

// ─── SVG Tik İkonları ─────────────────────────────────────
function tickSVG(status) {
  const color = status === "read" ? "#53bdeb" : "#8696a0";
  if (status === "sent") {
    return `<svg class="tick-icon" width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path d="M1.5 5.5L5.5 9.5L14.5 1.5" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
  }
  return `<svg class="tick-icon" width="20" height="11" viewBox="0 0 20 11" fill="none">
    <path d="M1.5 5.5L5.5 9.5L14.5 1.5" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6.5 5.5L10.5 9.5L19.5 1.5" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function getTickStatus(msg) {
  if (msg.readBy?.includes(state.selectedUid)) return "read";
  if (msg.status === "read") return "read";
  if (msg.status === "delivered") return "delivered";
  if (state.selectedProfile?.online === true) return "delivered";
  return "sent";
}

// ─── Firebase Kurulum Hatası Banner ───────────────────────
function showFirebaseError() {
  let banner = document.getElementById("firebase-error-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "firebase-error-banner";
    banner.style.cssText = [
      "position:fixed","top:0","left:0","right:0","z-index:9999",
      "background:#dc2626","color:#fff","padding:12px 20px",
      "font-size:13px","line-height:1.5","text-align:center",
      "box-shadow:0 2px 8px rgba(0,0,0,.3)"
    ].join(";");
    banner.innerHTML = `
      <strong>⚠️ Firestore izin hatası</strong> — Firebase Console'da Firestore güvenlik kurallarını ayarla:<br>
      <code style="font-size:11px;background:rgba(0,0,0,.3);padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px">
        allow read, write: if request.auth != null;
      </code>
      <button onclick="this.parentElement.remove()" style="margin-left:12px;background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px">✕ Kapat</button>
    `;
    document.body.prepend(banner);
  }
}

function hideFirebaseError() {
  document.getElementById("firebase-error-banner")?.remove();
}

// ─── Tema ─────────────────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("cf-theme", theme);
  el.sunIcon.classList.toggle("hidden", theme === "light");
  el.moonIcon.classList.toggle("hidden", theme === "dark");
}

el.themeToggle.addEventListener("click", () =>
  applyTheme(state.theme === "light" ? "dark" : "light")
);

// ─── Ghost session koruması ───────────────────────────────
// online:true olsa bile lastSeen 10+ dakika eskiyse offline say
const STALE_MS = 10 * 60 * 1000;
function isActuallyOnline(user) {
  if (!user?.online) return false;
  if (!user.lastSeen) return false;
  const ts = user.lastSeen.toMillis ? user.lastSeen.toMillis() : Number(user.lastSeen);
  return (Date.now() - ts) < STALE_MS;
}

// ─── Avatar rengi ─────────────────────────────────────────
function getAvatarColor(name) {
  const colors = ["#6366f1","#8b5cf6","#ec4899","#f43f5e","#f97316",
                  "#eab308","#22c55e","#14b8a6","#3b82f6","#06b6d4"];
  let h = 0;
  for (const c of (name || "?")) h = c.charCodeAt(0) + ((h << 5) - h);
  return colors[Math.abs(h) % colors.length];
}

function updateMyAvatar(profile) {
  const name = profile?.username || "?";
  const color = getAvatarColor(name);
  el.myAvatar.style.background = color;
  if (profile?.photoURL) {
    el.myAvatar.innerHTML = `<img src="${safeHtml(profile.photoURL)}" alt="${safeHtml(name)}" class="avatar-photo" />`;
  } else {
    el.myAvatar.textContent = name[0].toUpperCase();
  }
}

function updatePartnerAvatar(profile) {
  const name = profile?.username || "?";
  const color = getAvatarColor(name);
  el.partnerAvatar.style.background = color;
  if (profile?.photoURL) {
    el.partnerAvatar.innerHTML = `<img src="${safeHtml(profile.photoURL)}" alt="${safeHtml(name)}" class="avatar-photo" />`;
  } else {
    el.partnerAvatar.textContent = name[0].toUpperCase();
  }
}

// ─── Güvenli HTML ─────────────────────────────────────────
function safeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Zaman Formatı ────────────────────────────────────────
function formatTime(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

// ─── Süre Formatı (saniye → m:ss) ─────────────────────────
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ─── Auth form yardımcıları ───────────────────────────────
function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.querySelector("span").style.opacity = loading ? "0" : "1";
  btn.querySelector(".btn-spinner").classList.toggle("hidden", !loading);
}

function showError(elem, msg) {
  elem.textContent = msg;
  elem.style.display = msg ? "block" : "none";
}

// ─── Auth sekme geçişi ────────────────────────────────────
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach((f) => f.classList.remove("active"));
    tab.classList.add("active");
    $(`${target}-form`).classList.add("active");
    showError(el.loginError, "");
    showError(el.registerError, "");
  });
});

document.querySelectorAll(".show-pass").forEach((btn) => {
  btn.addEventListener("click", () => {
    const inp = $(btn.dataset.target);
    inp.type = inp.type === "password" ? "text" : "password";
    btn.textContent = inp.type === "password" ? "👁" : "🙈";
  });
});

// ─── Giriş ────────────────────────────────────────────────
el.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(el.loginError, "");
  setLoading(el.loginBtn, true);
  try {
    await loginUser(el.loginUsername.value, el.loginPassword.value);
  } catch (err) {
    let msg = "Giriş başarısız";
    if (err.code === "firestore-rules")
      msg = "⚠️ Firestore kuralları ayarlanmamış. Firebase Console → Firestore → Rules";
    else if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found")
      msg = "Kullanıcı adı veya şifre hatalı";
    else if (err.code === "auth/too-many-requests")
      msg = "Çok fazla deneme. Lütfen bekle.";
    else if (err.message) msg = err.message;
    showError(el.loginError, msg);
    setLoading(el.loginBtn, false);
  }
});

// ─── Kayıt ────────────────────────────────────────────────
el.registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(el.registerError, "");
  setLoading(el.registerBtn, true);
  try {
    await registerUser(el.regUsername.value, el.regPassword.value);
  } catch (err) {
    let msg = "Kayıt başarısız";
    if (err.code === "firestore-rules")
      msg = "⚠️ Firestore kuralları ayarlanmamış. Firebase Console → Firestore → Rules";
    else if (err.code === "auth/email-already-in-use")
      msg = "Bu kullanıcı adı zaten alınmış";
    else if (err.code === "auth/weak-password")
      msg = "Şifre en az 6 karakter olmalı";
    else if (err.message) msg = err.message;
    showError(el.registerError, msg);
    setLoading(el.registerBtn, false);
  }
});

// ─── Çıkış ────────────────────────────────────────────────
el.logoutBtn.addEventListener("click", async () => {
  await logoutUser(state.currentUser?.uid);
});

// ─── Profil fotoğrafı yükleme ─────────────────────────────
el.myAvatarWrap.addEventListener("click", () => {
  if (state.currentUser) el.photoUpload.click();
});

el.photoUpload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file || !state.currentUser) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast("Fotoğraf 5MB'dan küçük olmalı", "warning");
    return;
  }
  el.photoLoading.classList.remove("hidden");
  try {
    const url = await withTimeout(uploadProfilePhoto(state.currentUser.uid, file));
    if (state.currentProfile) {
      state.currentProfile.photoURL = url;
      updateMyAvatar(state.currentProfile);
    }
    showToast("Profil fotoğrafı güncellendi!", "success");
  } catch (err) {
    showToast("Profil fotoğrafı yüklenemedi: " + (err.message || "Hata"), "error", 6000);
  } finally {
    el.photoLoading.classList.add("hidden");
    el.photoUpload.value = "";
  }
});

// ─── Chat Fotoğrafı Seçme ─────────────────────────────────
el.photoChatBtn.addEventListener("click", () => {
  if (!state.convId) {
    showToast("Önce bir kullanıcı seçin.", "warning");
    return;
  }
  el.photoChatUpload.click();
});

el.photoChatUpload.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("Fotoğraf 10MB'dan küçük olmalı", "warning");
    el.photoChatUpload.value = "";
    return;
  }
  state.pendingImageFile = file;
  const objectURL = URL.createObjectURL(file);
  state.pendingImageURL = objectURL;
  el.imagePreviewThumb.src = objectURL;
  el.imagePreviewName.textContent = file.name;
  el.imagePreviewBar.classList.remove("hidden");
  el.photoChatUpload.value = "";
});

el.imagePreviewCancel.addEventListener("click", () => {
  clearPendingImage();
});

function clearPendingImage() {
  if (state.pendingImageURL) URL.revokeObjectURL(state.pendingImageURL);
  state.pendingImageFile = null;
  state.pendingImageURL = null;
  el.imagePreviewBar.classList.add("hidden");
  el.imagePreviewThumb.src = "";
  el.imagePreviewName.textContent = "";
}

// ─── PUSH-TO-TALK MİKROFON ────────────────────────────────

function getSupportedMimeType() {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
    "audio/mp4",
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function startVoiceRecording() {
  if (!state.convId) {
    showToast("Önce bir kullanıcı seçin", "warning");
    return;
  }
  if (voiceRec.isRecording) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceRec.chunks = [];
    voiceRec.startTime = Date.now();
    voiceRec.isRecording = true;
    voiceRec.cancelled = false;
    voiceRec.mimeType = getSupportedMimeType();

    voiceRec.mediaRecorder = new MediaRecorder(
      stream,
      voiceRec.mimeType ? { mimeType: voiceRec.mimeType } : {}
    );

    voiceRec.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) voiceRec.chunks.push(e.data);
    };

    voiceRec.mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());

      if (voiceRec.cancelled) return;

      const duration = Math.round((Date.now() - voiceRec.startTime) / 1000);
      if (duration < 1) {
        showToast("Çok kısa! En az 1 saniye konuşun.", "warning");
        return;
      }

      const mimeType = voiceRec.mimeType || "audio/webm";
      const blob = new Blob(voiceRec.chunks, { type: mimeType });

      try {
        showToast("Ses mesajı gönderiliyor...", "info", 3000);
        const url = await withTimeout(
          uploadVoiceMessage(state.convId, state.currentUser.uid, blob, mimeType)
        );
        await sendVoiceMessage(state.convId, state.currentUser.uid, url, duration);
        showToast("Ses mesajı gönderildi ✓", "success", 2000);
      } catch (err) {
        showToast(`❌ Ses gönderilemedi: ${err.message || "Hata"}`, "error", 6000);
      }
    };

    voiceRec.mediaRecorder.start(100);

    el.micBtn.classList.add("recording");
    el.recordingIndicator.classList.remove("hidden");
    el.recordingTimer.textContent = "0:00";

    let secs = 0;
    voiceRec.timer = setInterval(() => {
      secs++;
      el.recordingTimer.textContent = formatDuration(secs);
      if (secs >= 120) stopVoiceRecording();
    }, 1000);

  } catch (err) {
    voiceRec.isRecording = false;
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      showToast("Mikrofon izni reddedildi. Tarayıcı ayarlarından izin verin.", "error", 6000);
    } else if (err.name === "NotFoundError") {
      showToast("Mikrofon bulunamadı. Cihazınıza bir mikrofon bağlayın.", "error");
    } else {
      showToast("Mikrofon erişilemedi: " + err.message, "error");
    }
  }
}

function stopVoiceRecording() {
  if (!voiceRec.isRecording) return;
  voiceRec.isRecording = false;
  clearInterval(voiceRec.timer);

  if (voiceRec.mediaRecorder && voiceRec.mediaRecorder.state !== "inactive") {
    voiceRec.mediaRecorder.stop();
  }

  el.micBtn.classList.remove("recording");
  el.recordingIndicator.classList.add("hidden");
  el.recordingTimer.textContent = "0:00";
}

function cancelVoiceRecording() {
  voiceRec.cancelled = true;
  stopVoiceRecording();
  showToast("Ses kaydı iptal edildi", "info", 2000);
}

// Mouse olayları (masaüstü)
el.micBtn.addEventListener("mousedown", (e) => {
  e.preventDefault();
  startVoiceRecording();
});
el.micBtn.addEventListener("mouseup", stopVoiceRecording);
el.micBtn.addEventListener("mouseleave", () => {
  if (voiceRec.isRecording) cancelVoiceRecording();
});

// Dokunma olayları (mobil)
el.micBtn.addEventListener("touchstart", (e) => {
  e.preventDefault();
  startVoiceRecording();
}, { passive: false });
el.micBtn.addEventListener("touchend", (e) => {
  e.preventDefault();
  stopVoiceRecording();
}, { passive: false });
el.micBtn.addEventListener("touchcancel", () => {
  if (voiceRec.isRecording) cancelVoiceRecording();
});

el.cancelRecordingBtn.addEventListener("click", cancelVoiceRecording);

// ─── Kullanıcı arama ─────────────────────────────────────
el.userSearch.addEventListener("input", renderUserList);

// ─── Kullanıcı listesi render ─────────────────────────────
function renderUserList() {
  const q = el.userSearch.value.toLowerCase();
  const filtered = state.users.filter(
    (u) =>
      u.uid !== state.currentUser?.uid &&
      (u.username?.toLowerCase().includes(q) ||
        u.displayName?.toLowerCase().includes(q))
  );

  if (filtered.length === 0) {
    el.userList.innerHTML = `<div class="no-users">Kullanıcı bulunamadı</div>`;
    return;
  }

  el.userList.innerHTML = filtered
    .filter((u) => !state.blockedUsers.includes(u.uid))
    .sort((a, b) => (isActuallyOnline(b) ? 1 : 0) - (isActuallyOnline(a) ? 1 : 0))
    .map((u) => {
      const isActive = u.uid === state.selectedUid;
      const color = getAvatarColor(u.username);
      const initial = (u.username || "?")[0].toUpperCase();
      const online = isActuallyOnline(u);
      const statusText = online
        ? `<span class="status-dot online"></span> Çevrimiçi`
        : formatLastSeen(u.lastSeen);
      const unread = state.unreadCounts[u.uid] || 0;
      const unreadBadge = unread > 0 ? `<span class="unread-badge">${unread > 99 ? "99+" : unread}</span>` : "";
      const hasStory = state.statuses.some((s) => s.uid === u.uid);

      return `
        <div class="user-item ${isActive ? "active" : ""}" data-uid="${safeHtml(u.uid)}">
          <div class="avatar" style="background:${color};flex-shrink:0${hasStory ? ";box-shadow:0 0 0 2.5px #ec4899,0 0 0 4px var(--surface)" : ""}">
            ${u.photoURL ? `<img src="${safeHtml(u.photoURL)}" class="avatar-photo" alt="${safeHtml(u.username)}" />` : initial}
            <span class="presence-dot ${online ? "online" : "offline"}"></span>
          </div>
          <div class="user-info">
            <div class="user-badge-row">
              <span class="user-name">${safeHtml(u.displayName || u.username)}</span>
              ${unreadBadge}
            </div>
            <span class="user-status">${statusText}</span>
          </div>
        </div>
      `;
    })
    .join("");

  el.userList.querySelectorAll(".user-item").forEach((item) => {
    item.addEventListener("click", () => selectUser(item.dataset.uid));
  });
}

// ─── Kullanıcı seç ────────────────────────────────────────
async function selectUser(uid) {
  if (uid === state.selectedUid) return;
  cleanupConversation();
  state.selectedUid = uid;
  state.convId = getConvId(state.currentUser.uid, uid);

  const profile = state.users.find((u) => u.uid === uid);
  state.selectedProfile = profile;

  document.querySelector(".sidebar").classList.add("mobile-hidden");
  el.emptyState.classList.add("hidden");
  el.chatView.classList.remove("hidden");
  el.messageInput.disabled = false;

  updatePartnerAvatar(profile);
  el.partnerName.innerHTML = safeHtml(profile?.displayName || profile?.username || uid);
  updatePartnerStatus(profile);

  el.messages.innerHTML = `<div class="messages-loading">Yükleniyor...</div>`;
  renderUserList();

  state.unsubMessages = subscribeMessages(
    state.convId,
    (msgs) => {
      state.messages = msgs;
      renderMessages(msgs);
      markRead(state.convId, state.currentUser.uid).catch(() => {});
      markDelivered(state.convId, state.currentUser.uid).catch(() => {});
    },
    (err) => {
      if (err.code === "permission-denied") showFirebaseError();
    }
  );

  state.unsubTyping = subscribeTyping(
    state.convId,
    state.currentUser.uid,
    (typers) => {
      if (typers.length > 0) {
        const typer = state.users.find((u) => u.uid === typers[0]);
        el.typingText.textContent = `${typer?.displayName || "Birisi"} yazıyor`;
        el.typingIndicator.classList.remove("hidden");
      } else {
        el.typingIndicator.classList.add("hidden");
      }
    }
  );
}

function updatePartnerStatus(profile) {
  if (!profile) return;
  if (isActuallyOnline(profile)) {
    el.partnerStatus.innerHTML = `<span class="status-dot online"></span> Çevrimiçi`;
  } else {
    el.partnerStatus.textContent = `Son görülme: ${formatLastSeen(profile.lastSeen)}`;
  }
}

// ─── Konuşma temizle ─────────────────────────────────────
function cleanupConversation() {
  if (state.unsubMessages) { state.unsubMessages(); state.unsubMessages = null; }
  if (state.unsubTyping) { state.unsubTyping(); state.unsubTyping = null; }
  if (state.typingTimer) { clearTimeout(state.typingTimer); state.typingTimer = null; }
  if (state.isTyping && state.convId) {
    setTyping(state.convId, state.currentUser?.uid, false);
    state.isTyping = false;
  }
  clearPendingImage();
}

// ─── Reactions HTML builder ───────────────────────────────
function buildReactionsHtml(reactions, myUid, msgId) {
  if (!reactions) return "";
  const chips = Object.entries(reactions)
    .filter(([, users]) => users?.length > 0)
    .map(([emoji, users]) => {
      const isMine = users.includes(myUid);
      return `<button class="reaction-chip${isMine ? " mine" : ""}" data-msgid="${safeHtml(msgId)}" data-emoji="${safeHtml(emoji)}">${emoji}<span class="react-count">${users.length}</span></button>`;
    });
  return chips.length ? `<div class="reactions-row">${chips.join("")}</div>` : "";
}

// ─── Mesajları render et ──────────────────────────────────
function renderMessages(msgs) {
  if (msgs.length === 0) {
    el.messages.innerHTML = `<div class="no-messages">Henüz mesaj yok. Bir şeyler yaz!</div>`;
    return;
  }

  let html = "";
  let prevDate = null;
  let prevSender = null;

  msgs.forEach((msg) => {
    const isMine = msg.senderId === state.currentUser?.uid;
    const ts = msg.timestamp;
    const msgDate = ts?.toDate?.() || new Date();
    const dateStr = msgDate.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });

    if (dateStr !== prevDate) {
      html += `<div class="date-divider"><span>${dateStr}</span></div>`;
      prevDate = dateStr;
      prevSender = null;
    }

    const consecutive = prevSender === msg.senderId;
    prevSender = msg.senderId;

    let tickHtml = "";
    if (isMine) {
      const tickStatus = getTickStatus(msg);
      tickHtml = `<span class="tick-wrap">${tickSVG(tickStatus)}</span>`;
    }

    const reactHtml = buildReactionsHtml(msg.reactions, state.currentUser?.uid, msg.id);

    if (msg.type === "voice" && msg.audioURL) {
      const dur = msg.duration ? formatDuration(msg.duration) : "0:00";
      html += `
        <div class="message-wrapper ${isMine ? "mine" : "theirs"} ${consecutive ? "consecutive" : ""}" data-msgid="${safeHtml(msg.id)}">
          <div class="bubble bubble-voice">
            <div class="voice-player" data-src="${safeHtml(msg.audioURL)}" data-dur="${msg.duration || 0}">
              <button class="vp-play" type="button" aria-label="Oynat">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
              </button>
              <div class="vp-track"><div class="vp-fill"></div></div>
              <span class="vp-time">0:00 / ${dur}</span>
            </div>
            <span class="bubble-meta">${formatTime(ts)}${tickHtml}</span>
          </div>
          ${reactHtml}
        </div>
      `;
    } else if (msg.type === "image" && msg.imageURL) {
      const caption = msg.text ? `<span class="bubble-text image-caption">${safeHtml(msg.text).replace(/\n/g, "<br>")}</span>` : "";
      html += `
        <div class="message-wrapper ${isMine ? "mine" : "theirs"} ${consecutive ? "consecutive" : ""}" data-msgid="${safeHtml(msg.id)}">
          <div class="bubble bubble-image">
            <img src="${safeHtml(msg.imageURL)}" class="chat-image" data-lightbox="1" alt="Fotoğraf" loading="lazy" />
            ${caption}
            <span class="bubble-meta">${formatTime(ts)}${tickHtml}</span>
          </div>
          ${reactHtml}
        </div>
      `;
    } else {
      html += `
        <div class="message-wrapper ${isMine ? "mine" : "theirs"} ${consecutive ? "consecutive" : ""}" data-msgid="${safeHtml(msg.id)}">
          <div class="bubble">
            <span class="bubble-text">${safeHtml(msg.text || "").replace(/\n/g, "<br>")}</span>
            <span class="bubble-meta">${formatTime(ts)}${tickHtml}</span>
          </div>
          ${reactHtml}
        </div>
      `;
    }
  });

  el.messages.innerHTML = html;
  el.messages.scrollTop = el.messages.scrollHeight;
  initVoicePlayers();
  initLongPress();
}

// ─── Özel Ses Oynatıcı ────────────────────────────────────
let _vpCurrentAudio = null;
let _vpCurrentPlayer = null;

const PLAY_SVG  = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>`;
const PAUSE_SVG = `<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;

function fmtT(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function resetVpPlayer(player, totalDur) {
  const btn  = player.querySelector(".vp-play");
  const fill = player.querySelector(".vp-fill");
  const time = player.querySelector(".vp-time");
  if (btn)  btn.innerHTML = PLAY_SVG;
  if (fill) fill.style.width = "0%";
  if (time) time.textContent = `0:00 / ${fmtT(totalDur)}`;
}

function initVoicePlayers() {
  el.messages.querySelectorAll(".voice-player").forEach((player) => {
    const src      = player.dataset.src;
    const totalDur = parseFloat(player.dataset.dur) || 0;
    const btn      = player.querySelector(".vp-play");
    const fill     = player.querySelector(".vp-fill");
    const time     = player.querySelector(".vp-time");
    const track    = player.querySelector(".vp-track");
    let audio      = null;

    function stopOther() {
      if (_vpCurrentAudio && _vpCurrentAudio !== audio) {
        _vpCurrentAudio.pause();
        if (_vpCurrentPlayer) resetVpPlayer(_vpCurrentPlayer, parseFloat(_vpCurrentPlayer.dataset.dur) || 0);
        _vpCurrentAudio = null;
        _vpCurrentPlayer = null;
      }
    }

    function onTimeUpdate() {
      const dur = isFinite(audio.duration) ? audio.duration : totalDur;
      if (dur > 0) {
        fill.style.width = `${(audio.currentTime / dur) * 100}%`;
        time.textContent = `${fmtT(audio.currentTime)} / ${fmtT(dur)}`;
      }
    }

    function onEnded() {
      resetVpPlayer(player, totalDur);
      audio = null;
      _vpCurrentAudio = null;
      _vpCurrentPlayer = null;
    }

    btn.addEventListener("click", () => {
      if (!audio) {
        stopOther();
        audio = new Audio(src);
        audio.addEventListener("timeupdate", onTimeUpdate);
        audio.addEventListener("ended", onEnded);
        audio.addEventListener("error", () => { resetVpPlayer(player, totalDur); audio = null; });
        _vpCurrentAudio   = audio;
        _vpCurrentPlayer  = player;
        audio.play().then(() => { btn.innerHTML = PAUSE_SVG; }).catch(() => { resetVpPlayer(player, totalDur); audio = null; });
      } else if (audio.paused) {
        stopOther();
        _vpCurrentAudio  = audio;
        _vpCurrentPlayer = player;
        audio.play().then(() => { btn.innerHTML = PAUSE_SVG; });
      } else {
        audio.pause();
        btn.innerHTML = PLAY_SVG;
        _vpCurrentAudio  = null;
        _vpCurrentPlayer = null;
      }
    });

    track.addEventListener("click", (e) => {
      if (!audio) return;
      const rect = track.getBoundingClientRect();
      const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const dur  = isFinite(audio.duration) ? audio.duration : totalDur;
      audio.currentTime = pct * dur;
    });
  });
}

// ─── Fotoğraf Lightbox ────────────────────────────────────
function openLightbox(src) {
  el.lightboxImg.src = src;
  el.lightbox.classList.remove("hidden");
}
function closeLightbox() {
  el.lightbox.classList.add("hidden");
  el.lightboxImg.src = "";
}
el.lightboxClose.addEventListener("click", closeLightbox);
el.lightbox.addEventListener("click", (e) => { if (e.target === el.lightbox) closeLightbox(); });

el.messages.addEventListener("click", (e) => {
  const img = e.target.closest(".chat-image[data-lightbox]");
  if (img) openLightbox(img.src);
});

// ─── Mesaj gönder (metin + fotoğraf) ─────────────────────
async function handleSend() {
  if (!state.convId) return;

  if (state.pendingImageFile) {
    const file = state.pendingImageFile;
    const caption = el.messageInput.value.trim();
    clearPendingImage();
    el.messageInput.value = "";
    el.messageInput.style.height = "auto";

    el.photoLoading.classList.remove("hidden");
    try {
      const url = await withTimeout(uploadChatPhoto(state.convId, state.currentUser.uid, file));
      await sendImageMessage(state.convId, state.currentUser.uid, url, caption);
    } catch (err) {
      showToast(`❌ Fotoğraf gönderilemedi: ${err.message || "Hata"}`, "error", 6000);
    } finally {
      el.photoLoading.classList.add("hidden");
    }
    return;
  }

  const text = el.messageInput.value.trim();
  if (!text) return;

  el.messageInput.value = "";
  el.messageInput.style.height = "auto";
  closeEmojiPicker();

  if (state.isTyping) {
    state.isTyping = false;
    await setTyping(state.convId, state.currentUser.uid, false);
  }

  try {
    await sendMessage(state.convId, state.currentUser.uid, text);
  } catch (err) {
    showToast("Mesaj gönderilemedi. Bağlantınızı kontrol edin.", "error");
  }
}

el.sendBtn.addEventListener("click", handleSend);
el.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// ─── Textarea auto-resize + typing ───────────────────────
el.messageInput.addEventListener("input", () => {
  el.messageInput.style.height = "auto";
  el.messageInput.style.height = Math.min(el.messageInput.scrollHeight, 120) + "px";

  if (!state.convId) return;
  if (!state.isTyping) {
    state.isTyping = true;
    setTyping(state.convId, state.currentUser.uid, true);
  }
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    state.isTyping = false;
    setTyping(state.convId, state.currentUser.uid, false);
  }, 3000);
});

// ─── Emoji picker ─────────────────────────────────────────
function renderEmojiGrid(list) {
  el.emojiGrid.innerHTML = list
    .map((e) => `<button class="emoji-item" type="button">${e}</button>`)
    .join("");
  el.emojiGrid.querySelectorAll(".emoji-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pos = el.messageInput.selectionStart ?? el.messageInput.value.length;
      el.messageInput.value =
        el.messageInput.value.slice(0, pos) +
        btn.textContent +
        el.messageInput.value.slice(pos);
      el.messageInput.focus();
    });
  });
}

function openEmojiPicker() {
  filteredEmojis = [...EMOJIS];
  renderEmojiGrid(filteredEmojis);
  el.emojiPicker.classList.remove("hidden");
  el.emojiSearch.value = "";
  el.emojiSearch.focus();
}

function closeEmojiPicker() {
  el.emojiPicker.classList.add("hidden");
}

el.emojiBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  el.emojiPicker.classList.contains("hidden") ? openEmojiPicker() : closeEmojiPicker();
});

el.emojiSearch.addEventListener("input", () => {
  const q = el.emojiSearch.value;
  filteredEmojis = q ? EMOJIS.filter((e) => e.includes(q)) : [...EMOJIS];
  renderEmojiGrid(filteredEmojis);
});

document.addEventListener("click", (e) => {
  if (!el.emojiPicker.contains(e.target) && e.target !== el.emojiBtn) {
    closeEmojiPicker();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeEmojiPicker();
    el.photoLoading.classList.add("hidden");
  }
});

el.photoLoading.addEventListener("click", () => {
  el.photoLoading.classList.add("hidden");
});

// ─── Geri (mobil) ─────────────────────────────────────────
el.backBtn.addEventListener("click", () => {
  el.chatView.classList.add("hidden");
  el.emptyState.classList.remove("hidden");
  document.querySelector(".sidebar").classList.remove("mobile-hidden");
  state.selectedUid = null;
  cleanupConversation();
});

// ─── Sesli arama (placeholder) ────────────────────────────
el.voiceCallBtn.addEventListener("click", () => {
  if (!state.selectedProfile) return;
  updatePartnerAvatar(state.selectedProfile);
  el.callName.textContent = state.selectedProfile.displayName || state.selectedProfile.username;
  el.voiceModal.classList.remove("hidden");
});
el.endCallBtn.addEventListener("click", () => el.voiceModal.classList.add("hidden"));
el.muteBtn.addEventListener("click", () => el.muteBtn.classList.toggle("muted"));

// ─── Long Press → Reaction Picker ────────────────────────
let _lpTimer = null;
let _lpMsgId = null;

function initLongPress() {
  el.messages.querySelectorAll(".bubble").forEach((bubble) => {
    const wrapper = bubble.closest(".message-wrapper");
    const msgId = wrapper?.dataset?.msgid;
    if (!msgId) return;

    const onStart = () => {
      _lpMsgId = msgId;
      _lpTimer = setTimeout(() => {
        showReactPicker(bubble);
      }, 500);
    };
    const onEnd = () => clearTimeout(_lpTimer);

    bubble.addEventListener("touchstart", onStart, { passive: true });
    bubble.addEventListener("touchend", onEnd, { passive: true });
    bubble.addEventListener("touchmove", onEnd, { passive: true });
    bubble.addEventListener("mousedown", onStart);
    bubble.addEventListener("mouseup", onEnd);
    bubble.addEventListener("mouseleave", onEnd);
  });
}

function showReactPicker(bubble) {
  const rect = bubble.getBoundingClientRect();
  el.reactPicker.classList.remove("hidden");
  const pickerW = el.reactPicker.offsetWidth || 260;
  let left = rect.left + rect.width / 2 - pickerW / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - pickerW - 8));
  const top = rect.top > 80 ? rect.top - 56 : rect.bottom + 8;
  el.reactPicker.style.left = left + "px";
  el.reactPicker.style.top = top + "px";
}

el.reactPicker.querySelectorAll(".react-emoji").forEach((btn) => {
  btn.addEventListener("click", async () => {
    el.reactPicker.classList.add("hidden");
    if (!_lpMsgId || !state.convId || !state.currentUser) return;
    try {
      await addReaction(state.convId, _lpMsgId, state.currentUser.uid, btn.dataset.emoji);
    } catch (err) {
      showToast("Tepki eklenemedi", "error");
    }
    _lpMsgId = null;
  });
});

el.messages.addEventListener("click", async (e) => {
  const chip = e.target.closest(".reaction-chip");
  if (!chip || !state.convId || !state.currentUser) return;
  try {
    await addReaction(state.convId, chip.dataset.msgid, state.currentUser.uid, chip.dataset.emoji);
  } catch (_) {}
});

document.addEventListener("click", (e) => {
  if (!el.reactPicker.classList.contains("hidden") &&
      !el.reactPicker.contains(e.target) &&
      !e.target.closest(".bubble")) {
    el.reactPicker.classList.add("hidden");
    _lpMsgId = null;
  }
});

// ─── Story / Durum ────────────────────────────────────────
let _storyTimer = null;
const STORY_DURATION = 6000;

function renderStoryRow() {
  const myUid = state.currentUser?.uid;
  const myStatus = state.statuses.find((s) => s.uid === myUid);
  const others = state.statuses.filter((s) => s.uid !== myUid && !state.blockedUsers.includes(s.uid));

  let html = `
    <div class="story-item" id="my-story-item">
      <div class="story-ring ${myStatus ? "" : "mine-ring"}">
        ${myStatus
          ? `<div class="story-ring-inner">${myStatus.type === "image" ? `<img src="${safeHtml(myStatus.content)}" />` : `<span style="font-size:20px">💬</span>`}</div>`
          : `<span class="story-add-icon">+</span>`
        }
      </div>
      <span class="story-label">${myStatus ? "Durumum" : "Ekle"}</span>
    </div>`;

  others.forEach((s) => {
    const user = state.users.find((u) => u.uid === s.uid);
    const name = user?.displayName || user?.username || "Kullanıcı";
    const color = getAvatarColor(user?.username || s.uid);
    const initial = (user?.username || "?")[0].toUpperCase();
    html += `
      <div class="story-item" data-story-uid="${safeHtml(s.uid)}">
        <div class="story-ring">
          <div class="story-ring-inner" style="background:${color}">
            ${user?.photoURL ? `<img src="${safeHtml(user.photoURL)}" />` : initial}
          </div>
        </div>
        <span class="story-label">${safeHtml(name)}</span>
      </div>`;
  });

  el.storyRow.innerHTML = html;
  el.storyRow.style.display = (myStatus || others.length > 0) ? "flex" : "none";

  document.getElementById("my-story-item")?.addEventListener("click", () => {
    if (myStatus) openStoryViewer(myStatus, state.currentProfile);
    else openStoryCreator();
  });

  el.storyRow.querySelectorAll("[data-story-uid]").forEach((item) => {
    item.addEventListener("click", () => {
      const uid = item.dataset.storyUid;
      const s = state.statuses.find((st) => st.uid === uid);
      const user = state.users.find((u) => u.uid === uid);
      if (s) openStoryViewer(s, user);
    });
  });
}

function openStoryViewer(status, user) {
  clearTimeout(_storyTimer);
  const name = user?.displayName || user?.username || "Kullanıcı";
  const color = getAvatarColor(user?.username || status.uid);
  const initial = (user?.username || "?")[0].toUpperCase();
  el.svUserInfo.innerHTML = `
    <div class="avatar" style="background:${color};width:34px;height:34px;font-size:14px;border-radius:50%">
      ${user?.photoURL ? `<img src="${safeHtml(user.photoURL)}" class="avatar-photo" />` : initial}
    </div>
    <span>${safeHtml(name)}</span>`;

  if (status.type === "image") {
    el.svContent.innerHTML = `<img src="${safeHtml(status.content)}" alt="Durum" />`;
  } else {
    el.svContent.innerHTML = `<div class="sv-text">${safeHtml(status.content || "")}</div>`;
  }

  el.svProgressFill.style.transition = "none";
  el.svProgressFill.style.width = "0%";
  el.storyViewer.classList.remove("hidden");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.svProgressFill.style.transition = `width ${STORY_DURATION}ms linear`;
      el.svProgressFill.style.width = "100%";
    });
  });

  _storyTimer = setTimeout(() => el.storyViewer.classList.add("hidden"), STORY_DURATION);
}

el.svClose.addEventListener("click", () => {
  clearTimeout(_storyTimer);
  el.storyViewer.classList.add("hidden");
});

function openStoryCreator() {
  el.scTextInput.value = "";
  el.scImagePreview.classList.add("hidden");
  el.scImagePreview.src = "";
  state.storyPendingImage = null;
  el.storyCreator.classList.remove("hidden");
  el.scTextInput.focus();
}

el.scClose.addEventListener("click", () => el.storyCreator.classList.add("hidden"));

el.storyCreator.querySelectorAll(".sc-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    el.storyCreator.querySelectorAll(".sc-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const type = tab.dataset.type;
    document.getElementById("sc-text-area").classList.toggle("hidden", type !== "text");
    document.getElementById("sc-image-area").classList.toggle("hidden", type !== "image");
  });
});

el.scImagePick.addEventListener("click", () => el.scImageInput.click());
el.scImageInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  el.scImageInput.value = "";
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 800, maxH = 800;
          let w = img.width, h = img.height;
          if (w > maxW || h > maxH) {
            const r = Math.min(maxW / w, maxH / h);
            w = Math.round(w * r); h = Math.round(h * r);
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.7));
        };
        img.onerror = reject;
        img.src = ev.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    state.storyPendingImage = dataUrl;
    el.scImagePreview.src = dataUrl;
    el.scImagePreview.classList.remove("hidden");
  } catch (err) {
    showToast("Fotoğraf yüklenemedi", "error");
  }
});

el.scPostBtn.addEventListener("click", async () => {
  if (!state.currentUser) return;
  const activeTab = el.storyCreator.querySelector(".sc-tab.active")?.dataset?.type || "text";
  let content = "";
  if (activeTab === "text") {
    content = el.scTextInput.value.trim();
    if (!content) { showToast("Bir şeyler yaz!", "warning"); return; }
  } else {
    if (!state.storyPendingImage) { showToast("Önce fotoğraf seç", "warning"); return; }
    content = state.storyPendingImage;
  }
  try {
    await postStatus(state.currentUser.uid, activeTab, content);
    el.storyCreator.classList.add("hidden");
    showToast("Durum paylaşıldı! 24 saat sonra kaybolacak 🌟", "success");
  } catch (err) {
    showToast("Durum paylaşılamadı", "error");
  }
});

// ─── Kullanıcı Engelleme ──────────────────────────────────
el.blockUserBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!state.selectedUid) return;
  const isBlocked = state.blockedUsers.includes(state.selectedUid);
  el.optionsBlockBtn.style.display = isBlocked ? "none" : "block";
  el.optionsUnblockBtn.style.display = isBlocked ? "block" : "none";
  const rect = el.blockUserBtn.getBoundingClientRect();
  el.optionsMenu.style.top = (rect.bottom + 6) + "px";
  el.optionsMenu.style.right = (window.innerWidth - rect.right) + "px";
  el.optionsMenu.classList.toggle("hidden");
});

document.addEventListener("click", (e) => {
  if (!el.optionsMenu.contains(e.target) && e.target !== el.blockUserBtn) {
    el.optionsMenu.classList.add("hidden");
  }
});

el.optionsBlockBtn.addEventListener("click", () => {
  el.optionsMenu.classList.add("hidden");
  if (!state.selectedUid) return;
  const user = state.users.find((u) => u.uid === state.selectedUid);
  const name = user?.displayName || user?.username || "Bu kullanıcı";
  document.getElementById("block-dialog-title").textContent = `${name} Engelleniyor`;
  document.getElementById("block-dialog-desc").textContent = `${name} adlı kullanıcıyı engellemek istediğinden emin misin? Listenden kaybolacak.`;
  el.blockDialog.classList.remove("hidden");
});

el.optionsUnblockBtn.addEventListener("click", async () => {
  el.optionsMenu.classList.add("hidden");
  if (!state.selectedUid || !state.currentUser) return;
  try {
    await unblockUser(state.currentUser.uid, state.selectedUid);
    state.blockedUsers = state.blockedUsers.filter((id) => id !== state.selectedUid);
    renderUserList();
    showToast("Engel kaldırıldı ✅", "success");
  } catch (_) {
    showToast("İşlem başarısız", "error");
  }
});

el.blockCancelBtn.addEventListener("click", () => el.blockDialog.classList.add("hidden"));

el.blockConfirmBtn.addEventListener("click", async () => {
  el.blockDialog.classList.add("hidden");
  if (!state.selectedUid || !state.currentUser) return;
  try {
    await blockUser(state.currentUser.uid, state.selectedUid);
    state.blockedUsers = [...state.blockedUsers, state.selectedUid];
    state.selectedUid = null;
    el.chatView.classList.add("hidden");
    el.emptyState.classList.remove("hidden");
    document.querySelector(".sidebar").classList.remove("mobile-hidden");
    cleanupConversation();
    renderUserList();
    showToast("Kullanıcı engellendi 🚫", "success");
  } catch (_) {
    showToast("İşlem başarısız", "error");
  }
});

// ─── Presence Yönetimi ────────────────────────────────────
let _presenceUid = null;
let _inactivityTimer = null;
const INACTIVITY_MS = 5 * 60 * 1000;

function _goOnline() {
  if (!_presenceUid) return;
  setPresence(_presenceUid, true);
  clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(_goOffline, INACTIVITY_MS);
}

function _goOffline() {
  if (!_presenceUid) return;
  setPresence(_presenceUid, false);
  clearTimeout(_inactivityTimer);
}

function _resetActivity() {
  if (!_presenceUid) return;
  if (_inactivityTimer) clearTimeout(_inactivityTimer);
  _inactivityTimer = setTimeout(_goOffline, INACTIVITY_MS);
  setPresence(_presenceUid, true);
}

function _setupPresence(uid) {
  _presenceUid = uid;
  _goOnline();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      _goOffline();
    } else {
      _goOnline();
    }
  });

  window.addEventListener("beforeunload", () => {
    _presenceUid && setPresence(_presenceUid, false);
  });

  ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"].forEach((ev) => {
    document.addEventListener(ev, _resetActivity, { passive: true });
  });
}

function _teardownPresence() {
  _goOffline();
  clearTimeout(_inactivityTimer);
  _presenceUid = null;
}

// ─── Ana akış: Auth durumu ────────────────────────────────
onAuth(async (user) => {
  if (user) {
    state.currentUser = user;
    _setupPresence(user.uid);

    let profile;
    try {
      profile = await getUser(user.uid);
    } catch (err) {
      profile = null;
    }
    state.currentProfile = profile;
    updateMyAvatar(profile);
    el.myUsername.textContent = profile?.displayName || profile?.username || "";

    try {
      const userDoc = await getUser(user.uid);
      state.blockedUsers = userDoc?.blockedUsers || [];
    } catch (_) {}

    state.unsubUsers = subscribeUsers(
      (users) => {
        hideFirebaseError();
        state.users = users;
        renderUserList();
        renderStoryRow();

        if (state.selectedUid) {
          const partner = users.find((u) => u.uid === state.selectedUid);
          if (partner) {
            state.selectedProfile = partner;
            updatePartnerStatus(partner);
            updatePartnerAvatar(partner);
            if (state.messages.length > 0) renderMessages(state.messages);
          }
        }

        const myProfile = users.find((u) => u.uid === user.uid);
        if (myProfile) {
          state.currentProfile = myProfile;
          updateMyAvatar(myProfile);
        }
      },
      (err) => {
        if (err.code === "permission-denied" || err.code === "PERMISSION_DENIED") {
          showFirebaseError();
        }
      }
    );

    // BUG FIX: subscribeConversations already returns {uid: count} object
    state.unsubConversations = subscribeConversations(user.uid, (counts) => {
      state.unreadCounts = counts;
      renderUserList();
    });

    state.unsubStatuses = subscribeStatuses((statuses) => {
      state.statuses = statuses;
      renderStoryRow();
    });

    el.authScreen.classList.add("hidden");
    el.chatScreen.classList.remove("hidden");
    applyTheme(state.theme);
  } else {
    _teardownPresence();
    state.currentUser = null;
    state.currentProfile = null;
    state.selectedUid = null;
    if (state.unsubUsers) { state.unsubUsers(); state.unsubUsers = null; }
    if (state.unsubConversations) { state.unsubConversations(); state.unsubConversations = null; }
    if (state.unsubStatuses) { state.unsubStatuses(); state.unsubStatuses = null; }
    cleanupConversation();

    el.chatScreen.classList.add("hidden");
    el.authScreen.classList.remove("hidden");
    el.chatView.classList.add("hidden");
    el.emptyState.classList.remove("hidden");
  }
});

applyTheme(state.theme);
