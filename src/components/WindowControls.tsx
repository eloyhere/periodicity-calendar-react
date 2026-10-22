import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { PeriodicityButton } from "periodicity-react";
import "./WindowControls.css";

function WindowControls() {
    const [isMaximized, setIsMaximized]: [boolean, Dispatch<SetStateAction<boolean>>] = useState<boolean>(false);

    useEffect(() => {
        window.windowControls.onMaximizedChange((maximized: boolean) => {
            setIsMaximized(maximized);
        });
    }, []);

    return (
        <div className="window-controls">
            <PeriodicityButton
                className="window-control"
                variant="quiet"
                size="sm"
                icon="Subtract"
                aria-label="Minimize"
                title="Minimize"
                onClick={() => {
                    window.windowControls.minimize();
                }}
            />
            <PeriodicityButton
                className="window-control window-control--maximize"
                variant="quiet"
                size="sm"
                aria-label={isMaximized ? "Restore" : "Maximize"}
                title={isMaximized ? "Restore" : "Maximize"}
                onClick={() => {
                    window.windowControls.toggleMaximize();
                }}
            >
                <svg
                    className="window-control__icon"
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    aria-hidden="true"
                >
                    {isMaximized ? (
                        <>
                            <rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" />
                            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
                        </>
                    ) : (
                        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
                    )}
                </svg>
            </PeriodicityButton>
            <PeriodicityButton
                className="window-control window-control--close"
                variant="quiet"
                size="sm"
                icon="Close"
                aria-label="Close"
                title="Close"
                onClick={() => {
                    window.windowControls.close();
                }}
            />
        </div>
    );
}

export default WindowControls;
