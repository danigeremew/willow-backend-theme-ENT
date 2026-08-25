/** @odoo-module **/

import { routeToUrl } from "@web/core/browser/router_service";
import { registry } from "@web/core/registry";

/**
 * Odoo 17's router service exposes current/pushState/replaceState but does not
 * expose the stateToUrl helper used by the newer Willow shell implementation.
 * Add the missing adapter before the Willow shell service starts so generated
 * menu links use Odoo 17's canonical /web hash routing.
 */
const willowOdoo17NavigationCompat = {
    dependencies: ["router"],
    start(env, { router }) {
        if (typeof router.stateToUrl !== "function") {
            router.stateToUrl = (hash = {}) =>
                routeToUrl({
                    pathname: "/web",
                    search: router.current?.search || {},
                    hash,
                });
        }
        return {};
    },
};

registry.category("services").add("willow_odoo17_navigation_compat", willowOdoo17NavigationCompat);
