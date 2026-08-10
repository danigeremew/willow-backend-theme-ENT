/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";

export const WILLOW_PRESETS = [
    { id: "willow", label: "Willow", description: "Deep blue and cool neutrals", colors: ["#4F6EF7", "#061B36", "#F8F9FA"] },
    { id: "indigo", label: "Indigo", description: "Focused and technical", colors: ["#5B5CE2", "#26245C", "#F7F7FC"] },
    { id: "forest", label: "Forest", description: "Calm operational green", colors: ["#16896A", "#153B2F", "#F4F8F6"] },
    { id: "sunset", label: "Sunset", description: "Warm orange and plum", colors: ["#D96A3C", "#5A2440", "#FCF7F4"] },
    { id: "ocean", label: "Ocean", description: "Teal and ocean blue", colors: ["#1389A3", "#0F3F4D", "#F3F8F9"] },
    { id: "slate", label: "Slate", description: "Neutral enterprise palette", colors: ["#526275", "#26323F", "#F5F6F8"] },
];

export function getTranslatedPresets() {
    return WILLOW_PRESETS.map((preset) => ({
        ...preset,
        label: _t(preset.label),
        description: _t(preset.description),
    }));
}

export const PROFILE_COLOR_FIELDS = [
    ["primary_color", "Primary", "Main actions and selected records"],
    ["dashboard_primary_color", "Dashboard primary", "Highlights on the Willow dashboard screen"],
    ["header_base_color", "Hero base", "Primary header foundation"],
    ["header_mid_color", "Hero mid-tone", "Secondary header depth"],
    ["canvas_color", "Content canvas", "Main workspace background"],
    ["card_color", "Card surface", "Forms and panel background"],
    ["card_border_color", "Card border", "Panel edge definition"],
    ["header_text_color", "Header text", "Primary text in the header"],
    ["header_muted_color", "Header muted text", "Secondary header text"],
    ["body_text_color", "Body text", "Main readable text"],
    ["body_muted_color", "Muted text", "Descriptions and metadata"],
];

export const SEMANTIC_COLOR_FIELDS = [
    ["success_color", "Success", "Positive confirmations"],
    ["info_color", "Information", "Neutral informational states"],
    ["warning_color", "Warning", "Actions requiring attention"],
    ["danger_color", "Danger", "Errors and destructive actions"],
];

export function getTranslatedColorFields(fields) {
    return fields.map(([key, label, help]) => [key, _t(label), _t(help)]);
}
