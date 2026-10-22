import type { WebContents } from "electron";

export const PROGRESS_CHANNEL: string = "app:progress";

export type ProgressState = "running" | "success" | "error" | "cancelled";

export interface ProgressUpdate {
    id: string;
    label: string;
    percent: number;
    detail?: string;
    state: ProgressState;
}

function clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent));
}

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * Sends throttled task progress from the main process to a renderer.
 * @example
 * const reporter = new ProgressReporter(window.webContents, "import", "Importing");
 * reporter.update(25, "Reading file");
 * reporter.success("Finished");
*/
export class ProgressReporter {
    private readonly webContents: WebContents;
    private readonly id: string;
    private readonly label: string;
    private readonly minIntervalMs: number;
    private lastPercent: number = 0;
    private lastSentAt: number = 0;

    /**
     * Creates a reporter for one renderer task.
     * @param webContents Renderer that receives progress events.
     * @param id Stable task identifier.
     * @param label Human-readable task label.
     * @param minIntervalMs Minimum interval between running updates in milliseconds.
    */
    public constructor(webContents: WebContents, id: string, label: string = "", minIntervalMs: number = 50) {
        this.webContents = webContents;
        this.id = id;
        this.label = label;
        this.minIntervalMs = Math.max(0, minIntervalMs);
    }

    /**
     * Reports a running progress percentage.
     * @param percent Completion percentage from 0 to 100.
     * @param detail Optional detail line.
    */
    public update(percent: number, detail?: string): void {
        const normalizedPercent: number = clampPercent(percent);
        this.lastPercent = normalizedPercent;
        const now: number = Date.now();
        if (now - this.lastSentAt < this.minIntervalMs && normalizedPercent < 100) {
            return;
        }
        this.emit("running", normalizedPercent, detail);
    }

    /**
     * Marks the task as completed.
     * @param detail Optional completion message.
    */
    public success(detail?: string): void {
        this.emit("success", 100, detail);
    }

    /**
     * Marks the task as failed.
     * @param error Error that caused the failure.
     * @param detail Optional replacement error message.
    */
    public fail(error: unknown, detail?: string): void {
        this.emit("error", this.lastPercent, detail ?? describeError(error));
    }

    /**
     * Marks the task as cancelled.
     * @param detail Optional cancellation message.
    */
    public cancel(detail?: string): void {
        this.emit("cancelled", this.lastPercent, detail);
    }

    private emit(state: ProgressState, percent: number, detail?: string): void {
        if (this.webContents.isDestroyed()) {
            return;
        }
        this.lastSentAt = Date.now();
        const update: ProgressUpdate = {
            id: this.id,
            label: this.label,
            percent: clampPercent(percent),
            detail,
            state,
        };
        this.webContents.send(PROGRESS_CHANNEL, update);
    }
}
