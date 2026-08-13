import { useRef, useState, type DragEvent } from "react";
import { AlertCircle, ArrowRight, Check, Download, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { ApiError } from "../lib/api";
import type { CsvIssue, PaymentMethod } from "../types";

const SAMPLE = `address,amount,memo
u66474248@rurbit.com,1000,January payment
u77483920@rurbit.com,500,January payment
u88392048@rurbit.com,2000,January payment
`;

interface Props {
  disabled?: boolean;
  busy: boolean;
  onUpload: (csvData: string, method: PaymentMethod) => Promise<unknown>;
}

export function CsvUpload({ disabled, busy, onUpload }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("LIGHTNING_ADDRESS");
  const [dragging, setDragging] = useState(false);
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  function selectFile(next: File | undefined) {
    setIssues([]);
    setError(null);
    if (!next) return;
    if (!next.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file");
      return;
    }
    if (next.size > 1_000_000) {
      setError("CSV must be 1 MB or smaller");
      return;
    }
    setFile(next);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    selectFile(event.dataTransfer.files[0]);
  }

  async function validate() {
    if (!file) return;
    setError(null);
    setIssues([]);
    try {
      await onUpload(await file.text(), method);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (Array.isArray(caught.details)) setIssues(caught.details as CsvIssue[]);
      } else {
        setError("The file could not be validated");
      }
    }
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([SAMPLE], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "rurbit-payment-template.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel upload-panel">
      <div className="panel-heading">
        <div>
          <span className="step-kicker">Step 1 of 2</span>
          <h2>Prepare recipients</h2>
          <p>Upload a CSV and we’ll validate every row before any funds move.</p>
        </div>
        <button className="text-button" type="button" onClick={downloadSample}>
          <Download size={16} /> Template
        </button>
      </div>

      <div
        className={`drop-zone ${dragging ? "is-dragging" : ""} ${file ? "has-file" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !file && fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(event) => selectFile(event.target.files?.[0])}
        />
        {file ? (
          <div className="selected-file">
            <span className="file-icon"><FileSpreadsheet size={24} /></span>
            <div><b>{file.name}</b><small>{Math.max(1, Math.round(file.size / 1024))} KB · Ready to validate</small></div>
            <span className="file-ready"><Check size={15} /> Added</span>
            <button type="button" onClick={(event) => { event.stopPropagation(); setFile(null); }} aria-label="Remove file"><X size={18} /></button>
          </div>
        ) : (
          <div className="drop-empty">
            <span><UploadCloud size={25} /></span>
            <b>Drop your recipient CSV here</b>
            <p>or <u>browse your device</u> · maximum 1 MB</p>
          </div>
        )}
      </div>

      <div className="csv-format">
        <div><b>Required format</b><span>3 columns · whole sats only</span></div>
        <code>address,amount,memo</code>
        <code>u66474248@rurbit.com,1000,January payment</code>
      </div>

      <fieldset className="method-picker">
        <legend>Payment route</legend>
        <label className={method === "LIGHTNING_ADDRESS" ? "selected" : ""}>
          <input type="radio" name="method" checked={method === "LIGHTNING_ADDRESS"} onChange={() => setMethod("LIGHTNING_ADDRESS")} />
          <span className="radio-dot" />
          <span><b>Lightning address</b><small>Recommended for Rurbit addresses</small></span>
          <span className="recommended">Recommended</span>
        </label>
        <label className={method === "INTRA_LEDGER" ? "selected" : ""}>
          <input type="radio" name="method" checked={method === "INTRA_LEDGER"} onChange={() => setMethod("INTRA_LEDGER")} />
          <span className="radio-dot" />
          <span><b>Blink intra-ledger</b><small>Only if each username resolves in Blink</small></span>
        </label>
      </fieldset>

      {error && (
        <div className="validation-box" role="alert">
          <div><AlertCircle size={18} /><b>{error}</b></div>
          {issues.slice(0, 8).map((issue, index) => (
            <p key={`${issue.row}-${index}`}>Row {issue.row || "—"}{issue.field ? ` · ${issue.field}` : ""}: {issue.message}</p>
          ))}
          {issues.length > 8 && <p>…and {issues.length - 8} more issue(s)</p>}
        </div>
      )}

      <button className="primary-button panel-action" type="button" disabled={!file || busy || disabled} onClick={() => void validate()}>
        {busy ? <><span className="spinner" /> Validating file…</> : <>Review batch <ArrowRight size={18} /></>}
      </button>
    </section>
  );
}
