import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Plus, Minus, X, Trash2, Pencil, TrendingUp, ArrowUpRight, ArrowDownRight,
  Settings2, Calculator, PiggyBank, AlertTriangle, Sparkles, Target, Volume2, VolumeX, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CLOUD_ENABLED, signIn, signUp, resetPassword, currentUser, signOut, cloudLoad, cloudSave, pickInitialData, isAuthLost, authMessage } from './cloud.js';

// v2 intentionally starts with a clean profile so ZELVYRA is reusable by anyone.
const STORAGE_KEY = 'zelvyra-control-financiero-v2';
const LEGACY_META_ID = 'principal';
const RES = `${import.meta.env.BASE_URL}resources/`;

// ── App instalable (PWA): manifest, ícono y service worker ──────────────────
// Los archivos manifest.json, sw.js e icon-*.png van en la carpeta public/.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const base = import.meta.env.BASE_URL;
  const addLink = (rel, href) => { if (!document.querySelector(`link[rel="${rel}"]`)) { const l = document.createElement('link'); l.rel = rel; l.href = href; document.head.appendChild(l); } };
  addLink('manifest', `${base}manifest.json`);
  addLink('apple-touch-icon', `${base}icon-192.png`);
  if (!document.querySelector('meta[name="theme-color"]')) { const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#0c0b09'; document.head.appendChild(m); }
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    const registrar = () => navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
    if (document.readyState === 'complete') registrar(); else window.addEventListener('load', registrar);
  }
}

const fmt = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(n || 0));
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
const monthKey = (date) => String(date).slice(0, 7);
const parseMoney = (value) => parseInt(String(value).replace(/\D/g, ''), 10) || 0;
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

function defaultData() {
  return {
    startDate: todayISO(),
    ingresoMensual: 0,
    gastosMensual: 0,
    metas: [],
    transacciones: [],
  };
}

// Migrates the old single-goal shape (metaNombre/metaObjetivo/metaPlazoMeses) into data.metas[].
function migrate(loaded) {
  if (!loaded) return loaded;
  if (!loaded.metas && (loaded.metaObjetivo || loaded.metaNombre)) {
    loaded = {
      ...loaded,
      metas: [{
        id: LEGACY_META_ID,
        nombre: loaded.metaNombre || 'Mi meta de ahorro',
        objetivo: loaded.metaObjetivo || 0,
        plazoMeses: loaded.metaPlazoMeses || 0,
        startDate: loaded.startDate || todayISO(),
      }],
    };
  }
  if (!loaded.metas) loaded.metas = [];
  return loaded;
}

function useFinanceData(user) {
  const cloud = CLOUD_ENABLED && !!user && !user.local;
  const localKey = cloud ? `${STORAGE_KEY}:${user.uid}` : STORAGE_KEY;
  const pendingKey = `zelvyra-pendiente:${user?.uid}`;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [syncState, setSyncState] = useState(cloud ? 'sync' : 'local'); // local | sync | ok | offline | error | auth
  const dataRef = useRef(null);
  const queued = useRef(null);
  const syncing = useRef(false);

  const readJSON = (key) => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch (_) { return null; } };
  const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {} };
  const setPending = (v) => { try { if (v) localStorage.setItem(pendingKey, '1'); else localStorage.removeItem(pendingKey); } catch (_) {} };
  const isPending = () => { try { return localStorage.getItem(pendingKey) === '1'; } catch (_) { return false; } };

  // sube a la nube siempre lo último guardado; si falla, queda marcado como pendiente
  const push = useCallback(async () => {
    if (!cloud || syncing.current) return;
    syncing.current = true;
    try {
      while (queued.current) {
        const snapshot = queued.current;
        queued.current = null;
        await cloudSave(snapshot);
      }
      setPending(false);
      setSyncState('ok');
    } catch (err) {
      setSyncState(isAuthLost(err) ? 'auth' : err.code === 'NETWORK' ? 'offline' : 'error');
    }
    syncing.current = false;
  }, [cloud, pendingKey]);

  useEffect(() => {
    (async () => {
      const local = readJSON(localKey);
      if (!cloud) {
        const d = local ? { ...defaultData(), ...migrate(local) } : defaultData();
        dataRef.current = d; setData(d); setLoading(false);
        return;
      }
      const legacy = readJSON(STORAGE_KEY); // datos de antes de que existieran las cuentas
      let remote = null;
      let reachable = true;
      try { remote = await cloudLoad(); } catch (err) {
        if (isAuthLost(err)) { setSyncState('auth'); setLoading(false); return; }
        reachable = false;
      }
      if (!reachable) {
        const fallback = local || legacy;
        if (!fallback) { setLoadError(true); setLoading(false); return; } // sin nube y sin copia: no arrancamos vacíos
        const d = { ...defaultData(), ...migrate(fallback) };
        if (!local) { writeJSON(localKey, d); try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} setPending(true); }
        dataRef.current = d; setData(d); setSyncState('offline'); setLoading(false);
        return;
      }
      const pick = pickInitialData({ remote, local, legacy, pending: isPending() });
      const d = pick.data ? { ...defaultData(), ...migrate(pick.data) } : defaultData();
      writeJSON(localKey, d);
      if (pick.adoptLegacy) { try { localStorage.removeItem(STORAGE_KEY); } catch (_) {} }
      dataRef.current = d; setData(d); setLoading(false);
      if (pick.upload) { setPending(true); queued.current = d; push(); } else { setPending(false); setSyncState('ok'); }
    })();
  }, [localKey, cloud, attempt]);

  // reintentar cuando vuelve internet o la app vuelve a primer plano
  useEffect(() => {
    if (!cloud) return undefined;
    const retry = () => { if (isPending() && dataRef.current && !syncing.current) { queued.current = dataRef.current; push(); } };
    const onVisible = () => { if (!document.hidden) retry(); };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.removeEventListener('online', retry); document.removeEventListener('visibilitychange', onVisible); };
  }, [cloud, push]);

  const persist = useCallback(async (next) => {
    dataRef.current = next;
    setData(next);
    writeJSON(localKey, next);
    if (cloud) { setPending(true); setSyncState('sync'); queued.current = next; push(); }
  }, [cloud, localKey, push]);

  const retryLoad = () => { setLoadError(false); setLoading(true); setAttempt((n) => n + 1); };
  return { data, loading, saving: syncState === 'sync', persist, syncState, loadError, retryLoad };
}

function ProgressRing({ pct, color = '#D7AF58', size = 132, stroke = 11 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const offset = c - (clamped / 100) * c;
  return <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2B241A" strokeWidth={stroke} />
    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset .6s ease' }} />
  </svg>;
}

function Modal({ title, children, onCancel }) {
  return <div className="modal-backdrop" onClick={onCancel}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head"><span>{title}</span><button className="icon-btn" onClick={onCancel}><X size={18} /></button></div>
      {children}
    </div>
  </div>;
}

// Form for creating OR editing a single meta (goal). Independent of the global budget now.
function MetaForm({ meta, onCancel, onSave, firstTime = false }) {
  const [nombre, setNombre] = useState(meta?.nombre || '');
  const [objetivo, setObjetivo] = useState(meta?.objetivo ? String(meta.objetivo) : '');
  const [meses, setMeses] = useState(meta?.plazoMeses ? String(meta.plazoMeses) : '');

  const submit = () => {
    const obj = parseMoney(objetivo);
    const plazo = Math.max(0, parseInt(meses, 10) || 0);
    if (!obj || !plazo) return;
    const sameTarget = meta && meta.objetivo === obj && meta.plazoMeses === plazo;
    onSave({
      id: meta?.id || newId(),
      nombre: nombre.trim() || 'Mi meta de ahorro',
      objetivo: obj,
      plazoMeses: plazo,
      startDate: sameTarget ? meta.startDate : todayISO(),
    });
  };

  return <Modal title={firstTime ? 'Configura tu primera meta' : meta ? 'Editar meta' : 'Nueva meta de ahorro'} onCancel={onCancel}>
    {firstTime && <p className="setup-text">ZELVYRA empieza desde cero. Elige cuánto quieres ahorrar y en cuántos meses. Luego podrás crear todas las metas que quieras.</p>}
    <label className="field-label">Nombre de la meta</label>
    <input className="field-input" placeholder="Ej: Universidad, casa, viaje..." value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus={firstTime} />
    <label className="field-label">¿Cuánto quieres ahorrar?</label>
    <input className="field-input" inputMode="numeric" placeholder="$ 0" value={objetivo ? Number(objetivo).toLocaleString('es-CO') : ''} onChange={(e) => setObjetivo(e.target.value.replace(/\D/g, ''))} />
    <label className="field-label">¿En cuántos meses?</label>
    <input className="field-input" inputMode="numeric" type="number" min="1" placeholder="Ej: 12" value={meses} onChange={(e) => setMeses(e.target.value.replace(/\D/g, ''))} />
    <button className="submit-btn submit-in" onClick={submit}>{meta ? 'Guardar cambios' : 'Crear meta'}</button>
  </Modal>;
}

// Global settings: monthly budget + manage (edit/delete) existing metas.
function ConfigModal({ user, syncState, onLogout, data, onSavePresupuesto, onEditMeta, onDeleteMeta, onAddMeta, onCancel }) {
  const [ingreso, setIngreso] = useState(data.ingresoMensual ? String(data.ingresoMensual) : '');
  const [gastos, setGastos] = useState(data.gastosMensual ? String(data.gastosMensual) : '');
  const metas = data.metas || [];

  return <Modal title="Configuración" onCancel={onCancel}>
    <label className="field-label">Ingreso mensual estimado</label>
    <input className="field-input" inputMode="numeric" placeholder="$ 0" value={ingreso ? Number(ingreso).toLocaleString('es-CO') : ''} onChange={(e) => setIngreso(e.target.value.replace(/\D/g, ''))} />
    <label className="field-label">Gastos mensuales estimados</label>
    <input className="field-input" inputMode="numeric" placeholder="$ 0" value={gastos ? Number(gastos).toLocaleString('es-CO') : ''} onChange={(e) => setGastos(e.target.value.replace(/\D/g, ''))} />
    <button className="submit-btn submit-out" style={{ marginBottom: 20 }} onClick={() => onSavePresupuesto({ ingreso: parseMoney(ingreso), gastos: parseMoney(gastos) })}>Guardar presupuesto</button>

    <div className="section-title" style={{ margin: '0 0 10px' }}>Tus metas</div>
    {metas.length === 0 && <div className="empty-state">Aún no tienes metas de ahorro.</div>}
    <div className="config-meta-list">
      {metas.map((m) => <div className="config-meta-row" key={m.id}>
        <div className="config-meta-info"><b>{m.nombre}</b><span>{fmt(m.objetivo)} · {m.plazoMeses} meses</span></div>
        <div className="config-meta-actions">
          <button className="icon-btn" onClick={() => onEditMeta(m)}><Pencil size={15} /></button>
          <button className="icon-btn" onClick={() => onDeleteMeta(m.id)}><Trash2 size={15} /></button>
        </div>
      </div>)}
    </div>
    <button className="submit-btn submit-in" style={{ marginTop: 13 }} onClick={onAddMeta}>+ Agregar otra meta</button>
    {user && !user.local && <div className="account-box">
      <div className="section-title" style={{ margin: '22px 0 8px' }}>Tu cuenta</div>
      <div className="account-mail">{user.email}</div>
      <div className={`account-sync ${syncState}`}>{syncState === 'ok' ? '✓ Tus datos están guardados en la nube' : syncState === 'sync' ? 'Guardando…' : syncState === 'offline' ? '⚠ Sin conexión: se guardará cuando vuelva internet' : '⚠ No se pudo guardar en la nube. Inténtalo más tarde.'}</div>
      <button className="submit-btn submit-out" onClick={onLogout}>Cerrar sesión</button>
    </div>}
  </Modal>;
}

function TransactionForm({ tipo, metas, defaultMetaId, initial, onCancel, onSave }) {
  const [monto, setMonto] = useState(initial ? String(initial.monto) : '');
  const [nota, setNota] = useState(initial?.nota || '');
  const [fecha, setFecha] = useState(initial?.fecha || todayISO());
  const [metaId, setMetaId] = useState(initial?.metaId || defaultMetaId || metas?.[0]?.id || '');
  const [destino, setDestino] = useState('');   // meta a la que se envía parte del ingreso ('' = solo ingreso)
  const [montoMeta, setMontoMeta] = useState(''); // vacío = todo el ingreso
  const isIngreso = tipo === 'ingreso';
  const isAhorro = tipo === 'ahorro';
  const isGasto = tipo === 'gasto';
  const puedeDestinar = isIngreso && !initial && metas?.length > 0;
  const submit = () => {
    const n = parseMoney(monto);
    if (!n) return;
    if (initial) {
      onSave({ ...initial, monto: n, metaId: isAhorro ? (metaId || null) : null, nota: nota.trim(), fecha });
      return;
    }
    const mov = { id: newId(), tipo, monto: n, metaId: isAhorro ? (metaId || null) : null, nota: nota.trim(), fecha };
    if (puedeDestinar && destino) {
      const aMeta = Math.min(n, parseMoney(montoMeta) || n);
      const ahorro = { id: newId(), tipo: 'ahorro', monto: aMeta, metaId: destino, nota: nota.trim() ? `${nota.trim()} → meta` : 'Del ingreso', fecha };
      onSave([mov, ahorro]);
      return;
    }
    onSave(mov);
  };
  const palabra = isIngreso ? 'ingreso' : isAhorro ? 'ahorro' : 'gasto';
  return <Modal title={`${initial ? 'Editar' : 'Registrar'} ${palabra}`} onCancel={onCancel}>
    <label className="field-label">Monto</label>
    <input className="field-input" inputMode="numeric" placeholder="$ 0" value={monto ? Number(monto).toLocaleString('es-CO') : ''} onChange={(e) => setMonto(e.target.value.replace(/\D/g, ''))} autoFocus />
    {isAhorro && metas?.length > 0 && <>
      <label className="field-label">¿Para cuál meta?</label>
      <div className="chip-row">{metas.map((m) => <button key={m.id} className={metaId === m.id ? 'chip chip-active' : 'chip'} onClick={() => setMetaId(m.id)}>{m.nombre}</button>)}</div>
    </>}
    {puedeDestinar && <>
      <label className="field-label">¿Enviar a una meta de ahorro?</label>
      <div className="chip-row">
        <button className={!destino ? 'chip chip-active' : 'chip'} onClick={() => setDestino('')}>Solo ingreso</button>
        {metas.map((m) => <button key={m.id} className={destino === m.id ? 'chip chip-active' : 'chip'} onClick={() => setDestino(m.id)}>{m.nombre}</button>)}
      </div>
      {destino && <>
        <label className="field-label">¿Cuánto va a la meta?</label>
        <input className="field-input" inputMode="numeric" placeholder={monto ? Number(monto).toLocaleString('es-CO') : '$ 0'} value={montoMeta ? Number(montoMeta).toLocaleString('es-CO') : ''} onChange={(e) => setMontoMeta(e.target.value.replace(/\D/g, ''))} />
        <div className="field-hint">Si lo dejas vacío, va todo el ingreso a la meta.</div>
      </>}
    </>}
    <label className="field-label">Fecha</label>
    <input className="field-input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
    <label className="field-label">{isGasto ? '¿En qué te lo gastaste?' : isIngreso ? '¿De qué es este ingreso?' : 'Nota (opcional)'}</label>
    <input className="field-input" placeholder={isGasto ? 'Escríbelo tú: almuerzo, taxi, recibo de luz...' : isIngreso ? 'Escríbelo tú: sueldo, dinero extra, venta...' : 'Ej: ahorro del mes...'} value={nota} onChange={(e) => setNota(e.target.value)} />
    <button className={`submit-btn ${isIngreso || isAhorro ? 'submit-in' : 'submit-out'}`} onClick={submit}>{initial ? 'Guardar cambios' : 'Guardar'}</button>
  </Modal>;
}

function CalculatorModal({ onCancel }) {
  const [a, setA] = useState(''); const [b, setB] = useState(''); const [op, setOp] = useState('+');
  const x = parseMoney(a), y = parseMoney(b); let result = 0;
  if (op === '+') result = x + y; if (op === '-') result = x - y; if (op === '×') result = x * y; if (op === '÷') result = y ? x / y : 0;
  return <Modal title="Calculadora rápida" onCancel={onCancel}>
    <input className="field-input calc-input" inputMode="numeric" placeholder="$ 0" value={a ? Number(a).toLocaleString('es-CO') : ''} onChange={(e) => setA(e.target.value.replace(/\D/g, ''))} />
    <div className="calc-ops">{['+', '-', '×', '÷'].map((v) => <button key={v} className={op === v ? 'calc-op active' : 'calc-op'} onClick={() => setOp(v)}>{v}</button>)}</div>
    <input className="field-input calc-input" inputMode="numeric" placeholder="$ 0" value={b ? Number(b).toLocaleString('es-CO') : ''} onChange={(e) => setB(e.target.value.replace(/\D/g, ''))} />
    <div className="calc-result">{fmt(result)}</div>
  </Modal>;
}


function playWelcomeSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.055, now + i * 0.09 + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.45);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch (_) {}
}

// ── Música de fondo ─────────────────────────────────────────────────────────
// Si existe public/resources/musica.mp3 se reproduce esa pista en bucle.
// Si no, suena un riff de rock/metal sintetizado con Web Audio (sin archivos ni derechos de autor).
const MUSIC_PREF_KEY = 'zelvyra-musica';
const bgMusic = (() => {
  const STEP = 60 / 96 / 4; // 96 BPM, semicorcheas
  const E2 = 82.41; // Mi grave de la guitarra
  // 4 compases x 16 pasos. Número = semitonos sobre Mi grave; null = silencio
  const RIFF = [
    [0, 0, null, 0, 0, null, 3, null, 0, 0, null, 0, 5, null, 3, null],
    [0, 0, null, 0, 0, null, 3, null, 0, 0, null, 0, 7, null, 6, null],
    [8, 8, null, 8, 8, null, 10, null, 8, 8, null, 8, 7, null, 5, null],
    [3, 3, null, 3, 3, null, 5, null, 3, 3, null, 3, 2, null, 0, 0]
  ].flat();
  let ctx = null, out = null, amp = null, noise = null, timer = null, file = null;
  let on = false, step = 0, next = 0;

  const enabled = () => { try { return window.localStorage.getItem(MUSIC_PREF_KEY) !== 'off'; } catch (_) { return true; } };
  const remember = (v) => { try { window.localStorage.setItem(MUSIC_PREF_KEY, v ? 'on' : 'off'); } catch (_) {} };

  const build = () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    ctx = new AudioCtx();
    const comp = ctx.createDynamicsCompressor();
    out = ctx.createGain(); out.gain.value = 0.28; // volumen general de la música
    out.connect(comp); comp.connect(ctx.destination);
    // "amplificador": distorsión fuerte + filtro tipo bocina
    amp = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i * 2) / curve.length - 1) * 7);
    amp.curve = curve; amp.oversample = '4x';
    const cab = ctx.createBiquadFilter(); cab.type = 'lowpass'; cab.frequency.value = 2600;
    const guitar = ctx.createGain(); guitar.gain.value = 0.55;
    amp.connect(cab); cab.connect(guitar); guitar.connect(out);
    // ruido para caja, platillo y hi-hat
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  };

  // power chord: nota + quinta + octava, dos osciladores desafinados por voz
  const chord = (t, freq, dur, accent) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.42, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(amp);
    [1, 1.4983, 2].forEach((m) => [-7, 7].forEach((det) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = freq * m; o.detune.value = det;
      o.connect(g); o.start(t); o.stop(t + dur + 0.03);
    }));
  };
  const kick = (t) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.2);
  };
  const hit = (t, dur, filter, freq, vol) => {
    const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = filter; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out); s.start(t); s.stop(t + dur + 0.02);
  };

  // programa las notas con un poco de anticipación para que no se corte
  const tick = () => {
    while (next < ctx.currentTime + 0.25) {
      const i = step % 16, n = RIFF[step];
      if (n !== null) {
        const sustained = RIFF[(step + 1) % 64] === null;
        chord(next, E2 * Math.pow(2, n / 12), sustained ? STEP * 1.9 : STEP * 0.6, sustained);
      }
      if (i === 0 || i === 3 || i === 8 || i === 10) kick(next);
      if (i === 4 || i === 12) hit(next, 0.16, 'highpass', 1500, 0.35);
      if (i % 2 === 0) hit(next, 0.035, 'highpass', 7500, 0.1);
      if (step === 0) hit(next, 1.1, 'highpass', 5000, 0.18);
      step = (step + 1) % 64;
      next += STEP;
    }
  };

  const startSynth = () => {
    if (!ctx && !build()) return;
    step = 0; next = ctx.currentTime + 0.1;
    clearInterval(timer);
    timer = setInterval(tick, 60);
  };

  const start = async () => {
    if (on) return;
    on = true; remember(true);
    // el contexto se crea aquí, dentro del toque del usuario, para que el navegador lo permita
    if (!ctx) build();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    try {
      const a = new Audio(RES + 'musica.mp3');
      a.loop = true; a.volume = 0.45;
      await a.play();
      if (on) { file = a; if (ctx) ctx.suspend().catch(() => {}); } else a.pause();
      return;
    } catch (_) { /* no hay musica.mp3: usamos el riff sintetizado */ }
    if (on) startSynth();
  };

  const stop = () => {
    on = false; remember(false);
    clearInterval(timer); timer = null;
    if (file) { file.pause(); file = null; }
    if (ctx) ctx.suspend().catch(() => {});
  };

  // pausar cuando la app pasa a segundo plano
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!on) return;
      if (document.hidden) { if (file) file.pause(); if (ctx) ctx.suspend().catch(() => {}); }
      else if (file) file.play().catch(() => {});
      else if (ctx) ctx.resume().catch(() => {});
    });
  }

  return { start, stop, enabled, isOn: () => on };
})();

function WelcomeSplash({ onContinue }) {
  const [soundOn, setSoundOn] = useState(false);
  const continueApp = () => {
    playWelcomeSound();
    if (bgMusic.enabled()) bgMusic.start();
    setSoundOn(true);
    setTimeout(onContinue, 180);
  };
  return <div className="welcome-splash">
    <img className="welcome-image" src={RES + 'welcome-gothic.png'} alt="ZELVYRA - inspiración para ahorrar" />
    <div className="welcome-vignette" />
    <div className="welcome-content">
      <div className="welcome-message">Cada pequeño esfuerzo de hoy construye la libertad de mañana.</div>
      <button className="welcome-continue" onClick={continueApp}>{soundOn ? 'Entrando…' : 'Toca para comenzar'}</button>
      <div className="welcome-sound"><span className={soundOn ? 'sound-dot sound-active' : 'sound-dot'} /> Sonido de bienvenida</div>
    </div>
  </div>;
}

function FinanceApp({ user, onLogout }) {
  const { data, loading, saving, persist, syncState, loadError, retryLoad } = useFinanceData(user);
  // al cerrar sesión se borra la copia del celular, salvo que haya cambios sin subir
  const salir = () => {
    try { if (localStorage.getItem(`zelvyra-pendiente:${user.uid}`) !== '1') localStorage.removeItem(`${STORAGE_KEY}:${user.uid}`); } catch (_) {}
    onLogout();
  };
  useEffect(() => { if (syncState === 'auth') salir(); }, [syncState]);
  const [formTipo, setFormTipo] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [metaFormTarget, setMetaFormTarget] = useState(null); // null | 'new' | metaObject
  const [returnToConfig, setReturnToConfig] = useState(false);
  const [activeView, setActiveView] = useState('resumen');
  const [selectedMetaId, setSelectedMetaId] = useState(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [musicOn, setMusicOn] = useState(() => bgMusic.enabled());
  const [editingTx, setEditingTx] = useState(null);
  const [metaABorrar, setMetaABorrar] = useState(null);
  const [mesGasto, setMesGasto] = useState(() => todayISO().slice(0, 7));
  const toggleMusic = () => { if (musicOn) { bgMusic.stop(); setMusicOn(false); } else { bgMusic.start(); setMusicOn(true); } };

  const askedFirstMeta = useRef(false);
  useEffect(() => { if (data && data.metas.length === 0 && !askedFirstMeta.current) { askedFirstMeta.current = true; setMetaFormTarget('new'); } }, [data]);
  useEffect(() => {
    if (!data) return;
    if (!data.metas.find((m) => m.id === selectedMetaId)) setSelectedMetaId(data.metas[0]?.id || null);
  }, [data, selectedMetaId]);

  const saveMeta = (meta) => {
    const metas = data.metas || [];
    const idx = metas.findIndex((m) => m.id === meta.id);
    const nextMetas = idx >= 0 ? metas.map((m) => (m.id === meta.id ? meta : m)) : [...metas, meta];
    persist({ ...data, metas: nextMetas });
    setSelectedMetaId(meta.id);
    setMetaFormTarget(null);
    if (returnToConfig) { setShowConfig(true); setReturnToConfig(false); }
  };
  const deleteMeta = (id, conAhorros = false) => {
    const nextMetas = (data.metas || []).filter((m) => m.id !== id);
    const base = conAhorros ? data.transacciones.filter((t) => !(t.tipo === 'ahorro' && t.metaId === id)) : data.transacciones;
    const nextTx = base.map((t) => (t.metaId === id ? { ...t, metaId: null } : t));
    persist({ ...data, metas: nextMetas, transacciones: nextTx });
    setMetaABorrar(null);
  };
  const savePresupuesto = ({ ingreso, gastos }) => persist({ ...data, ingresoMensual: ingreso, gastosMensual: gastos });
  const addTransaccion = (t) => { const nuevos = Array.isArray(t) ? t : [t]; persist({ ...data, transacciones: [...nuevos, ...data.transacciones] }); setFormTipo(null); };
  const updateTransaccion = (t) => { persist({ ...data, transacciones: data.transacciones.map((x) => (x.id === t.id ? t : x)) }); setEditingTx(null); };
  const deleteTransaccion = (id) => persist({ ...data, transacciones: data.transacciones.filter((t) => t.id !== id) });

  const openAddMeta = () => { setShowConfig(false); setReturnToConfig(false); setMetaFormTarget('new'); };
  const openEditMeta = (m) => { setShowConfig(false); setReturnToConfig(true); setMetaFormTarget(m); };
  const openAhorro = () => { if (!data.metas.length) { setMetaFormTarget('new'); return; } setFormTipo('ahorro'); };

  const calc = useMemo(() => {
    if (!data) return null;
    const metas = data.metas || [];
    const ingresos = data.transacciones.filter((t) => t.tipo === 'ingreso').reduce((s, t) => s + t.monto, 0);
    const gastos = data.transacciones.filter((t) => t.tipo === 'gasto').reduce((s, t) => s + t.monto, 0);
    const ahorros = data.transacciones.filter((t) => t.tipo === 'ahorro').reduce((s, t) => s + t.monto, 0);
    const disponible = ingresos - gastos - ahorros;
    const ahora = new Date();
    const finMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0);
    const diasRestantesMes = Math.max(1, daysBetween(todayISO(), finMes.toISOString().slice(0, 10)) + 1);
    const presupuestoDiario = Math.max(0, ((data.ingresoMensual || 0) - (data.gastosMensual || 0)) / diasRestantesMes);
    const gastoRatio = data.ingresoMensual ? gastos / Math.max(1, data.ingresoMensual) : 0;

    const metasCalc = metas.map((meta) => {
      const objetivo = Number(meta.objetivo) || 0;
      const plazo = Number(meta.plazoMeses) || 0;
      const aportado = data.transacciones.filter((t) => t.tipo === 'ahorro' && t.metaId === meta.id).reduce((s, t) => s + t.monto, 0);
      const restante = Math.max(0, objetivo - aportado);
      const mensual = plazo ? objetivo / plazo : 0;
      const elapsed = daysBetween(meta.startDate || data.startDate, todayISO());
      const totalDays = Math.max(1, plazo * 30);
      const diasRestantesMeta = Math.max(1, totalDays - elapsed);
      const diarioAlcanzar = objetivo ? restante / diasRestantesMeta : 0;
      const mesesRestantes = Math.max(1, Math.ceil(diasRestantesMeta / 30));
      const mensualAlcanzar = objetivo ? restante / mesesRestantes : 0;
      const pct = objetivo ? Math.min(100, (aportado / objetivo) * 100) : 0;
      const inicioMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
      const ahorradoEsteMes = data.transacciones.filter((t) => t.tipo === 'ahorro' && t.metaId === meta.id && t.fecha >= inicioMes).reduce((s, t) => s + t.monto, 0);
      let estado = 'verde';
      if (objetivo && (ahorradoEsteMes < mensual * .7 || gastoRatio > .8)) estado = 'rojo';
      else if (objetivo && ahorradoEsteMes < mensual) estado = 'amarillo';
      const months = [];
      for (let i = Math.max(0, plazo - 1); i >= 0; i--) {
        const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const ahorroMes = data.transacciones.filter((t) => t.tipo === 'ahorro' && t.metaId === meta.id && monthKey(t.fecha) === key).reduce((s, t) => s + t.monto, 0);
        months.push({ key, label: d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', ''), ahorro: ahorroMes });
      }
      return { ...meta, objetivo, plazo, aportado, restante, mensual, diarioAlcanzar, mesesRestantes, mensualAlcanzar, pct, estado, ahorradoEsteMes, months };
    });

    return { ingresos, gastos, ahorros, disponible, diasRestantesMes, presupuestoDiario, metas: metasCalc };
  }, [data]);

  // Gastos del mes elegido, agrupados por lo que el usuario escribió
  const gastosMes = useMemo(() => {
    if (!data) return { total: 0, items: [] };
    const grupos = new Map();
    let total = 0;
    data.transacciones.filter((t) => t.tipo === 'gasto' && monthKey(t.fecha) === mesGasto).forEach((t) => {
      total += t.monto;
      const nombre = (t.nota || t.categoria || 'Sin detalle').trim();
      const k = nombre.toLowerCase();
      const g = grupos.get(k) || { nombre, monto: 0 };
      g.monto += t.monto;
      grupos.set(k, g);
    });
    return { total, items: [...grupos.values()].sort((a, b) => b.monto - a.monto) };
  }, [data, mesGasto]);
  const mesActual = todayISO().slice(0, 7);
  const nombreMes = new Date(`${mesGasto}-01T12:00:00`).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const cambiarMes = (delta) => {
    const [y, m] = mesGasto.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (key <= mesActual) setMesGasto(key);
  };

  if (loadError) return <div className="app-shell centered"><style>{CSS}</style><div className="login-card">
    <div className="login-title">No pudimos cargar tus datos</div>
    <p className="login-sub">Revisa tu conexión a internet e inténtalo de nuevo. Tus ahorros siguen guardados en tu cuenta.</p>
    <button className="submit-btn submit-in" onClick={retryLoad}>Reintentar</button>
    <div className="login-links"><button className="login-link" onClick={salir}>Cerrar sesión</button></div>
  </div></div>;
  if (loading || !data || !calc) return <div className="app-shell centered"><style>{CSS}</style><div className="loader">Cargando ZELVYRA…</div></div>;

  const historial = [...data.transacciones].sort((a, b) => b.fecha.localeCompare(a.fecha));
  const metas = calc.metas;
  const hasMetas = metas.length > 0;
  const selectedMeta = metas.find((m) => m.id === selectedMetaId) || metas[0];
  const maxChart = selectedMeta ? Math.max(selectedMeta.mensual, ...selectedMeta.months.map((m) => m.ahorro), 1) : 1;
  const metaById = (id) => metas.find((m) => m.id === id);

  return <div className="app-shell">
    <style>{CSS}</style><div className="texture" /><div className="app-frame">
      <header className="brand"><img className="brand-logo" src={RES + 'zelvyra-logo.png'} alt="ZELVYRA — Control Financiero" />
        <div className="brand-actions"><button className="icon-btn" onClick={toggleMusic} title={musicOn ? 'Silenciar música' : 'Activar música'}>{musicOn ? <Volume2 size={18} /> : <VolumeX size={18} />}</button><button className="icon-btn" onClick={() => setShowCalc(true)} title="Calculadora"><Calculator size={18} /></button><button className="icon-btn" onClick={() => setShowConfig(true)} title="Configuración"><Settings2 size={18} /></button></div>
      </header>
      <div className="motto">"Cada peso tiene un propósito."</div>
      <nav className="tabs"><button className={activeView === 'resumen' ? 'tab active' : 'tab'} onClick={() => setActiveView('resumen')}>Resumen</button><button className={activeView === 'seis' ? 'tab active' : 'tab'} onClick={() => setActiveView('seis')}>{selectedMeta ? `${selectedMeta.plazo} meses` : 'Seguimiento'}</button><button className={activeView === 'movimientos' ? 'tab active' : 'tab'} onClick={() => setActiveView('movimientos')}>Movimientos</button></nav>

      {activeView === 'resumen' && <>
        <section className="available-card"><div className="eyebrow">DINERO DISPONIBLE</div><div className="available-amount">{fmt(calc.disponible)}</div><div className="available-stats"><span><ArrowUpRight size={14} />{fmt(calc.ingresos)}</span><span><ArrowDownRight size={14} />{fmt(calc.gastos)}</span></div></section>
        <section className="month-card">
          <div className="month-head">
            <button className="icon-btn" onClick={() => cambiarMes(-1)} aria-label="Mes anterior"><ChevronLeft size={16} /></button>
            <span className="month-name">{nombreMes}</span>
            <button className="icon-btn" onClick={() => cambiarMes(1)} disabled={mesGasto >= mesActual} aria-label="Mes siguiente"><ChevronRight size={16} /></button>
          </div>
          <div className="eyebrow">{mesGasto === mesActual ? 'ESTE MES TE GASTASTE' : 'ESE MES TE GASTASTE'}</div>
          <div className="month-total">{fmt(gastosMes.total)}</div>
          {gastosMes.items.length === 0
            ? <div className="month-empty">No registraste gastos en este mes.</div>
            : <div className="month-list">{gastosMes.items.map((g) => <div className="month-row" key={g.nombre.toLowerCase()}><div className="month-row-top"><span>{g.nombre}</span><b>{fmt(g.monto)}</b></div><div className="month-bar"><i style={{ width: `${Math.max(3, (g.monto / gastosMes.total) * 100)}%` }} /></div></div>)}</div>}
        </section>
        {!hasMetas ? <section className="alert-card amarillo"><div className="alert-icon"><Target size={19} /></div><div><strong>CONFIGURA TU PRIMERA META</strong><p>Todo está en cero. Elige cuánto quieres ahorrar y en cuántos meses.</p><button className="goal-link" onClick={() => setMetaFormTarget('new')}>Crear mi meta</button></div></section> : <section className={`alert-card ${selectedMeta.estado}`}><div className="alert-icon">{selectedMeta.estado === 'rojo' ? <AlertTriangle size={19} /> : <Sparkles size={19} />}</div><div><strong>{selectedMeta.estado === 'rojo' ? 'ATENCIÓN: revisa tus gastos' : selectedMeta.estado === 'amarillo' ? 'Vas justo con el ahorro' : 'Vas por buen camino'}</strong><p>Tu ritmo para "{selectedMeta.nombre}" se compara con tu meta de {fmt(selectedMeta.objetivo)}.</p></div></section>}

        {hasMetas && <>
          <section className="university-card"><div className="ring-wrap"><ProgressRing pct={selectedMeta.pct} /><div className="ring-center"><b>{selectedMeta.pct.toFixed(0)}%</b><span>meta</span></div></div><div className="university-info"><div className="card-kicker">{selectedMeta.nombre.toUpperCase()}</div><h2>{fmt(selectedMeta.objetivo)}</h2><div className="mini-row"><span>Ahorrado</span><b>{fmt(selectedMeta.aportado)}</b></div><div className="mini-row"><span>Faltante</span><b>{fmt(selectedMeta.restante)}</b></div></div></section>
          <section className="daily-card"><div className="daily-icon"><PiggyBank size={20} /></div><div><div className="card-kicker">LO QUE DEBES AHORRAR</div><div className="daily-number">{fmt(selectedMeta.mensualAlcanzar)} <small>/ mes</small></div><div className="daily-number daily-secondary">{fmt(selectedMeta.diarioAlcanzar)} <small>/ día</small></div><p>Meta en {selectedMeta.plazo} meses · te faltan aprox. {selectedMeta.mesesRestantes} {selectedMeta.mesesRestantes === 1 ? 'mes' : 'meses'}. Cuota de tu plan: {fmt(selectedMeta.mensual)} al mes.</p></div></section>
        </>}

        <section className="budget-card"><div className="budget-head"><TrendingUp size={16} /><span>LÍMITE DE GASTO ESTIMADO</span></div><div className="budget-amount">{fmt(calc.presupuestoDiario)}</div><div className="budget-sub">Se calcula con tu ingreso y gastos mensuales configurados. Si están en cero, aquí también verás $0.</div></section>

        <section><div className="section-title">Tus metas</div><div className="metas-grid">
          {metas.map((m) => <div key={m.id} className={m.id === selectedMetaId ? 'meta-card meta-card-active' : 'meta-card'} onClick={() => setSelectedMetaId(m.id)}>
            <button className="meta-del" onClick={(e) => { e.stopPropagation(); setMetaABorrar(m); }} aria-label="Borrar meta"><Trash2 size={14} /></button>
            <div className="meta-icon" style={{ color: '#D7AF58', borderColor: '#D7AF5855' }}><Target size={17} /></div>
            <div className="meta-nombre">{m.nombre}</div>
            <div className="meta-monto">{fmt(m.aportado)}</div>
            <div className="meta-objetivo">de {fmt(m.objetivo)}</div>
            <div className="meta-bar-track"><div className="meta-bar-fill" style={{ width: `${m.pct}%`, background: '#D7AF58' }} /></div>
          </div>)}
          <div className="meta-card meta-card-add" onClick={openAddMeta}><Plus size={20} /><span>Nueva meta</span></div>
        </div></section>

        <section><div className="section-title">Últimos movimientos</div>{historial.length === 0 ? <div className="empty-state">Aún no hay movimientos.</div> : <div className="hist-list">{historial.slice(0, 6).map((t) => <TransactionRow key={t.id} t={t} meta={metaById(t.metaId)} onDelete={deleteTransaccion} onEdit={setEditingTx} />)}</div>}</section>
      </>}

      {activeView === 'seis' && (hasMetas ? <section className="six-card"><div className="section-title">Seguimiento · {selectedMeta.plazo} meses · {selectedMeta.nombre}</div><div className="legend"><span><i className="legend-dot gold" />Ahorro</span><span><i className="legend-dot line" />Meta mensual: {fmt(selectedMeta.mensual)}</span></div><div className="chart">{selectedMeta.months.map((m) => <div className="bar-col" key={m.key}><div className="bar-value">{m.ahorro ? fmt(m.ahorro).replace('COP', '') : ''}</div><div className="bar-track"><div className="bar-fill" style={{ height: `${Math.min(100, (m.ahorro / maxChart) * 100)}%` }} /></div><span>{m.label}</span></div>)}</div><div className="six-summary"><div><span>Objetivo</span><b>{fmt(selectedMeta.objetivo)}</b></div><div><span>Necesario por mes</span><b>{fmt(selectedMeta.mensual)}</b></div><div><span>Ahorrado este mes</span><b>{fmt(selectedMeta.ahorradoEsteMes)}</b></div></div></section> : <div className="empty-state">Crea una meta para ver su seguimiento mensual.</div>)}
      {activeView === 'movimientos' && <section><div className="section-title">Todos los movimientos</div>{historial.length === 0 ? <div className="empty-state">Aún no hay movimientos.</div> : <div className="hist-list">{historial.map((t) => <TransactionRow key={t.id} t={t} meta={metaById(t.metaId)} onDelete={deleteTransaccion} onEdit={setEditingTx} />)}</div>}</section>}
      <div style={{ height: 105 }} />
    </div>
    <div className="fab-row"><button className="fab fab-out" onClick={() => setFormTipo('gasto')}><Minus size={18} /> Gasto</button><button className="fab fab-save" onClick={openAhorro}><PiggyBank size={18} /> Ahorro</button><button className="fab fab-in" onClick={() => setFormTipo('ingreso')}><Plus size={18} /> Ingreso</button></div>
    {formTipo && <TransactionForm tipo={formTipo} metas={metas} defaultMetaId={selectedMetaId} onCancel={() => setFormTipo(null)} onSave={addTransaccion} />}
    {editingTx && <TransactionForm key={editingTx.id} tipo={editingTx.tipo} initial={editingTx} metas={metas} onCancel={() => setEditingTx(null)} onSave={updateTransaccion} />}
    {showCalc && <CalculatorModal onCancel={() => setShowCalc(false)} />}
    {showConfig && <ConfigModal user={user} syncState={syncState} onLogout={salir} data={data} onSavePresupuesto={savePresupuesto} onEditMeta={openEditMeta} onDeleteMeta={(id) => setMetaABorrar(metas.find((m) => m.id === id) || null)} onAddMeta={openAddMeta} onCancel={() => setShowConfig(false)} />}
    {metaABorrar && <Modal title="¿Borrar esta meta?" onCancel={() => setMetaABorrar(null)}>
      <p className="setup-text">{metaABorrar.nombre} · llevas {fmt(metaABorrar.aportado)} ahorrado.</p>
      {metaABorrar.aportado > 0 ? <>
        <button className="submit-btn submit-out" onClick={() => deleteMeta(metaABorrar.id, true)}>Borrar meta y sus ahorros</button>
        <div className="field-hint" style={{ marginTop: 6 }}>Ese dinero vuelve a “Dinero disponible”.</div>
        <button className="submit-btn submit-in" style={{ marginTop: 6 }} onClick={() => deleteMeta(metaABorrar.id, false)}>Borrar solo la meta</button>
        <div className="field-hint" style={{ marginTop: 6 }}>Los ahorros quedan en el historial, sin meta.</div>
      </> : <button className="submit-btn submit-out" onClick={() => deleteMeta(metaABorrar.id, false)}>Sí, borrar meta</button>}
      <button className="chip" style={{ width: '100%', padding: 11, marginTop: 4 }} onClick={() => setMetaABorrar(null)}>Cancelar</button>
    </Modal>}
    {metaFormTarget && <MetaForm meta={metaFormTarget === 'new' ? null : metaFormTarget} firstTime={data.metas.length === 0} onCancel={() => { setMetaFormTarget(null); if (returnToConfig) { setShowConfig(true); setReturnToConfig(false); } }} onSave={saveMeta} />}
    {showWelcome && <WelcomeSplash onContinue={() => setShowWelcome(false)} />}
  </div>;
}

function LoginScreen({ onLogged }) {
  const [modo, setModo] = useState('entrar'); // entrar | crear
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const enviar = async () => {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const u = modo === 'crear' ? await signUp(email.trim(), password) : await signIn(email.trim(), password);
      onLogged(u);
    } catch (err) { setMsg({ tipo: 'err', texto: authMessage(err) }); setBusy(false); }
  };
  const olvide = async () => {
    if (!email.trim()) { setMsg({ tipo: 'err', texto: 'Escribe tu correo arriba y vuelve a tocar “Olvidé mi contraseña”.' }); return; }
    setBusy(true); setMsg(null);
    try { await resetPassword(email.trim()); setMsg({ tipo: 'ok', texto: 'Listo. Si ese correo tiene cuenta, te enviamos un enlace para cambiar la contraseña.' }); }
    catch (err) { setMsg({ tipo: 'err', texto: authMessage(err) }); }
    setBusy(false);
  };
  return <div className="app-shell centered"><style>{CSS}</style>
    <div className="login-card">
      <img className="login-logo" src={RES + 'zelvyra-logo.png'} alt="ZELVYRA" />
      <div className="login-title">{modo === 'crear' ? 'Crea tu cuenta' : 'Entra a ZELVYRA'}</div>
      <p className="login-sub">Con tu correo, tus ahorros quedan guardados aunque cambies de celular.</p>
      <label className="field-label">Correo</label>
      <input className="field-input" type="email" inputMode="email" autoComplete="email" placeholder="tucorreo@ejemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="field-label">Contraseña</label>
      <input className="field-input" type="password" autoComplete={modo === 'crear' ? 'new-password' : 'current-password'} placeholder="Mínimo 6 caracteres" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') enviar(); }} />
      {msg && <div className={`login-msg ${msg.tipo}`}>{msg.texto}</div>}
      <button className="submit-btn submit-in" onClick={enviar} disabled={busy}>{busy ? 'Un momento…' : modo === 'crear' ? 'Crear mi cuenta' : 'Entrar'}</button>
      <div className="login-links">
        <button className="login-link" onClick={() => { setModo(modo === 'crear' ? 'entrar' : 'crear'); setMsg(null); }}>{modo === 'crear' ? 'Ya tengo cuenta' : '¿Primera vez? Crea tu cuenta'}</button>
        {modo === 'entrar' && <button className="login-link" onClick={olvide}>Olvidé mi contraseña</button>}
      </div>
    </div>
  </div>;
}

export default function App() {
  // sin datos de Firebase en cloud.js la app funciona como antes: sin cuenta, solo en el celular
  const [user, setUser] = useState(() => (CLOUD_ENABLED ? currentUser() : { uid: 'local', local: true }));
  if (!user) return <LoginScreen onLogged={setUser} />;
  return <FinanceApp key={user.uid} user={user} onLogout={() => { signOut(); setUser(null); }} />;
}

function TransactionRow({ t, meta, onDelete, onEdit }) {
  return <div className="hist-row"><div className={`hist-dot ${t.tipo === 'gasto' ? 'dot-out' : 'dot-in'}`} /><div className="hist-body" onClick={() => onEdit && onEdit(t)} title="Toca para editar"><div className="hist-top"><span className="hist-nota">{t.nota || (t.tipo === 'gasto' ? 'Gasto' : t.tipo === 'ahorro' ? 'Ahorro' : 'Ingreso')}</span><span className={t.tipo === 'gasto' ? 'hist-amt-out' : 'hist-amt-in'}>{t.tipo === 'gasto' ? '-' : '+'}{fmt(t.monto)}</span></div><div className="hist-sub">{t.fecha}{meta ? ` · ${meta.nombre}` : ''}</div></div><button className="del-btn" onClick={() => onDelete(t.id)}><Trash2 size={14} /></button></div>;
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
*{box-sizing:border-box}html,body,#root{margin:0;min-height:100%;background:#0a0908}.app-shell{width:100%;min-height:100vh;background:radial-gradient(circle at 50% -10%,#292016 0,#100e0b 34%,#080807 80%);color:#f4eee3;font-family:Inter,sans-serif;display:flex;justify-content:center;position:relative;overflow-x:hidden}.texture{position:fixed;inset:0;pointer-events:none;opacity:.22;background-image:radial-gradient(#c9a75a 0.55px,transparent .55px);background-size:18px 18px;mask-image:linear-gradient(to bottom,black,transparent 70%)}.app-frame{width:100%;max-width:470px;padding:20px 17px 0;position:relative;z-index:1}.centered{align-items:center}.loader{color:#a99b82}.brand{display:flex;align-items:center;gap:11px;padding:4px 0}
.brand-logo{display:block;width:auto;height:auto;max-height:110px;max-width:calc(100% - 140px);min-width:0;object-fit:contain;object-position:left center}.bat{font-size:28px;color:#d7af58;transform:rotate(180deg);filter:drop-shadow(0 0 10px #8d6d2d66)}.brand-name{font-family:Cinzel,serif;font-weight:800;font-size:21px;letter-spacing:.14em;color:#ead4a0}.brand-sub{font-size:9px;letter-spacing:.25em;color:#9c8c70;margin-top:1px}.brand-actions{margin-left:auto;display:flex;gap:7px}.motto{font-family:Cinzel,serif;color:#8f816c;font-size:11px;letter-spacing:.08em;margin:5px 0 17px 39px}.icon-btn{background:#17130e;border:1px solid #3c3020;color:#cbb889;border-radius:11px;padding:8px;display:flex;cursor:pointer}.tabs{display:flex;border-bottom:1px solid #30271b;margin-bottom:14px}.tab{flex:1;border:0;background:none;color:#766b5a;padding:10px 4px;font-weight:700;font-size:12px;cursor:pointer}.tab.active{color:#d7af58;border-bottom:2px solid #d7af58}.available-card,.university-card,.daily-card,.budget-card,.month-card,.alert-card,.gap-card,.meta-card,.six-card{background:linear-gradient(145deg,#19150f,#0f0e0c);border:1px solid #33291c;box-shadow:0 12px 35px #00000042}.available-card{border-radius:20px;padding:19px}.eyebrow,.card-kicker{font-size:10px;letter-spacing:.16em;color:#94856c;font-weight:700}.available-amount{font-family:Cinzel,serif;font-weight:800;font-size:38px;line-height:1.08;color:#f3e6ca;margin:7px 0 10px}.available-stats{display:flex;gap:17px;color:#9d917d;font-size:12px}.available-stats span{display:flex;gap:5px;align-items:center}.available-stats span:first-child{color:#b8a267}.alert-card{margin-top:11px;border-radius:15px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start}.alert-card strong{font-family:Cinzel,serif;font-size:12px;letter-spacing:.03em}.alert-card p{font-size:11px;color:#928777;margin:4px 0 0;line-height:1.4}.alert-icon{color:#d7af58}.alert-card.rojo{border-color:#654132}.alert-card.rojo .alert-icon{color:#c7775f}.alert-card.amarillo .alert-icon{color:#d7af58}.university-card{margin-top:11px;border-radius:19px;padding:16px;display:flex;align-items:center;gap:16px}.ring-wrap{width:132px;height:132px;position:relative;flex-shrink:0}.ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}.ring-center b{font-family:Cinzel,serif;font-size:25px;color:#e4c879}.ring-center span{font-size:9px;color:#817667;letter-spacing:.1em;text-transform:uppercase}.university-info{flex:1}.university-info h2{font-family:Cinzel,serif;font-size:22px;margin:5px 0 10px;color:#eee0c1}.mini-row{display:flex;justify-content:space-between;font-size:11px;margin-top:5px;color:#827767}.mini-row b{color:#d7c39c}.daily-card{margin-top:11px;border-radius:18px;padding:15px;display:flex;gap:12px;align-items:center;border-color:#5b4524}.daily-icon{width:39px;height:39px;border-radius:12px;background:#2b2113;color:#d7af58;display:grid;place-items:center;flex-shrink:0}.daily-number{font-family:Cinzel,serif;font-size:24px;font-weight:800;color:#e5cc8d;margin-top:4px}.daily-number small{font-family:Inter,sans-serif;font-size:10px;color:#8d806c;font-weight:500}
.daily-secondary{font-size:18px;margin-top:1px;color:#bfa768}.daily-card p{font-size:10.5px;color:#847867;margin:3px 0 0;line-height:1.35}.budget-card{margin-top:11px;border-radius:18px;padding:17px;border-color:#493a22}
.month-card{margin-top:11px;border-radius:18px;padding:16px}
.month-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.month-head .icon-btn:disabled{opacity:.3;cursor:default}
.month-name{font-family:Cinzel,serif;font-weight:700;font-size:14px;letter-spacing:.05em;color:#d9c49a;text-transform:capitalize}
.month-total{font-family:Cinzel,serif;font-weight:800;font-size:30px;color:#f3e6ca;margin:6px 0 12px}
.month-list{display:flex;flex-direction:column;gap:11px}
.month-row-top{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:#b9ab91}
.month-row-top span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}
.month-row-top b{color:#e6d3a6;font-weight:600;white-space:nowrap}
.month-bar{height:5px;border-radius:5px;background:#231d14;margin-top:5px;overflow:hidden}
.month-bar i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#9c7a30,#d7af58)}
.month-empty{font-size:12px;color:#766d60}.budget-head{display:flex;align-items:center;gap:8px;color:#bfa768;font-size:10px;letter-spacing:.12em;font-weight:700}.budget-amount{font-family:Cinzel,serif;font-size:31px;font-weight:800;color:#eee1c3;margin:6px 0}.budget-sub,.gap-sub{font-size:11px;color:#827667;line-height:1.45}.gap-card{margin-top:11px;border-radius:17px;padding:14px;border-color:#5a3c27}.gap-title{font-family:Cinzel,serif;font-size:13px;color:#d7af58;margin-bottom:4px}.section-title{font-family:Cinzel,serif;font-weight:700;font-size:15px;letter-spacing:.04em;margin:22px 0 10px;color:#d9c49a}.metas-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.meta-card{position:relative;border-radius:15px;padding:13px;cursor:pointer;transition:border-color .2s}
.meta-del{position:absolute;top:7px;right:7px;background:none;border:none;color:#8f816c;padding:5px;cursor:pointer;display:flex}.meta-card-active{border-color:#d7af58}.meta-card-add{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#8d7f68;border-style:dashed}.meta-card-add span{font-size:11px;font-weight:700}.meta-icon{width:31px;height:31px;border-radius:9px;border:1px solid;display:grid;place-items:center;margin-bottom:9px}.meta-nombre{font-size:11px;color:#a99a84;margin-bottom:3px}.meta-monto{font-family:Cinzel,serif;font-weight:700;font-size:15px}.meta-objetivo{font-size:9.5px;color:#716758;margin:3px 0 8px}.meta-bar-track{height:5px;background:#292117;border-radius:5px;overflow:hidden}.meta-bar-fill{height:100%;border-radius:5px;transition:width .5s}.config-meta-list{display:flex;flex-direction:column;gap:8px;margin-bottom:14px}.config-meta-row{display:flex;align-items:center;justify-content:space-between;background:#13110e;border:1px solid #2d2419;border-radius:12px;padding:10px 12px}.config-meta-info{display:flex;flex-direction:column;gap:3px;font-size:12px}.config-meta-info span{font-size:10.5px;color:#87795f}.config-meta-actions{display:flex;gap:6px}.config-meta-actions .icon-btn{padding:6px}.hist-list{display:flex;flex-direction:column}.hist-row{display:flex;align-items:center;gap:9px;padding:11px 3px;border-bottom:1px solid #211b13}.hist-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}.dot-in{background:#b99a4e;box-shadow:0 0 8px #b99a4e55}.dot-out{background:#a95f49}.hist-body{flex:1;min-width:0;cursor:pointer}
.field-hint{font-size:11px;color:#8f816c;margin:-6px 0 13px}
.login-card{width:100%;max-width:380px;margin:auto;padding:24px 22px;border-radius:22px;background:linear-gradient(145deg,#19150f,#0f0e0c);border:1px solid #33291c;box-shadow:0 12px 35px #00000060}
.login-logo{display:block;max-width:100%;max-height:150px;margin:0 auto 12px;object-fit:contain}
.login-title{font-family:Cinzel,serif;font-weight:800;font-size:20px;color:#f3e6ca;margin:4px 0 6px}
.login-sub{font-size:12px;color:#8f816c;line-height:1.5;margin:0 0 16px}
.login-msg{font-size:12px;line-height:1.45;margin:0 0 12px}
.login-msg.err{color:#e58a7b}.login-msg.ok{color:#9fcf8a}
.login-links{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;margin-top:10px}
.login-link{background:none;border:none;color:#d7af58;font-size:12px;text-decoration:underline;cursor:pointer;padding:6px 0}
.submit-btn:disabled{opacity:.6;cursor:default}
.account-mail{font-size:13px;color:#e6d3a6;margin-bottom:4px;word-break:break-all}
.account-sync{font-size:11.5px;color:#8f816c;margin-bottom:12px}
.account-sync.ok{color:#9fcf8a}.account-sync.offline,.account-sync.error{color:#e0b060}.hist-top{display:flex;justify-content:space-between;gap:8px}.hist-nota{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.hist-amt-in,.hist-amt-out{font-size:12px;font-weight:700;flex-shrink:0}.hist-amt-in{color:#cdb36f}.hist-amt-out{color:#bc755e}.hist-sub{font-size:9.5px;color:#6f6558;margin-top:3px}.del-btn{background:none;border:0;color:#4d453b;cursor:pointer;padding:5px}.empty-state{font-size:12px;color:#766d60;background:#13110e;border:1px dashed #33291e;border-radius:14px;padding:20px;text-align:center}.fab-row{position:fixed;bottom:13px;left:50%;transform:translateX(-50%);width:100%;max-width:470px;padding:0 13px;display:flex;gap:7px;z-index:30}.fab{flex:1;border-radius:14px;padding:13px 7px;border:1px solid #3b3022;font-weight:800;font-size:11px;display:flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;box-shadow:0 9px 28px #00000070}.fab-out{background:#17130f;color:#c9b99b}.fab-save{background:#2a2115;color:#d7af58;border-color:#5b4625}.fab-in{background:#d7af58;color:#17120c;border-color:#d7af58}.modal-backdrop{position:fixed;inset:0;background:#050403cc;display:flex;align-items:flex-end;justify-content:center;z-index:50;backdrop-filter:blur(4px)}.modal{width:100%;max-width:470px;max-height:90vh;overflow:auto;background:linear-gradient(145deg,#1b1711,#0e0d0b);border:1px solid #443522;border-radius:22px 22px 0 0;padding:20px 17px 28px;box-shadow:0 -15px 50px #000}.setup-text{font-size:12px;color:#8f816c;line-height:1.5;margin:-4px 0 15px}.goal-link{margin-top:8px;background:none;border:0;color:#d7af58;font-weight:800;font-size:11px;padding:0;cursor:pointer;text-decoration:underline}.modal-head{display:flex;justify-content:space-between;align-items:center;font-family:Cinzel,serif;font-weight:700;font-size:14px;margin-bottom:16px;color:#e1cea0}.field-label{font-size:10px;letter-spacing:.1em;color:#887b69;margin-bottom:6px;display:block;text-transform:uppercase}.field-input{width:100%;background:#0b0a08;border:1px solid #3a2e20;color:#eee3cd;border-radius:11px;padding:12px 13px;font-size:15px;margin-bottom:13px;outline:none}.field-input:focus{border-color:#8d6e36}.chip-row{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:13px}.chip{background:#0c0b09;border:1px solid #33291e;color:#9c907e;border-radius:20px;padding:7px 10px;font-size:10.5px;cursor:pointer}.chip-active{background:#251d12;color:#d7af58}.submit-btn{width:100%;border:0;border-radius:12px;padding:13px;font-weight:800;font-size:13px;cursor:pointer}.submit-in{background:#d7af58;color:#17120c}.submit-out{background:#6d3e31;color:#f3dfd4}.calc-ops{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin:-3px 0 12px}.calc-op{background:#16120e;border:1px solid #33291e;color:#b7a78c;border-radius:10px;padding:10px;font-size:17px}.calc-op.active{color:#d7af58;border-color:#80632f;background:#241c11}.calc-result{font-family:Cinzel,serif;font-size:30px;color:#e4c97e;text-align:center;border-top:1px solid #2e251a;padding-top:15px}.six-card{border-radius:19px;padding:15px}.legend{display:flex;flex-direction:column;gap:5px;color:#7e7467;font-size:9.5px}.legend span{display:flex;align-items:center;gap:6px}.legend-dot{width:7px;height:7px;border-radius:50%;display:inline-block}.gold{background:#d7af58}.line{border:1px solid #69593e}.chart{height:230px;display:flex;align-items:end;gap:8px;padding:20px 3px 4px;border-bottom:1px solid #30271c;margin-top:8px}.bar-col{height:100%;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:end;gap:5px}.bar-value{font-size:7px;color:#8d7e67;height:18px;white-space:nowrap;overflow:hidden;max-width:100%;text-overflow:ellipsis}.bar-track{height:165px;width:22px;background:#211a12;border-radius:8px;display:flex;align-items:end;overflow:hidden}.bar-fill{width:100%;background:linear-gradient(to top,#765a2d,#d7af58);border-radius:8px 8px 0 0;min-height:2px}.bar-col>span{font-size:9px;color:#776d5e;text-transform:uppercase}.six-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:15px}.six-summary div{background:#13100d;border:1px solid #2d2419;border-radius:12px;padding:10px}.six-summary span{display:block;color:#766b5c;font-size:9px}.six-summary b{display:block;color:#d8c397;font-family:Cinzel,serif;font-size:13px;margin-top:4px}@media(min-width:700px){.app-frame{padding-top:30px}.fab-row{bottom:20px}}

.welcome-splash{position:fixed;inset:0;z-index:100;overflow:hidden;background:#050505;display:flex;align-items:center;justify-content:center;animation:welcomeIn .45s ease both}.welcome-image{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center}.welcome-vignette{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(0,0,0,.48) 52%,rgba(0,0,0,.86));pointer-events:none}.welcome-content{position:absolute;left:0;right:0;bottom:7%;text-align:center;padding:0 24px;color:#f4ead7;text-shadow:0 2px 18px #000;display:flex;flex-direction:column;align-items:center}.welcome-brand{font-family:Cinzel,serif;font-size:31px;letter-spacing:.22em;color:#e5c778;font-weight:800}.welcome-kicker{font-size:9px;letter-spacing:.35em;color:#b6a487;margin-top:2px}.welcome-message{font-family:Cinzel,serif;font-size:15px;line-height:1.55;max-width:380px;margin:14px auto 18px;color:#f4e9d2}.welcome-continue{border:1px solid #d7af58;background:linear-gradient(145deg,#d7af58,#8f6927);color:#17110a;border-radius:999px;padding:13px 28px;font-weight:900;letter-spacing:.05em;box-shadow:0 8px 30px #0008;cursor:pointer}.welcome-sound{font-size:9px;color:#b7a98f;margin-top:10px;letter-spacing:.08em}.sound-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#776b58;margin-right:5px}.sound-active{background:#d7af58;box-shadow:0 0 10px #d7af58}.chart{overflow-x:auto}.chart .bar-col{min-width:38px}@keyframes welcomeIn{from{opacity:0;transform:scale(1.015)}to{opacity:1;transform:scale(1)}}
`;
