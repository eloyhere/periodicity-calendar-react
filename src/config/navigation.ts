import type { PeriodicityIconName } from "periodicity-react";

export interface AppNavigationItem {
    value: string;
    label: string;
    icon: PeriodicityIconName;
}

export const appNavigationItems: readonly AppNavigationItem[] = [
    { value: "/chat", label: "聊天", icon: "Chat" },
    { value: "/workflow", label: "工作流", icon: "Flow" },
    { value: "/call-test", label: "CallTest", icon: "Bell" },
    { value: "/gregorian", label: "格里高利历", icon: "Calendar" },
    { value: "/synodic", label: "朔望表", icon: "Moon" },
    { value: "/solar-terms", label: "节气表", icon: "Sun" },
    { value: "/xuanyuan", label: "轩辕历", icon: "History" },
    { value: "/settings", label: "设置", icon: "Wrench" },
];
