"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { trackAuthEvent } from "@/lib/analytics";
import { type AIConfig, type AIProvider, loadAIConfig, saveAIConfig } from "@/lib/aiConfig";
import {
  type CompanyProfile,
  EMPTY_COMPANY_PROFILE,
  loadCompanyProfile,
  loadCompanyProfileFromCache,
  saveCompanyProfile,
} from "@/lib/companyProfile";
import { Spinner } from "@/components/Spinner";

export default function SettingsPage() {
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

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(EMPTY_COMPANY_PROFILE);
  const [companyUserId, setCompanyUserId] = useState<string | null>(null);
  const [companySaving, setCompanySaving] = useState(false);
  const [companySaved, setCompanySaved] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  useEffect(() => {
    setAiConfig(loadAIConfig());
    setCompanyProfile(loadCompanyProfileFromCache());
  }, []);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      const uid = user?.uid ?? null;
      setCompanyUserId(uid);
      void loadCompanyProfile(uid).then((profile) => setCompanyProfile(profile));
    });
    return () => unsubscribe();
  }, []);

  const handleAiSave = () => {
    saveAIConfig(aiConfig);
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  };

  const updateCompanyField = (field: keyof CompanyProfile) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setCompanyProfile((previous) => ({ ...previous, [field]: value }));
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

        <section className="surface-card p-6">
          <h2 className="section-title">Integration Connectors</h2>
          <p className="mt-2 muted-copy">CRM, docs, social platforms, analytics suites, and SSO providers.</p>
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
