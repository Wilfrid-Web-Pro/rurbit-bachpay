import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Clock3, ExternalLink, KeyRound, LoaderCircle, Send, XCircle } from "lucide-react";
import type { Batch, Recipient } from "../types";

interface Props {
  batch: Batch;
  recipients: Recipient[];
  warnings: string[];
  busy: boolean;
  onStart: () => Promise<void>;
  onReset: () => void;
}

function sats(value: string | number) {
  return Number(value).toLocaleString("en-US");
}

function StatusIcon({ status }: { status: Recipient["status"] }) {
  if (status === "SUCCESS") return <CheckCircle2 size={17} />;
  if (status === "FAILED") return <XCircle size={17} />;
  if (status === "PROCESSING") return <LoaderCircle className="spin-icon" size={17} />;
  return <Clock3 size={17} />;
}

export function PaymentResults({ batch, recipients, warnings, busy, onStart, onReset }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const processed = batch.successfulPayments + batch.failedPayments;
  const progress = batch.recipientsTotal ? Math.round((processed / batch.recipientsTotal) * 100) : 0;
  const isDraft = batch.status === "DRAFT";
  const isProcessing = batch.status === "PROCESSING";
  const isDone = ["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"].includes(batch.status);
  const title = useMemo(() => {
    if (isDraft) return "Review your batch";
    if (isProcessing) return "Payments in progress";
    if (batch.status === "COMPLETED") return "Batch completed";
    if (batch.status === "COMPLETED_WITH_ERRORS") return "Batch completed with exceptions";
    return "Batch stopped";
  }, [batch.status, isDraft, isProcessing]);

  return (
    <section className="panel results-panel">
      <div className="panel-heading results-heading">
        <div>
          <span className="step-kicker">{isDraft ? "Step 2 of 2" : `Batch ${batch.id.slice(-8).toUpperCase()}`}</span>
          <h2>{title}</h2>
          <p>
            {isDraft && "Confirm the totals below. Lightning payments cannot be reversed."}
            {isProcessing && `Sending one payment at a time · ${processed} of ${batch.recipientsTotal} processed`}
            {isDone && `Finished ${batch.completedAt ? new Date(batch.completedAt).toLocaleString() : "just now"}`}
          </p>
        </div>
        {isDraft && <button className="text-button" type="button" onClick={onReset}><ArrowLeft size={16} /> Replace CSV</button>}
      </div>

      {(isProcessing || isDone) && (
        <div className={`batch-hero ${batch.status.toLowerCase()}`}>
          <div className="hero-status-icon">
            {isProcessing ? <LoaderCircle className="spin-icon" /> : batch.status === "COMPLETED" ? <Check /> : <AlertTriangle />}
          </div>
          <div className="hero-progress-copy">
            <b>{isProcessing ? "Sending securely via Blink" : title}</b>
            <span>{batch.successfulPayments} successful · {batch.failedPayments} failed</span>
          </div>
          <strong>{isProcessing ? `${progress}%` : `${processed}/${batch.recipientsTotal}`}</strong>
          <div className="progress-track"><span style={{ width: `${isDone ? 100 : progress}%` }} /></div>
        </div>
      )}

      <div className="batch-stats">
        <div><span>Recipients</span><strong>{batch.recipientsTotal}</strong></div>
        <div><span>Total amount</span><strong>{sats(batch.totalAmount)} <small>sats</small></strong></div>
        <div><span>Route</span><strong className="route-value">{batch.paymentMethod === "LIGHTNING_ADDRESS" ? "Lightning address" : "Intra-ledger"}</strong></div>
        {!isDraft && <div><span>Successful</span><strong className="success-text">{batch.successfulPayments}</strong></div>}
      </div>

      {warnings.map((warning) => <div className="inline-warning" key={warning}><AlertTriangle size={16} />{warning}</div>)}
      {batch.errorMessage && <div className="inline-error"><XCircle size={16} />{batch.errorMessage}</div>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Recipient</th><th>Memo</th><th className="number-cell">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {recipients.map((recipient) => (
              <tr key={recipient.id}>
                <td><span className="address-cell"><span>u</span><b>{recipient.address}</b></span></td>
                <td className="memo-cell">{recipient.memo || "—"}</td>
                <td className="number-cell"><b>{sats(recipient.amount)}</b> <small>sats</small></td>
                <td>
                  <span className={`recipient-status ${recipient.status.toLowerCase()}`}>
                    <StatusIcon status={recipient.status} /> {recipient.status === "PENDING" ? "Ready" : recipient.status.toLowerCase()}
                  </span>
                  {recipient.errorMessage && <small className="row-error" title={recipient.errorMessage}>{recipient.errorMessage}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isDraft && (
        <div className="confirmation-area">
          <label className="confirm-check">
            <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><Check size={14} /></span>
            I have checked every recipient and understand these payments are irreversible.
          </label>
          <button className="primary-button pay-button" type="button" disabled={!confirmed || busy} onClick={() => void onStart()}>
            {busy ? <><span className="spinner" /> Starting batch…</> : <><Send size={18} /> Send {sats(batch.totalAmount)} sats</>}
          </button>
        </div>
      )}

      {isDone && (
        <div className="purge-confirmation">
          <span><KeyRound size={18} /></span>
          <p><b>Encrypted key copy purged from Rurbit Pay</b><small>Remote revocation is not confirmed. Revoke the key in your Blink dashboard now.</small></p>
          <a href="https://dashboard.blink.sv" target="_blank" rel="noreferrer">Open Blink <ExternalLink size={14} /></a>
        </div>
      )}
    </section>
  );
}
