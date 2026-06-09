// ============================================================
// firebase.js — Firebase başlatma ve tüm işlemler
// ============================================================
import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
  limit,
  increment,
  where,
  Timestamp,
} from "firebase/firestore";
// ─── Firebase Yapılandırması ───────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "chatverse-a754a.firebaseapp.com",
  projectId: "chatverse-a754a",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ─── Medya yardımcıları (Storage yok, Firestore'da base64) ─
// Görseli canvas ile sıkıştırıp base64 data URL döndür
async function compressImageToBase64(file, maxPx = 900, quality = 0.72) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Dosya okunamadı"));
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.readAsDataURL(file);
  });

  const img = new Image();
  img.src = dataUrl;
  try {
    await img.decode();
  } catch {
    throw new Error("Görsel decode edilemedi");
  }

  let { naturalWidth: w, naturalHeight: h } = img;
  if (w > maxPx || h > maxPx) {
    const r = Math.min(maxPx / w, maxPx / h);
    w = Math.round(w * r);
    h = Math.round(h * r);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", quality);
  if (!out || out === "data:,") throw new Error("Görsel dönüştürülemedi");
  return out;
}

// Blob'u base64 data URL'e çevir
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── Conversation ID ───────────────────────────────────────
export function getConvId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

// ─── Firestore izin hatası kontrol ────────────────────────
function checkPermission(err) {
  if (err?.code === "permission-denied" || err?.code === "PERMISSION_DENIED") {
    throw Object.assign(new Error("FIRESTORE_RULES"), { code: "firestore-rules" });
  }
  throw err;
}

// ─── Kayıt Ol ─────────────────────────────────────────────
export async function registerUser(username, password) {
  const uname = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(uname)) {
    throw new Error("Kullanıcı adı 3-20 karakter, harf/rakam/_ olmalı");
  }

  const fakeEmail = `${uname}@chatverse.internal`;
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, fakeEmail, password);
  } catch (err) {
    if (err.code === "auth/email-already-in-use") {
      throw new Error("Bu kullanıcı adı zaten alınmış");
    }
    throw err;
  }
  const uid = cred.user.uid;

  try {
    const usernameRef = doc(db, "usernames", uname);
    const snap = await getDoc(usernameRef);
    if (snap.exists()) {
      await cred.user.delete();
      throw new Error("Bu kullanıcı adı zaten alınmış");
    }
    await setDoc(doc(db, "users", uid), {
      uid,
      username: uname,
      displayName: username.trim(),
      online: true,
      lastSeen: serverTimestamp(),
      createdAt: serverTimestamp(),
      photoURL: null,
    });
    await setDoc(usernameRef, { uid });
  } catch (err) {
    checkPermission(err);
  }
  return cred.user;
}

// ─── Giriş Yap ────────────────────────────────────────────
export async function loginUser(username, password) {
  const uname = username.trim().toLowerCase();
  const fakeEmail = `${uname}@chatverse.internal`;
  const cred = await signInWithEmailAndPassword(auth, fakeEmail, password);
  try {
    await updateDoc(doc(db, "users", cred.user.uid), {
      online: true,
      lastSeen: serverTimestamp(),
    });
  } catch (err) {
    checkPermission(err);
  }
  return cred.user;
}

// ─── Presence Güncelle ────────────────────────────────────
export async function setPresence(uid, online) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, "users", uid), {
      online,
      lastSeen: serverTimestamp(),
    });
  } catch (_) { /* sessiz hata */ }
}

// ─── Çıkış Yap ────────────────────────────────────────────
export async function logoutUser(uid) {
  try {
    if (uid) {
      await updateDoc(doc(db, "users", uid), {
        online: false,
        lastSeen: serverTimestamp(),
      });
    }
  } catch (_) { /* çıkışta hata önemli değil */ }
  await signOut(auth);
}

// ─── Kullanıcı Profili Getir ───────────────────────────────
export async function getUser(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// ─── Tüm Kullanıcıları Dinle ───────────────────────────────
export function subscribeUsers(callback, onError) {
  return onSnapshot(
    collection(db, "users"),
    (snap) => { callback(snap.docs.map((d) => d.data())); },
    (err) => {
      console.warn("subscribeUsers hata:", err.code, err.message);
      if (onError) onError(err);
    }
  );
}

// ─── Profil Fotoğrafı Yükle (base64 → Firestore) ──────────
export async function uploadProfilePhoto(uid, file) {
  const dataUrl = await compressImageToBase64(file, 300, 0.8);
  await updateDoc(doc(db, "users", uid), { photoURL: dataUrl });
  return dataUrl;
}

// ─── Chat Fotoğrafı Yükle (base64 → döndür) ───────────────
export async function uploadChatPhoto(_convId, _uid, file) {
  return await compressImageToBase64(file, 900, 0.72);
}

// ─── Ses Mesajı Yükle (base64 → döndür) ──────────────────
export async function uploadVoiceMessage(_convId, _uid, blob, _mimeType) {
  return await blobToBase64(blob);
}

// ─── Ses Mesajı Gönder ─────────────────────────────────────
export async function sendVoiceMessage(convId, senderId, audioURL, duration) {
  const msgRef = await addDoc(
    collection(db, "conversations", convId, "messages"),
    {
      type: "voice",
      audioURL,
      duration,
      senderId,
      timestamp: serverTimestamp(),
      status: "sent",
      readBy: [senderId],
    }
  );
  const recipientUid = convId.split("_").find((id) => id !== senderId);
  await setDoc(
    doc(db, "conversations", convId),
    {
      participants: convId.split("_"),
      lastMessage: "🎤 Ses mesajı",
      lastMessageTime: serverTimestamp(),
      lastSenderId: senderId,
      ...(recipientUid ? { [`unreadCounts.${recipientUid}`]: increment(1) } : {}),
    },
    { merge: true }
  );
  return msgRef.id;
}

// ─── Mesaj Gönder (metin) ─────────────────────────────────
export async function sendMessage(convId, senderId, text) {
  const recipientUid = convId.split("_").find((id) => id !== senderId);
  const msgRef = await addDoc(
    collection(db, "conversations", convId, "messages"),
    {
      type: "text",
      text,
      senderId,
      timestamp: serverTimestamp(),
      status: "sent",
      readBy: [senderId],
    }
  );
  await setDoc(
    doc(db, "conversations", convId),
    {
      participants: convId.split("_"),
      lastMessage: text,
      lastMessageTime: serverTimestamp(),
      lastSenderId: senderId,
      ...(recipientUid ? { [`unreadCounts.${recipientUid}`]: increment(1) } : {}),
    },
    { merge: true }
  );
  return msgRef.id;
}

// ─── Mesaj Gönder (fotoğraf) ──────────────────────────────
export async function sendImageMessage(convId, senderId, imageURL, caption = "") {
  const recipientUid = convId.split("_").find((id) => id !== senderId);
  const msgRef = await addDoc(
    collection(db, "conversations", convId, "messages"),
    {
      type: "image",
      text: caption,
      imageURL,
      senderId,
      timestamp: serverTimestamp(),
      status: "sent",
      readBy: [senderId],
    }
  );
  await setDoc(
    doc(db, "conversations", convId),
    {
      participants: convId.split("_"),
      lastMessage: "📷 Fotoğraf",
      lastMessageTime: serverTimestamp(),
      lastSenderId: senderId,
      ...(recipientUid ? { [`unreadCounts.${recipientUid}`]: increment(1) } : {}),
    },
    { merge: true }
  );
  return msgRef.id;
}

// ─── Mesajları Dinle ──────────────────────────────────────
export function subscribeMessages(convId, callback, onError) {
  const q = query(
    collection(db, "conversations", convId, "messages"),
    orderBy("timestamp", "asc"),
    limit(150)
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      callback(msgs);
    },
    (err) => {
      console.warn("subscribeMessages hata:", err.code, err.message);
      if (onError) onError(err);
    }
  );
}

// ─── Okundu İşareti ───────────────────────────────────────
export async function markRead(convId, myUid) {
  const q = query(
    collection(db, "conversations", convId, "messages"),
    orderBy("timestamp", "desc"),
    limit(60)
  );
  const snap = await getDocs(q);
  const toUpdate = snap.docs.filter(
    (d) => d.data().senderId !== myUid && !d.data().readBy?.includes(myUid)
  );
  await Promise.all(
    toUpdate.map((d) =>
      updateDoc(d.ref, { readBy: arrayUnion(myUid), status: "read" })
    )
  );
  try {
    await updateDoc(doc(db, "conversations", convId), {
      [`unreadCounts.${myUid}`]: 0,
    });
  } catch (_) { /* conversation doc yoksa önemli değil */ }
}

// ─── Delivered İşareti ────────────────────────────────────
export async function markDelivered(convId, myUid) {
  const q = query(
    collection(db, "conversations", convId, "messages"),
    orderBy("timestamp", "desc"),
    limit(60)
  );
  const snap = await getDocs(q);
  const toUpdate = snap.docs.filter(
    (d) => d.data().senderId !== myUid && d.data().status === "sent"
  );
  await Promise.all(
    toUpdate.map((d) => updateDoc(d.ref, { status: "delivered" }))
  );
}

// ─── Yazıyor Göster/Gizle ─────────────────────────────────
export async function setTyping(convId, uid, isTyping) {
  const ref = doc(db, "conversations", convId, "typing", uid);
  await setDoc(ref, { uid, isTyping, timestamp: isTyping ? serverTimestamp() : null });
}

// ─── Yazıyor Dinle ────────────────────────────────────────
export function subscribeTyping(convId, myUid, callback) {
  return onSnapshot(
    collection(db, "conversations", convId, "typing"),
    (snap) => {
      const now = Date.now();
      const typers = snap.docs
        .filter((d) => {
          if (d.id === myUid) return false;
          const t = d.data().timestamp;
          if (!d.data().isTyping || !t) return false;
          return now - (t.toMillis?.() ?? 0) < 6000;
        })
        .map((d) => d.id);
      callback(typers);
    },
    (err) => {
      console.warn("subscribeTyping hata:", err.code, err.message);
    }
  );
}

// ─── Konuşma okunmamış sayısı dinle ──────────────────────
// callback receives: { [partnerUid]: unreadCount }
export function subscribeConversations(uid, callback) {
  const q = query(
    collection(db, "conversations"),
    where("participants", "array-contains", uid)
  );
  return onSnapshot(q, (snap) => {
    const counts = {};
    snap.docs.forEach((d) => {
      const data = d.data();
      const partnerUid = data.participants?.find((p) => p !== uid);
      if (partnerUid) counts[partnerUid] = data.unreadCounts?.[uid] || 0;
    });
    callback(counts);
  }, (err) => { console.warn("subscribeConversations:", err.code); });
}

// ─── Emoji Tepki Ekle/Kaldır ──────────────────────────────
export async function addReaction(convId, msgId, uid, emoji) {
  const msgRef = doc(db, "conversations", convId, "messages", msgId);
  const snap = await getDoc(msgRef);
  if (!snap.exists()) return;
  const users = snap.data().reactions?.[emoji] || [];
  if (users.includes(uid)) {
    await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(uid) });
  } else {
    await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(uid) });
  }
}

// ─── Durum/Story Paylaş ───────────────────────────────────
export async function postStatus(uid, type, content) {
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  await setDoc(doc(db, "statuses", uid), {
    uid, type, content,
    createdAt: serverTimestamp(),
    expiresAt,
  });
}

// ─── Aktif Durumları Dinle ────────────────────────────────
export function subscribeStatuses(callback) {
  return onSnapshot(collection(db, "statuses"), (snap) => {
    const now = Date.now();
    const statuses = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => {
        const exp = s.expiresAt?.toMillis?.() || 0;
        return exp > now;
      });
    callback(statuses);
  }, (err) => { console.warn("subscribeStatuses:", err.code); });
}

// ─── Kullanıcı Engelle / Kaldır ───────────────────────────
export async function blockUser(myUid, targetUid) {
  await updateDoc(doc(db, "users", myUid), { blockedUsers: arrayUnion(targetUid) });
}
export async function unblockUser(myUid, targetUid) {
  await updateDoc(doc(db, "users", myUid), { blockedUsers: arrayRemove(targetUid) });
}

// ─── Auth Dinle ───────────────────────────────────────────
export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ─── Zaman Formatı ────────────────────────────────────────
export function formatLastSeen(ts) {
  if (!ts) return "Bilinmiyor";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - date) / 1000;
  if (diff < 60) return "Az önce";
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  return date.toLocaleDateString("tr-TR");
}
