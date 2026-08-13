import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./lib/api";
import type { Batch, Institution, PaymentMethod, Recipient } from "./types";

export function useInstitution() {
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await apiFetch<{ institution: Institution }>("/session");
      setInstitution(data.institution);
    } catch {
      setInstitution(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const connect = useCallback(async (institutionId: string, blinkApiKey: string) => {
    const data = await apiFetch<{ institution: Institution }>("/institutions/register", {
      method: "POST",
      body: JSON.stringify({ institutionId, blinkApiKey }),
    });
    setInstitution(data.institution);
    return data.institution;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch<void>("/session", { method: "DELETE" });
    setInstitution(null);
  }, []);

  return { institution, loading, connect, logout, refresh };
}

const terminalStatuses = new Set(["COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED"]);

export function usePayments(institutionId: string, onTerminal: () => void) {
  const [batch, setBatch] = useState<Batch | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [history, setHistory] = useState<Batch[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const terminalNotified = useRef<string | null>(null);

  const loadHistory = useCallback(async () => {
    const data = await apiFetch<{ batches: Batch[] }>(`/institutions/${institutionId}/batches`);
    setHistory(data.batches);
  }, [institutionId]);

  useEffect(() => void loadHistory(), [loadHistory]);

  const uploadCsv = useCallback(
    async (csvData: string, paymentMethod: PaymentMethod) => {
      setBusy(true);
      try {
        const data = await apiFetch<{ batch: Batch; recipients: Recipient[]; warnings: string[] }>(
          `/institutions/${institutionId}/upload-csv`,
          { method: "POST", body: JSON.stringify({ csvData, paymentMethod }) },
        );
        setBatch(data.batch);
        setRecipients(data.recipients);
        setWarnings(data.warnings);
        terminalNotified.current = null;
        await loadHistory();
        return data;
      } finally {
        setBusy(false);
      }
    },
    [institutionId, loadHistory],
  );

  const startBatch = useCallback(async () => {
    if (!batch) return;
    setBusy(true);
    try {
      await apiFetch(`/institutions/${institutionId}/pay-batch`, {
        method: "POST",
        body: JSON.stringify({ batchId: batch.id, acknowledgeIrreversible: true }),
      });
      setBatch({ ...batch, status: "PROCESSING", startedAt: new Date().toISOString() });
    } finally {
      setBusy(false);
    }
  }, [batch, institutionId]);

  useEffect(() => {
    if (!batch || batch.status !== "PROCESSING") return;
    let stopped = false;

    const poll = async () => {
      try {
        const data = await apiFetch<{ batch: Batch; recipients: Recipient[] }>(
          `/institutions/${institutionId}/batches/${batch.id}`,
        );
        if (stopped) return;
        setBatch(data.batch);
        setRecipients(data.recipients);
        if (terminalStatuses.has(data.batch.status)) {
          await loadHistory();
          if (terminalNotified.current !== data.batch.id) {
            terminalNotified.current = data.batch.id;
            onTerminal();
          }
        }
      } catch {
        // A later poll can recover from a transient connection error.
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 1_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [batch?.id, batch?.status, institutionId, loadHistory, onTerminal]);

  const reset = useCallback(() => {
    setBatch(null);
    setRecipients([]);
    setWarnings([]);
  }, []);

  return { batch, recipients, history, warnings, busy, uploadCsv, startBatch, reset };
}
