import { renderOverlay } from "../shared/render";
import DaemonWindow from "./DaemonWindow";

renderOverlay(<DaemonWindow />, {
    mode: "dark",
    windowClass: "daemon-window",
});
