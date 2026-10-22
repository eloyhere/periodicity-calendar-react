import { renderOverlay } from "../shared/render";
import NotificationWindow from "./NotificationWindow";

renderOverlay(<NotificationWindow />, {
    mode: "dark",
    windowClass: "notification-window",
});
