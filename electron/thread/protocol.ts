import type { MessagePort } from "node:worker_threads";

export type ThreadProgressMessage = {
    type: "progress";
    percent: number;
    detail?: string;
};

export type ThreadResultMessage<TOutput> = {
    type: "result";
    value: TOutput;
};

export type ThreadErrorMessage = {
    type: "error";
    message: string;
};

export type ThreadWorkerMessage<TOutput> =
    | ThreadProgressMessage
    | ThreadResultMessage<TOutput>
    | ThreadErrorMessage;

/**
 * Posts a progress update from a worker to its parent.
 * @param port Worker parent port, usually `parentPort`.
 * @param percent Completion percentage from 0 to 100.
 * @param detail Optional detail line.
*/
export function postThreadProgress(port: MessagePort | null, percent: number, detail?: string): void {
    if (!port) {
        return;
    }
    const message: ThreadProgressMessage = {
        type: "progress",
        percent,
        detail,
    };
    port.postMessage(message);
}

/**
 * Posts the final result from a worker to its parent.
 * @param port Worker parent port, usually `parentPort`.
 * @param value Result value to resolve the task with.
*/
export function postThreadResult<TOutput>(port: MessagePort | null, value: TOutput): void {
    if (!port) {
        return;
    }
    const message: ThreadResultMessage<TOutput> = {
        type: "result",
        value,
    };
    port.postMessage(message);
}

/**
 * Posts a failure from a worker to its parent.
 * @param port Worker parent port, usually `parentPort`.
 * @param error Error or value that describes the failure.
*/
export function postThreadError(port: MessagePort | null, error: unknown): void {
    if (!port) {
        return;
    }
    const message: ThreadErrorMessage = {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
    };
    port.postMessage(message);
}
