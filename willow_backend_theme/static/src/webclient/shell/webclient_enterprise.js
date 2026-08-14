/** @odoo-module **/

// Odoo Enterprise opens its fullscreen Home Menu when no route is present.
// Willow's sequence-0 dashboard is the intended root app, so delegate only
// this decision to the Community WebClient while retaining all other
// WebClientEnterprise services and components.
import { patch } from "@web/core/utils/patch";
import { cookie } from "@web/core/browser/cookie";
import { session } from "@web/session";
import { user } from "@web/core/user";
import { WebClient } from "@web/webclient/webclient";
import { WebClientEnterprise } from "@web_enterprise/webclient/webclient";
import {
    blockingWebClient,
    colorSchemeService,
    systemColorScheme,
} from "@web_enterprise/webclient/color_scheme/color_scheme_service";

const WILLOW_THEME_MODES = new Set(["light", "dark", "system"]);

patch(WebClientEnterprise.prototype, {
    _loadDefaultApp() {
        // Do not call the Enterprise original first: it would mount the Home
        // Menu action before Willow can select its dashboard root menu.
        return WebClient.prototype._loadDefaultApp.call(this);
    },
});

patch(colorSchemeService, {
    async start() {
        const willowMode = session.willow_theme_mode || user.settings?.color_scheme;
        if (!WILLOW_THEME_MODES.has(willowMode)) {
            return super.start(...arguments);
        }

        // Keep session and user.settings in sync with Willow's appearance preference.
        const nextMode = willowMode === "system" ? systemColorScheme() : willowMode;
        const currentMode = cookie.get("color_scheme");
        if (nextMode !== currentMode) {
            cookie.set("color_scheme", nextMode);
            if (currentMode || (!currentMode && nextMode === "dark")) {
                this.reload();
                await blockingWebClient.promise;
            }
        }
        return {
            get systemColorScheme() {
                return systemColorScheme();
            },
            get currentColorScheme() {
                return cookie.get("color_scheme");
            },
            get userColorScheme() {
                return willowMode;
            },
        };
    },
});
