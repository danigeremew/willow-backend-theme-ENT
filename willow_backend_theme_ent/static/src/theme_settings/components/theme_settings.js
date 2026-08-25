/** @odoo-module **/

import { browser } from "@web/core/browser/browser";
import { cookie } from "@web/core/browser/cookie";
import { ConfirmationDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { Dialog } from "@web/core/dialog/dialog";
import { downloadFile } from "@web/core/network/download";
import { _t } from "@web/core/l10n/translation";
import { useService } from "@web/core/utils/hooks";
import { mountComponent } from "@web/env";
import { session } from "@web/session";
import { Component, onMounted, onWillDestroy, onWillStart, useState } from "@odoo/owl";

import {
    PROFILE_COLOR_FIELDS,
    SEMANTIC_COLOR_FIELDS,
    getTranslatedPresets,
    getTranslatedColorFields,
} from "../presets/presets";
import { createThemeSettingsApi } from "../services/theme_settings_service";

const THEME_RELOAD_KEY = "wl_sp_theme_reloading";
const ACCEPTED_IMAGES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ASSET_LIMITS = {
    hero_image: 5 * 1024 * 1024,
    hero_image_dark: 5 * 1024 * 1024,
    company_logo: 1024 * 1024,
    favicon: 1024 * 1024,
    login_background: 5 * 1024 * 1024,
    login_background_dark: 5 * 1024 * 1024,
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeHex(value) {
    let hex = String(value || "").trim().toUpperCase();
    if (!hex.startsWith("#")) {
        hex = `#${hex}`;
    }
    return /^#[0-9A-F]{6}$/.test(hex) ? hex : null;
}

/** Appearance currently painted on the page (cookie / body), not the draft mode radio. */
function currentUiMode() {
    const client = document.querySelector(".o_web_client");
    if (
        client?.classList.contains("wl_sp_theme_dark") ||
        client?.classList.contains("o_dark") ||
        document.body.classList.contains("o_dark")
    ) {
        return "dark";
    }
    if (cookie.get("color_scheme") === "dark") {
        return "dark";
    }
    return "light";
}

/** Profile to edit for a saved/draft mode preference. System follows the live UI, not OS alone. */
function editProfileForMode(mode, chromeMode) {
    if (mode === "light" || mode === "dark") {
        return mode;
    }
    return chromeMode === "dark" ? "dark" : "light";
}

/** Resolve color_scheme cookie value after Save (System still tracks the device). */
function resolveModeForSave(mode) {
    if (mode !== "system") {
        return mode;
    }
    return browser.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function dataUrlToBase64(dataUrl) {
    return dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
}

function readFile(file, dataUrl = false) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () => resolve(reader.result);
        if (dataUrl) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    });
}

export class ThemeSettingsDialog extends Component {
    static template = "willow_backend_theme_ent.ThemeSettingsDialog";
    static components = { Dialog };
    static props = { close: Function };

    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.dialog = useService("dialog");
        this.api = createThemeSettingsApi(this.orm);
        this.presets = getTranslatedPresets();
        this.profileColors = getTranslatedColorFields(PROFILE_COLOR_FIELDS);
        this.semanticColors = getTranslatedColorFields(SEMANTIC_COLOR_FIELDS);
        this.state = useState({
            loading: true,
            saving: false,
            tab: "appearance",
            data: null,
            original: null,
            // Dialog chrome follows the live page theme until Save+reload.
            chromeMode: "light",
            // Which light/dark color profile the form edits (can differ from chrome while drafting).
            effectiveMode: "light",
            errors: {},
            previews: {},
            pendingAssets: {},
        });
        this.env.dialogData.dismiss = () => this.nativeDismiss();
        onMounted(() => this.bindBackdropDismiss());
        onWillDestroy(() => {
            this.unbindBackdropDismiss();
        });
        onWillStart(async () => {
            const data = await this.api.load();
            this.setData(data);
        });
    }

    setData(data) {
        const chromeMode = currentUiMode();
        this.state.data = clone(data);
        this.state.original = clone(data);
        this.state.chromeMode = chromeMode;
        this.state.effectiveMode = editProfileForMode(data.mode, chromeMode);
        this.state.previews = { ...data.assets };
        this.state.pendingAssets = {};
        this.state.errors = {};
        this.state.loading = false;
    }

    get profile() {
        return this.state.data.profiles[this.state.effectiveMode];
    }

    get isDirty() {
        if (!this.state.data || !this.state.original) {
            return false;
        }
        return (
            JSON.stringify(this.state.data) !== JSON.stringify(this.state.original) ||
            Object.keys(this.state.pendingAssets).length > 0
        );
    }

    activateTab(tab) {
        this.state.tab = tab;
    }

    onTabKeydown(event, index) {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const tabs = ["appearance", "colors", "dashboard", "branding", "advanced"];
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
        if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = tabs.length - 1;
        this.activateTab(tabs[next]);
        event.currentTarget.parentElement.children[next]?.focus();
    }

    setMode(mode) {
        this.state.data.mode = mode;
        // Draft mode preference only — keep dialog chrome on the live page theme until Save.
        this.state.effectiveMode = editProfileForMode(mode, this.state.chromeMode);
    }

    async applyPreset(preset) {
        // Apply the same named preset to both profiles so light/dark stay paired.
        const [lightValues, darkValues] = await Promise.all([
            this.api.preset("light", preset),
            this.api.preset("dark", preset),
        ]);
        this.state.data.profiles.light = {
            ...this.state.data.profiles.light,
            ...lightValues,
        };
        this.state.data.profiles.dark = {
            ...this.state.data.profiles.dark,
            ...darkValues,
        };
        for (const key of new Set([...Object.keys(lightValues), ...Object.keys(darkValues)])) {
            this.state.errors[key] = false;
        }
    }

    setProfileValue(key, value) {
        this.profile[key] = value;
        if (key !== "preset") {
            this.profile.preset = "custom";
        }
    }

    onColorPicker(key, event) {
        this.state.errors[key] = false;
        this.setProfileValue(key, event.target.value.toUpperCase());
    }

    onHexChange(key, event) {
        const rawValue = String(event.target.value || "").trim();
        const lastValid =
            normalizeHex(this.profile[key]) ||
            normalizeHex(this.state.original?.profiles?.[this.state.effectiveMode]?.[key]) ||
            "#4F6EF7";
        if (!rawValue) {
            this.state.errors[key] = false;
            this.profile[key] = lastValid;
            event.target.value = lastValid;
            return;
        }
        const normalized = normalizeHex(rawValue);
        if (!normalized) {
            this.state.errors[key] = _t("Enter a six-digit HEX color.");
            this.profile[key] = lastValid;
            event.target.value = lastValid;
            return;
        }
        this.state.errors[key] = false;
        this.setProfileValue(key, normalized);
    }

    setShared(key, value) {
        this.state.data.shared[key] = value;
    }

    async onAsset(event, key) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (!ACCEPTED_IMAGES.has(file.type)) {
            this.notification.add(_t("Choose a PNG, JPEG, or WebP image."), { type: "danger" });
            return;
        }
        if (file.size > ASSET_LIMITS[key]) {
            this.notification.add(_t("The selected image is larger than the allowed limit."), { type: "danger" });
            return;
        }
        const dataUrl = await readFile(file, true);
        this.state.previews[key] = dataUrl;
        this.state.pendingAssets[key] = dataUrlToBase64(dataUrl);
    }

    removeAsset(key) {
        this.state.previews[key] = false;
        this.state.pendingAssets[key] = false;
    }

    async save() {
        if (Object.values(this.state.errors).some(Boolean)) {
            this.notification.add(_t("Correct the invalid values before saving."), { type: "danger" });
            return;
        }
        const payload = clone(this.state.data);
        for (const mode of ["light", "dark"]) {
            const profile = payload.profiles?.[mode];
            const originalProfile = this.state.original?.profiles?.[mode];
            if (profile) {
                for (const k of Object.keys(profile)) {
                    if (k !== "preset") {
                        const valid = normalizeHex(profile[k]) || normalizeHex(originalProfile?.[k]) || "#4F6EF7";
                        profile[k] = valid;
                    }
                }
            }
        }
        this.state.saving = true;
        try {
            payload.assets = clone(this.state.pendingAssets);
            await this.api.save(payload);
            cookie.set("color_scheme", resolveModeForSave(this.state.data.mode));
            cookie.set(THEME_RELOAD_KEY, "1", 120);
            try {
                browser.sessionStorage.setItem(THEME_RELOAD_KEY, "1");
            } catch {
                // The cookie remains the cross-reload fallback in restricted browsers.
            }
            this.props.close();
            browser.location.reload();
        } finally {
            this.state.saving = false;
        }
    }

    discard() {
        this.props.close();
    }

    bindBackdropDismiss() {
        const dialogRoot = document.getElementById(`dialog_${this.env.dialogId}`);
        this.modalEl = dialogRoot?.querySelector(":scope > .modal");
        if (!this.modalEl) {
            return;
        }
        this.onModalMouseDown = (ev) => {
            if (ev.target !== this.modalEl || this.state.saving) {
                return;
            }
            void this.dismissDialog();
        };
        this.modalEl.addEventListener("mousedown", this.onModalMouseDown);
    }

    unbindBackdropDismiss() {
        if (this.modalEl && this.onModalMouseDown) {
            this.modalEl.removeEventListener("mousedown", this.onModalMouseDown);
        }
        this.modalEl = null;
        this.onModalMouseDown = null;
    }

    showDiscardConfirmation(onConfirm) {
        this.dialog.add(ConfirmationDialog, {
            title: _t("Discard theme changes?"),
            body: _t("Your unsaved Willow theme changes will be lost."),
            confirmLabel: _t("Discard"),
            confirmClass: "btn-danger",
            confirm: onConfirm,
            cancel: () => {},
        });
    }

    async dismissDialog() {
        if (this.state.saving) {
            return;
        }
        await this.nativeDismiss();
        this.props.close({ dismiss: true });
    }

    requestClose() {
        if (this.state.saving) {
            return;
        }
        if (!this.isDirty) {
            this.props.close();
            return;
        }
        this.showDiscardConfirmation(() => this.props.close());
    }

    nativeDismiss() {
        if (!this.isDirty) {
            return;
        }
        return new Promise((resolve) => {
            this.showDiscardConfirmation(resolve);
        });
    }

    confirmReset(scope = "all") {
        this.dialog.add(ConfirmationDialog, {
            title: _t("Reset Willow theme?"),
            body: _t("This will restore all Willow theme settings and colors to default theme values."),
            confirmLabel: _t("Reset to default settings"),
            confirmClass: "btn-danger",
            confirm: async () => {
                this.state.saving = true;
                try {
                    const data = await this.api.reset("all", this.state.effectiveMode);
                    this.setData(data);
                    cookie.set("color_scheme", resolveModeForSave(data.mode || "light"));
                    cookie.set(THEME_RELOAD_KEY, "1", 120);
                    try {
                        browser.sessionStorage.setItem(THEME_RELOAD_KEY, "1");
                    } catch {
                        // The cookie remains the cross-reload fallback in restricted browsers.
                    }
                    this.props.close();
                    browser.location.reload();
                } finally {
                    this.state.saving = false;
                }
            },
            cancel: () => {},
        });
    }

    async exportSettings() {
        const content = await this.api.export();
        downloadFile(content, "willow-theme-settings-v2.json", "application/json");
    }

    async importSettings(event) {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) {
            this.notification.add(_t("The settings file is too large."), { type: "danger" });
            return;
        }
        try {
            const data = await this.api.import(await readFile(file));
            this.setData(data);
            this.notification.add(_t("Willow theme settings were imported."), { type: "success" });
        } catch {
            this.notification.add(_t("The selected file is not a valid Willow settings export."), { type: "danger" });
        }
    }
}

export class ThemeSettingsButton extends Component {
    static template = "willow_backend_theme_ent.ThemeSettingsButton";

    setup() {
        this.dialog = useService("dialog");
    }

    open(event) {
        this.dialog.add(ThemeSettingsDialog);
    }
}

export async function mountThemeSettingsButtons() {
    if (!session.willow_theme_is_system_admin && !session.is_system && !session.is_admin) {
        return;
    }
    const env = window.odoo?.__WOWL_DEBUG__?.root?.env;
    if (!env) {
        return;
    }
    for (const host of document.querySelectorAll(".wl_theme_settings_mount:not([data-wl-mounted='1'])")) {
        host.dataset.wlMounted = "1";
        try {
            await mountComponent(ThemeSettingsButton, host, { env });
        } catch (error) {
            host.dataset.wlMounted = "";
            throw error;
        }
    }
}
