import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
    PeriodicityCollapse,
    PeriodicityCoordinator,
    PeriodicityDrawerLayout,
    PeriodicityNavigationView,
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
};

function AppLayout() {
    const location: ReturnType<typeof useLocation> = useLocation();
    const navigate: ReturnType<typeof useNavigate> = useNavigate();
    const activePath: string = location.pathname;
    const activeItem: AppNavigationItem | undefined = appNavigationItems.find((item: AppNavigationItem): boolean => {
        return item.value === activePath;
    });
    const meta: PageMeta = PAGE_META[activePath] ?? {
        title: activeItem?.label ?? "工作台",
        subtitle: "Periodicity Calendar",
    };

    return (
        <PeriodicityCoordinator
            className="app-chrome"
            height="100%"
            collapseHeight={170}
            collapse={
                <PeriodicityCollapse
                    className="app-hero"
                    expandedTitle={meta.title}
                    subtitle={meta.subtitle}
                    onDoubleClick={(event) => {
                        const target: HTMLElement = event.target as HTMLElement;
                        if (target.closest("button, a, input, textarea, [role='button']")) {
                            return;
                        }
                        window.windowControls.toggleMaximize();
                    }}
                >
                    <div className="app-hero__pinned">
                        <span>LOCAL WORKSPACE AGENT</span>
                        <span>{activePath}</span>
                    </div>
                </PeriodicityCollapse>
            }
            header={
                <PeriodicityToolbar
                    className="app-toolbar"
                    title="Periodicity Calendar"
                    subtitle={meta.title}
                    actions={<WindowControls />}
                    onDoubleClick={(event) => {
                        const target: HTMLElement = event.target as HTMLElement;
                        if (target.closest("button")) {
                            return;
                        }
                        window.windowControls.toggleMaximize();
                    }}
                />
            }
            main={
                <PeriodicityDrawerLayout
                    className="app-body"
                    leftWidth={240}
                    defaultLeftOpen
                    leftLabel="主菜单"
                    centreLabel="主内容"
                    left={
                        <PeriodicityNavigationView
                            className="app-menu"
                            items={appNavigationItems}
                            value={activePath}
                            onItemClick={(item) => {
                                navigate(item.value);
                            }}
                            variant="sidebar"
                            ariaLabel="功能菜单"
                            header={<span className="app-menu__section">功能</span>}
                            footer={<span className="app-menu__footer">Periodicity Calendar</span>}
                        />
                    }
                    centre={
                        <main className="app-page">
                            <Outlet />
                        </main>
                    }
                />
            }
        />
    );
}

export default AppLayout;
