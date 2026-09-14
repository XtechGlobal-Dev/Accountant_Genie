/** Background jobs as the Activity Panel and the upload dialog see them. */

export type JobStatusKind = "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED" | "DEAD";

export interface JobView {
  id: string;
  type: string;
  status: JobStatusKind;
  progress: number;
  currentStage: string | null;
  clientId: string | null;
  clientName: string | null;
  /** What the job is about, for the list — a file name, a client. */
  title: string;
  subtitle: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: Date;
  completedAt: Date | null;
}

/** One stage transition, as streamed over SSE. */
export interface JobEventView {
  stage: string;
  processed: number;
  total: number;
  message: string | null;
  progress: number;
  status: JobStatusKind;
  at: string;
}
