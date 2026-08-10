/** @odoo-module **/

import { router } from "@web/core/browser/router";

const WILLOW_DASHBOARD_ACTION = "willow_backend_theme_ent.action_willow_dashboard";
const WILLOW_DASHBOARD_ACTION_TAGS = [
    "willow_backend_theme_ent.operations_dashboard",
    "willow_backend_theme_ent.operations_home",
];
const originalStateToUrl = router.stateToUrl.bind(router);
const originalUrlToState = router.urlToState.bind(router);

function isWillowDashboardState(state) {
    const activeAction = state?.actionStack?.at?.(-1)?.action || state?.action;
    return WILLOW_DASHBOARD_ACTION_TAGS.includes(activeAction);
}

function isDashboardPath(pathname = "") {
    const path = pathname.replace(/\/+$/, "") || "/";
    return (
        path === "/home" ||
        path.startsWith("/home/") ||
        path === "/odoo/home" ||
        path.startsWith("/odoo/home/") ||
        path === "/dashboard" ||
        path.startsWith("/dashboard/") ||
        path === "/odoo/dashboard" ||
        path.startsWith("/odoo/dashboard/")
    );
}

router.stateToUrl = function stateToUrl(state) {
    if (!isWillowDashboardState(state)) {
        return originalStateToUrl(state);
    }

    const url = new URL(originalStateToUrl(state), window.location.origin);
    url.pathname = "/dashboard";
    url.searchParams.delete("dashboard_id");
    return `${url.pathname}${url.search}${url.hash}`;
};

router.urlToState = function urlToState(urlObj) {
    if (!isDashboardPath(urlObj?.pathname || "")) {
        return originalUrlToState(urlObj);
    }

    const canonicalUrl = new URL(urlObj.href);
    canonicalUrl.pathname = "/odoo";
    canonicalUrl.searchParams.delete("dashboard_id");
    if (!canonicalUrl.hash.includes("action=")) {
        canonicalUrl.hash = `#action=${WILLOW_DASHBOARD_ACTION}`;
    }
    return originalUrlToState(canonicalUrl);
};
