import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ProgressUpdate } from "../../electron/progress";

/**
 * Subscribes to progress updates sent by the main process.
 * @param id Optional task id to filter updates by.
 * @return The latest matching progress update, or null before the first event.
*/
export function useProgress(id?: string): ProgressUpdate | null {
    const [update, setUpdate]: [ProgressUpdate | null, Dispatch<SetStateAction<ProgressUpdate | null>>] = useState<ProgressUpdate | null>(null);

    useEffect(() => {
        window.progress.onUpdate((next: ProgressUpdate) => {
            if (id && next.id !== id) {
                return;
            }
            setUpdate(next);
        });
    }, [id]);

    return update;
}
