import { useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ChevronDown, Clock3, History, KeyRound, LockKeyhole, LogOut, Plus, ShieldCheck, WalletCards, X, Zap } from "lucide-react";
import { usePayments } from "../hooks";
import { ApiError } from "../lib/api";
import type { Institution } from "../types";
import { CsvUpload } from "./CsvUpload";
import { PaymentResults } from "./PaymentResults";

interface Props {
  institution: Institution;
  onConnect: (institutionId: string, apiKey: string) => Promise<Institution>;
  onLogout: () => Promise<void>;
  onRefresh: () => Promise<void>;
}

function formatSats(value: string | null) {
  return value === null ? "—" : Number(value).toLocaleString("en-US");
}

export function Dashboard({ institution, onConnect, onLogout, onRefresh }: Props) {
  const payments = usePayments(institution.id, onRefresh);
  const [rekeyOpen, setRekeyOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [rekeying, setRekeying] = useState(false);
  const [rekeyError, setRekeyError] = useState<string | null>(null);

  async function rekey(event: FormEvent) {
    event.preventDefault();
    setRekeying(true);
    setRekeyError(null);
    try {
      await onConnect(institution.id, newKey);
      setNewKey("");
      setRekeyOpen(false);
      payments.reset();
    } catch (error) {
      setRekeyError(error instanceof ApiError ? error.message : "Could not verify this key");
    } finally {
      setRekeying(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <a className="brand" href="#top"><span className="brand-mark"><Zap size={19} strokeWidth={2.6} /></span><span>Rurbit <b>Pay</b></span></a>
          <nav aria-label="Primary">
            <a className="active" href="#payments"><Zap size={16} /> Payments</a>
            <a href="#history"><History size={16} /> History</a>
          </nav>
          <div className="institution-menu">
            <span className="institution-avatar">{institution.id.slice(0, 2)}</span>
            <span><b>{institution.id}</b><small>{institution.blinkUsername ? `@${institution.blinkUsername}` : "Blink institution"}</small></span>
            <ChevronDown size={16} />
            <button type="button" onClick={() => void onLogout()} title="Sign out"><LogOut size={17} /></button>
          </div>
        </div>
      </header>

      <main className="dashboard" id="top">
        <section className="welcome-row">
          <div>
            <p className="eyebrow">Institution workspace</p>
            <h1>Payments overview</h1>
            <p>Prepare, verify, and send Rurbit disbursements from one secure workflow.</p>
          </div>
          <button className="secondary-button" type="button" onClick={() => setRekeyOpen(true)}>
            <Plus size={17} /> {institution.keyStatus === "ACTIVE" ? "Replace API key" : "Add API key"}
          </button>
        </section>

        <section className="overview-grid" aria-label="Account overview">
          <div className="metric-card balance-card">
            <span className="metric-icon"><WalletCards size={20} /></span>
            <div><span>Verified balance</span><strong>{formatSats(institution.balance)} <small>{institution.walletCurrency === "BTC" ? "sats" : "cents"}</small></strong><p>Snapshot taken when the key was verified</p></div>
          </div>
          <div className="metric-card">
            <span className={`metric-icon ${institution.keyStatus === "ACTIVE" ? "green" : "amber"}`}>
              {institution.keyStatus === "ACTIVE" ? <ShieldCheck size={20} /> : <LockKeyhole size={20} />}
            </span>
            <div><span>API key</span><strong>{institution.keyStatus === "ACTIVE" ? "Verified & ready" : "Locally purged"}</strong><p>{institution.keyStatus === "ACTIVE" ? "Read + Write scopes confirmed" : "New key required for another batch"}</p></div>
          </div>
          <div className="metric-card">
            <span className="metric-icon blue"><BarChart3 size={20} /></span>
            <div><span>Recent batches</span><strong>{payments.history.length}</strong><p>Latest 20 payment batches</p></div>
          </div>
        </section>

        {institution.keyStatus === "PURGED" && !payments.batch && (
          <section className="key-required-banner">
            <span><KeyRound size={21} /></span>
            <div><b>A new Blink API key is required</b><p>The previous encrypted copy was removed after its batch. Add a fresh Read + Write key to continue.</p></div>
            <button className="secondary-button" onClick={() => setRekeyOpen(true)}>Add new key <ArrowRight size={16} /></button>
          </section>
        )}

        <div id="payments" className="workspace-grid">
          <div className="workspace-main">
            {!payments.batch && (
              <CsvUpload
                disabled={institution.keyStatus !== "ACTIVE"}
                busy={payments.busy}
                onUpload={payments.uploadCsv}
              />
            )}
            {payments.batch && (
              <PaymentResults
                batch={payments.batch}
                recipients={payments.recipients}
                warnings={payments.warnings}
                busy={payments.busy}
                onStart={payments.startBatch}
                onReset={payments.reset}
              />
            )}
          </div>

          <aside className="workflow-aside">
            <section className="panel compact-panel">
              <div className="aside-title"><span><ShieldCheck size={18} /></span><div><b>Secure batch flow</b><small>How your key is handled</small></div></div>
              <ol className="flow-list">
                <li className="done"><span><CheckCircle2 size={15} /></span><div><b>Permissions verified</b><small>Read + Write via Blink</small></div></li>
                <li className={payments.batch ? "done" : "current"}><span>{payments.batch ? <CheckCircle2 size={15} /> : "2"}</span><div><b>CSV validated</b><small>Addresses, amounts & duplicates</small></div></li>
                <li className={payments.batch?.status === "PROCESSING" ? "current" : payments.batch && payments.batch.status !== "DRAFT" ? "done" : ""}><span>{payments.batch && payments.batch.status !== "DRAFT" ? <CheckCircle2 size={15} /> : "3"}</span><div><b>Sequential payments</b><small>2-second pacing per recipient</small></div></li>
                <li className={institution.keyStatus === "PURGED" ? "done" : ""}><span>{institution.keyStatus === "PURGED" ? <CheckCircle2 size={15} /> : "4"}</span><div><b>Local key purge</b><small>Encrypted copy removed</small></div></li>
              </ol>
            </section>

            <section className="panel compact-panel safety-card">
              <span className="safety-icon"><AlertTriangle size={18} /></span>
              <div><b>Payments are irreversible</b><p>Check addresses and amounts carefully. A failed row will not stop the rest of the batch.</p></div>
            </section>
          </aside>
        </div>

        <section className="history-section" id="history">
          <div className="section-heading"><div><p className="eyebrow">Audit trail</p><h2>Recent batches</h2></div><span>Last 20 batches</span></div>
          <div className="panel history-panel">
            {payments.history.length === 0 ? (
              <div className="empty-history"><span><History size={23} /></span><b>No batches yet</b><p>Your completed and draft batches will appear here.</p></div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Batch</th><th>Created</th><th>Recipients</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>{payments.history.map((item) => (
                    <tr key={item.id}>
                      <td><b className="batch-code">{item.id.slice(-8).toUpperCase()}</b></td>
                      <td>{new Date(item.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })}</td>
                      <td>{item.recipientsTotal}</td>
                      <td><b>{Number(item.totalAmount).toLocaleString()}</b> <small>sats</small></td>
                      <td><span className={`batch-status ${item.status.toLowerCase()}`}>{item.status === "COMPLETED_WITH_ERRORS" ? "Partial" : item.status.toLowerCase()}</span></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      <footer><span>Rurbit Pay</span><p>Keys encrypted at rest · Payment data retained for audit</p><span>Live Blink integration</span></footer>

      {rekeyOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !rekeying && setRekeyOpen(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="rekey-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" type="button" onClick={() => setRekeyOpen(false)}><X size={19} /></button>
            <span className="icon-tile"><KeyRound size={21} /></span>
            <p className="eyebrow">Key rotation</p>
            <h2 id="rekey-title">Connect a fresh Blink key</h2>
            <p>Use a short-lived API key with Read and Write scopes. Verification does not send a test payment.</p>
            <form onSubmit={rekey}>
              <label><span>Institution ID</span><input value={institution.id} disabled /></label>
              <label><span>New Blink API key</span><input type="password" value={newKey} onChange={(event) => setNewKey(event.target.value)} placeholder="blink_••••••••••••" autoComplete="off" required minLength={16} /></label>
              {rekeyError && <div className="form-error">{rekeyError}</div>}
              <button className="primary-button" disabled={rekeying}>{rekeying ? <><span className="spinner" /> Verifying…</> : <>Verify new key <ArrowRight size={17} /></>}</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
