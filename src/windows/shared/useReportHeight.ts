import { useEffect } from "react";

/**
 * Observes one portalled overlay element and reports its measured height.
 * @param selector CSS selector of the element owned by the design-system portal.
 * @param report Receiver of the integer content height; zero means absent.
 */
export function useReportHeight(selector: string, report: (height: number) => void): void {
    useEffect(() => {
        let target: Element | null = null;
        const measure: () => void = () => {
            if (!(target instanceof HTMLElement)) {
                report(0);
                return;
            }
            const rect: DOMRect = target.getBoundingClientRect();
            report(Math.max(0, Math.ceil(rect.height)));
        };
        const resizeObserver: ResizeObserver = new ResizeObserver(() => {
            measure();
        });
        const attach: () => void = () => {
            const next: Element | null = document.querySelector(selector);
            if (next === target) {
                measure();
                return;
            }
            if (target) {
                resizeObserver.unobserve(target);
            }
            target = next;
            if (target) {
                resizeObserver.observe(target);
            }
            measure();
        };
        const mutations: MutationObserver = new MutationObserver(() => {
            attach();
        });
        mutations.observe(document.body, {
            childList: true,
            subtree: true,
        });
        window.addEventListener("resize", measure);
        attach();
        return (): void => {
            mutations.disconnect();
            resizeObserver.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, [selector, report]);
}
