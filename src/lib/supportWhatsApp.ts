/**
 * Centralized Senzu Home Customer Service WhatsApp Provider
 * Single Source of Truth for Customer Service WhatsApp across the entire application.
 *
 * Source Priority:
 * 1. activeBranch.customerServiceWhatsApp
 * 2. businessSettings.customerSupportWhatsApp
 * 3. companySettings.customerServiceWhatsApp (or company.officialWhatsApp)
 * 4. generalSettings.contactWhatsApp
 * Fallback: Official Senzu CS WhatsApp (+6289654623347)
 */

import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import {
  CompanySettings,
  Branch,
  BusinessSettings,
  AppSettings,
} from '../types';
import {
  DEFAULT_COMPANY_SETTINGS,
  DEFAULT_BRANCH_PALEMBANG,
  DEFAULT_BUSINESS_SETTINGS,
  getCompanySettings,
  getBranches,
  getBusinessSettings,
} from './masterDataService';
import { getSettings } from './dbService';
import { normalizeWhatsApp, formatWhatsAppDisplay } from './masterDataUtils';

export const OFFICIAL_SENZU_WHATSAPP = '+6289654623347';
export const OFFICIAL_SENZU_WA_ME_TARGET = '6289654623347';
export const DEFAULT_CS_MESSAGE =
  'Halo Senzu Home, saya ingin tanya layanan pijat dan refleksi';
export const CS_UNAVAILABLE_MESSAGE = 'Nomor Customer Service belum tersedia.';

/**
 * Normalizes any phone string to digits-only wa.me target (e.g. '6289654623347').
 * Ensures Indonesian numbers starting with '0' become '62...' (never 0896... inside wa.me).
 * Strips '+', spaces, hyphens, and any non-numeric characters.
 */
export function getWaMeTarget(rawPhone?: string): string {
  if (!rawPhone || !rawPhone.trim()) return '';
  // Check if raw contains the old demo number pattern and reject it
  if (rawPhone.includes('1239876') || rawPhone.includes('123-9876')) {
    return OFFICIAL_SENZU_WA_ME_TARGET;
  }
  const normalized = normalizeWhatsApp(rawPhone);
  const digits = normalized.replace(/\D/g, '');
  if (digits.startsWith('0')) {
    return `62${digits.substring(1)}`;
  }
  return digits;
}

/**
 * Resolves the official Senzu Customer Service WhatsApp number according to priority:
 * 1. activeBranch.customerServiceWhatsApp
 * 2. businessSettings.customerSupportWhatsApp
 * 3. companySettings.customerServiceWhatsApp (or company.officialWhatsApp)
 * 4. generalSettings.contactWhatsApp
 * Default: OFFICIAL_SENZU_WHATSAPP ('+6289654623347')
 */
export function resolveCustomerServiceWhatsApp(sources?: {
  activeBranch?: Partial<Branch> | null;
  businessSettings?: Partial<BusinessSettings> | null;
  companySettings?: Partial<CompanySettings> | null;
  generalSettings?: Partial<AppSettings> | null;
}): string {
  // 1. active branch
  const branchWa = sources?.activeBranch?.customerServiceWhatsApp?.trim();
  if (branchWa && !branchWa.includes('1239876')) {
    return normalizeWhatsApp(branchWa);
  }

  // 2. business settings
  const bizWa = sources?.businessSettings?.customerSupportWhatsApp?.trim();
  if (bizWa && !bizWa.includes('1239876')) {
    return normalizeWhatsApp(bizWa);
  }

  // 3. company settings
  const compWa =
    sources?.companySettings?.customerServiceWhatsApp?.trim() ||
    (sources?.companySettings as any)?.officialWhatsApp?.trim();
  if (compWa && !compWa.includes('1239876')) {
    return normalizeWhatsApp(compWa);
  }

  // 4. general app settings
  const genWa = sources?.generalSettings?.contactWhatsApp?.trim();
  if (genWa && !genWa.includes('1239876')) {
    return normalizeWhatsApp(genWa);
  }

  return OFFICIAL_SENZU_WHATSAPP;
}

/**
 * Builds the official wa.me URL for contacting Senzu Customer Service.
 */
export function buildCustomerServiceWhatsAppUrl(
  phoneOrSources?:
    | string
    | {
        activeBranch?: Partial<Branch> | null;
        businessSettings?: Partial<BusinessSettings> | null;
        companySettings?: Partial<CompanySettings> | null;
        generalSettings?: Partial<AppSettings> | null;
      },
  message: string = DEFAULT_CS_MESSAGE
): string {
  let rawNumber: string;
  if (typeof phoneOrSources === 'string') {
    rawNumber = phoneOrSources;
  } else {
    rawNumber = resolveCustomerServiceWhatsApp(phoneOrSources);
  }

  const target = getWaMeTarget(rawNumber);
  if (!target) return '';
  return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
}

// Shared global cache & subscribers to avoid redundant Firestore listeners & reads
let sharedActiveBranch: Branch = DEFAULT_BRANCH_PALEMBANG;
let sharedBusinessSettings: BusinessSettings = DEFAULT_BUSINESS_SETTINGS;
let sharedCompanySettings: CompanySettings = DEFAULT_COMPANY_SETTINGS;
let sharedGeneralSettings: AppSettings | null = null;
let sharedIsLoading = false;
let sharedListenersInitialized = false;
const sharedSubscribers = new Set<() => void>();

function notifySharedSubscribers() {
  sharedSubscribers.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

function initSharedSupportListeners() {
  if (sharedListenersInitialized) return;
  sharedListenersInitialized = true;
  sharedIsLoading = true;

  // Single batch load for the whole app session
  Promise.all([
    getBranches().catch(() => [DEFAULT_BRANCH_PALEMBANG]),
    getBusinessSettings().catch(() => DEFAULT_BUSINESS_SETTINGS),
    getCompanySettings().catch(() => DEFAULT_COMPANY_SETTINGS),
    getSettings().catch(() => null),
  ])
    .then(([branches, biz, comp, gen]) => {
      const defBranch = branches.find((b) => b.isDefault) || branches[0] || DEFAULT_BRANCH_PALEMBANG;
      sharedActiveBranch = defBranch;
      if (biz) sharedBusinessSettings = biz;
      if (comp) sharedCompanySettings = comp;
      if (gen) sharedGeneralSettings = gen;
      sharedIsLoading = false;
      notifySharedSubscribers();
    })
    .catch(() => {
      sharedIsLoading = false;
      notifySharedSubscribers();
    });

  // Attach persistent single listeners with quota-exhausted safety
  try {
    onSnapshot(
      doc(db, 'settings', 'company'),
      (snap) => {
        if (snap.exists()) {
          sharedCompanySettings = snap.data() as CompanySettings;
          notifySharedSubscribers();
        }
      },
      (err) => {
        if (err.code !== 'resource-exhausted') {
          console.warn('Company settings support sync notice:', err.message);
        }
      }
    );

    onSnapshot(
      doc(db, 'settings', 'business'),
      (snap) => {
        if (snap.exists()) {
          sharedBusinessSettings = snap.data() as BusinessSettings;
          notifySharedSubscribers();
        }
      },
      (err) => {
        if (err.code !== 'resource-exhausted') {
          console.warn('Business settings support sync notice:', err.message);
        }
      }
    );

    onSnapshot(
      doc(db, 'settings', 'general'),
      (snap) => {
        if (snap.exists()) {
          sharedGeneralSettings = snap.data() as AppSettings;
          notifySharedSubscribers();
        }
      },
      (err) => {
        if (err.code !== 'resource-exhausted') {
          console.warn('General settings support sync notice:', err.message);
        }
      }
    );
  } catch (err) {
    console.warn('Shared support listeners initialization notice:', err);
  }
}

/**
 * React Hook providing real-time access to the official centralized Senzu CS WhatsApp.
 * Uses a centralized singleton cache to prevent quota exhaustion from duplicate listeners.
 */
export function useCustomerServiceWhatsApp() {
  const [, setTick] = useState(0);

  useEffect(() => {
    initSharedSupportListeners();
    const updater = () => setTick((t) => t + 1);
    sharedSubscribers.add(updater);
    return () => {
      sharedSubscribers.delete(updater);
    };
  }, []);

  const whatsAppNumber = resolveCustomerServiceWhatsApp({
    activeBranch: sharedActiveBranch,
    businessSettings: sharedBusinessSettings,
    companySettings: sharedCompanySettings,
    generalSettings: sharedGeneralSettings,
  });

  const waMeTarget = getWaMeTarget(whatsAppNumber);
  const displayWhatsApp = formatWhatsAppDisplay(whatsAppNumber);
  const isAvailable = Boolean(waMeTarget);

  const getWhatsAppUrl = useCallback(
    (message: string = DEFAULT_CS_MESSAGE, targetNumber?: string): string => {
      const target = targetNumber ? getWaMeTarget(targetNumber) : waMeTarget;
      if (!target) return '';
      return `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
    },
    [waMeTarget]
  );

  const openWhatsApp = useCallback(
    (message: string = DEFAULT_CS_MESSAGE, targetNumber?: string) => {
      const target = targetNumber ? getWaMeTarget(targetNumber) : waMeTarget;
      if (!target) {
        alert(CS_UNAVAILABLE_MESSAGE);
        return;
      }
      const url = `https://wa.me/${target}?text=${encodeURIComponent(message)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    [isAvailable, waMeTarget]
  );

  return {
    whatsAppNumber,
    displayWhatsApp,
    waMeTarget,
    isAvailable,
    isLoading: sharedIsLoading,
    unavailableNotice: CS_UNAVAILABLE_MESSAGE,
    getWhatsAppUrl,
    openWhatsApp,
  };
}
