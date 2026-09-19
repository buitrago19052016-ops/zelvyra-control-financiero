// ─────────────────────────────────────────────────────────────────────────────
// ZELVYRA · cuentas con correo + copia en la nube (Firebase Auth + Firestore)
// Usa solo fetch: no hay que instalar ningún paquete nuevo.
//
// PEGA AQUÍ los dos datos de tu proyecto de Firebase
// (Configuración del proyecto → Tus apps → Configuración del SDK):
// ─────────────────────────────────────────────────────────────────────────────
const FIREBASE = {
  apiKey: 'AIzaSyB-EUa8KqNpKC5vOZ4-Rtv1L18Qi-836eY',
  projectId: 'zelvyra-luis-2026',
};

// Mientras no pegues los datos, la app sigue funcionando como antes (solo en el celular, sin cuenta).
export const CLOUD_ENABLED = !FIREBASE.apiKey.startsWith('PEGA_') && !FIREBASE.projectId.startsWith('PEGA_');

const SESSION_KEY = 'zelvyra-sesion';
const AUTH = 'https://identitytoolkit.googleapis.com/v1/accounts';

export class CloudError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const readSession = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (_) { return null; } };
const writeSession = (s) => { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (_) {} };

async function post(url, body, form = false) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body).toString() : JSON.stringify(body),
    });
  } catch (_) { throw new CloudError('NETWORK'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(String(json.error?.message || 'ERROR').split(' ')[0]);
  return json;
}

const startSession = (r) => {
  const s = { uid: r.localId, email: r.email, idToken: r.idToken, refreshToken: r.refreshToken, expiresAt: Date.now() + Number(r.expiresIn) * 1000 };
  writeSession(s);
  return { uid: s.uid, email: s.email };
};

export const signUp = async (email, password) => startSession(await post(`${AUTH}:signUp?key=${FIREBASE.apiKey}`, { email, password, returnSecureToken: true }));
export const signIn = async (email, password) => startSession(await post(`${AUTH}:signInWithPassword?key=${FIREBASE.apiKey}`, { email, password, returnSecureToken: true }));
export const resetPassword = (email) => post(`${AUTH}:sendOobCode?key=${FIREBASE.apiKey}`, { requestType: 'PASSWORD_RESET', email });
export const currentUser = () => { const s = readSession(); return s ? { uid: s.uid, email: s.email } : null; };
export const signOut = () => { try { localStorage.removeItem(SESSION_KEY); } catch (_) {} };

// Errores que significan "esta sesión ya no sirve, hay que volver a entrar"
const AUTH_LOST = new Set(['TOKEN_EXPIRED', 'INVALID_REFRESH_TOKEN', 'USER_NOT_FOUND', 'USER_DISABLED', 'NO_SESSION', 'INVALID_GRANT_TYPE', 'MISSING_REFRESH_TOKEN', 'UNAUTHENTICATED']);
export const isAuthLost = (err) => AUTH_LOST.has(err?.code);

async function validToken() {
  const s = readSession();
  if (!s) throw new CloudError('NO_SESSION');
  if (Date.now() < s.expiresAt - 60000) return s;
  const r = await post(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, { grant_type: 'refresh_token', refresh_token: s.refreshToken }, true);
  const next = { ...s, idToken: r.id_token, refreshToken: r.refresh_token || s.refreshToken, expiresAt: Date.now() + Number(r.expires_in) * 1000 };
  writeSession(next);
  return next;
}

const docUrl = (uid) => `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/users/${uid}`;

// Devuelve los datos guardados en la nube, o null si esta cuenta aún no tiene nada.
export async function cloudLoad() {
  const s = await validToken();
  let res;
  try { res = await fetch(docUrl(s.uid), { headers: { Authorization: `Bearer ${s.idToken}` } }); } catch (_) { throw new CloudError('NETWORK'); }
  if (res.status === 404) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new CloudError(json.error?.status || 'ERROR');
  const txt = json.fields?.json?.stringValue;
  return txt ? JSON.parse(txt) : null;
}

// Guarda todos los datos de la cuenta en un solo documento.
export async function cloudSave(data) {
  const s = await validToken();
  let res;
  try {
    res = await fetch(`${docUrl(s.uid)}?updateMask.fieldPaths=json&updateMask.fieldPaths=updatedAt`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${s.idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(data) }, updatedAt: { stringValue: new Date().toISOString() } } }),
    });
  } catch (_) { throw new CloudError('NETWORK'); }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new CloudError(json.error?.status || 'ERROR');
  }
}

// Decide con qué datos arrancar al entrar y si hay que subirlos a la nube.
//  remote: lo que hay en la nube (o null) · local: copia de esta cuenta en el celular
//  legacy: datos de cuando la app no tenía cuentas · pending: hay cambios locales sin subir
export function pickInitialData({ remote, local, legacy, pending }) {
  if (remote && !(pending && local)) return { data: remote, upload: false, adoptLegacy: false };
  if (remote) return { data: local, upload: true, adoptLegacy: false };
  if (local) return { data: local, upload: true, adoptLegacy: false };
  if (legacy) return { data: legacy, upload: true, adoptLegacy: true };
  return { data: null, upload: false, adoptLegacy: false };
}

// Mensajes de error en español
export function authMessage(err) {
  const map = {
    EMAIL_EXISTS: 'Ese correo ya tiene cuenta. Prueba con "Entrar".',
    INVALID_LOGIN_CREDENTIALS: 'Correo o contraseña incorrectos.',
    INVALID_PASSWORD: 'Correo o contraseña incorrectos.',
    EMAIL_NOT_FOUND: 'Correo o contraseña incorrectos.',
    INVALID_EMAIL: 'Ese correo no parece válido.',
    MISSING_EMAIL: 'Escribe tu correo.',
    MISSING_PASSWORD: 'Escribe tu contraseña.',
    WEAK_PASSWORD: 'La contraseña debe tener al menos 6 caracteres.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    USER_DISABLED: 'Esta cuenta está desactivada.',
    OPERATION_NOT_ALLOWED: 'Falta activar "Correo y contraseña" en Firebase.',
    NETWORK: 'No hay conexión a internet. Inténtalo de nuevo.',
    API: 'La clave de Firebase (apiKey) que está en cloud.js no es correcta. Revísala.',
  };
  return map[err?.code] || 'No se pudo completar. Inténtalo de nuevo.';
}
