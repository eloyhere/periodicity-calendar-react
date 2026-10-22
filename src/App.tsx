import { Navigate, Route, Routes } from "react-router-dom";
import AppLayout from "./layout/AppLayout";
import ChatPage from "./pages/ChatPage";
import PlaceholderPage from "./pages/PlaceholderPage";
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
                                ) : (
                                    <PlaceholderPage title={item.label} />
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
