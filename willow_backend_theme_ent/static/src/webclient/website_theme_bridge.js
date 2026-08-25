/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { getBundle } from "@web/core/assets";
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

function removeAssetTags(matchingFn) {
    const removedUrls = [];
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
        const href = link.getAttribute("href") || "";
        if (matchingFn(href)) {
            removedUrls.push(href);
            link.remove();
        }
    }
    return removedUrls;
}

function hasLightScreenStylesheets() {
    // Dark boot loads web.assets_web_dark (+ always web.assets_web_print).
    // Match web.assets_web.min.css / web.assets_web.css only (dot after bundle name).
    return [...document.querySelectorAll('link[rel="stylesheet"]')].some((link) => {
        const href = link.getAttribute("href") || "";
        return /web\.assets_web\./.test(href);
    });
}

/**
 * Inject a stylesheet without going through Odoo 18's private cacheMap.
 * loadCSS() would no-op for URLs that were previously loaded then removed from DOM.
 */
function loadCssUncached(url) {
    return new Promise((resolve, reject) => {
        for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
            if (link.getAttribute("href") === url) {
                link.remove();
            }
        }
        const linkEl = document.createElement("link");
        linkEl.setAttribute("href", url);
        linkEl.type = "text/css";
        linkEl.rel = "stylesheet";
        linkEl.addEventListener("load", () => resolve());
        linkEl.addEventListener("error", () => reject(new Error(`CSS load failed: ${url}`)));
        document.head.appendChild(linkEl);
    });
}

async function loadBundleCssOnly(bundleName) {
    // Odoo 18 loadBundle() always loads JS+CSS; reloading JS duplicates the shell.
    const { cssLibs } = await getBundle(bundleName);
    await Promise.all((cssLibs || []).map((url) => loadCssUncached(url)));
}

async function reloadLightBundleAssets() {
    await loadBundleCssOnly("web.assets_web");
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
            await loadBundleCssOnly("web.assets_web_dark");
            return;
        }
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
    themeSwapChain = next.catch(() => {});
    return next;
}

function restoreSavedPathOnParams(params) {
    const saved = browser.sessionStorage.getItem(STORAGE_KEY);
    if (saved && params && (!params.path || params.path === "/")) {
        params.path = saved;
    }
}

async function installWebsitePatches() {
    // Odoo 18+: WebsiteBuilderClientAction with extractProps / onIframeLoad.
    try {
        const { WebsiteBuilderClientAction } = await import(
            "@website/client_actions/website_preview/website_builder_action"
        );
        patch(WebsiteBuilderClientAction, {
            extractProps(action) {
                const props = super.extractProps(action);
                const saved = browser.sessionStorage.getItem(STORAGE_KEY);
                if (saved && (!props.path || props.path === "/")) {
                    props.path = saved;
                }
                return props;
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
        return;
    } catch {
        // Odoo 18: WebsitePreview — path lives on action.context.params.
    }

    try {
        const { WebsitePreview } = await import(
            "@website/client_actions/website_preview/website_preview"
        );
        patch(WebsitePreview.prototype, {
            async onWillStart() {
                restoreSavedPathOnParams(this.props.action?.context?.params);
                return super.onWillStart(...arguments);
            },
            _onPageLoaded(ev) {
                const result = super._onPageLoaded(ev);
                preserveWebsitePreviewPath();
                return result;
            },
        });
    } catch {
        // website module not installed
    }
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
