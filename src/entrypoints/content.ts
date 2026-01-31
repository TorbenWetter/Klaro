import { clickElementById, scanPage, setInputValueById, setSelectValueById } from "../utils/dom-scanner";

export default defineContentScript({
    matches: ["<all_urls>"],
    main() {
        browser.runtime.onMessage.addListener(
            (
                message: {
                    type: string;
                    id?: string;
                    value?: string;
                },
                _sender: unknown,
                sendResponse: (r: unknown) => void,
            ) => {
                if (message.type === "SCAN_PAGE") {
                    // #region agent log
                    fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            location: "content.ts:SCAN_PAGE",
                            message: "SCAN_PAGE received",
                            data: { url: document.location?.href?.slice(0, 80) },
                            timestamp: Date.now(),
                            sessionId: "debug-session",
                            hypothesisId: "H1",
                        }),
                    }).catch(() => {});
                    // #endregion
                    try {
                        const data = scanPage();
                        // #region agent log
                        fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                location: "content.ts:scanDone",
                                message: "scan completed",
                                data: {
                                    actionsCount: data.actions?.length ?? 0,
                                    hasError: false,
                                },
                                timestamp: Date.now(),
                                sessionId: "debug-session",
                                hypothesisId: "H2",
                            }),
                        }).catch(() => {});
                        // #endregion
                        sendResponse(data);
                    } catch (e) {
                        // #region agent log
                        fetch("http://127.0.0.1:7242/ingest/8ba01891-3f35-401c-9df4-9efe4f4b4bec", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                location: "content.ts:scanError",
                                message: "scan threw",
                                data: { err: e instanceof Error ? e.message : String(e) },
                                timestamp: Date.now(),
                                sessionId: "debug-session",
                                hypothesisId: "H2",
                            }),
                        }).catch(() => {});
                        // #endregion
                        sendResponse({
                            article: null,
                            headings: [],
                            actions: [],
                            pageCopy: [],
                            error: e instanceof Error ? e.message : "Scan failed",
                        });
                    }
                    return true;
                }
                if (message.type === "CLICK_ELEMENT" && message.id) {
                    const ok = clickElementById(message.id);
                    sendResponse({ ok });
                    return true;
                }
                if (message.type === "SET_INPUT_VALUE" && message.id !== undefined) {
                    const ok = setInputValueById(message.id, message.value ?? "");
                    sendResponse({ ok });
                    return true;
                }
                if (message.type === "SET_SELECT_VALUE" && message.id !== undefined) {
                    const ok = setSelectValueById(message.id, message.value ?? "");
                    sendResponse({ ok });
                    return true;
                }
                sendResponse(undefined);
                return false;
            },
        );
    },
});
