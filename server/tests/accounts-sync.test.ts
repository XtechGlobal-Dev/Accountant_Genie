import { describe, expect, it } from "vitest";
import { syncSystemAccounts } from "../prisma/accounts-sync";
import { AU_CHART_OF_ACCOUNTS } from "@/server/au/coa";

/**
 * The sync applies the chart by code. The one thing it must never do is give
 * a posted-to code a new meaning in place — that moves history onto the wrong
 * account with the wrong GST snapshot, and the BAS follows. Exercised against
 * a fake client so the rule is tested without a database.
 */

type Row = {
  id: string;
  code: number;
  name: string;
  type: string;
  gstTreatment: string;
  isActive: boolean;
  journalLines: number;
  bankTransactions: number;
};

function fakeDb(rows: Row[]) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const creates: Array<Record<string, unknown>> = [];
  const account = {
    findFirst: async ({ where }: { where: { code: number } }) => {
      const row = rows.find((r) => r.code === where.code);
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        gstTreatment: row.gstTreatment,
        _count: { journalLines: row.journalLines, bankTransactions: row.bankTransactions },
      };
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      updates.push({ id: where.id, data });
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      creates.push(data);
      return data;
    },
    findMany: async () => [],
    delete: async () => ({}),
  };
  return { db: { account } as never, updates, creates };
}

const bankFees = AU_CHART_OF_ACCOUNTS.find((a) => a.code === 320)!;
const gstReceivable = AU_CHART_OF_ACCOUNTS.find((a) => a.code === 720)!;

describe("syncSystemAccounts", () => {
  it("leaves a posted-to account alone when the chart gives its code a different type or treatment", async () => {
    // The demo firm's history: 320 was Subcontractor Payments, 720 was Motor Vehicles.
    const rows: Row[] = [
      { id: "a320", code: 320, name: "Subcontractor Payments", type: "COGS", gstTreatment: "GST_ON_EXPENSES", isActive: true, journalLines: 1, bankTransactions: 0 },
      { id: "a720", code: 720, name: "Motor Vehicles", type: "ASSET", gstTreatment: "GST_ON_CAPITAL", isActive: true, journalLines: 1, bankTransactions: 0 },
    ];
    const lines: string[] = [];
    const { db, updates } = fakeDb(rows);
    const result = await syncSystemAccounts(db, (l) => lines.push(l));

    expect(result.conflicts).toBe(2);
    expect(updates.find((u) => u.id === "a320")).toBeUndefined();
    expect(updates.find((u) => u.id === "a720")).toBeUndefined();
    expect(rows[0]).toMatchObject({ name: "Subcontractor Payments", type: "COGS", gstTreatment: "GST_ON_EXPENSES" });
    expect(rows[1]).toMatchObject({ name: "Motor Vehicles", gstTreatment: "GST_ON_CAPITAL" });
    expect(lines.some((l) => l.includes("320 Subcontractor Payments") && l.includes(`NOT changed to ${bankFees.name}`))).toBe(true);
    expect(lines.some((l) => l.includes("720 Motor Vehicles") && l.includes(`NOT changed to ${gstReceivable.name}`))).toBe(true);
    // Every other code in the chart was created as normal.
    expect(result.created).toBe(AU_CHART_OF_ACCOUNTS.length - 2);
  });

  it("re-purposes a code freely while nothing has been posted to it", async () => {
    const rows: Row[] = [
      { id: "a320", code: 320, name: "Subcontractor Payments", type: "COGS", gstTreatment: "GST_ON_EXPENSES", isActive: true, journalLines: 0, bankTransactions: 0 },
    ];
    const { db } = fakeDb(rows);
    const result = await syncSystemAccounts(db);
    expect(result.conflicts).toBe(0);
    expect(rows[0]).toMatchObject({ name: bankFees.name, type: bankFees.type, gstTreatment: bankFees.gstTreatment });
  });

  it("still renames or redescribes a posted-to account that keeps its type and treatment", async () => {
    const rows: Row[] = [
      { id: "a320", code: 320, name: "Bank charges", type: bankFees.type, gstTreatment: bankFees.gstTreatment, isActive: false, journalLines: 5, bankTransactions: 2 },
    ];
    const { db } = fakeDb(rows);
    const result = await syncSystemAccounts(db);
    expect(result.conflicts).toBe(0);
    expect(rows[0]).toMatchObject({ name: bankFees.name, isActive: true });
  });
});
