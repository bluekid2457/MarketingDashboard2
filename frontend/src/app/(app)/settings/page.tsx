"use client";
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { trackAuthEvent } from '@/lib/analytics';
import { type AIConfig, type AIProvider, loadAIConfig, saveAIConfig } from '@/lib/aiConfig';
import { loadExaKey, saveExaKey } from '@/lib/exaConfig';
import { clearSessionMark } from '@/lib/sessionExpiry';
import {
  type CompanyProfile,
  EMPTY_COMPANY_PROFILE,
  loadCompanyProfile,
  loadCompanyProfileFromCache,
  saveCompanyProfile,
} from '@/lib/companyProfile';
import { disconnectIntegration, listIntegrationConnections, startLinkedInConnection, type IntegrationConnection } from '@/lib/integrations';
import { Spinner } from '@/components/Spinner';

type ConnectorNoticeTone = 'success' | 'error' | 'info';

function getConnectorBadgeClasses(status: string): string {
  if (status === 'connected') {
    return 'bg-emerald-100 text-emerald-800';
  }

  if (status === 'disconnected') {
    return 'bg-amber-100 text-amber-800';
  }

  return 'bg-slate-100 text-slate-700';
}

function formatConnectionStatus(status: string): string {
  if (status === 'connected') {
    return 'Connected';
  }

  if (status === 'disconnected') {
    return 'Disconnected';
  }

  return 'Not connected';
}

function formatDateTime(value: number | null | undefined): string | null {
  if (!value || Number.isNaN(value)) {
    return null;
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return null;
  }
}

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const [aiConfig, setAiConfig] = useState<AIConfig>({
    provider: 'openai',
    openaiKey: '',
    geminiKey: '',
    claudeKey: '',
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'gemma4',
  });
  const [aiSaved, setAiSaved] = useState(false);
  const [exaKey, setExaKey] = useState('');
  const [exaSaved, setExaSaved] = useState(false);

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(EMPTY_COMPANY_PROFILE);
  const [companyUserId, setCompanyUserId] = useState<string | null>(null);
  const [companySaving, setCompanySaving] = useState(false);
  const [companySaved, setCompanySaved] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [autofilling, setAutofilling] = useState(false);
  const [autofillNotice, setAutofillNotice] = useState<string | null>(null);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [integrationConnections, setIntegrationConnections] = useState<IntegrationConnection[]>([]);
  const [integrationLoading, setIntegrationLoading] = useState(false);
  const [integrationError, setIntegrationError] = useState<string | null>(null);
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null);
  const [integrationNoticeTone, setIntegrationNoticeTone] = useState<ConnectorNoticeTone>('info');
  const [connectorBusyKey, setConnectorBusyKey] = useState<string | null>(null);

  useEffect(() => {
    setAiConfig(loadAIConfig());
    setExaKey(loadExaKey());
    setCompanyProfile(loadCompanyProfileFromCache());
  }, []);

  const loadIntegrationStatus = useCallback(async (uid: string) => {
    setIntegrationLoading(true);
    setIntegrationError(null);
    try {
      const connections = await listIntegrationConnections(uid);
      setIntegrationConnections(connections);
    } catch (loadError) {
      setIntegrationError(loadError instanceof Error ? loadError.message : 'Unable to load integration status.');
    } finally {
      setIntegrationLoading(false);
    }
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      setCompanyUserId(uid);
      void loadCompanyProfile(uid).then((profile) => setCompanyProfile(profile));
      if (!uid) {
        setIntegrationConnections([]);
        setIntegrationLoading(false);
        setIntegrationError(null);
        return;
      }

      void loadIntegrationStatus(uid);
    });
    return () => unsubscribe();
  }, [loadIntegrationStatus]);

  useEffect(() => {
    const integration = searchParams.get('integration');
    const status = searchParams.get('status');
    if (!integration || !status) {
      return;
    }

    const providerLabel = integration === 'linkedin' ? 'LinkedIn' : integration;
    const message = searchParams.get('message');
    if (status === 'connected') {
      setIntegrationNotice(message || `${providerLabel} is connected for this user. Scheduled posts can use this saved authorization.`);
      setIntegrationNoticeTone('success');
    } else if (status === 'error') {
      setIntegrationNotice(message || `Unable to connect ${providerLabel}.`);
      setIntegrationNoticeTone('error');
    } else {
      setIntegrationNotice(message || `${providerLabel} authorization updated.`);
      setIntegrationNoticeTone('info');
    }

    router.replace('/settings');
  }, [router, searchParams]);

  const linkedinConnection = useMemo(
    () => integrationConnections.find((connection) => connection.provider === 'linkedin') ?? null,
    [integrationConnections],
  );

  const handleAiSave = () => {
    saveAIConfig(aiConfig);
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  };

  const handleExaSave = () => {
    saveExaKey(exaKey);
    setExaSaved(true);
    setTimeout(() => setExaSaved(false), 2000);
  };

  const updateCompanyField = (field: keyof CompanyProfile) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCompanyProfile((previous) => ({ ...previous, [field]: value }));
    };

  const handleAutofillFromWebsite = async () => {
    const trimmed = websiteUrl.trim();
    if (!trimmed) {
      setAutofillError('Enter a website URL first.');
      setAutofillNotice(null);
      return;
    }

    setAutofillError(null);
    setAutofillNotice(null);
    setAutofilling(true);
    try {
      const { provider, openaiKey, geminiKey, claudeKey, ollamaBaseUrl, ollamaModel } = aiConfig;
      const apiKeyMap: Record<AIProvider, string> = {
        openai: openaiKey,
        gemini: geminiKey,
        claude: claudeKey,
        ollama: '',
      };
      const apiKey = apiKeyMap[provider];

      if (provider !== 'ollama' && !apiKey) {
        setAutofillError(`Add your ${provider} API key under AI API Keys below before auto-filling.`);
        return;
      }

      const response = await fetch('/api/company/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          apiKey,
          ollamaBaseUrl,
          ollamaModel,
          websiteUrl: trimmed,
        }),
      });

      const payload = (await response.json()) as {
        profile?: Partial<CompanyProfile>;
        fetchedUrls?: string[];
        error?: string;
      };

      if (!response.ok || !payload.profile) {
        setAutofillError(payload.error || 'Auto-fill failed. Try again or fill the fields manually.');
        return;
      }

      const incoming = payload.profile;
      setCompanyProfile((previous) => ({
        companyName: incoming.companyName?.trim() || previous.companyName,
        companyDescription: incoming.companyDescription?.trim() || previous.companyDescription,
        industry: incoming.industry?.trim() || previous.industry,
        products: incoming.products?.trim() || previous.products,
        services: incoming.services?.trim() || previous.services,
        valueProposition: incoming.valueProposition?.trim() || previous.valueProposition,
        targetMarket: incoming.targetMarket?.trim() || previous.targetMarket,
        keyDifferentiators: incoming.keyDifferentiators?.trim() || previous.keyDifferentiators,
        brandVoice: incoming.brandVoice?.trim() || previous.brandVoice,
      }));

      const sourceLabel = payload.fetchedUrls && payload.fetchedUrls.length > 0
        ? payload.fetchedUrls.join(', ')
        : trimmed;
      setAutofillNotice(`Filled fields from ${sourceLabel}. Review and edit anything that looks off, then click Save.`);
    } catch (autofillException) {
      setAutofillError(autofillException instanceof Error ? autofillException.message : 'Auto-fill failed.');
    } finally {
      setAutofilling(false);
    }
  };

  const handleCompanySave = async () => {
    if (!companyUserId) {
      setCompanyError('Sign in to save your company profile.');
      return;
    }
    setCompanyError(null);
    setCompanySaving(true);
    try {
      await saveCompanyProfile(companyUserId, companyProfile);
      setCompanySaved(true);
      setTimeout(() => setCompanySaved(false), 2000);
    } catch (saveError) {
      setCompanyError(saveError instanceof Error ? saveError.message : 'Unable to save company profile.');
    } finally {
      setCompanySaving(false);
    }
  };

  const handleConnectLinkedIn = async () => {
    if (!companyUserId) {
      setIntegrationError('Sign in before connecting LinkedIn.');
      return;
    }

    setIntegrationError(null);
    setConnectorBusyKey('linkedin:connect');
    try {
      const payload = await startLinkedInConnection(companyUserId, '/settings');
      window.location.assign(payload.authorizeUrl);
    } catch (connectError) {
      setIntegrationError(connectError instanceof Error ? connectError.message : 'Unable to start the LinkedIn connection flow.');
      setConnectorBusyKey(null);
    }
  };

  const handleDisconnectProvider = async (provider: string) => {
    if (!companyUserId) {
      setIntegrationError('Sign in before disconnecting a provider.');
      return;
    }

    setIntegrationError(null);
    setConnectorBusyKey(`${provider}:disconnect`);
    try {
      const updatedConnection = await disconnectIntegration(provider, companyUserId);
      setIntegrationConnections((previous) => previous.map((item) => (item.provider === provider ? updatedConnection : item)));
      setIntegrationNotice(`${updatedConnection.label} has been disconnected for this user.`);
      setIntegrationNoticeTone('info');
    } catch (disconnectError) {
      setIntegrationError(disconnectError instanceof Error ? disconnectError.message : 'Unable to disconnect the provider right now.');
    } finally {
      setConnectorBusyKey(null);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    setError(null);
    const auth = getFirebaseAuth();
    if (!auth) {
      setError("Firebase not initialized.");
      setLoading(false);
      return;
    }
    try {
      trackAuthEvent("login_attempt", { action: "logout" });
      await signOut(auth);
      clearSessionMark();
      trackAuthEvent("login_success", { action: "logout" });
      try {
        sessionStorage.removeItem("ideas_sort_preference");
      } catch {
        // Ignore storage cleanup failures so logout can still complete.
      }
      router.replace("/login");
    } catch (e) {
      setError("Failed to log out. Please try again.");
      trackAuthEvent("login_failure", { action: "logout", error: String(e) });
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="surface-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-700">Screen 11</p>
        <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Settings and Compliance</h1>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">Company Profile</h2>
          <p className="mt-2 muted-copy">
            Tell us about your company so generated drafts, adaptations, and topic suggestions reflect your
            voice, audience, and offerings. All fields are optional — fill in whatever helps the AI.
          </p>

          <div className="mt-4 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-800">Auto-fill from website</h3>
            <p className="mt-1 text-sm text-slate-700">
              Paste your company website URL and we&apos;ll read the homepage and about page, then pre-fill the
              fields below. You can edit anything that looks off before saving.
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                type="url"
                inputMode="url"
                className="w-full flex-1 rounded-xl border border-slate-300 bg-white p-2 text-sm"
                placeholder="https://acme.com"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                disabled={autofilling}
              />
              <button
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                onClick={() => void handleAutofillFromWebsite()}
                disabled={autofilling || !websiteUrl.trim()}
              >
                {autofilling ? <Spinner size="sm" label="Auto-filling..." /> : 'Auto-fill from website'}
              </button>
            </div>
            {autofillNotice && (
              <p className="mt-2 text-sm font-medium text-teal-700">{autofillNotice}</p>
            )}
            {autofillError && (
              <p className="mt-2 text-sm text-red-600">{autofillError}</p>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Company name</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="Acme Co."
                value={companyProfile.companyName}
                onChange={updateCompanyField('companyName')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Industry</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="B2B SaaS, e-commerce, healthcare..."
                value={companyProfile.industry}
                onChange={updateCompanyField('industry')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Company description</label>
              <textarea
                className="min-h-[80px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="A short description of what your company does and who it serves."
                value={companyProfile.companyDescription}
                onChange={updateCompanyField('companyDescription')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Products</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="Main products you sell."
                value={companyProfile.products}
                onChange={updateCompanyField('products')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Services</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="Main services you offer."
                value={companyProfile.services}
                onChange={updateCompanyField('services')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Target market</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="Who your ideal customers are (segments, roles, sizes)."
                value={companyProfile.targetMarket}
                onChange={updateCompanyField('targetMarket')}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Value proposition</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="The core promise you make to customers."
                value={companyProfile.valueProposition}
                onChange={updateCompanyField('valueProposition')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Key differentiators</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="What sets you apart from competitors."
                value={companyProfile.keyDifferentiators}
                onChange={updateCompanyField('keyDifferentiators')}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Brand voice</label>
              <textarea
                className="min-h-[60px] w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="Tone, vocabulary, style guidance — e.g. confident, plainspoken, no jargon."
                value={companyProfile.brandVoice}
                onChange={updateCompanyField('brandVoice')}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              className="rounded-lg bg-teal-600 px-5 py-2 text-white font-semibold hover:bg-teal-700 disabled:opacity-60"
              onClick={handleCompanySave}
              disabled={companySaving || !companyUserId}
            >
              {companySaving ? <Spinner size="sm" label="Saving..." /> : 'Save Company Profile'}
            </button>
            {companySaved && <span className="text-sm font-medium text-teal-600">Saved!</span>}
            {!companyUserId && <span className="text-sm text-slate-500">Sign in to save changes.</span>}
            {companyError && <span className="text-sm text-red-600">{companyError}</span>}
          </div>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Brand Voice Editor</h2>
          <textarea
            className="mt-3 min-h-[140px] w-full rounded-xl border border-slate-300 p-3 text-sm"
            defaultValue="Confident, practical, and specific. Avoid hype language and unclear claims."
          />
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Compliance Flags</h2>
          <p className="mt-2 muted-copy">Enable claim checks, legal review gates, and industry rule packs.</p>
        </section>

        <section className="surface-card p-6">
          <h2 className="section-title">Audit Log Viewer</h2>
          <p className="mt-2 muted-copy">Immutable timeline of content edits, approvals, and publishing events.</p>
        </section>

        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">Integration Connectors</h2>
          <p className="mt-2 muted-copy">
            LinkedIn posting authorization is saved per user. Each person who wants automatic posting must connect
            their own LinkedIn account here once.
          </p>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-700">Per-user setup</h3>
              <ol className="mt-3 space-y-2 text-sm text-slate-700">
                <li>1. Sign into the dashboard with your own account.</li>
                <li>2. In this section, click <span className="font-semibold">Connect LinkedIn</span>.</li>
                <li>3. Sign into LinkedIn and approve the posting permissions prompt.</li>
                <li>4. Return to Settings and confirm the status changes to <span className="font-semibold">Connected</span>.</li>
                <li>5. After that, scheduled posts can publish for you without needing you online.</li>
              </ol>
            </div>
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-800">One-time app owner setup</h3>
              <ol className="mt-3 space-y-2 text-sm text-blue-900">
                <li>1. Create a LinkedIn developer app and enable the Share on LinkedIn product.</li>
                <li>2. Add the backend callback URL to LinkedIn: <span className="font-mono text-xs">/api/v1/auth/linkedin/callback</span>.</li>
                <li>3. Set <span className="font-mono text-xs">LINKEDIN_CLIENT_ID</span> and <span className="font-mono text-xs">LINKEDIN_CLIENT_SECRET</span> in the backend env.</li>
                <li>4. Make sure the frontend can reach the backend through <span className="font-mono text-xs">NEXT_PUBLIC_API_URL</span>.</li>
              </ol>
            </div>
          </div>

          {integrationNotice ? (
            <div
              className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                integrationNoticeTone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : integrationNoticeTone === 'error'
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              {integrationNotice}
            </div>
          ) : null}

          {integrationError ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {integrationError}
            </div>
          ) : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {integrationLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 xl:col-span-2">
                <Spinner size="sm" label="Loading provider connections..." />
              </div>
            ) : null}

            {!integrationLoading && integrationConnections.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 xl:col-span-2">
                Sign in to load provider connection status.
              </div>
            ) : null}

            {!integrationLoading
              ? integrationConnections.map((connection) => {
                  const isLinkedIn = connection.provider === 'linkedin';
                  const isConnected = connection.status === 'connected';
                  const busyKey = isLinkedIn
                    ? isConnected
                      ? 'linkedin:disconnect'
                      : 'linkedin:connect'
                    : null;
                  const isBusy = busyKey !== null && connectorBusyKey === busyKey;
                  const connectedAtLabel = formatDateTime(connection.connectedAtMs);
                  const expiresAtLabel = formatDateTime(connection.tokenExpiresAtMs);

                  return (
                    <article key={connection.provider} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold text-slate-900">{connection.label}</h3>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getConnectorBadgeClasses(connection.status)}`}>
                              {formatConnectionStatus(connection.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            {isLinkedIn
                              ? 'Recommended for automatic posting. Users connect their own account through LinkedIn OAuth.'
                              : 'Backend storage is ready for this provider. The user-facing connection flow will be added next.'}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-500">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1">Auth: {connection.authTypes.join(', ')}</span>
                          <span className="rounded-full bg-slate-100 px-2.5 py-1">
                            {connection.supportsScheduledPublish ? 'Scheduled publish ready' : 'Scheduled publish later'}
                          </span>
                        </div>
                      </div>

                      <dl className="mt-4 grid gap-3 sm:grid-cols-2 text-sm">
                        <div>
                          <dt className="font-medium text-slate-700">Connected account</dt>
                          <dd className="mt-1 text-slate-600">{connection.displayName || connection.email || 'Not connected yet'}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700">Stored scopes</dt>
                          <dd className="mt-1 text-slate-600">{connection.scopes?.length ? connection.scopes.join(', ') : 'None yet'}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700">Connected on</dt>
                          <dd className="mt-1 text-slate-600">{connectedAtLabel || 'Not connected yet'}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-slate-700">Token expires</dt>
                          <dd className="mt-1 text-slate-600">{expiresAtLabel || 'No expiry on file yet'}</dd>
                        </div>
                      </dl>

                      {linkedinConnection?.provider === 'linkedin' && isLinkedIn && isConnected && connection.metadata?.publishAuthorUrn ? (
                        <p className="mt-3 text-xs text-slate-500">
                          Saved publish identity: <span className="font-mono">{String(connection.metadata.publishAuthorUrn)}</span>
                        </p>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-3">
                        {isLinkedIn ? (
                          isConnected ? (
                            <button
                              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                              onClick={() => void handleDisconnectProvider(connection.provider)}
                              disabled={isBusy || !companyUserId}
                            >
                              {isBusy ? <Spinner size="sm" label="Disconnecting..." /> : 'Disconnect LinkedIn'}
                            </button>
                          ) : (
                            <button
                              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
                              onClick={() => void handleConnectLinkedIn()}
                              disabled={isBusy || !companyUserId}
                            >
                              {isBusy ? <Spinner size="sm" label="Starting..." /> : 'Connect LinkedIn'}
                            </button>
                          )
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-500">
                            UI connect controls for {connection.label} are coming next. The backend can already store auth for this provider.
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })
              : null}
          </div>

          {companyUserId && !integrationLoading && linkedinConnection && linkedinConnection.status !== 'connected' ? (
            <p className="mt-4 text-sm text-slate-600">
              LinkedIn must show <span className="font-semibold text-slate-900">Connected</span> here before unattended automatic posting can run for this user.
            </p>
          ) : null}
        </section>

        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">Security Settings</h2>
          <p className="mt-2 muted-copy">Enforce MFA, session controls, and access expiration policies.</p>
        </section>

        {/* AI API Keys */}
        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">AI API Keys</h2>
          <p className="mt-2 muted-copy">Configure your AI provider and API keys for AI-powered features.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Active Provider</label>
              <select
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                value={aiConfig.provider}
                onChange={(e) => setAiConfig({ ...aiConfig, provider: e.target.value as AIProvider })}
              >
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
                <option value="claude">Anthropic Claude</option>
                <option value="ollama">Local Ollama (Gemma)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">OpenAI API Key</label>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="sk-..."
                value={aiConfig.openaiKey}
                onChange={(e) => setAiConfig({ ...aiConfig, openaiKey: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Google Gemini API Key</label>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="AIza..."
                value={aiConfig.geminiKey}
                onChange={(e) => setAiConfig({ ...aiConfig, geminiKey: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Anthropic Claude API Key</label>
              <input
                type="password"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="sk-ant-..."
                value={aiConfig.claudeKey}
                onChange={(e) => setAiConfig({ ...aiConfig, claudeKey: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Ollama Base URL</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="http://127.0.0.1:11434"
                value={aiConfig.ollamaBaseUrl}
                onChange={(e) => setAiConfig({ ...aiConfig, ollamaBaseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Ollama Model</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-300 p-2 text-sm"
                placeholder="gemma4"
                value={aiConfig.ollamaModel}
                onChange={(e) => setAiConfig({ ...aiConfig, ollamaModel: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              className="rounded-lg bg-teal-600 px-5 py-2 text-white font-semibold hover:bg-teal-700"
              onClick={handleAiSave}
            >
              Save
            </button>
            {aiSaved && <span className="text-sm font-medium text-teal-600">Saved!</span>}
          </div>
        </section>

        {/* Exa Research Key */}
        <section className="surface-card p-6 lg:col-span-2">
          <h2 className="section-title">Research Sources (Exa AI)</h2>
          <p className="mt-2 muted-copy">
            Exa is a neural search engine that finds high-quality, semantically relevant sources for your drafts.
            When a key is saved, it replaces the default DuckDuckGo search for source retrieval.
            Exa only fetches sources — your configured AI model still writes the content.
            The app works without a key; drafts will just fall back to DuckDuckGo for research.
          </p>
          <div className="mt-4 max-w-md">
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Exa API Key
              <span className="ml-2 text-xs font-normal text-slate-400">(optional)</span>
            </label>
            <input
              type="password"
              className="w-full rounded-xl border border-slate-300 p-2 text-sm"
              placeholder="Your Exa API key"
              value={exaKey}
              onChange={(e) => setExaKey(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Get a key at exa.ai — the free tier includes enough searches for regular use.
            </p>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="rounded-lg bg-teal-600 px-5 py-2 text-white font-semibold hover:bg-teal-700"
              onClick={handleExaSave}
            >
              Save
            </button>
            {exaSaved && <span className="text-sm font-medium text-teal-600">Saved!</span>}
            {exaKey.trim() && !exaSaved && (
              <span className="text-xs text-emerald-700">Exa key configured — drafts will use Exa for source research.</span>
            )}
            {!exaKey.trim() && !exaSaved && (
              <span className="text-xs text-slate-400">No key saved — drafts will use DuckDuckGo as fallback.</span>
            )}
          </div>
        </section>

        {/* Log out button */}
        <section className="surface-card p-6 lg:col-span-2 flex flex-col items-start">
          <h2 className="section-title">Session</h2>
          <button
            className="mt-3 rounded-lg bg-red-600 px-5 py-2 text-white font-semibold hover:bg-red-700 disabled:opacity-60"
            onClick={handleLogout}
            disabled={loading}
          >
            {loading ? <Spinner size="sm" label="Logging out..." /> : "Log out"}
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </section>
      </div>
    </div>
  );
}
