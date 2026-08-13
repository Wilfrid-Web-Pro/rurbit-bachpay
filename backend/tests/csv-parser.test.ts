import { describe, expect, it } from "vitest";
import { CsvValidationError, parseRecipientsCsv } from "../src/csv-parser.js";

describe("recipient CSV parser", () => {
  it("parses canonical CSV including quoted memos", () => {
    const result = parseRecipientsCsv(
      'address,amount,memo\nu66474248@rurbit.com,1000,"January, tranche 1"\nu77483920@rurbit.io,500,Support',
    );
    expect(result.recipients).toHaveLength(2);
    expect(result.recipients[0]).toMatchObject({ amount: 1000, memo: "January, tranche 1" });
    expect(result.totalAmount).toBe(1500n);
  });

  it("rejects bare usernames and incomplete domains", () => {
    expect(() =>
      parseRecipientsCsv("address,amount,memo\nu66474248,1000,test\nu123@rurbit,20,test"),
    ).toThrow(CsvValidationError);
  });

  it("rejects duplicate addresses to reduce accidental double-payments", () => {
    expect(() =>
      parseRecipientsCsv(
        "address,amount,memo\nu66474248@rurbit.com,1000,one\nu66474248@rurbit.com,500,two",
      ),
    ).toThrow(/CSV validation failed/);
  });

  it("requires the canonical column order", () => {
    expect(() => parseRecipientsCsv("rurbit_address,amount_memo,sats\nu1@rurbit.com,1,x")).toThrow(
      CsvValidationError,
    );
  });
});
