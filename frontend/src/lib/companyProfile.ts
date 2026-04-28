import { doc, getDoc, setDoc } from 'firebase/firestore';

import { getFirebaseDb } from './firebase';

export type CompanyProfile = {
  companyName: string;
  companyDescription: string;
  industry: string;
  products: string;
  services: string;
  valueProposition: string;
  targetMarket: string;
  keyDifferentiators: string;
  brandVoice: string;
};

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  companyName: '',
  companyDescription: '',
  industry: '',
  products: '',
  services: '',
  valueProposition: '',
  targetMarket: '',
  keyDifferentiators: '',
  brandVoice: '',
};

const COMPANY_PROFILE_FIELD_LABELS: Record<keyof CompanyProfile, string> = {
  companyName: 'Company name',
  companyDescription: 'Company description',
  industry: 'Industry',
  products: 'Products',
  services: 'Services',
  valueProposition: 'Value proposition',
  targetMarket: 'Target market',
  keyDifferentiators: 'Key differentiators',
  brandVoice: 'Brand voice',
};

const LOCAL_CACHE_KEY = 'company_profile_cache';

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProfile(value: unknown): CompanyProfile {
  if (!value || typeof value !== 'object') {
    return { ...EMPTY_COMPANY_PROFILE };
  }
  const candidate = value as Partial<Record<keyof CompanyProfile, unknown>>;
  return {
    companyName: asString(candidate.companyName),
    companyDescription: asString(candidate.companyDescription),
    industry: asString(candidate.industry),
    products: asString(candidate.products),
    services: asString(candidate.services),
    valueProposition: asString(candidate.valueProposition),
    targetMarket: asString(candidate.targetMarket),
    keyDifferentiators: asString(candidate.keyDifferentiators),
    brandVoice: asString(candidate.brandVoice),
  };
}

export function isCompanyProfileEmpty(profile: CompanyProfile): boolean {
  return Object.values(profile).every((entry) => !entry.trim());
}

export function loadCompanyProfileFromCache(): CompanyProfile {
  if (typeof window === 'undefined') {
    return { ...EMPTY_COMPANY_PROFILE };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_CACHE_KEY);
    if (!raw) {
      return { ...EMPTY_COMPANY_PROFILE };
    }
    return normalizeProfile(JSON.parse(raw));
  } catch {
    return { ...EMPTY_COMPANY_PROFILE };
  }
}

function saveCompanyProfileToCache(profile: CompanyProfile): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore cache write failures so save can still proceed.
  }
}

export async function loadCompanyProfile(userId: string | null): Promise<CompanyProfile> {
  const cached = loadCompanyProfileFromCache();

  if (!userId) {
    return cached;
  }

  const firestore = getFirebaseDb();
  if (!firestore) {
    return cached;
  }

  try {
    const snapshot = await getDoc(doc(firestore, 'users', userId));
    if (!snapshot.exists()) {
      return cached;
    }
    const data = snapshot.data() as { companyContext?: unknown };
    const remote = normalizeProfile(data.companyContext);
    if (!isCompanyProfileEmpty(remote)) {
      saveCompanyProfileToCache(remote);
      return remote;
    }
    return cached;
  } catch {
    return cached;
  }
}

export async function saveCompanyProfile(userId: string, profile: CompanyProfile): Promise<void> {
  const normalized = normalizeProfile(profile);
  saveCompanyProfileToCache(normalized);

  const firestore = getFirebaseDb();
  if (!firestore) {
    return;
  }

  await setDoc(
    doc(firestore, 'users', userId),
    { companyContext: normalized },
    { merge: true },
  );
}

export function companyProfileToContextLines(profile: CompanyProfile): string[] {
  const entries = Object.entries(profile) as Array<[keyof CompanyProfile, string]>;
  return entries
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => `${COMPANY_PROFILE_FIELD_LABELS[key]}: ${value.trim()}`);
}

export function companyProfileToPromptBlock(profile: CompanyProfile): string | null {
  const lines = companyProfileToContextLines(profile);
  if (lines.length === 0) {
    return null;
  }
  return [
    'Company context (use to ground tone, examples, audience framing, and product references):',
    ...lines.map((line) => `- ${line}`),
  ].join('\n');
}

const TREND_TERM_FIELDS: Array<keyof CompanyProfile> = [
  'industry',
  'products',
  'services',
  'targetMarket',
  'keyDifferentiators',
];

export function companyProfileToTrendTerms(profile: CompanyProfile, limit = 6): string[] {
  const collected: string[] = [];

  for (const field of TREND_TERM_FIELDS) {
    const value = profile[field];
    if (!value) continue;
    for (const part of value.split(/[,;\n]/)) {
      const term = part.trim();
      if (term.length >= 2 && term.length <= 60) {
        collected.push(term);
      }
    }
  }

  return Array.from(new Set(collected)).slice(0, limit);
}
