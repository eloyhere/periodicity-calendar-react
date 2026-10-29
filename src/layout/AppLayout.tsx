import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    PeriodicityCoordinator,
    PeriodicityIcon,
    PeriodicityNavigation,
    PeriodicityToolbar,
} from "periodicity-react";
import WindowControls from "../components/WindowControls";
import { appNavigationItems } from "../config/navigation";
import type { AppNavigationItem } from "../config/navigation";
import "./AppLayout.css";

interface PageMeta {
    title: string;
    subtitle: string;
}

const PAGE_META: Record<string, PageMeta> = {
    "/chat": {
        title: "聊天",
        subtitle: "与大模型对话；Key 只在主进程使用，消息从本机直连模型服务。",
    },
    "/workflow": {
        title: "工作流",
        subtitle: "在工作目录里读文件、改代码、跑 PowerShell、查 git；允许试错，也允许验证。",
    },
    "/call-test": {
        title: "CallTest",
        subtitle: "测试系统通知与 Snackbar / Toast / Dialog 进程的发送、关闭与事件。",
    },
    "/gregorian": {
        title: "格里高利历",
        subtitle: "公历规则、闰年与月份结构。",
    },
    "/synodic": {
        title: "朔望表",
        subtitle: "朔望、月相与时间尺度。",
    },
    "/solar-terms": {
        title: "节气表",
        subtitle: "太阳黄经与二十四节气。",
    },
    "/xuanyuan": {
        title: "轩辕历",
        subtitle: "纪年、年号与历史规则。",
    },
    "/settings": {
        title: "设置",
        subtitle: "模型服务、工作目录、外观与动效、系统集成集中在这里。",
    },
};

function AppLayout() {
    const location: ReturnType<typeof useLocation> = useLocation();
    const navigate: ReturnType<typeof useNavigate> = useNavigate();
    const activePath: string = location.pathname;
    const [navigationExpanded, setNavigationExpanded]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(true);
    const [viewport, setViewport]: [HTMLDivElement | null, Dispatch<SetStateAction<HTMLDivElement | null>>] = useState<HTMLDivElement | null>(null);
    const [workspaceHeight, setWorkspaceHeight]: [number | undefined, Dispatch<SetStateAction<number | undefined>>] = useState<number | undefined>((void 0));

    useEffect(() => {
        if (!viewport) {
            return;
        }
        const updateHeight: () => void = () => {
            setWorkspaceHeight(viewport.clientHeight);
        };
        updateHeight();
        const observer: ResizeObserver = new ResizeObserver(updateHeight);
        observer.observe(viewport);
        return () => {
            observer.disconnect();
        };
    }, [viewport]);
    const activeItem: AppNavigationItem | undefined = appNavigationItems.find((item: AppNavigationItem): boolean => {
        return item.value === activePath;
    });
    const meta: PageMeta = PAGE_META[activePath] ?? {
        title: activeItem?.label ?? "工作台",
        subtitle: "Periodicity Calendar",
    };

    const handleNavigationClick: () => void = () => {
        setNavigationExpanded((current: boolean): boolean => {
            return !current;
        });
    };

    return (
        <PeriodicityCoordinator
            height="100%"
            scrollRef={setViewport}
            header={
                <div
                    className="app-toolbar"
                    onDoubleClick={(event) => {
                        const target: HTMLElement = event.target as HTMLElement;
                        if (target.closest("button")) {
                            return;
                        }
                        window.windowControls.toggleMaximize();
                    }}
                >
                    <PeriodicityToolbar
                        navigationIcon={<PeriodicityIcon name="Menu" size={20} />}
                        navigationLabel={navigationExpanded ? "收起导航" : "展开导航"}
                        onNavigationClick={handleNavigationClick}
                        title="Periodicity Calendar"
                        subtitle={meta.title}
                        actions={<WindowControls />}
                    />
                </div>
            }
            main={
                <div className="app-body" style={{ height: workspaceHeight }}>
                    <div className={`app-menu${navigationExpanded ? "" : " app-menu--rail"}`}>
                        <PeriodicityNavigation
                            items={appNavigationItems}
                            value={activePath}
                            onItemClick={(item) => {
                                navigate(item.value);
                            }}
                            variant={navigationExpanded ? "sidebar" : "rail"}
                            ariaLabel="功能菜单"
                            header={navigationExpanded ? "功能" : (void 0)}
                            footer={navigationExpanded ? "Periodicity Calendar" : (void 0)}
                        />
                    </div>
                    <main className="app-page" aria-label="主内容">
                        <Outlet />
                    </main>
                </div>
            }
        />
    );
}

export default AppLayout;
