import { Component, type ErrorInfo, type ReactNode } from "react";
import { PeriodicityButton } from "periodicity-react";

interface AppErrorBoundaryProps {
    children: ReactNode;
}

interface AppErrorBoundaryState {
    error: Error | null;
}

/**
 * Catches renderer render failures, reports them to the guardian process, and
 * keeps a minimal recovery surface available in the main window.
 */
class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
    public state: AppErrorBoundaryState = {
        error: null,
    };

    /**
     * Stores the thrown error so the fallback can render.
     * @param error Error thrown by a descendant.
     * @return Next boundary state.
     */
    public static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
        return {
            error,
        };
    }

    /**
     * Sends the React error and component stack to the guardian process.
     * @param error Error thrown by a descendant.
     * @param info React component stack metadata.
     */
    public componentDidCatch(error: Error, info: ErrorInfo): void {
        window.daemon.report({
            kind: "renderer-error",
            message: error.message || "React 渲染失败",
            stack: `${error.stack ?? ""}\n${info.componentStack ?? ""}`.trim(),
            source: "renderer:react",
        });
    }

    /**
     * Renders the fallback or the protected application subtree.
     * @return Recovery UI after a failure, otherwise the children.
     */
    public render(): ReactNode {
        if (!this.state.error) {
            return this.props.children;
        }
        return (
            <div className="app-crash" role="alert">
                <span className="app-crash__eyebrow">RENDER ERROR</span>
                <h1>界面出现异常</h1>
                <p>守护进程已经记录错误详情。重新加载界面即可恢复，当前数据仍保留在本地。</p>
                <pre className="app-crash__message">{this.state.error.message}</pre>
                <PeriodicityButton
                    icon="Refresh"
                    onClick={() => {
                        window.location.reload();
                    }}
                >
                    重新加载界面
                </PeriodicityButton>
            </div>
        );
    }
}

export default AppErrorBoundary;
