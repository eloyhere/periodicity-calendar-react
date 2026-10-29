import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import CallTestPage from "./pages/CallTestPage";
import ChatPage from "./pages/ChatPage";
import PlaceholderPage from "./pages/PlaceholderPage";
import SettingsPage from "./pages/SettingsPage";
import WorkflowPage from "./pages/WorkflowPage";
import { appNavigationItems } from "./config/navigation";
import "./App.css";

function App() {
    return (
        <Routes>
            <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/chat" replace />} />
                {appNavigationItems.map((item) => {
                    return (
                        <Route
                            key={item.value}
                            path={item.value.slice(1)}
                            element={
                                item.value === "/chat" ? (
                                    <ChatPage />
                                ) : item.value === "/workflow" ? (
                                    <WorkflowPage />
                                ) : item.value === "/call-test" ? (
                                    <CallTestPage />
                                ) : item.value === "/settings" ? (
                                    <SettingsPage />
                                ) : (
                                    <PlaceholderPage title={item.label} icon={item.icon} />
                                )
                            }
                        />
                    );
                })}
                <Route path="*" element={<Navigate to="/chat" replace />} />
            </Route>
        </Routes>
    );
}

export default App;
