"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getFirebaseAuth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { trackAuthEvent } from "@/lib/analytics";
import { type AIConfig, type AIProvider, loadAIConfig, saveAIConfig } from "@/lib/aiConfig";
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

  useEffect(() => {
    setAiConfig(loadAIConfig());
  }, []);

  const handleAiSave = () => {
    saveAIConfig(aiConfig);
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
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
