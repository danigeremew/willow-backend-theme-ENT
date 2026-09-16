/** @odoo-module **/

import { patch } from "@web/core/utils/patch";
import { registry } from "@web/core/registry";
import { _t } from "@web/core/l10n/translation";
import { cookie as cookieManager } from "@web/core/browser/cookie";
import { WebClient } from "@web/webclient/webclient";
import { WebClientEnterprise } from "@web_enterprise/webclient/webclient";
import {
    ColorSchemeService,
    colorSchemeService,
} from "@web_enterprise/webclient/color_scheme/color_scheme_service";

// Odoo Enterprise opens its fullscreen Home Menu when no route is present.
// Willow's sequence-0 dashboard is the intended root app, so delegate only
// this decision to the Community WebClient while retaining all other
// WebClientEnterprise services and components.
patch(WebClientEnterprise.prototype, {
    _loadDefaultApp() {
        // Do not call the Enterprise original first: it would mount the Home
        // Menu action before Willow can select its dashboard root menu.
        return WebClient.prototype._loadDefaultApp.call(this);
    },
});

const userMenuRegistry = registry.category("user_menuitems");

export function willowColorSchemeItem(env) {
    const isDark =
        typeof window.__wlGetThemeMode === "function"
            ? window.__wlGetThemeMode() === "dark"
            : cookieManager.get("color_scheme") === "dark";
    return {
        type: "switch",
        id: "color_scheme.switch_theme",
        description: _t("Dark Mode"),
        callback: () => {
            const currentMode =
                typeof window.__wlGetThemeMode === "function"
                    ? window.__wlGetThemeMode()
                    : cookieManager.get("color_scheme") || "light";
            const nextMode = currentMode === "dark" ? "light" : "dark";
            if (typeof window.__wlSetThemeMode === "function") {
                void window.__wlSetThemeMode(nextMode);
            } else if (env.services?.color_scheme?.switchToColorScheme) {
                env.services.color_scheme.switchToColorScheme(nextMode);
            } else {
                cookieManager.set("color_scheme", nextMode);
                window.location.reload();
            }
        },
        isChecked: isDark,
        sequence: 30,
    };
}

// Preserve Odoo's ColorSchemeService instance (getters, reload fallback, and
// UI unblock behavior) while routing a user-initiated switch through Willow.
patch(ColorSchemeService.prototype, {
    switchToColorScheme(scheme) {
        if (typeof window.__wlSetThemeMode === "function") {
            return window.__wlSetThemeMode(scheme);
        }
        return super.switchToColorScheme(scheme);
    },
});

patch(colorSchemeService, {
    start() {
        const service = super.start(...arguments);
        // Replace the stock menu item after its registry entry is installed.
        userMenuRegistry.add("color_scheme.switch", willowColorSchemeItem, { force: true });
        return service;
    },
});
