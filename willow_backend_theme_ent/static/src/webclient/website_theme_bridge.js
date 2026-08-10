/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { assetCacheByDocument, getBundle, loadBundle } from "@web/core/assets";
import { patch } from "@web/core/utils/patch";

const STORAGE_KEY = "wl_sp_website_preserve_path";
const ASSET_SWAP_CLASS = "wl_sp_theme_asset_swap";

/** Serialize overlapping toggles so remove/load cannot interleave. */
let themeSwapChain = Promise.resolve();

function readIframePath() {
    const iframe = document.querySelector(
        ".o_website_preview .o_iframe_container iframe:not(.o_ignore_in_tour)"
    );
    if (!iframe?.contentWindow) {
        return null;
    }
    try {
        const loc = iframe.contentWindow.location;
        if (loc.origin !== window.location.origin) {
            return null;
        }
        return loc.pathname + loc.search + loc.hash;
    } catch {
        return null;
    }
}

export function preserveWebsitePreviewPath() {
    const path = readIframePath();
    if (path) {
        browser.sessionStorage.setItem(STORAGE_KEY, path);
    }
}

export function isWebsitePreviewActive() {
    const locationRef = `${window.location.pathname}${window.location.hash}`;
    return !!(
        document.querySelector(".o_website_preview") ||
        document.querySelector(".o-website-builder_sidebar") ||
        document.body?.classList.contains("o_builder_open") ||
        /website\.website_preview|action-website\.website_preview/i.test(locationRef)
    );
}

function isBackendBrowserPath(pathname = "") {
    return (
        pathname === "/odoo" ||
        pathname.startsWith("/odoo/") ||
        pathname.startsWith("/web") ||
        pathname.startsWith("/@/")
    );
}

/**
 * Odoo's replaceBrowserUrl() mirrors the iframe URL in the address bar;
 * rewrite to /@/<path> so F5 keeps employees in website preview.
 */
function rewriteBrowserUrlForRefresh() {
    const { pathname, search, hash } = window.location;
    if (isBackendBrowserPath(pathname)) {
        return;
    }
    const frontendPath = `${pathname}${search}${hash}` || "/";
    history.replaceState(history.state, document.title, `/@${frontendPath}`);
}

function clearDocumentAssetCache(urls) {
    const cache = assetCacheByDocument.get(document);
    if (!cache) {
        return;
    }
    for (const url of urls) {
        cache.delete(url);
    }
}

function removeAssetTags(matchingFn) {
    const removedUrls = [];
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const href = link.getAttribute("href") || "";
        if (matchingFn(href)) {
            removedUrls.push(href);
            link.remove();
        }
    }
    // CSS-only theme swap: never strip scripts (JS must stay loaded once).
    clearDocumentAssetCache(removedUrls);
    return removedUrls;
}

function hasLightScreenStylesheets() {
    // Dark boot loads web.assets_web_dark (+ always web.assets_web_print).
    // Require a real light screen bundle — exclude _dark / _print explicitly.
    return [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => {
        const href = link.getAttribute("href") || "";
        return (
            href.includes("web.assets_web") &&
            !href.includes("web.assets_web_dark") &&
            !href.includes("web.assets_web_print")
        );
    });
}

async function reloadLightBundleAssets() {
    const { cssLibs } = await getBundle("web.assets_web");
    clearDocumentAssetCache([...(cssLibs || [])]);
    // Odoo serves JS from web.assets_web once; color scheme only swaps CSS.
    // Reloading JS re-registers OWL patches and duplicates the shell.
    await loadBundle("web.assets_web", { js: false });
}

function beginAssetSwapLock() {
    document.documentElement.classList.add(ASSET_SWAP_CLASS);
}

function endAssetSwapLock() {
    document.documentElement.classList.remove(ASSET_SWAP_CLASS);
}

/**
 * Swap light/dark CSS in place — no full page reload.
 * Dark→light loads light CSS before removing dark (avoids unstyled flash).
 */
async function applyThemeOnWebsiteUnlocked(mode) {
    if (isWebsitePreviewActive()) {
        preserveWebsitePreviewPath();
    }
    beginAssetSwapLock();
    try {
        if (mode === "dark") {
            await loadBundle("web.assets_web_dark", { js: false });
            return;
        }
        // Ensure light CSS is present BEFORE removing dark — otherwise the page
        // briefly (or stuck) renders as unstyled HTML.
        if (!hasLightScreenStylesheets()) {
            await reloadLightBundleAssets();
        }
        removeAssetTags((url) => url.includes("web.assets_web_dark"));
    } finally {
        endAssetSwapLock();
    }
}

export async function applyThemeOnWebsite(mode) {
    const next = themeSwapChain.then(() => applyThemeOnWebsiteUnlocked(mode));
    // Keep the chain alive even if one swap rejects, so later toggles still run.
    themeSwapChain = next.catch(() => {});
    return next;
}

function restoreSavedWebsitePath(props) {
    const saved = browser.sessionStorage.getItem(STORAGE_KEY);
    if (saved && (!props.path || props.path === "/")) {
        props.path = saved;
    }
    return props;
}

async function installWebsitePatches() {
    let WebsiteBuilderClientAction;
    try {
        ({ WebsiteBuilderClientAction } = await import(
            "@website/client_actions/website_preview/website_builder_action"
        ));
    } catch {
        return;
    }

    patch(WebsiteBuilderClientAction, {
        extractProps(action) {
            return restoreSavedWebsitePath(super.extractProps(action));
        },
    });

    patch(WebsiteBuilderClientAction.prototype, {
        replaceBrowserUrl() {
            const result = super.replaceBrowserUrl(...arguments);
            preserveWebsitePreviewPath();
            rewriteBrowserUrlForRefresh();
            return result;
        },

        onIframeLoad(ev) {
            const result = super.onIframeLoad(ev);
            preserveWebsitePreviewPath();
            return result;
        },
    });
}

installWebsitePatches();

if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
        if (isWebsitePreviewActive()) {
            preserveWebsitePreviewPath();
        }
    });
}

// Used by global_shell.js (plain script, not an ES module import).
window.__wlSpWebsiteTheme = {
    isWebsitePreviewActive,
    preserveWebsitePreviewPath,
    applyThemeOnWebsite,
};
