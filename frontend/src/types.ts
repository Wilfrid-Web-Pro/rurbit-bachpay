export type KeyStatus = "ACTIVE" | "PURGED";
export type PaymentMethod = "LIGHTNING_ADDRESS" | "INTRA_LEDGER";
export type BatchStatus = "DRAFT" | "PROCESSING" | "COMPLETED" | "COMPLETED_WITH_ERRORS" | "FAILED";
export type RecipientStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "FAILED";

export interface Institution {
  id: string;
  blinkUsername: string | null;
  walletCurrency: string;
  balance: string | null;
  keyStatus: KeyStatus;
  keyVerifiedAt: string | null;
  keyPurgedAt: string | null;
}

export interface Batch {
  id: string;
  institutionId: string;
  status: BatchStatus;
  paymentMethod: PaymentMethod;
  recipientsTotal: number;
  totalAmount: string;
  successfulPayments: number;
  failedPayments: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  keyPurgedAt: string | null;
  createdAt: string;
}

export interface Recipient {
  id: string;
  rowNumber: number;
  address: string;
  amount: number;
  memo: string;
  status: RecipientStatus;
  blinkStatus: string | null;
  transactionId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  processedAt: string | null;
}

export interface CsvIssue {
  row: number;
  field?: string;
  message: string;
}
