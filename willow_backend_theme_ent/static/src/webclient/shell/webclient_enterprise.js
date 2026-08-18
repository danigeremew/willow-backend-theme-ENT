/** @odoo-module **/

// Odoo Enterprise opens its fullscreen Home Menu when no route is present.
// Willow's sequence-0 dashboard is the intended root app, so delegate only
// this decision to the Community WebClient while retaining all other
// WebClientEnterprise services and components.
import { patch } from "@web/core/utils/patch";
import { WebClient } from "@web/webclient/webclient";
import { WebClientEnterprise } from "@web_enterprise/webclient/webclient";

patch(WebClientEnterprise.prototype, {
    _loadDefaultApp() {
        // Do not call the Enterprise original first: it would mount the Home
        // Menu action before Willow can select its dashboard root menu.
        return WebClient.prototype._loadDefaultApp.call(this);
    },
});
