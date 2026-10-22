import { Worker, type WorkerOptions } from "node:worker_threads";
import type { ThreadWorkerMessage } from "./protocol";

export type ThreadProgress = {
    percent: number;
    detail?: string;
};

export interface ThreadRunOptions {
    onProgress?: (progress: ThreadProgress) => void;
    signal?: AbortSignal;
}

function clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, percent));
}

function isThreadWorkerMessage<TOutput>(value: unknown): value is ThreadWorkerMessage<TOutput> {
    if (typeof value !== "object" || value === null || !("type" in value)) {
        return false;
    }
    const type: unknown = (value as { type: unknown }).type;
    return type === "progress" || type === "result" || type === "error";
}

/**
 * Runs tasks in a dedicated Node.js worker thread.
 * @example
 * const runner = new ThreadRunner<MyInput, MyOutput>(new URL("./my.worker.js", import.meta.url));
 * const result = await runner.run(input, { onProgress: (progress): void => console.log(progress.percent) });
*/
export class ThreadRunner<TInput = unknown, TOutput = unknown> {
    private readonly workerUrl: URL | string;
    private readonly workerOptions: WorkerOptions;

    /**
     * Creates a thread runner for a built worker entry.
     * @param workerUrl URL or path of the worker entry.
     * @param workerOptions Optional Node.js worker options.
    */
    public constructor(workerUrl: URL | string, workerOptions: WorkerOptions = {}) {
        this.workerUrl = workerUrl;
        this.workerOptions = workerOptions;
    }

    /**
     * Runs one task in a fresh worker and resolves with its result.
     * @param input Data cloned into the worker as `workerData`.
     * @param options Progress callback and optional abort signal.
     * @return The value posted by the worker as its result.
    */
    public run(input: TInput, options: ThreadRunOptions = {}): Promise<TOutput> {
        return new Promise<TOutput>((resolve, reject) => {
            const worker: Worker = new Worker(this.workerUrl, {
                ...this.workerOptions,
                workerData: input,
            });
            let settled: boolean = false;
            let abortHandler: () => void = () => {};

            const settle: (callback: () => void) => void = (callback) => {
                if (settled) {
                    return;
                }
                settled = true;
                options.signal?.removeEventListener("abort", abortHandler);
                worker.removeAllListeners("message");
                void worker.terminate();
                callback();
            };

            abortHandler = () => {
                settle(() => {
                    reject(new Error("Thread task aborted."));
                });
            };

            if (options.signal?.aborted) {
                abortHandler();
                return;
            }
            options.signal?.addEventListener("abort", abortHandler, { once: true });

            worker.on("message", (rawMessage: unknown) => {
                if (settled) {
                    return;
                }
                const message: ThreadWorkerMessage<TOutput> | null = isThreadWorkerMessage<TOutput>(rawMessage) ? rawMessage : null;
                if (!message) {
                    settle(() => {
                        reject(new Error("Thread worker sent an invalid message."));
                    });
                    return;
                }
                if (message.type === "progress") {
                    try {
                        const percent: number = Number.isFinite(message.percent) ? message.percent : 0;
                        options.onProgress?.({
                            percent: clampPercent(percent),
                            detail: message.detail,
                        });
                    } catch (error: unknown) {
                        settle(() => {
                            reject(error);
                        });
                    }
                    return;
                }
                if (message.type === "result") {
                    settle(() => {
                        resolve(message.value);
                    });
                    return;
                }
                settle(() => {
                    reject(new Error(message.message));
                });
            });

            worker.on("error", (error: Error) => {
                settle(() => {
                    reject(error);
                });
            });

            worker.on("exit", (code: number) => {
                if (code !== 0) {
                    settle(() => {
                        reject(new Error(`Thread worker exited with code ${String(code)}.`));
                    });
                    return;
                }
                settle(() => {
                    reject(new Error("Thread worker exited without a result."));
                });
            });
        });
    }
}
