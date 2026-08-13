import { useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LockKeyhole, ShieldCheck, Zap } from "lucide-react";
import { ApiError } from "../lib/api";
import type { Institution } from "../types";

interface Props {
  onConnect: (institutionId: string, blinkApiKey: string) => Promise<Institution>;
}

export function InstitutionLogin({ onConnect }: Props) {
  const [institutionId, setInstitutionId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onConnect(institutionId, apiKey);
      setApiKey("");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not verify this Blink API key");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand brand-light" href="#" aria-label="Rurbit Pay home">
          <span className="brand-mark"><Zap size={20} strokeWidth={2.6} /></span>
          <span>Rurbit <b>Pay</b></span>
        </a>
        <div className="story-content">
          <p className="eyebrow eyebrow-light">Institution payments, simplified</p>
          <h1>One file.<br />Every payment.<br /><em>Fully accounted for.</em></h1>
          <p className="story-copy">
            Send sats to your Rurbit community in a controlled batch using funds from your own Blink wallet.
          </p>
          <div className="trust-list">
            <div><span><LockKeyhole size={17} /></span><p><b>Encrypted by default</b><small>AES-256-GCM at rest</small></p></div>
            <div><span><ShieldCheck size={17} /></span><p><b>Your key stays server-side</b><small>Never stored in the browser</small></p></div>
            <div><span><Check size={17} /></span><p><b>Clear recipient reporting</b><small>Every outcome, row by row</small></p></div>
          </div>
        </div>
        <p className="story-foot">Built for responsible disbursement on Lightning.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-brand">
            <span className="brand-mark"><Zap size={19} /></span> Rurbit <b>Pay</b>
          </div>
          <div className="auth-heading">
            <span className="icon-tile"><KeyRound size={21} /></span>
            <div>
              <p className="eyebrow">Secure institution access</p>
              <h2>Connect your Blink wallet</h2>
            </div>
          </div>
          <p className="form-intro">
            We verify <b>Read</b> and <b>Write</b> scopes with Blink before accepting a batch.
          </p>

          <form onSubmit={submit} className="auth-form">
            <label>
              <span>Institution ID</span>
              <input
                value={institutionId}
                onChange={(event) => setInstitutionId(event.target.value)}
                placeholder="e.g. NGO-1234"
                autoCapitalize="characters"
                autoComplete="organization"
                required
                minLength={3}
                maxLength={64}
              />
              <small>Letters, numbers, hyphens, and underscores</small>
            </label>

            <label>
              <span>Blink API key</span>
              <div className="secret-input">
                <input
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  type={showKey ? "text" : "password"}
                  placeholder="blink_••••••••••••••••"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  minLength={16}
                />
                <button type="button" onClick={() => setShowKey((value) => !value)} aria-label={showKey ? "Hide key" : "Show key"}>
                  {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <small>Create a short-lived key with Read + Write scopes in Blink.</small>
            </label>

            {error && <div className="form-error" role="alert">{error}</div>}

            <button className="primary-button" disabled={submitting} type="submit">
              {submitting ? <><span className="spinner" /> Verifying with Blink…</> : <>Verify & continue <ArrowRight size={18} /></>}
            </button>
          </form>

          <div className="security-note">
            <ShieldCheck size={17} />
            <p><b>Local purge after every batch.</b> We delete our encrypted copy. You must still revoke the key in Blink to invalidate it remotely.</p>
          </div>
        </div>
        <p className="auth-legal">By continuing, you confirm you are authorized to spend from this wallet.</p>
      </section>
    </main>
  );
}
