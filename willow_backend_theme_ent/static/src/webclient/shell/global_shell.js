/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { cookie } from "@web/core/browser/cookie";
import { _t } from "@web/core/l10n/translation";
import { router, routerBus } from "@web/core/browser/router";
import { registry } from "@web/core/registry";
import { user, userBus } from "@web/core/user";
import { imageUrl } from "@web/core/utils/urls";
import { mountComponent } from "@web/env";
import { session } from "@web/session";
import { UserMenu } from "@web/webclient/user_menu/user_menu";
import { mountThemeSettingsButtons } from "../../theme_settings/components/theme_settings";
import { ensureHeroArt } from "../hero/hero_art";

const THEME_KEY = "wl_sp_theme_mode";
const THEME_RELOAD_KEY = "wl_sp_theme_reloading";
const THEME_RELOAD_BOOTSTRAP_MAX_MS = 2000;
const DEFAULT_LIGHT_PRIMARY = "#4F6EF7";
const DEFAULT_DARK_PRIMARY = "#6B8AFF";
const DEFAULT_DASHBOARD_PRIMARY = "#4F6EF7";
const DEFAULT_THEME_COLORS = {
    light_primary_color: DEFAULT_LIGHT_PRIMARY,
    dark_primary_color: DEFAULT_DARK_PRIMARY,
    dashboard_primary_color: DEFAULT_DASHBOARD_PRIMARY,
    dark_dashboard_primary_color: DEFAULT_DARK_PRIMARY,
    light_header_base_color: "#061B36",
    light_header_mid_color: "#09254A",
    light_canvas_color: "#F8F9FA",
    light_card_color: "#FFFFFF",
    light_card_border_color: "#E8ECF2",
    // Dark navy chrome — pale hero surface needs readable contrast (not white-on-teal).
    light_header_text_color: "#122033",
    light_header_muted_color: "#5C6B7F",
    light_body_text_color: "#122033",
    light_body_muted_color: "#7D8798",
    dark_header_base_color: "#020817",
    dark_header_mid_color: "#0F172A",
    dark_canvas_color: "#0B1120",
    dark_card_color: "#111827",
    dark_card_border_color: "#273449",
    dark_header_text_color: "#F8FAFC",
    dark_header_muted_color: "#A7B4C7",
    dark_body_text_color: "#E5EDF7",
    dark_body_muted_color: "#9AA7BA",
    dashboard_title_color: "#122033",
    dashboard_subtitle_color: "#5C6B7F",
    dark_dashboard_title_color: "#F8FAFC",
    dark_dashboard_subtitle_color: "#A7B4C7",
    success_color: "#16B978",
    info_color: "#8D83F6",
    warning_color: "#FF8B3D",
    danger_color: "#FF4D57",
    dark_success_color: "#34D399",
    dark_info_color: "#A5B4FC",
    dark_warning_color: "#FDBA74",
    dark_danger_color: "#FB7185",
};
const DEFAULT_THEME_VALUES = {
    dashboard_title_size: "38px",
    dashboard_title_weight: "700",
    dashboard_subtitle_size: "19px",
    dashboard_subtitle_weight: "500",
    brand_subtitle: "Enterprise Resource Planning",
};
const WILLOW_DASHBOARD_MENU_XMLID = "willow_backend_theme_ent.menu_willow_dashboard";
const WILLOW_DASHBOARD_ACTION_XMLID = "willow_backend_theme_ent.action_willow_dashboard";
const WILLOW_DASHBOARD_ICON_SRC = "/willow_backend_theme_ent/static/src/img/apps/dashboard.svg";
const WILLOW_THEME_VERSION = "19.0.2.4.9";
const BRAND_COPY_MIN_WIDTH = 80;
const FALLBACK_TOPBAR_MENUS = [
    "Dashboard",
    "Sales",
    "Purchases",
    "Inventory",
    "Finance",
    "HR",
    "Reports",
];
let cachedRootMenus = null;
let renderScheduled = false;
let currentTopSections = new Map();
let lastActiveParentId = null;
let pendingTopbarAppId = null;
let menuNavigationPromise = null;
let menuNavigationTargetId = null;
let activeSubmenuState = null;
let boundEnvBus = null;
let boundMenuChangeHandler = null;
let boundRouteEvents = false;
let footerLastLoadedAt = 0;
let footerRefreshPromise = null;
let systrayMountRetryTimer = null;
let systrayMountRetryCount = 0;
let tabsRenderRetryTimer = null;
let tabsRenderRetryCount = 0;
let rootMenusPreloadPromise = null;
const tabsScrollState = new WeakMap();
let modalViewportGuardReady = false;
let modalViewportSnapshot = null;
let modalViewportNormalizeTimer = null;
let themeReloadBootstrapReleased = false;
let themeReloadBootstrapTimeout = null;
let currentThemePreference = session.willow_theme_mode || user?.settings?.color_scheme || null;
let systemThemeListenerReady = false;
let topbarSearchReady = false;
let topbarSearchDebounce = null;
let topbarSearchRequestId = 0;
const topbarSearchCommands = new Map();
let activeTopbarSearchRoot = null;
let topbarSearchPositionListenerReady = false;
let lastMobileSidebarTrigger = null;

function markDashboardReady(selector) {
    document.querySelectorAll(selector).forEach((element) => {
        element.dataset.wlReady = "1";
    });
}

function formatCount(value) {
    return new Intl.NumberFormat("en-US").format(Number(value) || 0);
}

function pluralize(value, singular, plural = `${singular}s`) {
    return `${formatCount(value)} ${value === 1 ? singular : plural}`;
}

function formatActiveCount(value, singular, plural = `${singular}s`) {
    return _t("%(count)s active", {
        count: pluralize(value, singular, plural),
    });
}

function formatQueuedCount(value, singular, plural = `${singular}s`) {
    return _t("%(count)s queued", {
        count: pluralize(value, singular, plural),
    });
}

function formatEnabledCount(value, singular, plural = `${singular}s`) {
    return _t("%(count)s enabled", {
        count: pluralize(value, singular, plural),
    });
}

function getUserLocale() {
    return user?.lang || navigator.language || "en-US";
}

function formatTimestamp(date = new Date()) {
    return new Intl.DateTimeFormat(getUserLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function formatShortTime(date = new Date()) {
    return new Intl.DateTimeFormat(getUserLocale(), {
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
}

function buildJsonRpcBody(model, method, args = [], kwargs = {}) {
    return {
        jsonrpc: "2.0",
        method: "call",
        params: { model, method, args, kwargs },
        id: Date.now() + Math.floor(Math.random() * 1000),
    };
}

async function callKw(model, method, args = [], kwargs = {}) {
    const response = await fetch(`/web/dataset/call_kw/${model}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(buildJsonRpcBody(model, method, args, kwargs)),
    });
    const payload = await response.json();
    if (payload.error) {
        throw new Error(payload.error.message || "RPC error");
    }
    return payload.result;
}

function normalizeHexColor(value, fallback) {
    const color = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : fallback;
}

function getContrastColor(hexColor) {
    const hex = normalizeHexColor(hexColor, DEFAULT_LIGHT_PRIMARY).slice(1);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
    return luminance >= 150 ? "#111827" : "#ffffff";
}

function getRgbChannels(hexColor) {
    const hex = normalizeHexColor(hexColor, DEFAULT_LIGHT_PRIMARY).slice(1);
    const red = parseInt(hex.slice(0, 2), 16);
    const green = parseInt(hex.slice(2, 4), 16);
    const blue = parseInt(hex.slice(4, 6), 16);
    return `${red}, ${green}, ${blue}`;
}

function getThemeColor(key) {
    const colors = session.willow_theme_colors || {};
    return normalizeHexColor(colors[key], DEFAULT_THEME_COLORS[key]);
}

function getThemeValue(key) {
    const theme = session.willow_theme || {};
    const value = String(theme[key] || "").trim();
    return value || DEFAULT_THEME_VALUES[key];
}

function getBrandSubtitle() {
    // Empty or classic default → translated ERP label; custom text is shown as entered.
    const theme = session.willow_theme || {};
    const configured = String(theme.brand_subtitle || "").trim();
    if (!configured || configured === DEFAULT_THEME_VALUES.brand_subtitle) {
        return _t("Enterprise Resource Planning");
    }
    return configured;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function cssUrl(url) {
    const cleanedUrl = String(url || "").replace(/"/g, "%22");
    return cleanedUrl ? `url("${cleanedUrl}")` : "";
}

function softNeutralCss(color, neutral, tintPct = 30) {
    // Keep a whisper of the preset hue without washing dark surfaces.
    const safeColor = color || neutral;
    return `color-mix(in srgb, ${safeColor} ${tintPct}%, ${neutral})`;
}

function applyThemeColors() {
    const assets = session.willow_theme_assets || {};
    const lightPrimary = getThemeColor("light_primary_color");
    const darkPrimary = getThemeColor("dark_primary_color");
    const lightPrimaryRgb = getRgbChannels(lightPrimary);
    const darkPrimaryRgb = getRgbChannels(darkPrimary);
    const isDarkMode = getThemeMode() === "dark";
    const dashboardPrimary = getThemeColor(
        isDarkMode ? "dark_dashboard_primary_color" : "dashboard_primary_color"
    );
    const dashboardPrimaryRgb = getRgbChannels(dashboardPrimary);
    // Optional company uploads only — empty means reactive SVG hero (no static PNG fallback).
    const lightHeroImage = cssUrl(assets.hero_image);
    const darkHeroImage = cssUrl(assets.hero_image_dark);
    const activeHeroImage = isDarkMode ? darkHeroImage : lightHeroImage;
    const hasCustomHero = Boolean(activeHeroImage);

    const darkCanvasRaw = getThemeColor("dark_canvas_color");
    const darkCardRaw = getThemeColor("dark_card_color");
    const darkBorderRaw = getThemeColor("dark_card_border_color");
    const darkHeaderBaseRaw = getThemeColor("dark_header_base_color");
    const darkHeaderMidRaw = getThemeColor("dark_header_mid_color");
    // Dark homepage/shell: neutralize tinted preset surfaces; keep primary for accents.
    const darkCanvas = isDarkMode ? softNeutralCss(darkCanvasRaw, "#0B1120", 30) : getThemeColor("light_canvas_color");
    const darkCard = isDarkMode ? softNeutralCss(darkCardRaw, "#111827", 30) : getThemeColor("light_card_color");
    const darkBorder = isDarkMode ? softNeutralCss(darkBorderRaw, "#273449", 36) : getThemeColor("light_card_border_color");
    const darkHeaderBase = isDarkMode
        ? softNeutralCss(darkHeaderBaseRaw, "#020817", 34)
        : getThemeColor("light_header_base_color");
    const darkHeaderMid = isDarkMode
        ? softNeutralCss(darkHeaderMidRaw, "#0F172A", 34)
        : getThemeColor("light_header_mid_color");

    const canvasColor = isDarkMode ? darkCanvas : getThemeColor("light_canvas_color");
    const cardColor = isDarkMode ? darkCard : getThemeColor("light_card_color");
    const borderColor = isDarkMode ? darkBorder : getThemeColor("light_card_border_color");

    const variables = {
        "--wl-config-light-primary": lightPrimary,
        "--wl-config-light-primary-contrast": getContrastColor(lightPrimary),
        "--wl-config-light-primary-rgb": lightPrimaryRgb,
        "--wl-config-dark-primary": darkPrimary,
        "--wl-config-dark-primary-contrast": getContrastColor(darkPrimary),
        "--wl-config-dark-primary-rgb": darkPrimaryRgb,
        "--wl-config-dashboard-primary": dashboardPrimary,
        "--wl-config-dashboard-primary-contrast": getContrastColor(dashboardPrimary),
        "--wl-config-dashboard-primary-rgb": dashboardPrimaryRgb,
        "--wl-light-primary": lightPrimary,
        "--wl-light-primary-contrast": getContrastColor(lightPrimary),
        "--wl-light-primary-rgb": lightPrimaryRgb,
        "--wl-dark-primary": darkPrimary,
        "--wl-dark-primary-contrast": getContrastColor(darkPrimary),
        "--wl-dark-primary-rgb": darkPrimaryRgb,
        "--wl-dark-accent": darkPrimary,
        "--wl-dark-accent-contrast": getContrastColor(darkPrimary),
        "--wl-dark-accent-rgb": darkPrimaryRgb,
        "--wl-dashboard-primary": dashboardPrimary,
        "--wl-dashboard-primary-contrast": getContrastColor(dashboardPrimary),
        "--wl-dashboard-primary-rgb": dashboardPrimaryRgb,
        // Homepage buttons/graphs/chips read --wl-erp-primary; keep it in sync with presets.
        "--wl-erp-primary": dashboardPrimary,
        "--wl-erp-primary-contrast": getContrastColor(dashboardPrimary),
        "--wl-erp-primary-rgb": dashboardPrimaryRgb,
        // Mode-aware surfaces so cards/canvas/borders stay consistent across light/dark + presets.
        "--wl-canvas": canvasColor,
        "--wl-card": cardColor,
        "--wl-card-border": borderColor,
        "--wl-erp-card-bg": cardColor,
        "--wl-erp-border": borderColor,
        "--wl-erp-text-dark": getThemeColor(isDarkMode ? "dark_body_text_color" : "light_body_text_color"),
        "--wl-erp-text-muted": getThemeColor(isDarkMode ? "dark_body_muted_color" : "light_body_muted_color"),
        "--wl-erp-green": getThemeColor(isDarkMode ? "dark_success_color" : "success_color"),
        "--wl-erp-red": getThemeColor(isDarkMode ? "dark_danger_color" : "danger_color"),
        "--wl-erp-orange": getThemeColor(isDarkMode ? "dark_warning_color" : "warning_color"),
        "--wl-erp-purple": getThemeColor(isDarkMode ? "dark_info_color" : "info_color"),
        "--wl-config-light-header-base": getThemeColor("light_header_base_color"),
        "--wl-config-light-header-mid": getThemeColor("light_header_mid_color"),
        "--wl-config-light-canvas": getThemeColor("light_canvas_color"),
        "--wl-config-light-card": getThemeColor("light_card_color"),
        "--wl-config-light-card-border": getThemeColor("light_card_border_color"),
        "--wl-config-light-header-text": getThemeColor("light_header_text_color"),
        "--wl-config-light-header-muted": getThemeColor("light_header_muted_color"),
        "--wl-config-light-body-text": getThemeColor("light_body_text_color"),
        "--wl-config-light-body-muted": getThemeColor("light_body_muted_color"),
        "--wl-config-dark-header-base": isDarkMode ? darkHeaderBase : darkHeaderBaseRaw,
        "--wl-config-dark-header-mid": isDarkMode ? darkHeaderMid : darkHeaderMidRaw,
        "--wl-config-dark-canvas": isDarkMode ? darkCanvas : darkCanvasRaw,
        "--wl-config-dark-card": isDarkMode ? darkCard : darkCardRaw,
        "--wl-config-dark-card-border": isDarkMode ? darkBorder : darkBorderRaw,
        "--wl-config-dark-header-text": getThemeColor("dark_header_text_color"),
        "--wl-config-dark-header-muted": getThemeColor("dark_header_muted_color"),
        "--wl-config-dark-body-text": getThemeColor("dark_body_text_color"),
        "--wl-config-dark-body-muted": getThemeColor("dark_body_muted_color"),
        "--wl-config-dashboard-title-size": getThemeValue("dashboard_title_size"),
        "--wl-config-dashboard-title-weight": getThemeValue("dashboard_title_weight"),
        "--wl-config-dashboard-subtitle-size": getThemeValue("dashboard_subtitle_size"),
        "--wl-config-dashboard-subtitle-weight": getThemeValue("dashboard_subtitle_weight"),
        "--wl-config-dashboard-title-color": getThemeColor(
            isDarkMode ? "dark_dashboard_title_color" : "dashboard_title_color"
        ),
        "--wl-config-dashboard-subtitle-color": getThemeColor(
            isDarkMode ? "dark_dashboard_subtitle_color" : "dashboard_subtitle_color"
        ),
        "--wl-config-success": getThemeColor("success_color"),
        "--wl-config-info": getThemeColor("info_color"),
        "--wl-config-warning": getThemeColor("warning_color"),
        "--wl-config-danger": getThemeColor("danger_color"),
        "--wl-config-dark-success": getThemeColor("dark_success_color"),
        "--wl-config-dark-info": getThemeColor("dark_info_color"),
        "--wl-config-dark-warning": getThemeColor("dark_warning_color"),
        "--wl-config-dark-danger": getThemeColor("dark_danger_color"),
        "--wl-erp-hero-bg-image": lightHeroImage || "none",
        "--wl-erp-hero-bg-image-dark": darkHeroImage || "none",
        // Active layer for raster paint — must follow mode. Empty → SVG hero.
        // Inline styles beat the SCSS dark override, so this cannot stay light-only.
        "--wl-erp-hero-bg-layer": activeHeroImage || "none",
        "--wl-erp-hero-bg-layer-dark": darkHeroImage || "none",
    };
    const targets = [
        document.documentElement,
        document.body,
        ...document.querySelectorAll(".o_web_client, .wl_sp_action_shell, .wl_sp_global_shell"),
    ].filter(Boolean);
    for (const target of targets) {
        for (const [name, value] of Object.entries(variables)) {
            target.style.setProperty(name, value);
        }
    }
    document.querySelectorAll(".o_web_client").forEach((webClient) => {
        webClient.classList.toggle("wl_sp_hero_custom", hasCustomHero);
    });
    document.body?.classList.toggle("wl_sp_hero_custom", hasCustomHero);
}

function applyTheme(mode) {
    const body = document.body;
    if (!body) {
        return;
    }
    applyThemeColors();
    const isDark = mode === "dark";
    body.classList.toggle("wl_sp_theme_dark", isDark);
    document.documentElement.classList.toggle("wl_sp_theme_dark", isDark);
    document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    // Match soft-neutralized dark canvas so the page chrome is not preset-washed.
    document.documentElement.style.backgroundColor = isDark
        ? softNeutralCss(getThemeColor("dark_canvas_color"), "#0B1120", 30)
        : getThemeColor("light_canvas_color");
    document.querySelectorAll(".o_web_client").forEach((webClient) => {
        webClient.classList.toggle("wl_sp_theme_dark", isDark);
    });
    document.querySelectorAll(".wl_sp_action_shell").forEach((shell) => {
        shell.classList.toggle("wl_sp_theme_dark", isDark);
    });
    document.querySelectorAll(".wl_sp_global_shell").forEach((shell) => {
        shell.classList.toggle("wl_sp_theme_dark", isDark);
    });

    syncThemeToggleButtons(mode);
}

const THEME_SWITCH_TRANSITION_MS = 220;
let themeModeChangeInFlight = null;
/** Latest mode requested while a swap is running — applied when the current run finishes. */
let pendingThemeMode = null;

function beginThemeSwitchTransition() {
    document.documentElement.classList.add("wl_sp_theme_switching");
}

function endThemeSwitchTransition() {
    window.setTimeout(() => {
        document.documentElement.classList.remove("wl_sp_theme_switching");
    }, THEME_SWITCH_TRANSITION_MS);
}

async function applyThemeAssets(mode) {
    const bridge = window.__wlSpWebsiteTheme;
    if (!bridge?.applyThemeOnWebsite) {
        return false;
    }
    if (bridge.isWebsitePreviewActive?.()) {
        bridge.preserveWebsitePreviewPath?.();
    }
    await bridge.applyThemeOnWebsite(mode);
    return true;
}

function reloadForThemeModeChange() {
    cookie.set(THEME_RELOAD_KEY, "1", 120);
    try {
        browser.sessionStorage.setItem(THEME_RELOAD_KEY, "1");
    } catch (storageError) {
        logThemeError("failed to store theme reload flag", storageError);
    }
    browser.location.reload();
}

function dispatchThemeModeChanged(mode) {
    try {
        window.dispatchEvent(
            new CustomEvent("willow-theme-mode-changed", { detail: { mode } })
        );
    } catch (error) {
        logThemeError("failed to dispatch theme mode event", error);
    }
}

function getThemeSunIconMarkup() {
    // Custom SVG: Font Awesome fa-sun-o reads as a gear in Odoo's FA build.
    return `
        <span class="wl_sp_sun_icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" focusable="false">
                <circle cx="12" cy="12" r="3.5"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(0 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(45 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(90 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(135 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(180 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(225 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(270 12 12)"/>
                <rect x="11" y="2.75" width="2" height="4" rx="1" transform="rotate(315 12 12)"/>
            </svg>
        </span>
    `;
}

function getThemeToggleIconMarkup(mode) {
    if (mode === "dark") {
        return getThemeSunIconMarkup();
    }
    return `<i class="fa fa-moon-o" aria-hidden="true"></i>`;
}

function syncThemeToggleButtons(mode) {
    const isDark = mode === "dark";
    const label = isDark ? _t("Switch to light mode") : _t("Switch to dark mode");
    const icon = getThemeToggleIconMarkup(isDark ? "dark" : "light");
    document.querySelectorAll(".wl_sp_theme_toggle").forEach((btn) => {
        const labelEl = btn.querySelector(".wl_sp_mobile_profile_text");
        if (labelEl) {
            const iconHost = btn.querySelector(".wl_sp_mobile_profile_icon");
            if (iconHost) {
                iconHost.innerHTML = icon;
            } else {
                btn.insertAdjacentHTML(
                    "afterbegin",
                    `<span class="wl_sp_mobile_profile_icon" aria-hidden="true">${icon}</span>`
                );
            }
            labelEl.textContent = label;
        } else {
            btn.innerHTML = icon;
        }
        btn.title = label;
        btn.setAttribute("aria-label", label);
    });
}

function getThemeMode() {
    if (currentThemePreference === "system") {
        return browser.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    if (currentThemePreference === "dark" || currentThemePreference === "light") {
        return currentThemePreference;
    }
    const cookieMode = cookie.get("color_scheme");
    if (cookieMode === "dark" || cookieMode === "light") {
        return cookieMode;
    }
    const storedMode = browser.localStorage.getItem(THEME_KEY);
    return storedMode === "dark" ? "dark" : "light";
}

function isThemeReloadPending() {
    if (cookie.get(THEME_RELOAD_KEY) === "1") {
        return true;
    }
    try {
        return browser.sessionStorage.getItem(THEME_RELOAD_KEY) === "1";
    } catch (error) {
        logThemeError("failed to read theme reload flag", error);
        return false;
    }
}

function isActionContentReady() {
    const actionManager = document.querySelector(".o_web_client > .o_action_manager");
    if (!actionManager) {
        return false;
    }
    if (
        actionManager.querySelector(
            ".o-mail-Discuss, .o_content, .o_renderer, .o_view_controller, .wl_erp_theme_page, .o_control_panel"
        )
    ) {
        return true;
    }
    const action = actionManager.querySelector(":scope > .o_action");
    return Boolean(action?.querySelector(".o_content, .o_renderer, .o_view_controller"));
}

function releaseThemeReloadBootstrap({ force = false } = {}) {
    if (themeReloadBootstrapReleased) {
        return;
    }
    if (!force && !isThemeReloadPending()) {
        return;
    }
    if (!force && !isActionContentReady()) {
        return;
    }
    themeReloadBootstrapReleased = true;
    if (themeReloadBootstrapTimeout) {
        window.clearTimeout(themeReloadBootstrapTimeout);
        themeReloadBootstrapTimeout = null;
    }
    document.documentElement.classList.remove("wl_sp_theme_reloading");
    document.body?.classList.remove("wl_sp_theme_reloading");
    cookie.delete(THEME_RELOAD_KEY);
    try {
        browser.sessionStorage.removeItem(THEME_RELOAD_KEY);
    } catch (error) {
        logThemeError("failed to clear theme reload flag", error);
    }
}

function finishThemeReloadBootstrap() {
    releaseThemeReloadBootstrap();
}

function scheduleThemeReloadBootstrapTimeout() {
    if (!isThemeReloadPending() || themeReloadBootstrapTimeout) {
        return;
    }
    themeReloadBootstrapTimeout = window.setTimeout(() => {
        themeReloadBootstrapTimeout = null;
        releaseThemeReloadBootstrap({ force: true });
    }, THEME_RELOAD_BOOTSTRAP_MAX_MS);
}

function bootThemeReloadLock() {
    if (!isThemeReloadPending()) {
        return;
    }
    const applyLock = () => {
        document.documentElement.classList.add("wl_sp_theme_reloading");
        document.body.classList.add("wl_sp_theme_reloading");
        scheduleThemeReloadBootstrapTimeout();
    };
    if (document.body) {
        applyLock();
    } else {
        document.addEventListener("DOMContentLoaded", applyLock, { once: true });
    }
}

function persistThemeModePreference(mode) {
    currentThemePreference = mode;
    cookie.set("color_scheme", mode);
    if (user?.updateUserSettings) {
        user.updateUserSettings("color_scheme", mode);
    }
    try {
        browser.localStorage.setItem(THEME_KEY, mode);
    } catch (error) {
        logThemeError("failed to store theme mode", error);
    }
    applyTheme(mode);
}

async function setThemeMode(mode) {
    const nextMode = mode === "dark" ? "dark" : "light";

    // Paint + persist intent immediately so every click feels instant.
    persistThemeModePreference(nextMode);

    if (themeModeChangeInFlight) {
        // Queue latest intent instead of dropping the click while CSS swap runs.
        pendingThemeMode = nextMode;
        return themeModeChangeInFlight;
    }

    beginThemeSwitchTransition();

    const run = (async () => {
        try {
            let modeToApply = nextMode;
            // Drain rapid toggles: always finish on the latest pending mode.
            while (true) {
                pendingThemeMode = null;
                // Persist preference in parallel — do not block CSS swap on RPC latency.
                const writePromise = callKw("res.users", "write", [
                    [user.userId],
                    {
                        willow_theme_mode: modeToApply,
                        color_scheme: modeToApply,
                    },
                ]).catch((error) => logThemeError("failed to persist theme preference", error));

                try {
                    const swapped = await applyThemeAssets(modeToApply);
                    if (!swapped) {
                        reloadForThemeModeChange();
                        return;
                    }
                } catch (error) {
                    logThemeError("in-place theme asset swap failed", error);
                    reloadForThemeModeChange();
                    return;
                }

                void writePromise;

                if (pendingThemeMode && pendingThemeMode !== modeToApply) {
                    modeToApply = pendingThemeMode;
                    pendingThemeMode = null;
                    persistThemeModePreference(modeToApply);
                    continue;
                }

                // After CSS + body class are correct so dashboard remount darkens the new snapshot.
                dispatchThemeModeChanged(modeToApply);
                break;
            }
        } finally {
            themeModeChangeInFlight = null;
            endThemeSwitchTransition();
            if (pendingThemeMode) {
                const pending = pendingThemeMode;
                pendingThemeMode = null;
                void setThemeMode(pending);
            }
        }
    })();

    themeModeChangeInFlight = run;
    return run;
}

function refreshThemeScope() {
    applyTheme(getThemeMode());
}

function syncPersistedThemePreference() {
    const resolvedMode = getThemeMode();
    if (cookie.get("color_scheme") !== resolvedMode) {
        cookie.set("color_scheme", resolvedMode);
        beginThemeSwitchTransition();
        applyTheme(resolvedMode);
        void applyThemeAssets(resolvedMode)
            .then(() => {
                dispatchThemeModeChanged(resolvedMode);
            })
            .catch((error) => logThemeError("boot theme asset sync failed", error))
            .finally(() => endThemeSwitchTransition());
    }
    if (currentThemePreference === "system" && !systemThemeListenerReady) {
        systemThemeListenerReady = true;
        browser.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            const nextMode = getThemeMode();
            if (cookie.get("color_scheme") !== nextMode) {
                cookie.set("color_scheme", nextMode);
                beginThemeSwitchTransition();
                applyTheme(nextMode);
                void applyThemeAssets(nextMode)
                    .then(() => {
                        dispatchThemeModeChanged(nextMode);
                    })
                    .catch((error) => logThemeError("system theme asset swap failed", error))
                    .finally(() => endThemeSwitchTransition());
            }
        });
    }
    return true;
}

function setActiveButton(button, selector) {
    const group = button.closest(selector);
    if (!group) {
        return;
    }
    group.querySelectorAll("button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
}

function isDashboardActionToken(actionToken) {
    const token = String(actionToken || "");
    return (
        token === "willow_backend_theme_ent.operations_dashboard" ||
        token === "willow_backend_theme_ent.operations_home" ||
        token === "willow_backend_theme_ent.dashboard" ||
        token === WILLOW_DASHBOARD_ACTION_XMLID ||
        token === "willow_backend_theme_ent.action_willow_dashboard" ||
        token === "willow_backend_theme_ent.action_willow_home"
    );
}

function isWillowDashboardMenu(menu) {
    const xmlid = menu?.xmlid || "";
    return (
        xmlid === WILLOW_DASHBOARD_MENU_XMLID ||
        xmlid === "willow_backend_theme_ent.menu_willow_dashboard" ||
        xmlid === "willow_backend_theme_ent.menu_willow_home"
    );
}

function isSpreadsheetDashboardMenu(menu) {
    const xmlid = String(menu?.xmlid || "");
    return xmlid.startsWith("spreadsheet_dashboard.");
}

function isSpreadsheetDashboardActionToken(actionToken) {
    const token = String(actionToken || "");
    return (
        token === "dashboards" ||
        token === "action_spreadsheet_dashboard" ||
        token === "spreadsheet_dashboard.ir_actions_dashboard_action" ||
        token.endsWith(".ir_actions_dashboard_action")
    );
}

function isSpreadsheetDashboardPage() {
    return !!document.querySelector(
        ".o_web_client > .o_action_manager > .o_action.o_spreadsheet_dashboard_action"
    );
}

function findSpreadsheetDashboardApp(menuService) {
    const apps = typeof menuService?.getApps === "function" ? menuService.getApps() : [];
    return (
        apps.find((menu) => isSpreadsheetDashboardMenu(menu)) ||
        apps.find((menu) =>
            SPREADSHEET_DASHBOARD_MENU_CANONICAL_KEYS.has(canonicalMenuKey(menu?.name))
        ) ||
        null
    );
}

function clearPendingWillowDashboardApp(menuService) {
    if (!pendingTopbarAppId || !menuService?.getMenu) {
        return;
    }
    const pendingMenu = menuService.getMenu(pendingTopbarAppId);
    if (
        pendingMenu &&
        (isWillowDashboardMenu(pendingMenu) ||
            (isDashboardMenuLabel(pendingMenu.name) && !isSpreadsheetDashboardMenu(pendingMenu)))
    ) {
        pendingTopbarAppId = null;
    }
}

function resolveSpreadsheetDashboardAppIfActive(menuService) {
    const { actionToken } = getCurrentActionContext();
    if (!isSpreadsheetDashboardPage() && !isSpreadsheetDashboardActionToken(actionToken)) {
        return null;
    }
    clearPendingWillowDashboardApp(menuService);
    return findSpreadsheetDashboardApp(menuService);
}

function getMenuChildren(menuService, menu) {
    if (!menu?.id) {
        return [];
    }
    return menuService?.getMenuAsTree?.(menu.id)?.childrenTree || menu.childrenTree || [];
}

function findDashboardApp(menuService) {
    const apps = typeof menuService?.getApps === "function" ? menuService.getApps() : [];
    const willowHome = apps.find((menu) => isWillowDashboardMenu(menu));
    if (willowHome) {
        return willowHome;
    }
    return (
        apps.find(
            (menu) => isDashboardMenuLabel(menu?.name) && !isSpreadsheetDashboardMenu(menu)
        ) || null
    );
}

function resolveMenuRootApp(menuService, menu) {
    if (!menu?.id || !menuService?.getMenu) {
        return menu || null;
    }
    const appId = menu.appID || menu.id;
    return menuService.getMenu(appId) || menu;
}

function resolveMenuFirstActionId(menuService, menu) {
    if (!menu) {
        return null;
    }
    const fullMenu =
        typeof menuService?.getMenu === "function" && menu?.id ? menuService.getMenu(menu.id) : menu;
    if (fullMenu?.actionID) {
        return fullMenu.actionID;
    }
    if (fullMenu?.action_id) {
        return fullMenu.action_id;
    }
    const children = fullMenu?.childrenTree || (Array.isArray(fullMenu?.children) ? fullMenu.children : []);
    for (const child of children) {
        const childMenu =
            typeof child === "object"
                ? child
                : typeof menuService?.getMenu === "function"
                ? menuService.getMenu(child)
                : null;
        const childActionId = resolveMenuFirstActionId(menuService, childMenu);
        if (childActionId) {
            return childActionId;
        }
    }
    return null;
}

function isRootAppMenu(menuService, menuId) {
    if (!menuId || typeof menuService?.getApps !== "function") {
        return false;
    }
    const normalizedMenuId = String(menuId);
    return menuService.getApps().some((app) => String(app.id) === normalizedMenuId);
}

function syncPendingTopbarApp(menuService) {
    if (!pendingTopbarAppId || !menuService?.getMenu) {
        return;
    }
    const pendingMenu = menuService.getMenu(pendingTopbarAppId);
    if (!pendingMenu) {
        pendingTopbarAppId = null;
        return;
    }
    const pendingApp = resolveMenuRootApp(menuService, pendingMenu);
    const pendingAppId = pendingApp?.id;
    if (!pendingAppId) {
        pendingTopbarAppId = null;
        return;
    }
    const currentApp = menuService.getCurrentApp?.();
    const currentAppId = currentApp?.appID || currentApp?.id;
    if (String(pendingAppId) !== String(currentAppId)) {
        return;
    }
    const { actionId, actionToken } = getCurrentActionContext();
    if (actionId || actionToken) {
        const matchedActionMenu =
            menuService.getAll?.().find((menu) => {
                if (!menu) {
                    return false;
                }
                return (
                    (actionId && menu.actionID === actionId) ||
                    (actionToken && typeof actionToken === "string" && menu.actionPath === actionToken)
                );
            }) || null;
        if (matchedActionMenu) {
            const actionAppId = resolveMenuRootApp(menuService, matchedActionMenu)?.id;
            if (actionAppId && String(actionAppId) !== String(pendingAppId)) {
                return;
            }
        }
    }
    pendingTopbarAppId = null;
}

function markActiveTopbarApp(menuId) {
    const normalizedMenuId = String(menuId || "");
    if (!normalizedMenuId) {
        return;
    }
    const selector = `.wl_sp_submenu_btn[data-wl-menu-id="${CSS.escape(normalizedMenuId)}"]`;
    const targetButton = document.querySelector(selector);
    if (!targetButton) {
        return;
    }
    if (targetButton.classList.contains("is-active")) {
        return;
    }
    const tabs = targetButton.closest(".wl_sp_tabs");
    const siblingButtons = tabs
        ? tabs.querySelectorAll(".wl_sp_submenu_btn.is-active")
        : document.querySelectorAll(".wl_sp_submenu_btn.is-active");
    siblingButtons.forEach((button) => button.classList.remove("is-active"));
    targetButton.classList.add("is-active");
    if (tabs) {
        tabs.dataset.wlActiveMenuId = normalizedMenuId;
    }
}

function requestTopbarAppSwitch(menuService, menu) {
    if (!menu?.id || menu.isFallback) {
        return false;
    }
    if (menuNavigationPromise && String(menuNavigationTargetId) === String(menu.id)) {
        markActiveTopbarApp(menu.id);
        return false;
    }
    const currentApp = menuService?.getCurrentApp?.();
    if (currentApp?.id && String(currentApp.id) === String(menu.id) && !menuNavigationPromise) {
        return false;
    }
    pendingTopbarAppId = menu.id;
    lastActiveParentId = null;
    heroSubnavSignature = "";
    markActiveTopbarApp(menu.id);
    syncHeroSubnav();
    navigateToMenu(menu.id, menu.actionID);
    return true;
}

function resolveCurrentAppForTabs(menuService) {
    syncPendingTopbarApp(menuService);

    // Spreadsheet Dashboard opened via doAction keeps Willow's menu_id; prefer the
    // spreadsheet_dashboard root so hero subnav (Dashboards | Configuration) appears.
    const spreadsheetApp = resolveSpreadsheetDashboardAppIfActive(menuService);
    if (spreadsheetApp?.id) {
        return spreadsheetApp;
    }

    if (pendingTopbarAppId && menuService?.getMenu) {
        const pendingMenu = menuService.getMenu(pendingTopbarAppId);
        const pendingApp = pendingMenu ? resolveMenuRootApp(menuService, pendingMenu) : null;
        if (pendingApp?.id) {
            return pendingApp;
        }
    }

    const currentApp = menuService?.getCurrentApp?.();
    const { actionId, actionToken } = getCurrentActionContext();
    const routeMenuId = Number.parseInt(router?.current?.menu_id, 10);
    const routeMenu =
        Number.isFinite(routeMenuId) && routeMenuId > 0 ? menuService?.getMenu?.(routeMenuId) || null : null;
    const matchedActionMenu =
        actionId || actionToken
            ? menuService?.getAll?.().find((menu) => {
                  if (!menu) {
                      return false;
                  }
                  return (
                      (actionId && menu.actionID === actionId) ||
                      (actionToken && typeof actionToken === "string" && menu.actionPath === actionToken) ||
                      (actionToken &&
                          typeof actionToken === "string" &&
                          isSpreadsheetDashboardActionToken(actionToken) &&
                          isSpreadsheetDashboardMenu(menu))
                  );
              }) || null
            : null;
    const isDashboardMenuRoute =
        isDashboardMenuLabel(routeMenu?.name) || isDashboardMenuLabel(matchedActionMenu?.name);
    const hasNonHomeRouteMenu = routeMenu?.id && !isDashboardMenuLabel(routeMenu.name);
    const hasNonHomeActionMenu = matchedActionMenu?.id && !isDashboardMenuLabel(matchedActionMenu.name);
    const hasExplicitRouteSignal = !!(routeMenu || matchedActionMenu || actionId || actionToken);
    const isDashboardRoute =
        (!hasNonHomeRouteMenu && !hasNonHomeActionMenu && isDashboardActionToken(actionToken)) ||
        isDashboardMenuRoute ||
        (!hasExplicitRouteSignal && isDashboardContext());

    const serviceAppRootId = currentApp?.appID || currentApp?.id;
    if (serviceAppRootId && !isDashboardRoute) {
        if (hasNonHomeRouteMenu) {
            const routeAppId = routeMenu.appID || routeMenu.id;
            if (String(routeAppId) !== String(serviceAppRootId)) {
                return menuService?.getMenu?.(serviceAppRootId) || currentApp;
            }
        }
        if (hasNonHomeActionMenu) {
            const matchAppId = matchedActionMenu.appID || matchedActionMenu.id;
            if (String(matchAppId) !== String(serviceAppRootId)) {
                return menuService?.getMenu?.(serviceAppRootId) || currentApp;
            }
        }
    }

    if (hasNonHomeRouteMenu) {
        const routeAppId = routeMenu.appID || routeMenu.id;
        return menuService?.getMenu?.(routeAppId) || routeMenu;
    }

    if (hasNonHomeActionMenu) {
        const matchAppId = matchedActionMenu.appID || matchedActionMenu.id;
        return menuService?.getMenu?.(matchAppId) || matchedActionMenu;
    }

    if (isDashboardRoute || isDashboardMenuRoute) {
        const homeApp = findDashboardApp(menuService);
        if (homeApp?.id) {
            return homeApp;
        }
    }

    const routeAppId = routeMenu?.appID || routeMenu?.id;
    if (routeAppId) {
        return menuService?.getMenu?.(routeAppId) || routeMenu;
    }

    if (matchedActionMenu) {
        const matchAppId = matchedActionMenu.appID || matchedActionMenu.id;
        if (matchAppId) {
            return menuService?.getMenu?.(matchAppId) || matchedActionMenu;
        }
    }

    if (currentApp?.id && !isDashboardRoute) {
        return currentApp;
    }

    return currentApp?.id ? currentApp : null;
}

function getCurrentAppSections(menuService) {
    const currentApp = resolveCurrentAppForTabs(menuService);
    if (!currentApp?.id) {
        return [];
    }
    return getMenuChildren(menuService, currentApp);
}

function findMenuInTree(nodes, targetMenuId) {
    if (!targetMenuId) {
        return null;
    }
    for (const node of nodes || []) {
        if (!node) {
            continue;
        }
        if (node.id === targetMenuId) {
            return node;
        }
        const childMatch = findMenuInTree(node.childrenTree || [], targetMenuId);
        if (childMatch) {
            return childMatch;
        }
    }
    return null;
}

function resolveTopSectionById(menuService, menuIdValue) {
    const menuId = Number.parseInt(menuIdValue, 10);
    if (!Number.isFinite(menuId)) {
        return null;
    }

    const cachedSection = currentTopSections.get(String(menuId));
    if (cachedSection) {
        return cachedSection;
    }

    const sections = getCurrentAppSections(menuService);
    const section = findMenuInTree(sections, menuId);
    if (section?.id) {
        currentTopSections.set(String(section.id), section);
    }
    return section || null;
}

function getCurrentActionContext() {
    const route = router?.current || {};
    const actionService = getWebclientActionService();
    const actionStack = Array.isArray(route.actionStack) ? route.actionStack : [];
    const routeAction = actionStack.at(-1)?.action || route.action;
    const currentAction = routeAction || actionService?.currentController?.action?.id || null;
    const numericActionId = Number.parseInt(currentAction, 10);
    return {
        actionId: Number.isFinite(numericActionId) ? numericActionId : null,
        actionToken: currentAction || null,
    };
}

function resolveCurrentMenu(menuService) {
    if (!menuService?.getAll) {
        return null;
    }

    const routeMenuId = Number.parseInt(router?.current?.menu_id, 10);
    const routeMenu =
        Number.isFinite(routeMenuId) && routeMenuId > 0 ? menuService.getMenu(routeMenuId) || null : null;

    const { actionId, actionToken } = getCurrentActionContext();
    const storedAppId = Number.parseInt(window.sessionStorage.getItem("menu_id"), 10);
    if (actionId || actionToken) {
        const matches = menuService.getAll().filter((menu) => {
            if (!menu) {
                return false;
            }
            return (
                (actionId && menu.actionID === actionId) ||
                (actionToken && typeof actionToken === "string" && menu.actionPath === actionToken)
            );
        });
        if (matches.length) {
            const preferredAppId = routeMenu?.appID || routeMenu?.id || storedAppId;
            return matches.find((menu) => menu.appID === preferredAppId) || matches[0];
        }
    }

    if (routeMenu) {
        return routeMenu;
    }
    return Number.isFinite(storedAppId) && storedAppId > 0 ? menuService.getMenu(storedAppId) || null : null;
}

function menuTreeContains(menu, targetMenuId, targetActionId) {
    if (!menu) {
        return false;
    }
    if ((targetMenuId && menu.id === targetMenuId) || (targetActionId && menu.actionID === targetActionId)) {
        return true;
    }
    return (menu.childrenTree || []).some((child) =>
        menuTreeContains(child, targetMenuId, targetActionId)
    );
}

function findActiveTopSection(sections, currentMenu) {
    const { actionId } = getCurrentActionContext();
    return (
        sections.find((section) => menuTreeContains(section, currentMenu?.id || null, actionId)) ||
        sections[0] ||
        null
    );
}

function markActiveTopSection(menuId) {
    const normalizedMenuId = String(menuId || "");
    if (!normalizedMenuId) {
        console.warn("[willow_backend_theme_ent] cannot mark active submenu without a menu id");
        return;
    }
    const selector = `.wl_sp_submenu_btn[data-wl-menu-id="${CSS.escape(normalizedMenuId)}"]`;
    const targetButton = document.querySelector(selector);
    if (!targetButton) {
        console.warn("[willow_backend_theme_ent] active submenu button not found", {
            menuId: normalizedMenuId,
        });
        return;
    }
    if (targetButton.classList.contains("is-active")) {
        return;
    }
    const tabs = targetButton.closest(".wl_sp_tabs");
    const siblingButtons = tabs
        ? tabs.querySelectorAll(".wl_sp_submenu_btn.is-active")
        : document.querySelectorAll(".wl_sp_submenu_btn.is-active");
    siblingButtons.forEach((button) => button.classList.remove("is-active"));
    targetButton.classList.add("is-active");
    if (tabs) {
        tabs.dataset.wlActiveMenuId = normalizedMenuId;
    }
}

function collectActionableDescendants(menu) {
    const items = [];
    const seen = new Set();

    const traverseMenuTree = (tree, callback, parents = []) => {
        if (!tree) {
            return;
        }
        callback(tree, parents);
        (tree.childrenTree || []).forEach((child) =>
            traverseMenuTree(child, callback, parents.concat([tree]))
        );
    };

    for (const root of menu?.childrenTree || []) {
        traverseMenuTree(root, (node, parents) => {
            if (!node?.id || !node.actionID || seen.has(node.id)) {
                return;
            }
            seen.add(node.id);
            const label = normalizeMenuLabel(node.name || _t("Menu"));
            const normalizedParents = parents.map((parent) => normalizeMenuLabel(parent.name || _t("Menu")));
            const immediateParent = normalizedParents[normalizedParents.length - 1] || "";
            const resolvedGroup = immediateParent && immediateParent !== label ? immediateParent : null;
            items.push({
                actionID: node.actionID,
                id: node.id,
                key: `${node.id}-${node.actionID}`,
                group: resolvedGroup,
                label,
                xmlid: node.xmlid || null,
            });
        });
    }

    return items;
}

function isWebsitePreviewActive() {
    return Boolean(
        document.querySelector(".o_website_preview") ||
        document.querySelector(".o-website-builder_sidebar") ||
        document.body.classList.contains("o_builder_open") ||
        /website\.website_preview|action-website\.website_preview/i.test(location.href || "")
    );
}

async function tryOpenWebsiteCustomMenu(item) {
    if (!item?.xmlid || !isWebsitePreviewActive()) {
        return false;
    }
    const env = getWebclientEnv();
    const websiteService = env?.services?.website;
    if (item.xmlid === "website.menu_website_preview" && websiteService?.goToWebsite) {
        websiteService.goToWebsite({ path: "/" });
        return true;
    }
    const customMenusService = env?.services?.["website_custom_menus"];
    let xmlid = item.xmlid;
    if (xmlid === "website.custom_menu_edit_menu" && !customMenusService?.get(xmlid)) {
        xmlid = "website.menu_edit_menu";
    }
    let menuConfig = customMenusService?.get(xmlid);
    if (!menuConfig && (xmlid === "website.custom_menu_edit_menu" || xmlid === "website.menu_edit_menu")) {
        xmlid = "website.menu_edit_menu";
        menuConfig = customMenusService?.get(xmlid);
    }
    if (
        !env ||
        !menuConfig ||
        !websiteService?.currentWebsite?.metadata ||
        !websiteService.isRestrictedEditor
    ) {
        return false;
    }
    if (menuConfig.isDisplayed && !menuConfig.isDisplayed(env)) {
        if (xmlid === "website.custom_menu_edit_menu" && customMenusService?.get("website.menu_edit_menu")) {
            xmlid = "website.menu_edit_menu";
            menuConfig = customMenusService.get(xmlid);
        } else {
            return false;
        }
    }
    try {
        let dynamicProps = item.dynamicProps;
        if (!dynamicProps?.rootID && (xmlid === "website.custom_menu_edit_menu" || xmlid === "website.menu_edit_menu")) {
            const contentMenus = websiteService.currentWebsite.metadata.contentMenus;
            const firstMenu = contentMenus?.[0];
            const rootID = firstMenu ? parseInt(firstMenu[1], 10) : 1;
            dynamicProps = { ...dynamicProps, rootID };
        }
        await customMenusService.open({ xmlid, dynamicProps });
        return true;
    } catch (error) {
        logThemeError("website custom menu open failed", error);
        return false;
    }
}

// ── Hero subnav (wl_erp_submenus_bar) ────────────────────────────────────────

let heroSubnavSignature = "";
let activeHeroDropdownState = null;

function closeHeroDropdown() {
    if (!activeHeroDropdownState) {
        return;
    }
    const { button, panel, onPointerDown, onKeyDown, onResize, onScroll } = activeHeroDropdownState;
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
    button?.classList.remove("is-open");
    button?.setAttribute("aria-expanded", "false");
    panel?.remove();
    activeHeroDropdownState = null;
}

function openHeroSubmenuDropdown(button, sectionNode, menuService, activeMenuId) {
    if (activeHeroDropdownState?.button === button) {
        closeHeroDropdown();
        return;
    }
    closeHeroDropdown();

    const items = collectActionableDescendants(sectionNode);
    if (!items.length) {
        if (sectionNode?.actionID) {
            const item = { id: sectionNode.id, actionID: sectionNode.actionID, xmlid: sectionNode.xmlid || null };
            tryOpenWebsiteCustomMenu(item).then((opened) => {
                if (!opened) {
                    navigateToMenu(sectionNode.id, sectionNode.actionID);
                }
            });
        }
        return;
    }

    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");

    const panel = document.createElement("div");
    panel.className = "o_popover popover wl_sp_submenu_popover_wrap wl_erp_hero_dropdown";
    panel.setAttribute("role", "menu");
    panel.innerHTML = '<div class="popover-body wl_sp_submenu_popover"></div>';
    const body = panel.querySelector(".popover-body");

    const ungroupedItems = [];
    const groups = new Map();
    for (const item of items) {
        if (!item.group) {
            ungroupedItems.push(item);
        } else {
            if (!groups.has(item.group)) {
                groups.set(item.group, []);
            }
            groups.get(item.group).push(item);
        }
    }

    const appendItemButton = (item) => {
        const btn = document.createElement("a");
        btn.className = "dropdown-item";
        btn.href = buildMenuUrl(item.id, item.actionID);
        if (activeMenuId === item.id) {
            btn.classList.add("active");
        }
        btn.textContent = item.label;
        btn.addEventListener("click", async (ev) => {
            if (isModifiedNavigationClick(ev)) {
                closeHeroDropdown();
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            body.querySelectorAll(".dropdown-item.active").forEach((el) => el.classList.remove("active"));
            btn.classList.add("active");
            lastActiveParentId = sectionNode?.id || null;
            closeHeroDropdown();
            const opened = await tryOpenWebsiteCustomMenu(item);
            if (!opened) {
                navigateToMenu(item.id, item.actionID);
            }
        });
        body.appendChild(btn);
    };

    for (const item of ungroupedItems) {
        appendItemButton(item);
    }
    if (ungroupedItems.length && groups.size) {
        const divider = document.createElement("div");
        divider.className = "wl_sp_submenu_group_divider";
        body.appendChild(divider);
    }
    Array.from(groups.entries()).forEach(([groupLabel, groupItems], index, arr) => {
        const header = document.createElement("div");
        header.className = "wl_sp_submenu_group_title";
        if (groupItems.some((item) => item.id === activeMenuId)) {
            header.classList.add("is-active");
        }
        header.textContent = groupLabel;
        body.appendChild(header);
        for (const item of groupItems) {
            appendItemButton(item);
        }
        if (index < arr.length - 1) {
            const divider = document.createElement("div");
            divider.className = "wl_sp_submenu_group_divider";
            body.appendChild(divider);
        }
    });

    document.body.appendChild(panel);

    const positionPanel = () => {
        const rect = button.getBoundingClientRect();
        panel.style.position = "fixed";
        panel.style.top = `${rect.bottom + 6}px`;
        panel.style.left = `${Math.max(8, rect.left)}px`;
        panel.style.zIndex = "2200";
    };

    const onPointerDown = (ev) => {
        if (!panel.contains(ev.target) && !button.contains(ev.target)) {
            closeHeroDropdown();
        }
    };
    const onKeyDown = (ev) => {
        if (ev.key === "Escape") {
            closeHeroDropdown();
        }
    };
    const onResize = () => closeHeroDropdown();
    const onScroll = (ev) => {
        if (panel.contains(ev.target)) {
            return;
        }
        closeHeroDropdown();
    };

    positionPanel();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    activeHeroDropdownState = { button, panel, onPointerDown, onKeyDown, onResize, onScroll };
}

function isDashboardThemePage() {
    return !!document.querySelector(".wl_erp_theme_page");
}

let spreadsheetBackButtonObserver = null;
let spreadsheetBackButtonObservedRoot = null;
let spreadsheetBackButtonTimer = null;
let spreadsheetHeroSyncedForRoot = null;

function syncSpreadsheetDashboardBackButton() {
    const actionRoot = document.querySelector(
        ".o_web_client > .o_action_manager > .o_action.o_spreadsheet_dashboard_action"
    );
    document.querySelectorAll(".wl_sp_open_willow_dashboard_btn").forEach((button) => {
        if (!actionRoot || !actionRoot.contains(button)) {
            button.remove();
        }
    });
    if (!actionRoot) {
        spreadsheetHeroSyncedForRoot = null;
        if (spreadsheetBackButtonTimer) {
            window.clearTimeout(spreadsheetBackButtonTimer);
            spreadsheetBackButtonTimer = null;
        }
        if (spreadsheetBackButtonObserver) {
            spreadsheetBackButtonObserver.disconnect();
            spreadsheetBackButtonObserver = null;
            spreadsheetBackButtonObservedRoot = null;
        }
        return;
    }

    // After doAction, menu_id may still be Willow Dashboard until/unless selectMenu
    // was used. Re-sync hero once the spreadsheet action DOM is present.
    if (spreadsheetHeroSyncedForRoot !== actionRoot) {
        spreadsheetHeroSyncedForRoot = actionRoot;
        heroSubnavSignature = "";
        syncHeroSubnav();
    }

    const ensureButton = () => {
        const navigation = actionRoot.querySelector(".o_control_panel_navigation");
        if (!navigation || navigation.querySelector(":scope > .wl_sp_open_willow_dashboard_btn")) {
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.className =
            "btn btn-primary wl_sp_open_willow_dashboard_btn tt_dashboard_button tt_dashboard_button_primary";
        button.dataset.wlAction = "open-dashboard";
        button.setAttribute("title", _t("Dashboard"));
        button.setAttribute("aria-label", _t("Dashboard"));
        button.textContent = _t("Dashboard");
        // Avoid observer feedback while we mutate the control panel.
        spreadsheetBackButtonObserver?.disconnect();
        navigation.appendChild(button);
        if (spreadsheetBackButtonObservedRoot === actionRoot && spreadsheetBackButtonObserver) {
            spreadsheetBackButtonObserver.observe(actionRoot, { childList: true, subtree: true });
        }
    };

    ensureButton();

    if (spreadsheetBackButtonObservedRoot !== actionRoot) {
        spreadsheetBackButtonObserver?.disconnect();
        spreadsheetBackButtonObserver = null;
        spreadsheetBackButtonObservedRoot = actionRoot;
    }

    if (!spreadsheetBackButtonObserver) {
        spreadsheetBackButtonObserver = new MutationObserver(() => {
            if (!document.contains(actionRoot)) {
                spreadsheetBackButtonObserver?.disconnect();
                spreadsheetBackButtonObserver = null;
                spreadsheetBackButtonObservedRoot = null;
                return;
            }
            if (spreadsheetBackButtonTimer) {
                window.clearTimeout(spreadsheetBackButtonTimer);
            }
            spreadsheetBackButtonTimer = window.setTimeout(() => {
                spreadsheetBackButtonTimer = null;
                ensureButton();
            }, 80);
        });
        spreadsheetBackButtonObserver.observe(actionRoot, { childList: true, subtree: true });
    }
}

function resolveHeroSubnavApp(menuService) {
    syncPendingTopbarApp(menuService);
    const spreadsheetApp = resolveSpreadsheetDashboardAppIfActive(menuService);
    if (spreadsheetApp?.id) {
        return spreadsheetApp;
    }
    if (pendingTopbarAppId && menuService?.getMenu) {
        const pendingMenu = menuService.getMenu(pendingTopbarAppId);
        const pendingApp = pendingMenu ? resolveMenuRootApp(menuService, pendingMenu) : null;
        if (pendingApp?.id) {
            return pendingApp;
        }
    }
    return resolveCurrentAppForTabs(menuService);
}

function resolveActiveHeroSection(sections, currentMenu, currentApp, menuService) {
    const intendedActiveSection = lastActiveParentId
        ? sections.find((section) => String(section.id) === String(lastActiveParentId))
        : null;
    if (intendedActiveSection) {
        return intendedActiveSection;
    }
    if (currentMenu?.id && currentApp?.id && menuService) {
        const currentMenuApp = resolveMenuRootApp(menuService, currentMenu);
        if (
            currentMenuApp?.id &&
            String(currentMenuApp.id) !== String(currentApp.appID || currentApp.id)
        ) {
            return sections[0] || null;
        }
    }
    return findActiveTopSection(sections, currentMenu) || sections[0] || null;
}

function syncHeroSubnav() {
    const nav = document.getElementById("wl_erp_submenus_bar");
    const heroBand = document.getElementById("wl_erp_app_hero");
    if (!nav) {
        return;
    }

    if (isDashboardThemePage()) {
        closeHeroDropdown();
        nav.innerHTML = "";
        nav.classList.add("wl_erp_submenus--empty");
        heroBand?.classList.add("wl_erp_app_hero--hidden");
        heroBand?.classList.remove("wl_erp_app_hero--compact");
        heroSubnavSignature = "dashboard:hidden";
        return;
    }

    heroBand?.classList.remove("wl_erp_app_hero--hidden");

    const menuService = getWebclientMenuService();
    if (!menuService) {
        return;
    }

    const currentApp = resolveHeroSubnavApp(menuService);
    const sections = currentApp ? getMenuChildren(menuService, currentApp) : [];
    const currentMenu = resolveCurrentMenu(menuService);
    const activeSection = resolveActiveHeroSection(sections, currentMenu, currentApp, menuService);

    const sig = `${currentApp?.id || 0}|pending:${pendingTopbarAppId || 0}|${sections.map((s) => `${s.id}:${s.actionID || 0}`).join("|")}|active:${activeSection?.id || 0}|last:${lastActiveParentId || 0}`;
    if (sig === heroSubnavSignature) {
        return;
    }
    heroSubnavSignature = sig;

    closeHeroDropdown();
    nav.innerHTML = "";

    nav.classList.toggle("wl_erp_submenus--empty", sections.length === 0);
    heroBand?.classList.toggle("wl_erp_app_hero--compact", sections.length === 0);

    for (const section of sections) {
        const descendants = collectActionableDescendants(section);
        const hasChildren = descendants.length > 0;
        const isActive = activeSection?.id === section.id;

        const button = document.createElement("a");
        button.className = "wl_erp_submenu_item" + (isActive ? " active" : "");
        button.setAttribute("aria-expanded", "false");
        button.dataset.wlMenuId = String(section.id);
        let sectionActionId = section.actionID;
        if (!sectionActionId) {
            const descendants = collectActionableDescendants(section);
            const firstAction = descendants.find((d) => d.actionID);
            if (firstAction) {
                sectionActionId = firstAction.actionID;
            }
        }
        button.href = buildMenuUrl(section.id, sectionActionId);
        if (section.actionID) {
            button.dataset.wlActionId = String(section.actionID);
        }

        const labelSpan = document.createElement("span");
        labelSpan.className = "wl_erp_submenu_label";
        labelSpan.textContent = normalizeMenuLabel(section.name || _t("Menu"));
        button.appendChild(labelSpan);

        button.addEventListener("click", async (ev) => {
            if (isModifiedNavigationClick(ev)) {
                closeHeroDropdown();
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            if (hasChildren) {
                openHeroSubmenuDropdown(button, section, menuService, currentMenu?.id || null);
            } else if (section.actionID) {
                lastActiveParentId = section.id;
                const item = { id: section.id, actionID: section.actionID, xmlid: section.xmlid || null };
                const opened = await tryOpenWebsiteCustomMenu(item);
                if (!opened) {
                    navigateToMenu(section.id, section.actionID);
                }
            }
        });

        nav.appendChild(button);
    }
}

function closeSubmenuPopover() {
    if (!activeSubmenuState) {
        return;
    }
    const { button, popover, onPointerDown, onKeyDown, onResize, onScroll } = activeSubmenuState;
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("scroll", onScroll, true);
    button?.classList.remove("is-open");
    button?.setAttribute("aria-expanded", "false");
    popover?.remove();
    activeSubmenuState = null;
}

function openSubmenuPopover(button, menuService, activeMenuId) {
    const menuIdValue = button?.dataset?.krMenuId;
    const section =
        currentTopSections.get(menuIdValue || "") || resolveTopSectionById(menuService, menuIdValue);
    const items = collectActionableDescendants(section);
    if (!items.length) {
        if (section?.actionID) {
            const item = { id: section.id, actionID: section.actionID, xmlid: section.xmlid || null };
            tryOpenWebsiteCustomMenu(item).then((opened) => {
                if (!opened) {
                    navigateToMenu(section.id, section.actionID);
                }
            });
        }
        return;
    }
    if (!button) {
        return;
    }
    if (activeSubmenuState?.button === button) {
        closeSubmenuPopover();
        return;
    }

    closeSubmenuPopover();
    button.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");

    const popover = document.createElement("div");
    popover.className = "o_popover popover wl_sp_submenu_popover_wrap";
    popover.setAttribute("role", "menu");
    popover.innerHTML = '<div class="popover-body wl_sp_submenu_popover"></div>';
    const body = popover.querySelector(".popover-body");
    const ungroupedItems = [];
    const groups = new Map();
    for (const item of items) {
        if (!item.group) {
            ungroupedItems.push(item);
            continue;
        }
        if (!groups.has(item.group)) {
            groups.set(item.group, []);
        }
        groups.get(item.group).push(item);
    }

    const appendItemButton = (item) => {
        const itemButton = document.createElement("a");
        itemButton.className = "dropdown-item";
        itemButton.href = buildMenuUrl(item.id, item.actionID);
        if (activeMenuId === item.id) {
            itemButton.classList.add("active");
        }
        itemButton.textContent = item.label;
        itemButton.dataset.wlAction = "open-menu";
        itemButton.dataset.wlMenuId = String(item.id);
        itemButton.dataset.wlActionId = String(item.actionID);
        itemButton.addEventListener("click", async (ev) => {
            if (isModifiedNavigationClick(ev)) {
                closeSubmenuPopover();
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            body.querySelectorAll(".dropdown-item.active").forEach((element) => {
                element.classList.remove("active");
            });
            itemButton.classList.add("active");
            lastActiveParentId = section?.id || null;
            markActiveTopSection(lastActiveParentId);
            closeSubmenuPopover();
            const opened = await tryOpenWebsiteCustomMenu(item);
            if (!opened) {
                navigateToMenu(item.id, item.actionID);
            }
        });
        body.appendChild(itemButton);
    };

    for (const item of ungroupedItems) {
        appendItemButton(item);
    }

    if (ungroupedItems.length && groups.size) {
        const divider = document.createElement("div");
        divider.className = "wl_sp_submenu_group_divider";
        body.appendChild(divider);
    }

    const groupEntries = Array.from(groups.entries());
    groupEntries.forEach(([groupLabel, groupItems], index) => {
        const header = document.createElement("div");
        header.className = "wl_sp_submenu_group_title";
        if (groupItems.some((item) => item.id === activeMenuId)) {
            header.classList.add("is-active");
        }
        header.textContent = groupLabel;
        body.appendChild(header);

        for (const item of groupItems) {
            appendItemButton(item);
        }

        if (index < groupEntries.length - 1) {
            const divider = document.createElement("div");
            divider.className = "wl_sp_submenu_group_divider";
            body.appendChild(divider);
        }
    });
    document.body.appendChild(popover);

    const positionPopover = () => {
        const rect = button.getBoundingClientRect();
        popover.style.position = "fixed";
        popover.style.top = `${rect.bottom + 8}px`;
        popover.style.left = `${Math.max(8, rect.left)}px`;
        popover.style.zIndex = "2200";
    };

    const onPointerDown = (ev) => {
        if (!popover.contains(ev.target) && !button.contains(ev.target)) {
            closeSubmenuPopover();
        }
    };
    const onKeyDown = (ev) => {
        if (ev.key === "Escape") {
            closeSubmenuPopover();
        }
    };
    const onResize = () => closeSubmenuPopover();
    const onScroll = (ev) => {
        if (popover.contains(ev.target)) {
            return;
        }
        closeSubmenuPopover();
    };

    positionPopover();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    activeSubmenuState = {
        button,
        popover,
        onPointerDown,
        onKeyDown,
        onResize,
        onScroll,
    };
}

function scrollToTarget(id) {
    if (!id) {
        return;
    }
    const target = document.getElementById(id);
    if (!target) {
        return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("wl_sp_target_flash");
    window.setTimeout(() => target.classList.remove("wl_sp_target_flash"), 700);
}

const willowShellBridgeService = {
    // `router` and `user` are Odoo modules, not services. Declaring them here
    // prevents the entire web client from starting before the shell can mount.
    dependencies: ["menu", "action"],
    start(env, { menu, action }) {
        window.__willowEnv = env;
        window.__willowMenuService = menu;
        window.__willowActionService = action;
    },
};
registry.category("services").add("willow_shell_bridge", willowShellBridgeService);

function getWebclientMenuService() {
    const wowlRoot = window.odoo?.__WOWL_DEBUG__?.root;
    return window.__willowMenuService || wowlRoot?.menuService || wowlRoot?.env?.services?.menu || null;
}

function getWebclientEnv() {
    return window.__willowEnv || window.odoo?.__WOWL_DEBUG__?.root?.env || null;
}

function getWebclientCommandService() {
    return getWebclientEnv()?.services?.command || null;
}

function getWebclientActionService() {
    return window.__willowActionService || window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.action || null;
}

function getWebclientBus() {
    return window.__willowEnv?.bus || window.odoo?.__WOWL_DEBUG__?.root?.env?.bus || null;
}

function hasVisibleModal() {
    return Array.from(document.querySelectorAll(".modal.show, .modal.d-block")).some((modal) => {
        const style = window.getComputedStyle(modal);
        return style.display !== "none" && style.visibility !== "hidden" && modal.getClientRects().length > 0;
    });
}

function getWillowViewportElements() {
    return [
        document.documentElement,
        document.body,
        document.querySelector(".o_web_client"),
        document.querySelector(".o_web_client > .o_action_manager"),
        document.querySelector(".o_web_client > .o_action_manager > .o_action"),
        document.querySelector(".o_web_client > .o_action_manager > .o_action > .o_content"),
    ].filter(Boolean);
}

function captureModalViewportState() {
    const body = document.body;
    if (!body?.classList.contains("wl_sp_global_mode") || modalViewportSnapshot) {
        return;
    }
    modalViewportSnapshot = {
        windowX: window.scrollX || 0,
        windowY: window.scrollY || 0,
        elements: getWillowViewportElements().map((element) => ({
            element,
            scrollLeft: element.scrollLeft || 0,
            scrollTop: element.scrollTop || 0,
        })),
    };
}

function clearModalCompensationStyles() {
    for (const element of getWillowViewportElements()) {
        element.style.removeProperty("padding-right");
        element.style.removeProperty("padding-left");
        element.style.removeProperty("margin-right");
        element.style.removeProperty("margin-left");
    }
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("position");
    document.body.style.removeProperty("top");
    document.body.style.removeProperty("left");
    document.body.style.removeProperty("right");
}

function normalizeModalViewportState() {
    const body = document.body;
    if (!body?.classList.contains("wl_sp_global_mode") || hasVisibleModal()) {
        return;
    }

    body.classList.remove("modal-open");
    clearModalCompensationStyles();

    if (modalViewportSnapshot) {
        for (const item of modalViewportSnapshot.elements) {
            if (item.element.isConnected) {
                item.element.scrollLeft = item.scrollLeft;
                item.element.scrollTop = item.scrollTop;
            }
        }
        window.scrollTo(modalViewportSnapshot.windowX, modalViewportSnapshot.windowY);
    }
    modalViewportSnapshot = null;
    renderAllTopbars();
    mountScrollers();
}

function setupModalViewportGuard() {
    if (modalViewportGuardReady || !document.body) {
        return;
    }
    modalViewportGuardReady = true;

    const scheduleCapture = () => {
        window.setTimeout(captureModalViewportState, 0);
    };
    const scheduleNormalize = () => {
        if (modalViewportNormalizeTimer) {
            window.clearTimeout(modalViewportNormalizeTimer);
        }
        window.setTimeout(normalizeModalViewportState, 0);
        modalViewportNormalizeTimer = window.setTimeout(() => {
            modalViewportNormalizeTimer = null;
            normalizeModalViewportState();
        }, 220);
    };

    document.addEventListener("show.bs.modal", scheduleCapture, true);
    document.addEventListener("shown.bs.modal", scheduleCapture, true);
    document.addEventListener("hide.bs.modal", scheduleNormalize, true);
    document.addEventListener("hidden.bs.modal", scheduleNormalize, true);
    new MutationObserver(() => {
        if (document.body.classList.contains("modal-open")) {
            captureModalViewportState();
        } else if (modalViewportSnapshot) {
            scheduleNormalize();
        }
    }).observe(document.body, {
        attributes: true,
        attributeFilter: ["class", "style"],
    });
}

function isDashboardContext() {
    return !!document.querySelector(".wl_sp_action_shell");
}

function isPendingDashboardNavigation() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    if (path === "/home" || path.startsWith("/home/")) {
        return true;
    }
    if (path === "/odoo/home" || path.startsWith("/odoo/home/")) {
        return true;
    }
    if (path === "/dashboard" || path.startsWith("/dashboard/")) {
        return true;
    }
    if (path === "/odoo/dashboard" || path.startsWith("/odoo/dashboard/")) {
        return true;
    }

    const menuService = getWebclientMenuService();
    const routeMenuId = Number.parseInt(router?.current?.menu_id, 10);
    const routeMenu =
        Number.isFinite(routeMenuId) && routeMenuId > 0 ? menuService?.getMenu?.(routeMenuId) || null : null;
    if (routeMenu?.id) {
        return isDashboardMenuLabel(routeMenu.name);
    }

    const { actionId, actionToken } = getCurrentActionContext();
    if (isDashboardActionToken(actionToken)) {
        return true;
    }
    if ((actionId || actionToken) && menuService?.getAll) {
        const matchedActionMenu =
            menuService.getAll().find((menu) => {
                if (!menu) {
                    return false;
                }
                return (
                    (actionId && menu.actionID === actionId) ||
                    (actionToken && typeof actionToken === "string" && menu.actionPath === actionToken)
                );
            }) || null;
        return isDashboardMenuLabel(matchedActionMenu?.name);
    }

    return false;
}

function getSelectedCompanyName() {
    if (user?.activeCompany?.name) {
        return user.activeCompany.name;
    }
    if (user?.defaultCompany?.name) {
        return user.defaultCompany.name;
    }
    if (Array.isArray(user?.allowedCompanies) && user.allowedCompanies[0]?.name) {
        return user.allowedCompanies[0].name;
    }

    const sessionCompanyInfo = window.odoo?.__session_info__?.user_companies;
    if (sessionCompanyInfo && sessionCompanyInfo.allowed_companies) {
        const currentCompanyId = sessionCompanyInfo.current_company;
        const currentCompany = sessionCompanyInfo.allowed_companies[String(currentCompanyId)];
        if (currentCompany?.name) {
            return currentCompany.name;
        }
    }

    const companyService = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.company;
    return companyService?.currentCompany?.name || "";
}

function getSelectedCompanyId() {
    if (user?.activeCompany?.id) {
        return user.activeCompany.id;
    }
    if (user?.defaultCompany?.id) {
        return user.defaultCompany.id;
    }
    if (Array.isArray(user?.allowedCompanies) && user.allowedCompanies[0]?.id) {
        return user.allowedCompanies[0].id;
    }

    const sessionCompanyInfo = window.odoo?.__session_info__?.user_companies;
    if (sessionCompanyInfo?.current_company) {
        return sessionCompanyInfo.current_company;
    }

    const companyService = window.odoo?.__WOWL_DEBUG__?.root?.env?.services?.company;
    return companyService?.currentCompany?.id || null;
}

function getSelectedCompanyLogoSrc() {
    const companyId = getSelectedCompanyId();
    if (!companyId) {
        return "/web/binary/company_logo";
    }
    return imageUrl("res.company", companyId, "logo");
}

function measureElementTextWidth(element) {
    if (!element?.textContent) {
        return 0;
    }
    const style = window.getComputedStyle(element);
    const probe = document.createElement("span");
    probe.textContent = element.textContent;
    probe.setAttribute("aria-hidden", "true");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.pointerEvents = "none";
    probe.style.font = style.font;
    probe.style.letterSpacing = style.letterSpacing;
    probe.style.textTransform = style.textTransform;
    document.body.appendChild(probe);
    const width = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return width;
}

function syncCompanyBrandName() {
    const companyName = getSelectedCompanyName();
    if (!companyName) {
        return;
    }
    const brandSubtitle = getBrandSubtitle();
    document.querySelectorAll(".wl_sp_brand_copy").forEach((copy) => {
        const nameElement = copy.querySelector(".wl_sp_brand_name");
        if (!nameElement) {
            return;
        }
        const subtitleElement = copy.querySelector(".wl_sp_brand_subtitle");
        nameElement.textContent = companyName;
        if (subtitleElement) {
            subtitleElement.textContent = brandSubtitle;
        }
        const nameWidth = measureElementTextWidth(nameElement);
        const subtitleWidth = subtitleElement ? measureElementTextWidth(subtitleElement) : 0;
        const contentWidth = Math.max(nameWidth, subtitleWidth, BRAND_COPY_MIN_WIDTH);
        copy.style.setProperty("--wl-brand-copy-width", `${contentWidth}px`);
        copy.style.width = `${contentWidth}px`;
        nameElement.classList.remove("is-truncated");
        subtitleElement?.classList.remove("is-truncated");
    });
}

function syncCompanyBrandLogo() {
    const companyName = getSelectedCompanyName() || _t("Company");
    const logoSrc = getSelectedCompanyLogoSrc();
    document.querySelectorAll("img.wl_sp_brand_logo").forEach((element) => {
        // Compare authored src — assigning element.src every tick re-fetches the logo.
        if (element.getAttribute("src") !== logoSrc) {
            element.setAttribute("src", logoSrc);
        }
        if (element.getAttribute("alt") !== companyName) {
            element.setAttribute("alt", companyName);
        }
    });
}

function shouldShowPendingActionSkeleton(actionManager) {
    if (isDashboardContext() || !isPendingDashboardNavigation()) {
        return false;
    }
    const currentAction = actionManager?.querySelector(":scope > .o_action");
    if (!currentAction) {
        return true;
    }
    if (currentAction.querySelector(".o_content, .o_control_panel, .o_renderer, .o_view_controller")) {
        return false;
    }
    return !currentAction.textContent.trim();
}

function syncPendingActionSkeleton() {
    const actionManager = document.querySelector(".o_web_client > .o_action_manager");
    if (!actionManager) {
        return;
    }

    const existing = document.getElementById("wl_sp_pending_action_skeleton");
    if (!shouldShowPendingActionSkeleton(actionManager)) {
        existing?.remove();
        return;
    }
    if (existing) {
        return;
    }

    const skeleton = document.createElement("section");
    skeleton.id = "wl_sp_pending_action_skeleton";
    skeleton.className = "wl_sp_pending_action_skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    skeleton.innerHTML = `
        <div class="wl_sp_pending_header"></div>
        <div class="wl_sp_pending_grid">
            <article></article>
            <article></article>
            <article></article>
        </div>
        <div class="wl_sp_pending_grid is-bottom">
            <article></article>
            <article></article>
            <article></article>
        </div>
    `;
    actionManager.appendChild(skeleton);
}

function getUserAvatarSrc() {
    if (user?.partnerId) {
        return imageUrl("res.partner", user.partnerId, "avatar_128", {
            unique: user.writeDate,
        });
    }
    if (user?.userId) {
        return `/web/image?model=res.users&field=avatar_128&id=${user.userId}`;
    }
    return "/web/static/img/user_menu_avatar.png";
}

function getUserDisplayName() {
    return user?.name || _t("User");
}

function isDebugMode() {
    return !!window.odoo?.__WOWL_DEBUG__?.root?.env?.debug;
}

function getCurrentDebugParam() {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("debug")) {
        return currentUrl.searchParams.get("debug") || "";
    }
    const hashParams = new URLSearchParams(currentUrl.hash.replace(/^#/, ""));
    if (hashParams.has("debug")) {
        return hashParams.get("debug") || "";
    }
    return null;
}

function withCurrentDebugParam(targetUrl) {
    const debugValue = getCurrentDebugParam();
    const url = new URL(targetUrl, window.location.origin);
    if (debugValue !== null) {
        url.searchParams.set("debug", debugValue);
    }
    return `${url.pathname}${url.search}${url.hash}`;
}

function buildMenuUrl(menuId, actionId) {
    const normalizedMenuId = Number.parseInt(menuId, 10);
    if (!Number.isFinite(normalizedMenuId)) {
        return withCurrentDebugParam("/odoo");
    }
    const state = { menu_id: normalizedMenuId };
    if (actionId) {
        state.action = actionId;
    }
    try {
        if (typeof router?.stateToUrl === "function") {
            return withCurrentDebugParam(router.stateToUrl(state));
        }
    } catch (error) {
        logThemeError("buildMenuUrl via router failed", error);
    }
    const hash = new URLSearchParams();
    hash.set("menu_id", String(normalizedMenuId));
    if (actionId) {
        hash.set("action", String(actionId));
    }
    return `${withCurrentDebugParam("/odoo")}#${hash.toString()}`;
}

function isModifiedNavigationClick(ev) {
    return Boolean(ev?.ctrlKey || ev?.metaKey || ev?.shiftKey || ev?.button === 1 || ev?.which === 2);
}

function buildLogoutUrl() {
    const redirectUrl = new URL(withCurrentDebugParam("/web/login"), window.location.origin);
    const logoutUrl = new URL(withCurrentDebugParam("/web/session/logout"), window.location.origin);
    logoutUrl.searchParams.set("redirect", `${redirectUrl.pathname}${redirectUrl.search}`);
    return `${logoutUrl.pathname}${logoutUrl.search}`;
}

function getUserRoleLabel() {
    if (user?.isSystem) {
        return _t("Administrator");
    }
    if (user?.isAdmin) {
        return _t("Access Rights");
    }
    if (user?.isInternalUser) {
        return _t("Internal User");
    }
    return _t("Portal User");
}

function getUserMetaLabel() {
    return isDebugMode() ? session.db || "" : getUserRoleLabel();
}

function inferEnvironment() {
    const fingerprint = `${window.location.hostname} ${session.db || ""}`.toLowerCase();
    if (/(stag|stage|uat|preprod|sandbox|qa)/.test(fingerprint)) {
        return { label: _t("Staging"), className: "is-staging" };
    }
    if (/(dev|test|local|demo)/.test(fingerprint)) {
        return { label: _t("Development"), className: "is-development" };
    }
    return { label: _t("Production"), className: "is-production" };
}

function getFiscalPeriodLabel() {
    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3) + 1;
    const dateLabel = new Intl.DateTimeFormat(getUserLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(now);
    return `Q${quarter} ${now.getFullYear()} • ${dateLabel}`;
}

function getShortcutHint() {
    const platform = navigator.platform || "";
    return /Mac|iPhone|iPad|iPod/i.test(platform) ? _t("Cmd+K search") : _t("Ctrl+K search");
}

function logThemeError(context, error) {
    console.error(`[willow_backend_theme_ent] ${context}`, error);
}

function runSafely(context, callback) {
    try {
        const result = callback();
        if (result && typeof result.then === "function") {
            return result.catch((error) => {
                logThemeError(context, error);
                return null;
            });
        }
        return result;
    } catch (error) {
        logThemeError(context, error);
        return null;
    }
}

function getLocaleTimeZoneLabel() {
    const locale = getUserLocale();
    const timeZone = user?.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return `${timeZone} / ${locale}`;
}

function setTextContent(id, value) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = value;
    }
}

function setElementHidden(id, hidden) {
    const element = document.getElementById(id);
    if (element) {
        element.hidden = !!hidden;
    }
}

function setActionVisibility(action, visible) {
    document.querySelectorAll(`.wl_sp_footer_action[data-wl-action="${action}"]`).forEach((element) => {
        element.hidden = !visible;
    });
}

function setEnvironmentBadge(environment = inferEnvironment()) {
    const badge = document.getElementById("wl_sp_footer_env_badge");
    if (!badge) {
        return;
    }
    const envKey = (environment.key || environment.className || "production")
        .replace(/^is-/, "")
        .toLowerCase();
    badge.textContent = environment.label || _t("Production");
    badge.classList.remove("is-production", "is-staging", "is-development");
    badge.classList.add(
        environment.className || `is-${(environment.key || "production").toLowerCase()}`
    );
    badge.hidden = envKey === "production";
}

function collectDashboardFilters() {
    return _t("Dashboard");
}

function collectDashboardScope() {
    return _t("Dashboard");
}

function syncDashboardFooterContext() {
    if (!isDashboardContext()) {
        return;
    }
    const companyName = getSelectedCompanyName() || _t("Current Company");
    const dbName = session.db || _t("database");
    const userName = getUserDisplayName();
    const roleLabel = getUserRoleLabel();

    setEnvironmentBadge();
    setTextContent("wl_sp_footer_company_db", `${companyName} / ${dbName}`);
    setTextContent("wl_sp_footer_user_role", `${userName} / ${roleLabel}`);
    setTextContent("wl_sp_footer_period", getFiscalPeriodLabel());
    setTextContent("wl_sp_footer_scope", collectDashboardScope());
    setTextContent("wl_sp_footer_filters", collectDashboardFilters());
    setTextContent("wl_sp_footer_shortcut", getShortcutHint());
    setTextContent("wl_sp_footer_locale", getLocaleTimeZoneLabel());
    setTextContent("wl_sp_footer_odoo_version", session.server_version || "Odoo 19");
    setTextContent("wl_sp_footer_theme_version", WILLOW_THEME_VERSION);
    setTextContent(
        "wl_sp_footer_debug_link",
        isDebugMode() ? _t("Developer Mode On") : _t("Developer Mode")
    );
}

function syncProfileDetails() {
    const userName = getUserDisplayName();
    const metaLabel = getUserMetaLabel();
    const avatarSrc = getUserAvatarSrc();
    const debugMode = isDebugMode();

    document.querySelectorAll(".wl_sp_user_name").forEach((element) => {
        element.textContent = userName;
    });
    document.querySelectorAll(".wl_sp_user_meta").forEach((element) => {
        element.classList.toggle("is-db-badge", debugMode);
        if (debugMode) {
            element.innerHTML = `<i class="fa fa-database" aria-hidden="true"></i><span>${metaLabel}</span>`;
        } else {
            element.textContent = metaLabel;
        }
    });
    document.querySelectorAll(".wl_sp_user_avatar").forEach((element) => {
        if (element.getAttribute("src") !== avatarSrc) {
            element.setAttribute("src", avatarSrc);
        }
        if (element.getAttribute("alt") !== userName) {
            element.setAttribute("alt", userName);
        }
    });
}

async function countModelRecords(model, domain = []) {
    try {
        return await callKw(model, "search_count", [domain]);
    } catch (error) {
        if (model !== "helpdesk.ticket" || !String(error?.message || error).includes("404")) {
            logThemeError(`failed to count ${model}`, error);
        }
        return null;
    }
}

function formatOptionalCount(value) {
    return Number.isFinite(value) ? formatCount(value) : _t("Unavailable");
}

function getActivityStatusLabel(dateDeadline) {
    if (!dateDeadline) {
        return _t("Pending");
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${dateDeadline}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
        return _t("Pending");
    }
    return target < today ? _t("Overdue") : _t("Open");
}

function formatActivityDate(dateDeadline) {
    if (!dateDeadline) {
        return "-";
    }
    const target = new Date(`${dateDeadline}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
        return dateDeadline;
    }
    return new Intl.DateTimeFormat(getUserLocale(), {
        year: "numeric",
        month: "short",
        day: "numeric",
    }).format(target);
}

function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function renderRecentActivitiesTable(activities = []) {
    const tableBody = document.getElementById("wl_sp_recent_table_body");
    if (!tableBody) {
        return;
    }

    tableBody.replaceChildren();
    if (!activities.length) {
        const row = document.createElement("tr");
        [_t("No recent activities found"), "-", "-", "-"].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        tableBody.appendChild(row);
        return;
    }

    activities.forEach((activity) => {
        const row = document.createElement("tr");
        row.dataset.wlAction = "open-dashboard-activity-row";
        row.dataset.wlModel = activity.res_model || "mail.activity";
        row.dataset.wlResId = activity.res_id ? String(activity.res_id) : "";
        row.dataset.wlActivityId = activity.id ? String(activity.id) : "";
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        [
            activity.summary || _t("Activity"),
            activity.res_model || "-",
            getActivityStatusLabel(activity.date_deadline),
            formatActivityDate(activity.date_deadline),
        ].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        tableBody.appendChild(row);
    });
}

function setDashboardChartBarHeights(values = []) {
    const finiteValues = values.map((value) => (Number.isFinite(value) ? value : 0));
    if (!finiteValues.length) {
        return;
    }
    const maxValue = Math.max(...finiteValues, 1);
    document.querySelectorAll(".wl_sp_chart_bars span").forEach((bar, index) => {
        const value = finiteValues[index] || 0;
        bar.style.setProperty("--p", `${Math.max(18, Math.round((value / maxValue) * 128))}px`);
    });
}

async function refreshDashboardOverview(force = false) {
    const overview = document.getElementById("wl_sp_overview");
    if (!overview) {
        return;
    }
    const companyName = getSelectedCompanyName() || _t("Current Company");
    const userName = getUserDisplayName();
    setTextContent("wl_sp_overview_user", userName);
    // Keep the static welcome subtitle from the dashboard template.

    if (overview.dataset.wlOverviewLoaded === "1" && !force) {
        markDashboardReady(".wl_sp_pending_live");
        return;
    }
    overview.dataset.wlOverviewLoaded = "1";
    overview.dataset.wlOverviewRefreshing = "1";
    document.querySelectorAll('[data-wl-action="refresh-dashboard-overview"]').forEach((button) => {
        button.disabled = true;
    });

    try {
    const todayDate = getLocalDateString();
    const overdueActivityDomain = [["date_deadline", "<", todayDate]];
    const todayActivityDomain = [["date_deadline", "=", todayDate]];
    const salesOrderDomain = [["state", "in", ["sale", "done"]]];
    const invoiceDomain = [["move_type", "in", ["out_invoice", "out_refund"]]];
    const quotationDomain = [["state", "in", ["draft", "sent"]]];
    const unpaidInvoiceDomain = [
        ["move_type", "=", "out_invoice"],
        ["state", "=", "posted"],
        ["payment_state", "in", ["not_paid", "partial"]],
    ];
    const crmLeadDomain = [
        ["type", "=", "lead"],
        ["active", "=", true],
    ];
    const openTicketDomain = [["stage_id.fold", "=", false]];

    const [
        partners,
        usersCount,
        activitiesCount,
        attachments,
        companies,
        customers,
        vendors,
        overdueActivities,
        todayActivities,
        salesOrders,
        invoices,
        crmLeads,
        quotations,
        unpaidInvoices,
        helpdeskTickets,
        activities,
    ] = await Promise.all([
        countModelRecords("res.partner"),
        countModelRecords("res.users", [["share", "=", false]]),
        countModelRecords("mail.activity"),
        countModelRecords("ir.attachment"),
        countModelRecords("res.partner", [["is_company", "=", true]]),
        countModelRecords("res.partner", [["customer_rank", ">", 0]]),
        countModelRecords("res.partner", [["supplier_rank", ">", 0]]),
        countModelRecords("mail.activity", overdueActivityDomain),
        countModelRecords("mail.activity", todayActivityDomain),
        countModelRecords("sale.order", salesOrderDomain),
        countModelRecords("account.move", invoiceDomain),
        countModelRecords("crm.lead", crmLeadDomain),
        countModelRecords("sale.order", quotationDomain),
        countModelRecords("account.move", unpaidInvoiceDomain),
        countModelRecords("helpdesk.ticket", openTicketDomain),
        callKw("mail.activity", "search_read", [[]], {
            fields: ["id", "summary", "res_model", "res_id", "date_deadline"],
            limit: 5,
            order: "date_deadline asc",
        }).catch((error) => {
            logThemeError("failed to load recent activities", error);
            return [];
        }),
    ]);
    const counts = [partners, usersCount, activitiesCount, attachments].filter(Number.isFinite);
    const totalRecords = counts.reduce((total, count) => total + count, 0);

    setTextContent("wl_sp_overview_total", counts.length ? formatCount(totalRecords) : _t("Unavailable"));
    setTextContent(
        "wl_sp_overview_total_note",
        counts.length
            ? _t("Across core operational records")
            : _t("Live counts are unavailable for this user")
    );
    const urgentActivities =
        (Number.isFinite(overdueActivities) ? overdueActivities : 0) +
        (Number.isFinite(todayActivities) ? todayActivities : 0);
    const activityProgress =
        Number.isFinite(activitiesCount) && activitiesCount
            ? Math.min(100, Math.round((urgentActivities / activitiesCount) * 100))
            : 0;
    const progressFill = document.getElementById("wl_sp_progress_fill");
    if (progressFill) {
        progressFill.style.setProperty("--wl-progress", `${Math.max(activityProgress, urgentActivities ? 8 : 0)}%`);
    }
    const nextDueDate = activities.find((activity) => activity.date_deadline)?.date_deadline;

    setTextContent("wl_sp_metric_value_1", formatOptionalCount(overdueActivities));
    setTextContent("wl_sp_metric_value_2", formatOptionalCount(todayActivities));
    setTextContent("wl_sp_metric_value_3", formatOptionalCount(salesOrders));
    setTextContent("wl_sp_metric_value_4", formatOptionalCount(invoices));
    setTextContent("wl_sp_wallet_companies", formatOptionalCount(companies));
    setTextContent("wl_sp_wallet_customers", formatOptionalCount(customers));
    setTextContent("wl_sp_wallet_vendors", formatOptionalCount(vendors));
    setTextContent("wl_sp_live_leads", formatOptionalCount(crmLeads));
    setTextContent("wl_sp_live_quotations", formatOptionalCount(quotations));
    setTextContent("wl_sp_live_unpaid_invoices", formatOptionalCount(unpaidInvoices));
    setTextContent("wl_sp_live_tickets", formatOptionalCount(helpdeskTickets));
    setTextContent("wl_sp_chart_customers", formatOptionalCount(customers));
    setTextContent("wl_sp_chart_vendors", formatOptionalCount(vendors));
    setTextContent("wl_sp_chart_sales_orders", formatOptionalCount(salesOrders));
    setTextContent("wl_sp_chart_invoices", formatOptionalCount(invoices));
    setTextContent("wl_sp_progress_current", _t("%(count)s urgent activities", { count: formatOptionalCount(urgentActivities) }));
    setTextContent("wl_sp_progress_total", Number.isFinite(activitiesCount) ? _t("%(count)s open activities", { count: formatCount(activitiesCount) }) : _t("Live records"));
    setTextContent("wl_sp_progress_share", Number.isFinite(activitiesCount) ? _t("%(percent)s% urgent", { percent: activityProgress }) : "-");
    setTextContent("wl_sp_progress_today", formatOptionalCount(todayActivities));
    setTextContent("wl_sp_progress_due", nextDueDate ? formatActivityDate(nextDueDate) : _t("None"));
    setTextContent("wl_sp_activity_status", activities.length ? _t("Live") : _t("Empty"));
    setDashboardChartBarHeights([customers, vendors, salesOrders, invoices]);
    renderRecentActivitiesTable(activities);
    setTextContent("wl_sp_overview_updated", _t("Updated %(time)s", { time: formatShortTime() }));
    markDashboardReady(".wl_sp_pending_live");
    } finally {
    delete overview.dataset.wlOverviewRefreshing;
    document.querySelectorAll('[data-wl-action="refresh-dashboard-overview"]').forEach((button) => {
        button.disabled = false;
    });
    }
}

async function refreshDashboardFooterData(force = false) {
    if (!isDashboardContext()) {
        return;
    }

    syncDashboardFooterContext();

    if (!force && Date.now() - footerLastLoadedAt < 30000) {
        return footerRefreshPromise;
    }
    if (footerRefreshPromise) {
        return footerRefreshPromise;
    }

    footerRefreshPromise = callKw("res.users", "get_willow_dashboard_footer_data")
        .then((footerData) => {
            const nowLabel = formatTimestamp(new Date());
            const environment = footerData.environment || inferEnvironment();
            const supportContact = footerData.support_contact || "";
            const buildVersion = footerData.build_version || "";
            const quickLinks = footerData.quick_links || {};
            const status = footerData.system_status || {};
            const hasSystemStatus = Object.values(status).some((value) => value !== null && value !== undefined);

            setEnvironmentBadge({
                key: environment.key || environment.label?.toLowerCase() || "production",
                label: environment.label || _t("Production"),
                className: `is-${(environment.key || "production").toLowerCase()}`,
            });
            setTextContent(
                "wl_sp_footer_company_db",
                `${footerData.company_name || getSelectedCompanyName() || _t("Current Company")} / ${footerData.database_name || session.db || _t("database")}`
            );
            setTextContent(
                "wl_sp_footer_user_role",
                `${footerData.user_name || getUserDisplayName()} / ${footerData.role_label || getUserRoleLabel()}`
            );
            setTextContent("wl_sp_footer_period", footerData.fiscal_period || getFiscalPeriodLabel());
            setTextContent("wl_sp_footer_scope", collectDashboardScope());
            setTextContent("wl_sp_footer_filters", collectDashboardFilters());
            setTextContent("wl_sp_footer_shortcut", getShortcutHint());
            setTextContent(
                "wl_sp_footer_locale",
                `${footerData.timezone || user?.tz || "UTC"} / ${footerData.locale || getUserLocale()}`
            );
            setTextContent("wl_sp_footer_odoo_version", footerData.odoo_version || session.server_version || "Odoo");
            setTextContent("wl_sp_footer_theme_version", footerData.theme_version || WILLOW_THEME_VERSION);
            setTextContent("wl_sp_footer_last_refresh", nowLabel);
            setTextContent(
                "wl_sp_footer_debug_link",
                isDebugMode() ? _t("Developer Mode On") : _t("Developer Mode")
            );

            if (supportContact) {
                setTextContent("wl_sp_footer_support", supportContact);
            }
            if (buildVersion) {
                setTextContent("wl_sp_footer_build_version", buildVersion);
            }

            setElementHidden("wl_sp_footer_support_row", !supportContact);
            setElementHidden("wl_sp_footer_build_row", !buildVersion);

            setActionVisibility("open-settings", !!quickLinks.settings);
            setActionVisibility("open-users", !!quickLinks.users);
            setActionVisibility("open-scheduled-actions", !!quickLinks.scheduled_actions);
            setActionVisibility("toggle-debug", !!quickLinks.developer_mode);
            setElementHidden(
                "wl_sp_footer_actions",
                !Array.from(document.querySelectorAll("#wl_sp_footer_actions .wl_sp_footer_action")).some(
                    (element) => !element.hidden
                )
            );

            setElementHidden("wl_sp_footer_status_section", !hasSystemStatus);
            if (hasSystemStatus) {
                setTextContent(
                    "wl_sp_footer_jobs",
                    status.background_jobs === null || status.background_jobs === undefined
                        ? _t("Unavailable")
                        : formatActiveCount(status.background_jobs, _t("job"), _t("jobs"))
                );
                setTextContent(
                    "wl_sp_footer_mail_queue",
                    status.mail_queue === null || status.mail_queue === undefined
                        ? _t("Unavailable")
                        : formatQueuedCount(status.mail_queue, _t("message"), _t("messages"))
                );
                setTextContent(
                    "wl_sp_footer_integrations",
                    status.integrations === null || status.integrations === undefined
                        ? _t("Not configured")
                        : formatEnabledCount(status.integrations, _t("integration"), _t("integrations"))
                );
            }
            footerLastLoadedAt = Date.now();
        })
        .finally(() => {
            footerRefreshPromise = null;
        });

    return footerRefreshPromise;
}

async function mountUserMenu() {
    const mountHosts = Array.from(document.querySelectorAll(".wl_sp_profile_menu_mount"));
    if (!mountHosts.length) {
        return;
    }
    const env = window.odoo?.__WOWL_DEBUG__?.root?.env;
    if (!env) {
        return;
    }

    const mounts = mountHosts
        .filter((host) => !host.dataset.wlMounted)
        .map(async (host) => {
            host.dataset.wlMounted = "1";
            try {
                await mountComponent(UserMenu, host, { env });
                host.querySelector(".o_user_menu")?.classList.add("wl_sp_profile_menu");
            } catch {
                host.dataset.wlMounted = "";
            }
        });

    await Promise.all(mounts);
}

function buildTabsElement(menuService) {
    const serviceRootMenus = normalizeRootMenus(
        typeof menuService?.getApps === "function" ? menuService.getApps() : []
    );
    const availableRootMenus = serviceRootMenus.length ? serviceRootMenus : cachedRootMenus || [];
    const rootMenus = getTopbarMenus(availableRootMenus);
    const fallbackMenus = FALLBACK_TOPBAR_MENUS.map((name, index) => ({
        id: `fallback-${index}`,
        name,
        actionID: null,
        isFallback: true,
    }));
    const visibleMenus = rootMenus.length ? rootMenus : fallbackMenus;
    const currentApp = resolveCurrentAppForTabs(menuService);
    const homeApp = findDashboardApp(menuService);
    const activeMenu =
        visibleMenus.find((menu) => String(menu.id) === String(currentApp?.id)) ||
        (isDashboardActionToken(getCurrentActionContext().actionToken) ? homeApp : null) ||
        visibleMenus[0] ||
        null;
    currentTopSections = new Map(
        visibleMenus.filter((menu) => !menu.isFallback).map((menu) => [String(menu.id), menu])
    );

    const tabs = document.createElement("div");
    tabs.className = "wl_sp_tabs";
    // Structure-only signature — active menu is synced via classes (avoids DOM rebuild flash).
    const signatureParts = [`roots:${rootMenus.length}`, `fallback:${rootMenus.length ? 0 : 1}`];
    let activeMenuId = "";

    for (const menu of visibleMenus) {
        const button = document.createElement("a");
        const label = normalizeMenuLabel(menu.name || _t("Menu"));
        signatureParts.push(`${menu.id}:${menu.actionID || 0}`);
        button.className = "wl_sp_submenu_btn";
        button.textContent = label;
        if (!menu.isFallback) {
            button.href = buildMenuUrl(menu.id, menu.actionID);
        } else {
            button.href = withCurrentDebugParam("/odoo");
        }
        button.dataset.wlMenuId = String(menu.id);
        button.dataset.wlAction = menu.isFallback ? "open-apps" : "open-menu";
        if (menu.actionID) {
            button.dataset.wlActionId = String(menu.actionID);
        }
        button.addEventListener("click", (ev) => {
            if (isModifiedNavigationClick(ev)) {
                closeSubmenuPopover();
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            closeSubmenuPopover();
            if (menu.isFallback) {
                openAppsPage();
            } else {
                requestTopbarAppSwitch(menuService, menu);
            }
        });
        if (activeMenu?.id === menu.id) {
            button.classList.add("is-active");
            activeMenuId = String(menu.id);
        }
        tabs.appendChild(button);
    }

    tabs.dataset.wlTabsSignature = signatureParts.join("|");
    tabs.dataset.wlActiveMenuId = activeMenuId;

    return tabs;
}

function renderTabsInViewport(viewport, menuService) {
    if (!viewport) {
        return false;
    }
    const nextTabs = buildTabsElement(menuService);
    const currentTabs = viewport.querySelector(":scope > .wl_sp_tabs");
    if (nextTabs.dataset.wlTabsSignature === "empty") {
        scheduleTabsRender();
        if (!currentTabs) {
            viewport.replaceChildren(nextTabs);
        }
        return false;
    }
    if (!currentTabs) {
        viewport.replaceChildren(nextTabs);
        scrollActiveTabIntoView(viewport.querySelector(":scope > .wl_sp_tabs"));
        return true;
    }
    if (currentTabs.dataset.wlTabsSignature === nextTabs.dataset.wlTabsSignature) {
        // Same menu list — only move the active pill class (no button rebuild / square flash).
        const nextActiveId = nextTabs.dataset.wlActiveMenuId || "";
        if ((currentTabs.dataset.wlActiveMenuId || "") !== nextActiveId) {
            currentTabs.querySelectorAll(".wl_sp_submenu_btn.is-active").forEach((button) => {
                button.classList.remove("is-active");
            });
            if (nextActiveId) {
                const target = currentTabs.querySelector(
                    `.wl_sp_submenu_btn[data-wl-menu-id="${CSS.escape(nextActiveId)}"]`
                );
                target?.classList.add("is-active");
            }
            currentTabs.dataset.wlActiveMenuId = nextActiveId;
            scrollActiveTabIntoView(currentTabs);
        }
        return true;
    }
    closeSubmenuPopover();
    currentTabs.replaceChildren(...nextTabs.childNodes);
    currentTabs.dataset.wlTabsSignature = nextTabs.dataset.wlTabsSignature || "";
    currentTabs.dataset.wlActiveMenuId = nextTabs.dataset.wlActiveMenuId || "";
    scrollActiveTabIntoView(currentTabs);
    return true;
}

function openSearchPalette() {
    const commandService = getWebclientCommandService();
    if (commandService?.openMainPalette) {
        commandService.openMainPalette();
        return;
    }
    window.dispatchEvent(
        new KeyboardEvent("keydown", {
            key: "k",
            ctrlKey: true,
            bubbles: true,
        })
    );
}

function parseTopbarSearchNamespaces(query) {
    const trimmed = (query || "").trimStart();
    const prefix = trimmed[0];
    if (["/", "@", "#"].includes(prefix)) {
        return { namespaces: [prefix], searchValue: trimmed.slice(1).trimStart() };
    }
    return { namespaces: ["/", "@"], searchValue: trimmed };
}

function renderTopbarSearchHint(popover, text) {
    const results = document.createElement("div");
    results.className = "wl_sp_topbar_search_popover_results";
    const hint = document.createElement("div");
    hint.className = "wl_sp_topbar_search_popover_hint";
    hint.textContent = text;
    results.appendChild(hint);
    popover.replaceChildren(results);
}

function renderTopbarSearchResults(popover, commands) {
    const results = document.createElement("div");
    results.className = "wl_sp_topbar_search_popover_results";
    topbarSearchCommands.clear();
    for (const command of commands) {
        topbarSearchCommands.set(command.id, command);
        const item = document.createElement("button");
        item.type = "button";
        item.className = "wl_sp_topbar_search_popover_item";
        item.dataset.wlSearchId = command.id;

        const iconWrap = document.createElement("span");
        iconWrap.className = "wl_sp_topbar_search_popover_icon";
        if (command.iconUrl) {
            const img = document.createElement("img");
            img.src = command.iconUrl;
            img.alt = "";
            iconWrap.appendChild(img);
        } else {
            const icon = document.createElement("i");
            icon.className = "fa fa-search";
            icon.setAttribute("aria-hidden", "true");
            iconWrap.appendChild(icon);
        }

        const label = document.createElement("span");
        label.className = "wl_sp_topbar_search_popover_label";
        label.textContent = command.name || "";
        item.append(iconWrap, label);
        results.appendChild(item);
    }
    popover.replaceChildren(results);
}

function getTopbarSearchPopover(root) {
    if (!root) {
        return document.querySelector(".wl_sp_topbar_search_popover.is-ported") || null;
    }
    return (
        document.querySelector(`.wl_sp_topbar_search_popover.is-ported[data-wl-search-owner="${root.dataset.wlSearchOwner || ""}"]`) ||
        root.querySelector(".wl_sp_topbar_search_popover") ||
        document.querySelector(".wl_sp_topbar_search_popover.is-ported")
    );
}

function ensureTopbarSearchOwnerId(root) {
    if (!root.dataset.wlSearchOwner) {
        root.dataset.wlSearchOwner = `wl-search-${Math.random().toString(36).slice(2, 10)}`;
    }
    return root.dataset.wlSearchOwner;
}

function positionTopbarSearchPopover(root, popover) {
    if (!root || !popover) {
        return;
    }
    const rect = root.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 8)}px`;
    popover.style.left = `${Math.round(Math.max(8, rect.left))}px`;
    popover.style.width = `${Math.round(rect.width)}px`;
}

function mountTopbarSearchPopover(root) {
    if (!root) {
        return null;
    }
    const ownerId = ensureTopbarSearchOwnerId(root);
    let popover = root.querySelector(".wl_sp_topbar_search_popover");
    if (!popover) {
        popover = document.querySelector(
            `.wl_sp_topbar_search_popover.is-ported[data-wl-search-owner="${ownerId}"]`
        );
    }
    if (!popover) {
        return null;
    }
    popover.dataset.wlSearchOwner = ownerId;
    popover.classList.add("is-ported");
    popover.hidden = false;
    if (popover.parentElement !== document.body) {
        document.body.appendChild(popover);
    }
    positionTopbarSearchPopover(root, popover);
    return popover;
}

function unmountTopbarSearchPopover(root, popover) {
    const targetPopover = popover || getTopbarSearchPopover(root);
    if (!targetPopover) {
        return;
    }
    targetPopover.hidden = true;
    targetPopover.classList.remove("is-ported");
    targetPopover.replaceChildren();
    targetPopover.style.removeProperty("top");
    targetPopover.style.removeProperty("left");
    targetPopover.style.removeProperty("width");
    if (root && targetPopover.parentElement !== root) {
        root.appendChild(targetPopover);
    }
}

function onTopbarSearchReposition() {
    if (!activeTopbarSearchRoot?.classList.contains("is-expanded")) {
        return;
    }
    const popover = getTopbarSearchPopover(activeTopbarSearchRoot);
    if (popover && !popover.hidden) {
        positionTopbarSearchPopover(activeTopbarSearchRoot, popover);
    }
}

function ensureTopbarSearchPositionListeners() {
    if (topbarSearchPositionListenerReady) {
        return;
    }
    topbarSearchPositionListenerReady = true;
    window.addEventListener("resize", onTopbarSearchReposition);
    window.addEventListener("scroll", onTopbarSearchReposition, true);
}

function expandTopbarSearch(root) {
    if (!root) {
        return;
    }
    closeSubmenuPopover();
    closeSystrayDropdown();
    document.querySelectorAll(".wl_sp_topbar_search.is-expanded").forEach((element) => {
        if (element !== root) {
            collapseTopbarSearch(element);
        }
    });
    root.classList.add("is-expanded");
    activeTopbarSearchRoot = root;
    ensureTopbarSearchPositionListeners();
    const popover = mountTopbarSearchPopover(root);
    const input = root.querySelector(".wl_sp_topbar_search_input");
    if (popover && !input?.value?.trim()) {
        renderTopbarSearchHint(popover, _t("Start typing to search menus or users."));
    }
    requestAnimationFrame(() => {
        positionTopbarSearchPopover(root, getTopbarSearchPopover(root));
        input?.focus?.();
    });
}

function collapseTopbarSearch(root) {
    const target = root || activeTopbarSearchRoot || document.querySelector(".wl_sp_topbar_search.is-expanded");
    if (!target?.classList.contains("is-expanded")) {
        return;
    }
    window.clearTimeout(topbarSearchDebounce);
    topbarSearchDebounce = null;
    topbarSearchRequestId += 1;
    target.classList.remove("is-expanded");
    unmountTopbarSearchPopover(target);
    const input = target.querySelector(".wl_sp_topbar_search_input");
    if (input) {
        input.value = "";
        input.blur();
    }
    topbarSearchCommands.clear();
    if (activeTopbarSearchRoot === target) {
        activeTopbarSearchRoot = null;
    }
}

async function runTopbarSearch(root, query) {
    const popover = getTopbarSearchPopover(root);
    if (!popover) {
        return;
    }
    const { namespaces, searchValue } = parseTopbarSearchNamespaces(query);
    if (!searchValue) {
        renderTopbarSearchHint(popover, _t("Start typing to search menus or users."));
        return;
    }

    const requestId = ++topbarSearchRequestId;
    renderTopbarSearchHint(popover, _t("Searching..."));

    const env = getWebclientEnv();
    if (!env) {
        renderTopbarSearchHint(popover, _t("No results found."));
        return;
    }

    try {
        const providers = registry.category("command_provider").getAll();
        const matchingProviders = providers.filter((provider) => {
            const providerNamespace = provider.namespace || "default";
            return namespaces.includes(providerNamespace);
        });
        const results = (
            await Promise.all(
                matchingProviders.map((provider) => provider.provide(env, { searchValue }))
            )
        ).flat();

        if (requestId !== topbarSearchRequestId) {
            return;
        }

        const mapped = results
            .map((command, index) => ({
                id: String(command.id || `${command.name}-${index}`),
                name: command.name,
                href: command.href,
                action: command.action,
                iconUrl: command?.props?.imgUrl || command?.props?.webIconData,
            }))
            .slice(0, 12);

        if (!mapped.length) {
            renderTopbarSearchHint(popover, _t("No results found."));
            return;
        }
        renderTopbarSearchResults(popover, mapped);
        positionTopbarSearchPopover(root, popover);
    } catch (error) {
        logThemeError("topbar search failed", error);
        if (requestId === topbarSearchRequestId) {
            renderTopbarSearchHint(popover, _t("No results found."));
        }
    }
}

function onTopbarSearchSelect(command) {
    collapseTopbarSearch();
    if (typeof command?.action === "function") {
        command.action();
    } else if (command?.href) {
        browser.location.href = command.href;
    }
}

function setupTopbarSearch() {
    if (topbarSearchReady) {
        return;
    }
    topbarSearchReady = true;

    document.addEventListener("focusin", (ev) => {
        const root = ev.target.closest?.(".wl_sp_topbar_search");
        if (root) {
            expandTopbarSearch(root);
        }
    });

    document.addEventListener("pointerdown", (ev) => {
        // Keep focus in the input when choosing a result so focusout cannot
        // collapse before the click handler runs.
        if (ev.target.closest?.(".wl_sp_topbar_search_popover_item")) {
            ev.preventDefault();
            return;
        }
        if (
            ev.target.closest?.(".wl_sp_topbar_search") ||
            ev.target.closest?.(".wl_sp_topbar_search_popover")
        ) {
            return;
        }
        if (document.querySelector(".wl_sp_topbar_search.is-expanded")) {
            collapseTopbarSearch();
        }
    });

    document.addEventListener("click", (ev) => {
        const item = ev.target.closest?.(".wl_sp_topbar_search_popover_item");
        if (item?.dataset?.wlSearchId) {
            ev.preventDefault();
            const command = topbarSearchCommands.get(item.dataset.wlSearchId);
            if (command) {
                onTopbarSearchSelect(command);
            }
            return;
        }
        const root = ev.target.closest?.(".wl_sp_topbar_search");
        if (root) {
            expandTopbarSearch(root);
        }
    });

    document.addEventListener("input", (ev) => {
        const input = ev.target.closest?.(".wl_sp_topbar_search_input");
        if (!input) {
            return;
        }
        const root = input.closest(".wl_sp_topbar_search");
        if (!root) {
            return;
        }
        if (!root.classList.contains("is-expanded")) {
            expandTopbarSearch(root);
        }
        window.clearTimeout(topbarSearchDebounce);
        topbarSearchDebounce = window.setTimeout(() => {
            runTopbarSearch(root, input.value || "");
        }, 120);
    });
}

function openMobileSidebar() {
    lastMobileSidebarTrigger = document.activeElement?.closest?.(
        '[data-wl-action="mobile-sidebar-open"]'
    ) || document.querySelector('[data-wl-action="mobile-sidebar-open"]');
    document.body?.classList.add("wl_sp_mobile_sidebar_open");
    document.querySelectorAll('[data-wl-action="mobile-sidebar-open"]').forEach((button) => {
        button.setAttribute("aria-expanded", "true");
    });
    const sidebar = document.getElementById("wl_sp_mobile_sidebar");
    sidebar?.setAttribute("aria-hidden", "false");
    sidebar?.removeAttribute("inert");
    syncThemeToggleButtons(getThemeMode());
    // App links are built once and invalidated by MENUS:APP-CHANGED. Replacing them
    // while the drawer opens can cancel the pointer sequence that triggered it.
    void buildSidebarApps();
    sidebar?.querySelector(".wl_sp_mobile_sidebar_close")?.focus();
}

function closeMobileSidebar() {
    document.body?.classList.remove("wl_sp_mobile_sidebar_open");
    document.querySelectorAll('[data-wl-action="mobile-sidebar-open"]').forEach((button) => {
        button.setAttribute("aria-expanded", "false");
    });
    const sidebar = document.getElementById("wl_sp_mobile_sidebar");
    if (window.matchMedia?.("(max-width: 991.98px)").matches && lastMobileSidebarTrigger?.isConnected) {
        lastMobileSidebarTrigger.focus();
    }
    sidebar?.setAttribute("aria-hidden", "true");
    sidebar?.setAttribute("inert", "");
}

function closeSystrayDropdown() {
    document.querySelectorAll(".wl_sp_systray_overflow.is-open").forEach((element) => {
        element.classList.remove("is-open");
    });
}

function toggleSystrayDropdown(button) {
    const overflow = button.closest(".wl_sp_systray_overflow");
    if (!overflow) {
        return;
    }
    const isOpen = overflow.classList.contains("is-open");
    closeSystrayDropdown();
    overflow.classList.toggle("is-open", !isOpen);
}

function buildTopbarMarkup(context = "global") {
    const companyName = getSelectedCompanyName() || _t("ERP System");
    const companyLogoSrc = getSelectedCompanyLogoSrc();
    const avatarSrc = getUserAvatarSrc();
    const modifier =
        context === "dashboard" || context === "home"
            ? "wl_sp_topbar--dashboard"
            : "wl_sp_topbar--global";
    const searchTitle = getShortcutHint();
    const themeMode = getThemeMode();
    const themeToggleIconMarkup = getThemeToggleIconMarkup(themeMode);
    const themeToggleLabel =
        themeMode === "dark" ? _t("Switch to light mode") : _t("Switch to dark mode");

    return `
        <section class="wl_sp_topbar ${modifier} wl_sp_pending_shell" id="wl_sp_topbar">
            <div class="wl_sp_topbar_left">
                <div class="wl_sp_mobile_menu_slot">
                    <button
                        type="button"
                        class="wl_sp_mobile_menu_btn"
                        data-wl-action="mobile-sidebar-open"
                        title="${_t("All Apps")}"
                        aria-label="${_t("All Apps")}"
                        aria-controls="wl_sp_mobile_sidebar"
                        aria-expanded="false"
                    >
                        <i class="fa fa-bars" aria-hidden="true"></i>
                    </button>
                </div>
                <div class="wl_sp_brand_section" aria-label="${_t("ERP System")}">
                    <button
                        type="button"
                        class="wl_sp_brand_apps_btn"
                        data-wl-action="workspace-modal"
                        title="${_t("All Apps")}"
                        aria-label="${_t("All Apps")}"
                    >
                        <i class="fa fa-th" aria-hidden="true"></i>
                    </button>
                    <button
                        type="button"
                        class="wl_sp_brand_home"
                        data-wl-action="open-dashboard"
                        title="${_t("Dashboard")}"
                        aria-label="${_t("Dashboard")}"
                    >
                        <img src="${companyLogoSrc}" alt="${companyName}" class="wl_sp_brand_logo"/>
                        <div class="wl_sp_brand_copy">
                            <span class="wl_sp_brand_name">${companyName}</span>
                            <span class="wl_sp_brand_subtitle">${escapeHtml(getBrandSubtitle())}</span>
                        </div>
                    </button>
                </div>
                <nav class="wl_sp_tabs_cluster" aria-label="${_t("Main menus")}">
                    <button type="button" class="wl_sp_tabs_scroll is-left" title="${_t("Scroll left")}" aria-label="${_t("Scroll left")}">
                        <i class="fa fa-angle-left"></i>
                    </button>
                    <div class="wl_sp_tabs_section">
                        <div class="wl_sp_tabs_viewport"></div>
                    </div>
                    <button type="button" class="wl_sp_tabs_scroll is-right" title="${_t("Scroll right")}" aria-label="${_t("Scroll right")}">
                        <i class="fa fa-angle-right"></i>
                    </button>
                </nav>
            </div>
            <div class="wl_sp_right_section">
                <div class="wl_sp_topbar_search" role="search" title="${searchTitle}">
                    <span class="wl_sp_search_icon" aria-hidden="true"></span>
                    <input
                        type="search"
                        class="wl_sp_topbar_search_input"
                        placeholder="${_t("Search anything here")}"
                        aria-label="${_t("Search anything here")}"
                        autocomplete="off"
                    />
                    <div class="wl_sp_topbar_search_popover" hidden></div>
                </div>
                <div class="wl_sp_topbar_icons">
                    <div class="wl_sp_systray_mount"></div>
                    <div class="wl_sp_systray_overflow">
                        <button type="button" class="wl_sp_systray_overflow_btn" data-wl-action="toggle-systray-dropdown" title="${_t("More tools")}" aria-label="${_t("More tools")}">
                            <i class="fa fa-ellipsis-h"></i>
                        </button>
                        <div class="wl_sp_systray_overflow_menu"></div>
                    </div>
                </div>
                <div class="wl_sp_account_cluster">
                    <button
                        type="button"
                        class="wl_sp_theme_toggle"
                        data-wl-action="theme-toggle"
                        title="${themeToggleLabel}"
                        aria-label="${themeToggleLabel}"
                    >
                        ${themeToggleIconMarkup}
                    </button>
                    <div class="wl_theme_settings_mount"></div>
                    <div class="wl_sp_profile">
                        <img src="${avatarSrc}" alt="${_t("User")}" class="wl_sp_user_avatar"/>
                        <span class="wl_sp_chevron_down" aria-hidden="true"></span>
                        <div class="wl_sp_profile_menu_mount"></div>
                    </div>
                </div>
            </div>
        </section>
    `;
}

function renderTopbarMount(mount) {
    if (!mount) {
        return;
    }
    const context = mount.dataset.wlTopbarContext || "global";
    if (mount.dataset.wlTopbarRendered === context && mount.querySelector(".wl_sp_topbar")) {
        return;
    }
    mount.dataset.wlTopbarRendered = context;
    mount.innerHTML = buildTopbarMarkup(context);
    const topbar = mount.querySelector(".wl_sp_topbar");
    if (topbar) {
        topbar.dataset.wlReady = "1";
    }
    syncCompanyBrandName();
    syncCompanyBrandLogo();
    const userName = mount.querySelector(".wl_sp_user_name");
    if (userName) {
        userName.textContent = getUserDisplayName();
    }
    const userMeta = mount.querySelector(".wl_sp_user_meta");
    if (userMeta) {
        userMeta.textContent = getUserMetaLabel();
    }
    syncThemeToggleButtons(getThemeMode());
}

function renderAllTopbars() {
    const mounts = document.querySelectorAll(".wl_sp_topbar_mount");
    if (mounts.length) {
        systrayMountRetryCount = 0;
        tabsRenderRetryCount = 0;
    }
    mounts.forEach(renderTopbarMount);
}

function scheduleSystemTrayMount() {
    if (systrayMountRetryTimer || systrayMountRetryCount >= 8) {
        return;
    }
    systrayMountRetryCount += 1;
    systrayMountRetryTimer = window.setTimeout(() => {
        systrayMountRetryTimer = null;
        mountSystemTray();
    }, Math.min(900, 80 * systrayMountRetryCount));
}

function mountSystemTray() {
    const mountHosts = Array.from(document.querySelectorAll(".wl_sp_systray_mount"));
    const overflowHosts = Array.from(document.querySelectorAll(".wl_sp_systray_overflow_menu"));
    if (!mountHosts.length && !overflowHosts.length) {
        scheduleSystemTrayMount();
        return;
    }

    const useOverflow = window.matchMedia?.("(max-width: 767.98px)").matches;
    const candidateHosts = useOverflow && overflowHosts.length ? overflowHosts : mountHosts;
    const homeHost = candidateHosts.find((host) => host.closest(".wl_sp_topbar--dashboard"));
    const globalHost = candidateHosts.find((host) => host.closest(".wl_sp_topbar--global"));
    const activeHost = homeHost || globalHost || candidateHosts[0];
    const systray =
        document.querySelector(".wl_sp_systray_menu") ||
        document.querySelector(".o_main_navbar .o_menu_systray") ||
        document.querySelector(".o_menu_systray");
    if (!activeHost || !systray) {
        scheduleSystemTrayMount();
        return;
    }

    if (systray.parentElement !== activeHost) {
        activeHost.appendChild(systray);
    }
    systray.classList.add("wl_sp_systray_menu");
    for (const item of Array.from(systray.children)) {
        const shouldHide =
            item.querySelector?.(".o_user_menu") ||
            item.querySelector?.(".o_mobile_menu_toggle") ||
            item.querySelector?.(".o_burger_menu_avatar");
        if (shouldHide) {
            item.classList.add("wl_sp_systray_hidden_item");
            item.hidden = true;
            item.setAttribute("aria-hidden", "true");
            item.style.display = "none";
        }
    }
    systray.querySelectorAll(".o_mobile_menu_toggle").forEach((toggle) => {
        const host = toggle.closest(".o_menu_systray > *") || toggle.parentElement;
        if (host) {
            host.classList.add("wl_sp_systray_hidden_item");
            host.hidden = true;
            host.setAttribute("aria-hidden", "true");
            host.style.display = "none";
        }
        toggle.hidden = true;
        toggle.style.display = "none";
    });
    systrayMountRetryCount = 0;
}

function buildWorkspaceModalMarkup() {
    return `
        <div id="wl_sp_workspace_modal" class="wl_sp_workspace_modal" aria-hidden="true">
            <div class="wl_sp_workspace_backdrop" data-wl-action="workspace-close"></div>
            <div class="wl_sp_workspace_dialog" role="dialog" aria-modal="true" aria-label="${_t("All Apps")}">
                <div class="wl_sp_apps_modal">
                    <header class="wl_sp_apps_modal_head">
                        <div class="wl_sp_apps_modal_head_copy">
                            <p class="wl_sp_apps_modal_eyebrow">${_t("Workspace")}</p>
                            <h3 class="wl_sp_apps_modal_title">${_t("All Apps")}</h3>
                            <p class="wl_sp_apps_modal_meta" id="wl_sp_workspace_meta"></p>
                        </div>
                        <button
                            type="button"
                            class="wl_sp_apps_modal_close"
                            data-wl-action="workspace-close"
                            title="${_t("Close")}"
                            aria-label="${_t("Close")}"
                        >
                            <i class="fa fa-times" aria-hidden="true"></i>
                        </button>
                    </header>
                    <div class="wl_sp_apps_modal_search_row">
                        <i class="fa fa-search wl_sp_apps_modal_search_icon" aria-hidden="true"></i>
                        <input
                            type="search"
                            id="wl_sp_workspace_search"
                            class="wl_sp_apps_modal_search"
                            placeholder="${_t("Search applications...")}"
                            autocomplete="off"
                            spellcheck="false"
                        />
                    </div>
                    <div id="wl_sp_workspace_grid" class="wl_sp_apps_modal_grid"></div>
                    <p id="wl_sp_workspace_empty" class="wl_sp_apps_modal_empty" hidden>
                        ${_t("No applications match your search")}
                    </p>
                </div>
            </div>
        </div>
    `;
}

function ensureWorkspaceModal() {
    let modal = document.getElementById("wl_sp_workspace_modal");
    if (modal && !modal.querySelector(".wl_sp_apps_modal")) {
        modal.remove();
        modal = null;
    }
    if (!modal) {
        const wrapper = document.createElement("div");
        wrapper.innerHTML = buildWorkspaceModalMarkup().trim();
        modal = wrapper.firstElementChild;
        document.body.appendChild(modal);
        setupWorkspaceModalSearch();
    } else if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    return modal;
}

function updateWorkspaceModalMeta(visibleCount, totalCount) {
    const meta = document.getElementById("wl_sp_workspace_meta");
    if (!meta) {
        return;
    }
    if (!totalCount) {
        meta.textContent = _t("Loading applications...");
        return;
    }
    if (visibleCount === totalCount) {
        meta.textContent = _t("%(count)s installed applications", { count: totalCount });
        return;
    }
    meta.textContent = _t("Showing %(visible)s of %(total)s applications", {
        visible: visibleCount,
        total: totalCount,
    });
}

function filterWorkspaceGrid(query = "") {
    const grid = document.getElementById("wl_sp_workspace_grid");
    if (!grid) {
        return;
    }
    const normalizedQuery = query.trim().toLowerCase();
    let visibleCount = 0;
    grid.querySelectorAll(".wl_sp_apps_tile").forEach((tile) => {
        const label = tile.dataset.wlAppLabel || "";
        const visible = !normalizedQuery || label.includes(normalizedQuery);
        tile.hidden = !visible;
        if (visible) {
            visibleCount += 1;
        }
    });
    const totalCount = grid.querySelectorAll(".wl_sp_apps_tile").length;
    updateWorkspaceModalMeta(visibleCount, totalCount);
    const emptyState = document.getElementById("wl_sp_workspace_empty");
    if (emptyState) {
        emptyState.hidden = visibleCount !== 0 || !normalizedQuery;
    }
}

function setupWorkspaceModalSearch() {
    const searchInput = document.getElementById("wl_sp_workspace_search");
    if (!searchInput || searchInput.dataset.wlReady) {
        return;
    }
    searchInput.dataset.wlReady = "1";
    searchInput.addEventListener("input", () => {
        filterWorkspaceGrid(searchInput.value);
    });
}

function ensureGlobalHeroBand() {
    const shell = document.getElementById("wl_sp_global_shell");
    if (!shell) {
        return;
    }
    if (document.getElementById("wl_erp_app_hero")) {
        return;
    }
    const hero = document.createElement("section");
    hero.id = "wl_erp_app_hero";
    hero.className = "wl_erp_app_hero";
    hero.innerHTML = `
        <div class="wl_erp_app_hero_inner">
            <nav class="wl_erp_submenus" id="wl_erp_submenus_bar" aria-label="${_t("Submenus")}"></nav>
        </div>
    `;
    const topbarMount = shell.querySelector(".wl_sp_topbar_mount");
    if (topbarMount?.nextSibling) {
        shell.insertBefore(hero, topbarMount.nextSibling);
    } else {
        shell.appendChild(hero);
    }
}

function ensureHeroArtMounts(webClient, shell) {
    if (webClient) {
        ensureHeroArt(webClient, "wl-hero-band-", { prepend: true });
    }
    if (shell) {
        ensureHeroArt(shell, "wl-hero-shell-", { prepend: true });
    }
}

function buildMobileSidebarMarkup() {
    const themeMode = getThemeMode();
    const themeToggleLabel =
        themeMode === "dark" ? _t("Switch to light mode") : _t("Switch to dark mode");
    return `
        <div class="wl_sp_mobile_sidebar_head">
            <h1 class="wl_sp_mobile_sidebar_title">${_t("Menu")}</h1>
            <button type="button" class="wl_sp_mobile_sidebar_close" data-wl-action="mobile-sidebar-close" title="${_t("Close")}" aria-label="${_t("Close")}">
                <i class="fa fa-times" aria-hidden="true"></i>
            </button>
        </div>
        <div class="wl_sp_mobile_search">
            <label class="wl_sp_mobile_search_box">
                <i class="fa fa-search" aria-hidden="true"></i>
                <input
                    type="search"
                    class="wl_sp_mobile_search_input"
                    placeholder="${_t("Search apps…")}"
                    autocomplete="off"
                    enterkeyhint="search"
                />
            </label>
        </div>
        <main class="wl_sp_mobile_apps_list">
            <div class="wl_sp_mobile_apps_grid wl_sp_rail_apps"></div>
        </main>
        <div class="wl_sp_mobile_bottom">
            <div class="wl_sp_mobile_profile_label">${_t("Preferences")}</div>
            <button type="button" class="wl_sp_mobile_profile_item" data-wl-action="workspace-modal" title="${_t("Workspace")}">
                <span class="wl_sp_mobile_profile_icon" aria-hidden="true"><i class="fa fa-th"></i></span>
                <span class="wl_sp_mobile_profile_text">${_t("All Apps")}</span>
            </button>
            <a class="wl_sp_mobile_profile_item" data-wl-action="open-settings" href="${withCurrentDebugParam("/odoo/settings")}" title="${_t("Settings")}">
                <span class="wl_sp_mobile_profile_icon" aria-hidden="true"><i class="fa fa-cog"></i></span>
                <span class="wl_sp_mobile_profile_text">${_t("Settings")}</span>
            </a>
            <button
                type="button"
                class="wl_sp_mobile_profile_item wl_sp_theme_toggle"
                data-wl-action="theme-toggle"
                title="${themeToggleLabel}"
                aria-label="${themeToggleLabel}"
            >
                <span class="wl_sp_mobile_profile_icon" aria-hidden="true">${getThemeToggleIconMarkup(themeMode)}</span>
                <span class="wl_sp_mobile_profile_text">${themeToggleLabel}</span>
            </button>
        </div>
    `;
}

function ensureMobileSidebarMarkup(shell) {
    if (!shell) {
        return;
    }
    let sidebar = shell.querySelector("#wl_sp_mobile_sidebar");
    if (!sidebar) {
        sidebar = document.createElement("aside");
        sidebar.id = "wl_sp_mobile_sidebar";
        sidebar.className = "wl_sp_mobile_sidebar_panel";
        sidebar.setAttribute("aria-label", _t("Menu"));
        sidebar.setAttribute("aria-hidden", "true");
        sidebar.setAttribute("inert", "");
        const backdrop = shell.querySelector(".wl_sp_mobile_sidebar_backdrop");
        if (backdrop?.nextSibling) {
            shell.insertBefore(sidebar, backdrop.nextSibling);
        } else {
            shell.appendChild(sidebar);
        }
    }
    // Migrate Kraken-style rail groups → Pine-style menu (search + app cards + one theme toggle).
    if (!sidebar.querySelector(".wl_sp_mobile_apps_list") || sidebar.querySelector(".wl_sp_rail_group_top")) {
        sidebar.innerHTML = buildMobileSidebarMarkup();
        syncThemeToggleButtons(getThemeMode());
    }
}

function renderGlobalShell() {
    const body = document.body;
    if (!body) {
        return;
    }
    const webClient = document.querySelector(".o_web_client");
    const actionManager = webClient?.querySelector(":scope > .o_action_manager");
    if (!webClient || !actionManager) {
        return;
    }

    const enableGlobalMode = () => {
        body.classList.add("wl_sp_global_mode");
        webClient.classList.add("wl_sp_global_mode");
    };

    const existing = document.getElementById("wl_sp_global_shell");
    if (existing) {
        if (existing.parentElement !== webClient || existing.nextElementSibling !== actionManager) {
            webClient.insertBefore(existing, actionManager);
        }
        enableGlobalMode();
        ensureWorkspaceModal();
        ensureGlobalHeroBand();
        ensureHeroArtMounts(webClient, existing);
        ensureMobileSidebarMarkup(existing);
        renderAllTopbars();
        syncPendingActionSkeleton();
        syncHeroSubnav();
        return;
    }

    const shell = document.createElement("section");
    shell.id = "wl_sp_global_shell";
    shell.className = "wl_sp_global_shell";
    shell.innerHTML = `
        <div class="wl_sp_topbar_mount" data-wl-topbar-context="global"></div>
        <div class="wl_sp_mobile_sidebar_backdrop" data-wl-action="mobile-sidebar-close"></div>
        <aside
            id="wl_sp_mobile_sidebar"
            class="wl_sp_mobile_sidebar_panel"
            aria-label="${_t("Menu")}"
            aria-hidden="true"
            inert
        >
            ${buildMobileSidebarMarkup()}
        </aside>
        <section class="wl_erp_app_hero" id="wl_erp_app_hero">
            <div class="wl_erp_app_hero_inner">
                <nav class="wl_erp_submenus" id="wl_erp_submenus_bar" aria-label="${_t("Submenus")}"></nav>
            </div>
        </section>
    `;
    webClient.insertBefore(shell, actionManager);
    enableGlobalMode();
    ensureHeroArtMounts(webClient, shell);
    ensureWorkspaceModal();
    renderAllTopbars();
    syncPendingActionSkeleton();
}

function normalizeRootMenu(menu) {
    if (!menu?.id || !menu?.name) {
        return null;
    }
    return {
        id: menu.id,
        name: menu.name,
        actionID: menu.actionID,
        actionModel: menu.actionModel,
        actionPath: menu.actionPath,
        appID: menu.appID,
        xmlid: menu.xmlid,
        children: Array.isArray(menu.children) ? [...menu.children] : [],
        childrenTree: menu.childrenTree,
        webIcon: menu.webIcon,
        webIconData: menu.webIconData,
        webIconDataMimetype: menu.webIconDataMimetype,
    };
}

function normalizeRootMenus(menus) {
    const seenMenuIds = new Set();
    let seenHomeMenu = false;
    return menus
        .map(normalizeRootMenu)
        .filter(Boolean)
        .filter((menu) => {
            const menuKey = String(menu.id);
            if (seenMenuIds.has(menuKey)) {
                return false;
            }
            seenMenuIds.add(menuKey);

            if (isWillowDashboardMenu(menu) || isDashboardMenuLabel(menu.name)) {
                if (seenHomeMenu) {
                    return false;
                }
                seenHomeMenu = true;
            }
            return true;
        });
}

function getCachedRootMenu(menuId) {
    const normalizedMenuId = String(menuId || "");
    if (!normalizedMenuId || !cachedRootMenus?.length) {
        return null;
    }
    return cachedRootMenus.find((menu) => String(menu.id) === normalizedMenuId) || null;
}

function isAllowedRootMenuId(menuId) {
    return !cachedRootMenus?.length || !!getCachedRootMenu(menuId);
}

async function loadRootMenus() {
    if (cachedRootMenus) {
        return cachedRootMenus;
    }

    const menuService = getWebclientMenuService();
    if (menuService?.getApps) {
        const apps = normalizeRootMenus(menuService.getApps());
        if (apps.length) {
            cachedRootMenus = apps;
            setFavoriteMenuIds(getFavoriteMenuIds());
            return cachedRootMenus;
        }
    }

    let payload = null;
    if (window.odoo?.loadMenusPromise) {
        payload = await window.odoo.loadMenusPromise;
    } else {
        const response = await fetch("/web/webclient/load_menus", {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
        });
        payload = await response.json();
    }
    const root = payload?.root || {};
    const rootChildren = Array.isArray(root.children) ? root.children : [];
    cachedRootMenus = normalizeRootMenus(rootChildren.map((menuId) => payload?.[menuId]));
    setFavoriteMenuIds(getFavoriteMenuIds());
    return cachedRootMenus;
}

function menuInitial(name) {
    if (!name) {
        return "A";
    }
    const normalizedName = name.replace(/[\uE000-\uF8FF]/g, "").trim();
    const token = (normalizedName.split(/\s+/)[0] || "A").slice(0, 1);
    return token.toUpperCase();
}

function canonicalMenuKey(name) {
    return normalizeMenuLabel(name)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

// Canonical keys from English + shipped PO menu titles (ascii-normalized).
// Non-latin langs (ar/zh/hi) rely on xmlid-first matching via isDashboardMenu().
const DASHBOARD_MENU_CANONICAL_KEYS = new Set([
    "home",
    "accueil",
    "dashboard",
    "dashboards",
    "willowdashboard",
    "tableaudebord",
    "tableauxdebord",
    "tablero",
    "tableros",
    "painel",
    "paineis",
]);

const SPREADSHEET_DASHBOARD_MENU_CANONICAL_KEYS = new Set([
    "dashboards",
    "tableauxdebord",
    "tableros",
    "paineis",
]);

function isDashboardMenuLabel(name) {
    const canonical = canonicalMenuKey(name);
    // Include translated menu titles (FR/ES/PT). Prefer isDashboardMenu(menu)
    // with xmlid when a full menu object is available.
    return DASHBOARD_MENU_CANONICAL_KEYS.has(canonical);
}

function isDashboardMenu(menu) {
    if (!menu) {
        return false;
    }
    if (isWillowDashboardMenu(menu)) {
        return true;
    }
    if (isSpreadsheetDashboardMenu(menu)) {
        return true;
    }
    if (menu.actionPath && isDashboardActionToken(menu.actionPath)) {
        return true;
    }
    return isDashboardMenuLabel(menu.name);
}

function isReservedRailMenuLabel(name) {
    const canonical = canonicalMenuKey(name);
    return (
        canonical === "apps" ||
        canonical === "settings" ||
        canonical === "parametres" ||
        canonical === "ajustes" ||
        canonical === "configuracion" ||
        canonical === "einstellungen"
    );
}

function isSettingsMenu(menu) {
    const canonical = canonicalMenuKey(menu?.name);
    return canonical === "settings" || canonical === "parametres" || menu?.xmlid === "base.menu_administration";
}

function isReservedRailMenu(menu) {
    return isReservedRailMenuLabel(menu?.name) || isSettingsMenu(menu);
}

function getFavoriteMenuIds() {
    const favoriteIds = Array.isArray(session?.willow_favorite_menu_ids)
        ? session.willow_favorite_menu_ids.map((menuId) => String(menuId))
        : [];
    if (!cachedRootMenus?.length) {
        return favoriteIds;
    }
    return favoriteIds.filter((menuId) => isAllowedRootMenuId(menuId));
}

function setFavoriteMenuIds(menuIds) {
    const normalizedIds = [...new Set(menuIds.map((menuId) => String(menuId)).filter(Boolean))]
        .filter((menuId) => isAllowedRootMenuId(menuId));
    session.willow_favorite_menu_ids = normalizedIds.map((menuId) => Number(menuId)).filter(Number.isFinite);
    return normalizedIds;
}

function isFavoriteMenu(menuId) {
    return getFavoriteMenuIds().includes(String(menuId));
}

function canFavoriteWorkspaceMenu(menu) {
    return menu?.id && !isReservedRailMenu(menu) && !isDashboardMenuLabel(menu?.name);
}

function syncFavoriteButtonState(button, menuId) {
    if (!button) {
        return;
    }
    const isFavorite = isFavoriteMenu(menuId);
    button.classList.toggle("is-active", isFavorite);
    button.setAttribute("aria-pressed", isFavorite ? "true" : "false");
    button.title = isFavorite ? _t("Remove from favorites") : _t("Add to favorites");
    button.setAttribute(
        "aria-label",
        isFavorite ? _t("Remove from favorites") : _t("Add to favorites")
    );
    button.innerHTML = `<i class="fa ${isFavorite ? "fa-star" : "fa-star-o"}" aria-hidden="true"></i>`;
}

function createWorkspaceFavoriteButton(menu) {
    const favoriteButton = document.createElement("button");
    favoriteButton.type = "button";
    favoriteButton.className = "wl_sp_apps_tile_favorite";
    favoriteButton.dataset.wlAction = "toggle-favorite-menu";
    favoriteButton.dataset.wlMenuId = String(menu.id);
    if (!canFavoriteWorkspaceMenu(menu)) {
        favoriteButton.hidden = true;
        return favoriteButton;
    }
    syncFavoriteButtonState(favoriteButton, menu.id);
    return favoriteButton;
}

function getFavoriteAppMenus(menus) {
    const visibleMenus = menus.filter((menu) => !isReservedRailMenu(menu));
    const favoriteMenuIds = getFavoriteMenuIds();
    return favoriteMenuIds
        .map((favoriteId) => visibleMenus.find((menu) => String(menu.id) === favoriteId))
        .filter(Boolean)
        .filter((menu) => !isDashboardMenuLabel(menu.name));
}

function findDashboardMenu(menus = []) {
    const willowMenu = menus.find((menu) => isWillowDashboardMenu(menu));
    if (willowMenu) {
        return willowMenu;
    }
    return (
        menus.find(
            (menu) => isDashboardMenuLabel(menu?.name) && !isSpreadsheetDashboardMenu(menu)
        ) || null
    );
}

function orderAppsMenuMenus(menus = []) {
    const homeMenu = findDashboardMenu(menus);
    const otherMenus = menus.filter((menu) => !isDashboardMenuLabel(menu?.name));
    return homeMenu ? [homeMenu, ...otherMenus] : otherMenus;
}

function getTopbarMenus(menus) {
    const visibleMenus = menus.filter((menu) => !isReservedRailMenu(menu));
    const homeMenu = findDashboardMenu(visibleMenus);
    const favoriteMenus = getFavoriteAppMenus(menus);
    if (favoriteMenus.length) {
        return homeMenu ? [homeMenu, ...favoriteMenus] : favoriteMenus;
    }
    return homeMenu ? [homeMenu] : [];
}

async function toggleFavoriteMenu(menuId) {
    const normalizedMenuId = String(menuId || "");
    if (!normalizedMenuId || !isAllowedRootMenuId(normalizedMenuId)) {
        return getFavoriteMenuIds();
    }
    const menuIds = await callKw("res.users", "willow_toggle_favorite_menu", [Number(normalizedMenuId)]);
    return setFavoriteMenuIds(menuIds || []);
}

function normalizeMenuLabel(name) {
    const cleaned = (name || "").replace(/[\uE000-\uF8FF]/g, "").trim();
    if (cleaned === "Willow Dashboard" || cleaned === "Home") {
        return _t("Dashboard");
    }
    return cleaned;
}

function isDashboardWorkspaceMenu(menu) {
    return isWillowDashboardMenu(menu) || (isDashboardMenuLabel(menu?.name) && !isSpreadsheetDashboardMenu(menu));
}

function fillWorkspaceTileIcon(icon, menu, label) {
    const iconSrc = menuIconSrc(menu);
    icon.replaceChildren();
    if (isDashboardWorkspaceMenu(menu)) {
        const image = document.createElement("img");
        image.src = WILLOW_DASHBOARD_ICON_SRC;
        image.alt = "";
        icon.appendChild(image);
        return;
    }
    if (iconSrc) {
        const image = document.createElement("img");
        image.src = iconSrc;
        image.alt = "";
        icon.appendChild(image);
        return;
    }
    icon.textContent = menuInitial(label);
}

function menuIconSrc(menu) {
    if (isDashboardWorkspaceMenu(menu)) {
        return null;
    }
    if (menu?.webIconData) {
        const value = String(menu.webIconData).trim();
        if (value === "/web/static/img/default_icon_app.png") {
            return null;
        }
        if (value.startsWith("data:image")) {
            return value;
        }
        if (value.startsWith("/") || value.startsWith("http://") || value.startsWith("https://")) {
            return value;
        }
        return `data:image/png;base64,${value}`;
    }
    if (typeof menu?.webIcon === "string" && menu.webIcon.includes(",")) {
        return `/${menu.webIcon.replace(",", "/")}`;
    }
    return null;
}

function openWillowDashboard() {
    const menuService = getWebclientMenuService();
    const apps =
        cachedRootMenus ||
        (typeof menuService?.getApps === "function" ? menuService.getApps() : []) ||
        [];
    const homeMenu = findDashboardMenu(apps);
    if (homeMenu?.id) {
        navigateToMenu(homeMenu.id, homeMenu.actionID);
        return;
    }
    const actionService = getWebclientActionService();
    if (actionService?.doAction) {
        actionService.doAction(WILLOW_DASHBOARD_ACTION_XMLID);
        return;
    }
    window.location.assign(
        `${withCurrentDebugParam("/odoo/web")}#action=${WILLOW_DASHBOARD_ACTION_XMLID}`
    );
}

function navigateToMenu(menuId, actionId) {
    const normalizedMenuId = Number.parseInt(menuId, 10);
    if (!Number.isFinite(normalizedMenuId)) {
        return;
    }
    if (menuNavigationPromise && String(menuNavigationTargetId) === String(normalizedMenuId)) {
        return;
    }
    const menuService = getWebclientMenuService();
    const actionService = getWebclientActionService();
    const liveMenu = menuService?.getMenu?.(normalizedMenuId) || null;
    const resolvedMenu = liveMenu || getCachedRootMenu(normalizedMenuId);
    const resolvedActionId = actionId || resolvedMenu?.actionID || resolveMenuFirstActionId(menuService, resolvedMenu);
    if (!resolvedMenu?.id && !resolvedActionId) {
        if (isRootAppMenu(menuService, normalizedMenuId)) {
            pendingTopbarAppId = null;
        }
        return;
    }

    const menuToSelect = liveMenu || (resolvedActionId
        ? {
              ...(resolvedMenu || { id: normalizedMenuId, appID: normalizedMenuId }),
              id: resolvedMenu?.id || normalizedMenuId,
              actionID: resolvedActionId,
          }
        : normalizedMenuId);

    const executeFallbackAction = () => {
        if (actionService?.doAction && resolvedActionId) {
            void actionService.doAction(resolvedActionId);
        } else {
            window.location.assign(buildMenuUrl(normalizedMenuId, resolvedActionId));
        }
    };

    if (menuService?.selectMenu) {
        menuNavigationTargetId = normalizedMenuId;
        const navigationPromise = Promise.resolve()
            .then(() => menuService.selectMenu(menuToSelect))
            .catch((error) => {
                logThemeError("menu navigation via selectMenu failed", error);
                executeFallbackAction();
                if (isRootAppMenu(menuService, normalizedMenuId)) {
                    pendingTopbarAppId = null;
                }
            })
            .finally(() => {
                if (String(menuNavigationTargetId) === String(normalizedMenuId)) {
                    menuNavigationTargetId = null;
                    menuNavigationPromise = null;
                }
                syncPendingTopbarApp(menuService);
                if (isRootAppMenu(menuService, normalizedMenuId)) {
                    heroSubnavSignature = "";
                    window.requestAnimationFrame(() => {
                        renderAllTabs();
                        syncHeroSubnav();
                    });
                }
            });
        menuNavigationPromise = navigationPromise;
        return;
    }

    menuNavigationTargetId = null;
    menuNavigationPromise = null;
    executeFallbackAction();
}

function preloadRootMenus() {
    if (cachedRootMenus) {
        return Promise.resolve(cachedRootMenus);
    }
    if (!rootMenusPreloadPromise) {
        rootMenusPreloadPromise = loadRootMenus()
            .then((menus) => {
                renderAllTabs();
                mountScrollers();
                return menus;
            })
            .catch((error) => {
                logThemeError("failed to preload root menus", error);
                return [];
            })
            .finally(() => {
                rootMenusPreloadPromise = null;
            });
    }
    return rootMenusPreloadPromise;
}

function renderAllTabs() {
    const viewports = document.querySelectorAll(".wl_sp_tabs_viewport");
    if (!viewports.length) {
        scheduleTabsRender();
        return;
    }
    const menuService = getWebclientMenuService();
    const renderedAnyTabs = Array.from(viewports).some((viewport) =>
        renderTabsInViewport(viewport, menuService)
    );
    if (renderedAnyTabs) {
        tabsRenderRetryCount = 0;
    } else {
        scheduleTabsRender();
    }
    if (!menuService || !normalizeRootMenus(menuService.getApps?.() || []).length) {
        void preloadRootMenus();
    }
}

function scheduleTabsRender() {
    if (tabsRenderRetryTimer || tabsRenderRetryCount >= 8) {
        return;
    }
    tabsRenderRetryCount += 1;
    tabsRenderRetryTimer = window.setTimeout(() => {
        tabsRenderRetryTimer = null;
        renderAllTabs();
        mountScrollers();
    }, Math.min(900, 80 * tabsRenderRetryCount));
}

function renderWorkspaceGrid(menus) {
    const grid = document.getElementById("wl_sp_workspace_grid");
    if (!grid) {
        return;
    }
    const orderedMenus = orderAppsMenuMenus(menus);
    const menuService = getWebclientMenuService();
    const signature = orderedMenus
        .map((menu) => {
            const actionId = menu.actionID || resolveMenuFirstActionId(menuService, menu) || "";
            return [
                menu.id,
                actionId,
                normalizeMenuLabel(menu.name),
                isFavoriteMenu(menu.id) ? "favorite" : "standard",
            ].join(":");
        })
        .join("|");
    if (grid.dataset.wlAppsSignature === signature && grid.childElementCount) {
        filterWorkspaceGrid(document.getElementById("wl_sp_workspace_search")?.value || "");
        return;
    }

    // Keep stable nodes under the pointer. Replacing a hovered link between
    // pointerdown and pointerup suppresses its click and visibly resets :hover.
    grid.innerHTML = "";
    grid.dataset.wlAppsSignature = signature;
    const emptyState = document.getElementById("wl_sp_workspace_empty");
    if (emptyState) {
        emptyState.hidden = true;
    }

    let renderedCount = 0;
    for (const menu of orderedMenus) {
        const label = normalizeMenuLabel(menu.name);
        const card = document.createElement("article");
        card.className = "wl_sp_apps_tile";
        card.dataset.wlAppLabel = label.toLowerCase();

        const favoriteButton = createWorkspaceFavoriteButton(menu);
        const tileActionId = menu.actionID || resolveMenuFirstActionId(menuService, menu);
        // Real href enables Ctrl/Cmd/middle-click → new tab; click handler does SPA nav.
        const openButton = document.createElement("a");
        openButton.className = "wl_sp_apps_tile_body";
        openButton.href = buildMenuUrl(menu.id, tileActionId);
        openButton.title = label;
        openButton.dataset.wlAction = "open-menu";
        openButton.dataset.wlMenuId = String(menu.id);
        openButton.dataset.wlActionId = tileActionId ? String(tileActionId) : "";

        const icon = document.createElement("span");
        icon.className = "wl_sp_apps_tile_icon";
        fillWorkspaceTileIcon(icon, menu, label);

        const labelElement = document.createElement("span");
        labelElement.className = "wl_sp_apps_tile_label";
        labelElement.textContent = label;

        openButton.appendChild(icon);
        openButton.appendChild(labelElement);
        card.appendChild(favoriteButton);
        card.appendChild(openButton);
        grid.appendChild(card);
        renderedCount += 1;
    }

    updateWorkspaceModalMeta(renderedCount, renderedCount);

    const searchInput = document.getElementById("wl_sp_workspace_search");
    filterWorkspaceGrid(searchInput?.value || "");
}

function openWorkspaceModal() {
    const modal = ensureWorkspaceModal();
    if (!modal) {
        return;
    }
    closeSubmenuPopover();
    closeSystrayDropdown();
    setupWorkspaceModalSearch();
    updateWorkspaceModalMeta(0, 0);
    void loadRootMenus()
        .then((menus) => {
            renderWorkspaceGrid(menus);
        })
        .catch((error) => {
            logThemeError("failed to load apps for workspace modal", error);
        });
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("wl_sp_workspace_open");
    window.requestAnimationFrame(() => {
        document.getElementById("wl_sp_workspace_search")?.focus();
    });
}

function closeWorkspaceModal() {
    const modal = document.getElementById("wl_sp_workspace_modal");
    if (!modal) {
        return;
    }
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("wl_sp_workspace_open");
    const searchInput = document.getElementById("wl_sp_workspace_search");
    if (searchInput) {
        searchInput.value = "";
    }
}

function getSidebarMenus(menus) {
    // Pine-style drawer: all installable root apps (not favorites-only rail).
    return orderAppsMenuMenus(menus.filter((menu) => !isReservedRailMenu(menu)));
}

function getSettingsMenu(menus = cachedRootMenus || []) {
    return menus.find((menu) => isSettingsMenu(menu)) || null;
}

function canOpenSettings(menus = cachedRootMenus || []) {
    return !!getSettingsMenu(menus) || !!user?.isAdmin || !!user?.isSystem;
}

function syncSettingsActionVisibility(menus = cachedRootMenus || []) {
    const visible = canOpenSettings(menus);
    document.querySelectorAll('[data-wl-action="open-settings"]').forEach((element) => {
        element.hidden = !visible;
    });
}

function openSettingsMenu() {
    const settingsMenu = getSettingsMenu();
    if (settingsMenu) {
        navigateToMenu(settingsMenu.id, settingsMenu.actionID);
        return;
    }
    if (canOpenSettings()) {
        window.location.assign(withCurrentDebugParam("/odoo/settings"));
    }
}

async function buildSidebarApps({ force = false } = {}) {
    const containers = Array.from(document.querySelectorAll(".wl_sp_rail_apps"));
    if (!containers.length) {
        if (cachedRootMenus) {
            syncSettingsActionVisibility(cachedRootMenus);
        }
        return;
    }

    const pendingContainers = force ? containers : containers.filter((container) => !container.dataset.wlReady);
    if (!pendingContainers.length) {
        if (cachedRootMenus) {
            syncSettingsActionVisibility(cachedRootMenus);
            renderWorkspaceGrid(cachedRootMenus);
        }
        return;
    }

    try {
        const menus = await loadRootMenus();
        syncSettingsActionVisibility(menus);
        const sidebarMenus = getSidebarMenus(menus);
        pendingContainers.forEach((container) => {
            container.innerHTML = "";
        });

        for (const menu of sidebarMenus) {
            // Real href enables Ctrl/Cmd/middle-click → new tab; click handler does SPA nav.
            const button = document.createElement("a");
            button.className = "wl_sp_mobile_app_card";
            const label = normalizeMenuLabel(menu.name);
            const menuService = getWebclientMenuService();
            const tileActionId = menu.actionID || resolveMenuFirstActionId(menuService, menu);
            button.href = buildMenuUrl(menu.id, tileActionId);
            button.title = label;
            button.dataset.wlAction = "open-menu";
            button.dataset.wlMenuId = String(menu.id);
            button.dataset.wlActionId = tileActionId ? String(tileActionId) : "";
            button.dataset.wlAppLabel = label.toLowerCase();
            const iconSrc = menuIconSrc(menu);
            let iconMarkup = `<span class="wl_sp_app_initial">${menuInitial(label)}</span>`;
            if (isDashboardWorkspaceMenu(menu)) {
                iconMarkup = `<img src="${WILLOW_DASHBOARD_ICON_SRC}" alt=""/>`;
            } else if (iconSrc) {
                iconMarkup = `<img src="${iconSrc}" alt=""/>`;
            }
            button.innerHTML = `
                <span class="wl_sp_mobile_app_icon">${iconMarkup}</span>
                <span class="wl_sp_mobile_app_title">${escapeHtml(label)}</span>
            `;
            pendingContainers.forEach((container) => {
                container.appendChild(button.cloneNode(true));
            });
        }

        bindMobileSidebarSearch();
        renderWorkspaceGrid(menus);
        pendingContainers.forEach((container) => {
            container.dataset.wlReady = "1";
        });
    } catch {
        pendingContainers.forEach((container) => {
            container.dataset.wlReady = "";
        });
    }
}

function bindMobileSidebarSearch() {
    document.querySelectorAll(".wl_sp_mobile_search_input").forEach((input) => {
        if (input.dataset.wlBound === "1") {
            return;
        }
        input.dataset.wlBound = "1";
        input.addEventListener("input", () => {
            const query = (input.value || "").trim().toLowerCase();
            const panel = input.closest(".wl_sp_mobile_sidebar_panel");
            panel?.querySelectorAll(".wl_sp_mobile_app_card").forEach((card) => {
                const label = card.dataset.wlAppLabel || "";
                card.hidden = Boolean(query) && !label.includes(query);
            });
        });
    });
}

function openBackendList({ name, model, domain = [], views = [[false, "list"], [false, "form"]] }) {
    const actionService = getWebclientActionService();
    if (!actionService?.doAction) {
        return;
    }
    actionService.doAction({
        type: "ir.actions.act_window",
        name,
        res_model: model,
        domain,
        views,
        target: "current",
    });
}

function openBackendRecord({ name, model, resId }) {
    const actionService = getWebclientActionService();
    if (!actionService?.doAction || !model || !Number.isFinite(resId)) {
        return;
    }
    actionService.doAction({
        type: "ir.actions.act_window",
        name: name || _t("Record"),
        res_model: model,
        res_id: resId,
        views: [[false, "form"]],
        target: "current",
    });
}

function openAppsPage() {
    window.location.assign(withCurrentDebugParam("/odoo/apps"));
}

function toggleDeveloperMode() {
    const url = new URL(window.location.href);
    if (isDebugMode()) {
        url.searchParams.delete("debug");
    } else {
        url.searchParams.set("debug", "1");
    }
    window.location.assign(url.toString());
}

function setupControlButtons() {
    const root = document.body;
    if (!root || root.dataset.wlControlsReady) {
        return;
    }
    root.dataset.wlControlsReady = "1";

    applyTheme(getThemeMode());

    // Icon children sometimes get pointerdown/up without a synthesized click; activate
    // on pointerup and suppress the follow-up click so we do not double-toggle.
    let wlThemeToggleArmed = null;
    let wlThemeToggleHandledByPointer = false;
    root.addEventListener("pointerdown", (ev) => {
        const toggle = ev.target.closest?.(".wl_sp_theme_toggle");
        if (!toggle || ev.button !== 0) {
            if (ev.button === 0) {
                wlThemeToggleArmed = null;
            }
            return;
        }
        wlThemeToggleArmed = toggle;
    }, true);
    root.addEventListener("pointerup", (ev) => {
        const toggle = ev.target.closest?.(".wl_sp_theme_toggle");
        const armed = wlThemeToggleArmed;
        if (ev.button === 0 && armed && toggle === armed) {
            wlThemeToggleHandledByPointer = true;
            wlThemeToggleArmed = null;
            void setThemeMode(getThemeMode() === "dark" ? "light" : "dark");
            return;
        }
        wlThemeToggleArmed = null;
    }, true);
    root.addEventListener("pointercancel", () => {
        wlThemeToggleArmed = null;
    }, true);

    root.addEventListener("click", (ev) => {
        const button = ev.target.closest("button, [data-wl-action], [data-wl-scroll]");
        if (!button) {
            return;
        }

        try {
            const scrollTarget = button.dataset.wlScroll;
            if (scrollTarget) {
                ev.preventDefault();
                scrollToTarget(scrollTarget);
            }

            if (button.classList.contains("wl_sp_rail_btn") && button.closest(".wl_sp_rail_group_main")) {
                setActiveButton(button, ".wl_sp_rail_group_main");
            }

            const action = button.dataset.wlAction;
            if (action === "theme-light") {
                ev.preventDefault();
                void setThemeMode("light");
            }

            if (action === "theme-dark") {
                ev.preventDefault();
                void setThemeMode("dark");
            }

            if (action === "theme-toggle") {
                ev.preventDefault();
                if (wlThemeToggleHandledByPointer) {
                    wlThemeToggleHandledByPointer = false;
                    return;
                }
                void setThemeMode(getThemeMode() === "dark" ? "light" : "dark");
            }

            if (action === "workspace-modal") {
                ev.preventDefault();
                ev.stopPropagation();
                closeMobileSidebar();
                openWorkspaceModal();
            }

            if (action === "workspace-close") {
                ev.preventDefault();
                closeWorkspaceModal();
            }

            if (action === "mobile-sidebar-open") {
                ev.preventDefault();
                openMobileSidebar();
            }

            if (action === "mobile-sidebar-close") {
                ev.preventDefault();
                closeMobileSidebar();
            }

            if (action === "toggle-systray-dropdown") {
                ev.preventDefault();
                ev.stopPropagation();
                toggleSystrayDropdown(button);
            }

            if (action === "toggle-favorite-menu") {
                ev.preventDefault();
                ev.stopPropagation();
                const menuId = Number.parseInt(button.dataset.wlMenuId, 10);
                if (Number.isFinite(menuId)) {
                    toggleFavoriteMenu(menuId)
                        .then(() => {
                            document
                                .querySelectorAll(
                                    `.wl_sp_apps_tile_favorite[data-wl-menu-id="${menuId}"]`
                                )
                                .forEach((favoriteButton) => {
                                    syncFavoriteButtonState(favoriteButton, menuId);
                                });
                            if (cachedRootMenus) {
                                renderWorkspaceGrid(cachedRootMenus);
                            }
                            renderAllTabs();
                        })
                        .catch((error) => {
                            syncFavoriteButtonState(button, menuId);
                            logThemeError("favorite menu toggle failed", error);
                        });
                }
            }

            if (action === "open-menu") {
                const menuId = Number.parseInt(button.dataset.wlMenuId, 10);
                const actionId = Number.parseInt(button.dataset.wlActionId, 10);

                if (isModifiedNavigationClick(ev)) {
                    closeSubmenuPopover();
                    closeMobileSidebar();
                    closeWorkspaceModal();
                    if (button.tagName === "A" && button.hasAttribute("href")) {
                        return;
                    }
                    if (Number.isFinite(menuId)) {
                        const url = buildMenuUrl(menuId, Number.isFinite(actionId) ? actionId : null);
                        window.open(url, "_blank");
                        ev.preventDefault();
                        ev.stopPropagation();
                        return;
                    }
                }

                // Workspace, mobile app cards, and top bar links carry complete Odoo URLs. Keep their native
                // navigation path for modified clicks while doing SPA navigation for normal left clicks.
                if (button.tagName === "A" && button.hasAttribute("href")) {
                    closeSubmenuPopover();
                    closeMobileSidebar();
                    closeWorkspaceModal();
                    return;
                }

                ev.preventDefault();
                ev.stopPropagation();

                if (Number.isFinite(menuId)) {
                    closeSubmenuPopover();
                    closeMobileSidebar();
                    closeWorkspaceModal();
                    if (button.classList.contains("wl_sp_submenu_btn")) {
                        const menuService = getWebclientMenuService();
                        const menu =
                            menuService?.getMenu?.(menuId) ||
                            getCachedRootMenu(menuId) || {
                                id: menuId,
                                actionID: Number.isFinite(actionId) ? actionId : null,
                            };
                        requestTopbarAppSwitch(menuService, menu);
                    } else {
                        navigateToMenu(menuId, Number.isFinite(actionId) ? actionId : null);
                    }
                }
            }

            if (action === "open-submenu-popover") {
                ev.preventDefault();
                const menuService = getWebclientMenuService();
                const currentMenu = resolveCurrentMenu(menuService);
                openSubmenuPopover(button, menuService, currentMenu?.id || null);
            }

            if (action === "go-dashboard" || action === "go-home") {
                ev.preventDefault();
                closeMobileSidebar();
                closeSubmenuPopover();
                window.location.assign(buildLogoutUrl());
            }

            if (action === "open-dashboard" || action === "open-home") {
                if (isModifiedNavigationClick(ev)) {
                    closeMobileSidebar();
                    closeSubmenuPopover();
                    const url = `${withCurrentDebugParam("/odoo/web")}#action=${WILLOW_DASHBOARD_ACTION_XMLID}`;
                    window.open(url, "_blank");
                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                }
                ev.preventDefault();
                closeMobileSidebar();
                closeSubmenuPopover();
                openWillowDashboard();
            }

            if (action === "open-settings") {
                if (button.tagName === "A" && isModifiedNavigationClick(ev)) {
                    closeMobileSidebar();
                    closeSubmenuPopover();
                    return;
                }
                ev.preventDefault();
                closeMobileSidebar();
                closeSubmenuPopover();
                openSettingsMenu();
            }

            if (action === "open-apps") {
                if (button.tagName === "A" && isModifiedNavigationClick(ev)) {
                    closeMobileSidebar();
                    closeSubmenuPopover();
                    return;
                }
                ev.preventDefault();
                closeMobileSidebar();
                closeSubmenuPopover();
                openAppsPage();
            }

            if (action === "open-users") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({ name: _t("Users"), model: "res.users" });
            }

            if (action === "open-partners") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({ name: _t("Partners"), model: "res.partner" });
            }

            if (action === "open-activities") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({ name: _t("Activities"), model: "mail.activity" });
            }

            if (action === "open-attachments") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({ name: _t("Attachments"), model: "ir.attachment" });
            }

            if (action === "refresh-dashboard-overview" || action === "refresh-home-overview") {
                ev.preventDefault();
                closeSubmenuPopover();
                refreshDashboardOverview(true).catch((error) =>
                    logThemeError("manual dashboard overview refresh failed", error)
                );
            }

            if (action === "refresh-dashboard-data" || action === "refresh-home-data") {
                ev.preventDefault();
                closeSubmenuPopover();
                refreshDashboardFooterData(true).catch((error) =>
                    logThemeError("manual home data refresh failed", error)
                );
                window.dispatchEvent(new CustomEvent("willow-dashboard:refresh-data"));
            }

            if (action === "open-customers") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Customers"),
                    model: "res.partner",
                    domain: [["customer_rank", ">", 0]],
                });
            }

            if (action === "open-vendors") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Vendors"),
                    model: "res.partner",
                    domain: [["supplier_rank", ">", 0]],
                });
            }

            if (action === "open-dashboard-activity-row" || action === "open-home-activity-row") {
                ev.preventDefault();
                closeSubmenuPopover();
                const resId = Number.parseInt(button.dataset.wlResId, 10);
                const activityId = Number.parseInt(button.dataset.wlActivityId, 10);
                if (button.dataset.wlModel && Number.isFinite(resId)) {
                    openBackendRecord({
                        name: button.textContent?.trim() || _t("Activity Record"),
                        model: button.dataset.wlModel,
                        resId,
                    });
                } else if (Number.isFinite(activityId)) {
                    openBackendRecord({
                        name: _t("Activity"),
                        model: "mail.activity",
                        resId: activityId,
                    });
                }
            }

            if (action === "open-overdue-activities") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Overdue Activities"),
                    model: "mail.activity",
                    domain: [["date_deadline", "<", getLocalDateString()]],
                });
            }

            if (action === "open-today-activities") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Activities Due Today"),
                    model: "mail.activity",
                    domain: [["date_deadline", "=", getLocalDateString()]],
                });
            }

            if (action === "open-sales-orders") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Sales Orders"),
                    model: "sale.order",
                    domain: [["state", "in", ["sale", "done"]]],
                });
            }

            if (action === "open-invoices") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Customer Invoices"),
                    model: "account.move",
                    domain: [["move_type", "in", ["out_invoice", "out_refund"]]],
                });
            }

            if (action === "open-crm-leads") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("CRM Leads"),
                    model: "crm.lead",
                    domain: [["type", "=", "lead"], ["active", "=", true]],
                });
            }

            if (action === "open-quotations") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Quotations"),
                    model: "sale.order",
                    domain: [["state", "in", ["draft", "sent"]]],
                });
            }

            if (action === "open-unpaid-invoices") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Unpaid Invoices"),
                    model: "account.move",
                    domain: [
                        ["move_type", "=", "out_invoice"],
                        ["state", "=", "posted"],
                        ["payment_state", "in", ["not_paid", "partial"]],
                    ],
                });
            }

            if (action === "open-helpdesk-tickets") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({
                    name: _t("Open Tickets"),
                    model: "helpdesk.ticket",
                    domain: [["stage_id.fold", "=", false]],
                });
            }

            if (action === "open-scheduled-actions") {
                ev.preventDefault();
                closeSubmenuPopover();
                openBackendList({ name: _t("Scheduled Actions"), model: "ir.cron" });
            }

            if (action === "toggle-debug") {
                ev.preventDefault();
                closeSubmenuPopover();
                toggleDeveloperMode();
            }

        } catch (error) {
            logThemeError("control button handler failed", error);
        }
    });

    root.addEventListener("click", (ev) => {
        if (!ev.target.closest?.(".wl_sp_systray_overflow")) {
            closeSystrayDropdown();
        }

        if (ev.target.closest(".wl_sp_workspace_backdrop")) {
            closeWorkspaceModal();
        }
    });

    root.addEventListener("keydown", (ev) => {
        const keyboardControl = ev.target.closest?.("[data-wl-action][role='button'], [data-wl-scroll][role='button']");
        if (keyboardControl && (ev.key === "Enter" || ev.key === " ")) {
            ev.preventDefault();
            keyboardControl.click();
            return;
        }

        if (ev.key === "Escape") {
            if (document.querySelector(".wl_sp_topbar_search.is-expanded")) {
                ev.preventDefault();
                collapseTopbarSearch();
                return;
            }
            closeWorkspaceModal();
            closeMobileSidebar();
            closeSubmenuPopover();
            closeSystrayDropdown();
        }
    });

    let scrollRafPending = false;
    const updateScrollState = (ev) => {
        if (scrollRafPending) return;
        scrollRafPending = true;
        window.requestAnimationFrame(() => {
            scrollRafPending = false;
            const shell = document.getElementById("wl_sp_global_shell");
            if (!shell) return;
            let maxScrollTop = 0;
            const winY = window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
            if (winY > maxScrollTop) maxScrollTop = winY;
            if (ev && ev.target && typeof ev.target.scrollTop === "number") {
                if (ev.target.scrollTop > maxScrollTop) maxScrollTop = ev.target.scrollTop;
            }
            const containers = document.querySelectorAll(".o_action_manager, .o_action, .o_content, .o_willow_dashboard_action, .wl_erp_theme_page");
            for (let i = 0; i < containers.length; i++) {
                if (containers[i].scrollTop > maxScrollTop) {
                    maxScrollTop = containers[i].scrollTop;
                }
            }

            const scrollProgress = Math.min(1, Math.max(0, maxScrollTop / 80));
            shell.style.setProperty("--wl-scroll-progress", scrollProgress.toFixed(3));
            shell.classList.toggle("is-scrolled", maxScrollTop > 5);
        });
    };

    window.addEventListener("scroll", updateScrollState, { passive: true, capture: true });
    updateScrollState();

    window.addEventListener("resize", () => {
        if (!window.matchMedia?.("(max-width: 991.98px)").matches) {
            closeMobileSidebar();
        }
        closeSystrayDropdown();
        mountSystemTray();
        syncCompanyBrandName();
        updateScrollState();
    });

    const companyBus = userBus;
    companyBus.addEventListener("ACTIVE_COMPANIES_CHANGED", () => {
        window.setTimeout(() => {
            syncCompanyBrandName();
            syncCompanyBrandLogo();
            syncDashboardFooterContext();
            refreshDashboardFooterData(true);
            mountSystemTray();
        }, 0);
    });
}

function getTabsScrollState(cluster) {
    if (!cluster) {
        return null;
    }
    if (!tabsScrollState.has(cluster)) {
        tabsScrollState.set(cluster, { userScrolled: false, programmaticScroll: false });
    }
    return tabsScrollState.get(cluster);
}

function scrollActiveTabIntoView(tabs, { behavior = "smooth", force = false } = {}) {
    if (!tabs) {
        return;
    }
    const cluster = tabs.closest(".wl_sp_tabs_cluster");
    const state = getTabsScrollState(cluster);
    if (!force && state?.userScrolled) {
        return;
    }
    const activeButton = tabs.querySelector(".wl_sp_submenu_btn.is-active");
    if (!activeButton) {
        return;
    }
    if (state) {
        state.programmaticScroll = true;
    }
    activeButton.scrollIntoView({ behavior, block: "nearest", inline: "center" });
    window.setTimeout(() => {
        if (state) {
            state.programmaticScroll = false;
        }
    }, behavior === "smooth" ? 450 : 0);
}

function setupTabsScroller(cluster) {
    if (!cluster || cluster.dataset.wlScrollerReady) {
        return;
    }

    const section = cluster.querySelector(".wl_sp_tabs_section");
    if (!section) {
        return;
    }
    const viewport = section.querySelector(".wl_sp_tabs_viewport");
    const tabs = section.querySelector(".wl_sp_tabs");
    const leftButton = cluster.querySelector(".wl_sp_tabs_scroll.is-left");
    const rightButton = cluster.querySelector(".wl_sp_tabs_scroll.is-right");
    if (!viewport || !tabs || !leftButton || !rightButton) {
        return;
    }

    cluster.dataset.wlScrollerReady = "1";
    const scrollState = getTabsScrollState(cluster);

    const updateState = () => {
        const maxOffset = Math.max(0, tabs.scrollWidth - viewport.clientWidth);
        const isOverflowing = maxOffset > 2;
        cluster.classList.toggle("is-overflowing", isOverflowing);

        leftButton.disabled = !isOverflowing || tabs.scrollLeft <= 1;
        rightButton.disabled = !isOverflowing || tabs.scrollLeft >= maxOffset - 1;
    };

    const markManualScroll = () => {
        scrollState.userScrolled = true;
    };

    const scrollTabs = (direction) => {
        markManualScroll();
        const step = Math.max(80, Math.round(viewport.clientWidth * 0.65));
        tabs.scrollBy({
            left: direction * step,
            behavior: "smooth",
        });
    };

    leftButton.addEventListener("click", () => scrollTabs(-1));
    rightButton.addEventListener("click", () => scrollTabs(1));
    tabs.addEventListener(
        "scroll",
        () => {
            if (scrollState.programmaticScroll) {
                updateState();
                return;
            }
            scrollState.userScrolled = true;
            updateState();
        },
        { passive: true }
    );
    tabs.addEventListener("wheel", markManualScroll, { passive: true });
    tabs.addEventListener("touchmove", markManualScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
        updateState();
        scrollActiveTabIntoView(tabs);
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(tabs);

    const mutationObserver = new MutationObserver(() => {
        updateState();
        scrollActiveTabIntoView(tabs);
    });
    mutationObserver.observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });

    updateState();
    scrollActiveTabIntoView(tabs, { behavior: "auto", force: true });
}

function mountScrollers() {
    document.querySelectorAll(".wl_sp_tabs_cluster").forEach(setupTabsScroller);
}

function bindNavigationRefresh(scheduleRunFeatures) {
    if (!boundRouteEvents) {
        routerBus.addEventListener("ROUTE_CHANGE", () => {
            closeSubmenuPopover();
            closeHeroDropdown();
            heroSubnavSignature = "";
            syncPendingTopbarApp(getWebclientMenuService());
            scheduleRunFeatures();
        });
        boundRouteEvents = true;
    }

    const envBus = getWebclientBus();
    if (envBus && envBus !== boundEnvBus) {
        if (boundEnvBus) {
            boundEnvBus.removeEventListener("MENUS:APP-CHANGED", boundMenuChangeHandler);
            boundEnvBus.removeEventListener("ACTION_MANAGER:UI-UPDATED", scheduleRunFeatures);
            boundEnvBus.removeEventListener("ACTION_MANAGER:UI-UPDATED", finishThemeReloadBootstrap);
        }
        boundEnvBus = envBus;
        boundMenuChangeHandler = () => {
            cachedRootMenus = null;
            document.querySelectorAll(".wl_sp_rail_apps").forEach((container) => {
                delete container.dataset.wlReady;
            });
            heroSubnavSignature = "";
            syncHeroSubnav();
            scheduleRunFeatures();
        };
        boundEnvBus.addEventListener("MENUS:APP-CHANGED", boundMenuChangeHandler);
        boundEnvBus.addEventListener("ACTION_MANAGER:UI-UPDATED", scheduleRunFeatures);
        boundEnvBus.addEventListener("ACTION_MANAGER:UI-UPDATED", finishThemeReloadBootstrap);
    }
}

function start() {
    if (!document.body) {
        return;
    }
    if (!syncPersistedThemePreference()) {
        return;
    }
    const runFeatures = () => {
        renderScheduled = false;
        runSafely("bind navigation refresh", () => bindNavigationRefresh(scheduleRunFeatures));
        runSafely("render global shell", renderGlobalShell);
        runSafely("setup modal viewport guard", setupModalViewportGuard);
        runSafely("normalize modal viewport state", normalizeModalViewportState);
        runSafely("render shared topbars", renderAllTopbars);
        runSafely("sync pending action skeleton", syncPendingActionSkeleton);
        runSafely("render tabs", renderAllTabs);
        runSafely("preload root menus", () => void preloadRootMenus());
        runSafely("sync company brand name", syncCompanyBrandName);
        runSafely("sync company brand logo", syncCompanyBrandLogo);
        runSafely("sync profile details", syncProfileDetails);
        runSafely("sync hero subnav", syncHeroSubnav);
        runSafely("refresh dashboard overview", refreshDashboardOverview);
        runSafely("sync dashboard footer context", syncDashboardFooterContext);
        runSafely("sync spreadsheet dashboard back button", syncSpreadsheetDashboardBackButton);
        runSafely("mount system tray", mountSystemTray);
        runSafely("mount user menu", mountUserMenu);
        runSafely("mount theme settings", () => void mountThemeSettingsButtons());
        runSafely("mount scrollers", mountScrollers);
        runSafely("setup topbar search", setupTopbarSearch);
        runSafely("setup control buttons", setupControlButtons);
        runSafely("refresh theme scope", refreshThemeScope);
        runSafely("mark dashboard ready", () => markDashboardReady(".wl_sp_pending_shell"));
        runSafely("refresh dashboard footer data", refreshDashboardFooterData);
        runSafely("build sidebar apps", buildSidebarApps);
        runSafely("finish theme reload bootstrap", finishThemeReloadBootstrap);
    };

    const scheduleRunFeatures = () => {
        if (renderScheduled) {
            return;
        }
        renderScheduled = true;
        window.requestAnimationFrame(() => {
            // Coalesce bursts (systray moves, control-panel patches, etc.).
            window.setTimeout(runFeatures, 0);
        });
    };

    const actionManager = document.querySelector(".o_web_client > .o_action_manager") || document.body;
    const rootObserver = new MutationObserver(scheduleRunFeatures);
    try {
        rootObserver.observe(actionManager, { childList: true, subtree: false });
    } catch (error) {
        logThemeError("failed to observe action manager", error);
    }
    runSafely("initial scrollers mount", mountScrollers);
    runSafely("initial feature run", runFeatures);

    window.addEventListener("willow-dashboard:refresh-footer", () => {
        refreshDashboardFooterData(true).catch((error) =>
            logThemeError("dashboard footer refresh event failed", error)
        );
    });
    window.addEventListener("willow-home:refresh-footer", () => {
        refreshDashboardFooterData(true).catch((error) =>
            logThemeError("legacy home footer refresh event failed", error)
        );
    });
}

bootThemeReloadLock();

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
    start();
}
