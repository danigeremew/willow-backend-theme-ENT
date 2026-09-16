/** @odoo-module **/

import { Thread } from "@mail/core/common/thread";
import { patch } from "@web/core/utils/patch";

patch(Thread.prototype, {
    get displayMessages() {
        let messages =
            this.props.order === "asc"
                ? this.props.thread.nonEmptyMessages
                : [...this.props.thread.nonEmptyMessages].reverse();

        if (!this.props.showNotificationMessages) {
            messages = messages.filter(
                // Odoo 17 maps the RPC message_type field to Message.type.
                (msg) => !["user_notification", "notification"].includes(msg.type)
            );
        }
        return messages;
    },
});

Thread.props = [...Thread.props, "showNotificationMessages?"];
Thread.defaultProps = {
    ...Thread.defaultProps,
    showNotificationMessages: true,
};
