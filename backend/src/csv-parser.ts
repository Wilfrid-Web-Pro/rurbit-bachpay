import { parse } from "csv-parse/sync";

export const RURBIT_ADDRESS_PATTERN = /^u\d+@rurbit\.(?:com|io|co)$/i;
export const MAX_CSV_BYTES = 1_000_000;
export const MAX_SATS_PER_RECIPIENT = 100_000_000;

export interface RecipientInput {
  rowNumber: number;
  address: string;
  amount: number;
  memo: string;
}

export interface CsvIssue {
  row: number;
  field?: "address" | "amount" | "memo" | "row" | "header";
  message: string;
}

export class CsvValidationError extends Error {
  constructor(public readonly issues: CsvIssue[]) {
    super("CSV validation failed");
    this.name = "CsvValidationError";
  }
}

export function parseRecipientsCsv(csvData: string, maxRecipients = 500): {
  recipients: RecipientInput[];
  totalAmount: bigint;
} {
  if (Buffer.byteLength(csvData, "utf8") > MAX_CSV_BYTES) {
    throw new CsvValidationError([{ row: 0, field: "row", message: "CSV must be 1 MB or smaller" }]);
  }

  let rows: string[][];
  try {
    rows = parse(csvData, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: false,
      relax_column_count: true,
    }) as string[][];
  } catch (error) {
    throw new CsvValidationError([
      { row: 0, field: "row", message: error instanceof Error ? error.message : "Malformed CSV" },
    ]);
  }

  if (rows.length === 0) {
    throw new CsvValidationError([{ row: 1, field: "header", message: "CSV is empty" }]);
  }

  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const expected = ["address", "amount", "memo"];
  if (header.length !== 3 || header.some((cell, index) => cell !== expected[index])) {
    throw new CsvValidationError([
      {
        row: 1,
        field: "header",
        message: "Header must be exactly: address,amount,memo",
      },
    ]);
  }

  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    throw new CsvValidationError([{ row: 2, field: "row", message: "Add at least one recipient" }]);
  }
  if (dataRows.length > maxRecipients) {
    throw new CsvValidationError([
      { row: 0, field: "row", message: `A batch can contain at most ${maxRecipients} recipients` },
    ]);
  }

  const issues: CsvIssue[] = [];
  const recipients: RecipientInput[] = [];
  const seenAddresses = new Map<string, number>();

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (row.length !== 3) {
      issues.push({ row: rowNumber, field: "row", message: "Expected exactly 3 columns" });
      return;
    }

    const address = (row[0] ?? "").trim().toLowerCase();
    const amountText = (row[1] ?? "").trim();
    const memo = (row[2] ?? "").trim();
    let valid = true;

    if (!RURBIT_ADDRESS_PATTERN.test(address)) {
      issues.push({
        row: rowNumber,
        field: "address",
        message: "Use a full address such as u66474248@rurbit.com",
      });
      valid = false;
    }

    const previousRow = seenAddresses.get(address);
    if (address && previousRow !== undefined) {
      issues.push({
        row: rowNumber,
        field: "address",
        message: `Duplicate address; first used on row ${previousRow}`,
      });
      valid = false;
    } else if (address) {
      seenAddresses.set(address, rowNumber);
    }

    if (!/^[1-9]\d*$/.test(amountText)) {
      issues.push({ row: rowNumber, field: "amount", message: "Amount must be a positive whole number of sats" });
      valid = false;
    }

    const amount = Number(amountText);
    if (Number.isFinite(amount) && amount > MAX_SATS_PER_RECIPIENT) {
      issues.push({
        row: rowNumber,
        field: "amount",
        message: `Amount cannot exceed ${MAX_SATS_PER_RECIPIENT.toLocaleString()} sats`,
      });
      valid = false;
    }

    if (memo.length > 200) {
      issues.push({ row: rowNumber, field: "memo", message: "Memo cannot exceed 200 characters" });
      valid = false;
    }

    if (valid) recipients.push({ rowNumber, address, amount, memo });
  });

  if (issues.length > 0) throw new CsvValidationError(issues.slice(0, 100));

  return {
    recipients,
    totalAmount: recipients.reduce((sum, recipient) => sum + BigInt(recipient.amount), 0n),
  };
}
