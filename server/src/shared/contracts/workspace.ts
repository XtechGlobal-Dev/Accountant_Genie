/** The signed-in frame: who is here, which firm, and how much of the plan is used. */

import type { ClientOption } from "./client";

export interface Workspace {
  user: { name: string };
  firmName: string;
  clients: ClientOption[];
  quota: { total: number; used: number };
  plan: { code: string; name: string; isTrial: boolean };
  /** Transactions across the firm waiting on a person — drives the bell. */
  attention: number;
}
