/** @odoo-module **/

import { ButtonBox } from "@web/views/form/button_box/button_box";
import { patch } from "@web/core/utils/patch";
import { onWillRender } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

patch(ButtonBox.prototype, {
    setup() {
        super.setup();
        const ui = useService("ui");

        // Odoo 17 Enterprise renders buttons through getButtons()/getMaxButtons().
        // Newer Odoo 17 sources compute visibleButtons during rendering instead.
        // Keep Willow's compact thresholds while preserving either stock contract.
        if (typeof this.getButtons === "function") {
            this.getMaxButtons = () => [2, 2, 3, 4, 4, 5, 6][ui.size] ?? 6;
            return;
        }

        onWillRender(() => {
            const MAX_VISIBLE_BUTTONS_BY_SIZE = [2, 2, 3, 4, 4, 5, 6];
            const maxVisibleButtons = MAX_VISIBLE_BUTTONS_BY_SIZE[ui.size] ?? 6;

            const allVisibleButtons = Object.entries(this.props.slots)
                .filter(([_, slot]) => this.isSlotVisible(slot))
                .map(([slotName]) => slotName);

            if (allVisibleButtons.length <= maxVisibleButtons) {
                this.visibleButtons = allVisibleButtons;
                this.additionalButtons = [];
                this.isFull = allVisibleButtons.length === maxVisibleButtons;
            } else {
                const splitIndex = Math.max(maxVisibleButtons - 1, 0);
                this.visibleButtons = allVisibleButtons.slice(0, splitIndex);
                this.additionalButtons = allVisibleButtons.slice(splitIndex);
                this.isFull = true;
            }
        });
    }
});
