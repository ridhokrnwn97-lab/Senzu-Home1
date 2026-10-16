import { auth } from './firebase';
import { getMetaAdsSettings } from './metaAdsService';
import type { MetaAdsSettings, MetaAdsTrigger } from './metaAdsSettings';

type Fbq = ((...args: any[]) => void) & {
  callMethod?: (...args: any[]) => void;
  queue: any[][];
  push: Fbq;
  loaded: boolean;
  version: string;
};
type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };
const initialized = new Set<string>(), sentThisPage = new Set<string>();
const storageKey = 'senzu_meta_events_v1';
let sdkPromise: Promise<Fbq> | null = null;

function privacyAllowsTracking(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined' && typeof navigator !== 'undefined'
    && !(navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
    && navigator.doNotTrack !== '1' && (window as Window & { doNotTrack?: string }).doNotTrack !== '1';
}

async function bounded<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('META_PIXEL_TIMEOUT')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function loadSdk(): Promise<Fbq> {
  const target = window as PixelWindow;
  if (typeof target.fbq === 'function' && typeof target.fbq.callMethod === 'function') return Promise.resolve(target.fbq);
  if (sdkPromise) return sdkPromise;
  if (!target.fbq) {
    const queue = function (...args: any[]) {
      if (queue.callMethod) queue.callMethod.apply(queue, args);
      else queue.queue.push(args);
    } as Fbq;
    queue.queue = []; queue.push = queue; queue.loaded = true; queue.version = '2.0';
    target.fbq = queue; target._fbq = queue;
  }
  sdkPromise = new Promise<Fbq>((resolve, reject) => {
    const script = document.createElement('script');
    const finish = (error?: Error) => {
      clearTimeout(timer); script.onload = null; script.onerror = null;
      if (error || typeof target.fbq?.callMethod !== 'function') {
        script.remove(); reject(error || new Error('META_PIXEL_SDK_UNAVAILABLE'));
      } else resolve(target.fbq);
    };
    const timer = setTimeout(() => finish(new Error('META_PIXEL_SDK_TIMEOUT')), 8000);
    script.id = 'senzu-meta-pixel-sdk'; script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.referrerPolicy = 'strict-origin';
    script.onload = () => finish(); script.onerror = () => finish(new Error('META_PIXEL_SDK_BLOCKED'));
    document.head.appendChild(script);
  }).catch(error => { sdkPromise = null; throw error; });
  return sdkPromise;
}

function targets(settings: MetaAdsSettings, action: MetaAdsTrigger) {
  const result = new Map<string, { pixelId: string; kind: 'standard' | 'custom'; eventName: string }>();
  if (!settings.enabled) return [];
  for (const pixel of settings.pixels) if (pixel.enabled) {
    for (const event of settings.events) if (event.enabled && (event.trigger === action
      || (event.trigger === 'payment_confirmation_or_proof' && ['payment_confirmation_clicked', 'payment_proof_submitted'].includes(action)))
      && (event.pixelIds === 'all' || event.pixelIds.includes(pixel.id))) {
      result.set(`${pixel.pixelId}:${event.kind}:${event.eventName}`, { pixelId: pixel.pixelId, kind: event.kind, eventName: event.eventName });
    }
  }
  return [...result.values()];
}

function previouslySent(key: string): boolean {
  if (sentThisPage.has(key)) return true;
  try {
    const records: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(records) && records.slice(-500).some(item => item === key);
  } catch { return false; }
}

function remember(key: string): void {
  sentThisPage.add(key);
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const records: string[] = Array.isArray(raw) ? raw.filter(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) : [];
    localStorage.setItem(storageKey, JSON.stringify([...new Set([...records, key])].slice(-500)));
  } catch { /* Storage restrictions must not affect the customer's action. */ }
}

/** Analytics is a non-blocking side effect; it never determines booking/payment success. */
export async function trackMetaAdsAction(action: MetaAdsTrigger, context: { entityId: string; value?: number }): Promise<void> {
  try {
    if (!privacyAllowsTracking() || typeof context.entityId !== 'string' || !context.entityId || context.entityId.length > 200) return;
    const session = auth.currentUser;
    const stable = () => auth.currentUser === session && privacyAllowsTracking();
    const initial = await bounded(getMetaAdsSettings(), 5000);
    if (!stable() || !targets(initial, action).length) return;
    const fbq = await loadSdk();
    if (!stable()) return;
    // Re-read after SDK loading so an edited, disabled or deleted Pixel/rule is respected.
    const current = await bounded(getMetaAdsSettings(), 5000);
    if (!stable()) return;
    for (const target of targets(current, action)) {
      const buffer = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(
        JSON.stringify([target.pixelId, target.kind, target.eventName, action.startsWith('payment_') ? 'payment' : action, context.entityId])
      ));
      const key = Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2, '0')).join('');
      if (!stable() || previouslySent(key)) continue;
      if (!initialized.has(target.pixelId)) {
        fbq('set', 'autoConfig', false, target.pixelId);
        fbq('init', target.pixelId); // No advanced matching or customer identifiers.
        initialized.add(target.pixelId);
      }
      const parameters = ['AddToCart', 'Purchase'].includes(target.eventName) && typeof context.value === 'number'
        && Number.isFinite(context.value) && context.value >= 0
        ? { value: context.value, currency: 'IDR' } : {};
      fbq(target.kind === 'custom' ? 'trackSingleCustom' : 'trackSingle', target.pixelId, target.eventName, parameters, { eventID: `sh_${key}` });
      remember(key); // Queued to the SDK; this is not a claim of delivery to Meta.
    }
  } catch { /* Blocked SDK, unavailable settings, or browser privacy limits never block checkout. */ }
}
