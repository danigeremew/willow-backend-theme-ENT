import base64
import json
import re

from odoo import api, fields, models
from odoo.exceptions import ValidationError


HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
PIXEL_SIZE_RE = re.compile(r"^\d{1,3}px$")
FONT_WEIGHT_RE = re.compile(r"^[1-9]00$")

WILLOW_THEME_DEFAULTS = {
    "light_primary_color": "#4F6EF7",
    "dark_primary_color": "#6B8AFF",
    "dashboard_primary_color": "#4F6EF7",
    "dark_dashboard_primary_color": "#6B8AFF",
    "light_header_base_color": "#061B36",
    "light_header_mid_color": "#09254A",
    "light_canvas_color": "#F8F9FA",
    "light_card_color": "#FFFFFF",
    "light_card_border_color": "#E8ECF2",
    "light_header_text_color": "#122033",
    "light_header_muted_color": "#5C6B7F",
    "light_body_text_color": "#122033",
    "light_body_muted_color": "#7D8798",
    "dark_header_base_color": "#020817",
    "dark_header_mid_color": "#0F172A",
    "dark_canvas_color": "#0B1120",
    "dark_card_color": "#111827",
    "dark_card_border_color": "#273449",
    "dark_header_text_color": "#F8FAFC",
    "dark_header_muted_color": "#A7B4C7",
    "dark_body_text_color": "#E5EDF7",
    "dark_body_muted_color": "#9AA7BA",
    "dashboard_show": True,
    "dashboard_title_size": "38px",
    "dashboard_title_weight": "700",
    "dashboard_subtitle_size": "19px",
    "dashboard_subtitle_weight": "500",
    "dashboard_title_color": "#122033",
    "dashboard_subtitle_color": "#5C6B7F",
    "dark_dashboard_title_color": "#F8FAFC",
    "dark_dashboard_subtitle_color": "#A7B4C7",
    "success_color": "#16B978",
    "info_color": "#8D83F6",
    "warning_color": "#FF8B3D",
    "danger_color": "#FF4D57",
    "dark_success_color": "#34D399",
    "dark_info_color": "#A5B4FC",
    "dark_warning_color": "#FDBA74",
    "dark_danger_color": "#FB7185",
    "environment": "production",
    "support_contact": "",
    "build_version": "",
    "brand_subtitle": "Enterprise Resource Planning",
    "light_preset": "willow",
    "dark_preset": "willow",
}

WILLOW_COLOR_KEYS = [
    key for key, value in WILLOW_THEME_DEFAULTS.items() if key.endswith("_color")
]


def _str_to_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"

    willow_light_primary_color = fields.Char(
        string="Light Mode Primary Color",
        config_parameter="willow_backend_theme_ent.light_primary_color",
        default=WILLOW_THEME_DEFAULTS["light_primary_color"],
    )
    willow_dark_primary_color = fields.Char(
        string="Dark Mode Primary Color",
        config_parameter="willow_backend_theme_ent.dark_primary_color",
        default=WILLOW_THEME_DEFAULTS["dark_primary_color"],
    )
    willow_dashboard_primary_color = fields.Char(
        string="Dashboard Primary Color",
        config_parameter="willow_backend_theme_ent.dashboard_primary_color",
        default=WILLOW_THEME_DEFAULTS["dashboard_primary_color"],
    )
    willow_dark_dashboard_primary_color = fields.Char(
        string="Dark Dashboard Primary Color",
        config_parameter="willow_backend_theme_ent.dark_dashboard_primary_color",
        default=WILLOW_THEME_DEFAULTS["dark_dashboard_primary_color"],
    )
    willow_light_header_base_color = fields.Char(string="Light Hero Base", config_parameter="willow_backend_theme_ent.light_header_base_color", default=WILLOW_THEME_DEFAULTS["light_header_base_color"])
    willow_light_header_mid_color = fields.Char(string="Light Hero Mid-tone", config_parameter="willow_backend_theme_ent.light_header_mid_color", default=WILLOW_THEME_DEFAULTS["light_header_mid_color"])
    willow_light_canvas_color = fields.Char(string="Light Canvas", config_parameter="willow_backend_theme_ent.light_canvas_color", default=WILLOW_THEME_DEFAULTS["light_canvas_color"])
    willow_light_card_color = fields.Char(string="Light Card Surface", config_parameter="willow_backend_theme_ent.light_card_color", default=WILLOW_THEME_DEFAULTS["light_card_color"])
    willow_light_card_border_color = fields.Char(string="Light Card Border", config_parameter="willow_backend_theme_ent.light_card_border_color", default=WILLOW_THEME_DEFAULTS["light_card_border_color"])
    willow_light_header_text_color = fields.Char(string="Light Header Text", config_parameter="willow_backend_theme_ent.light_header_text_color", default=WILLOW_THEME_DEFAULTS["light_header_text_color"])
    willow_light_header_muted_color = fields.Char(string="Light Header Muted Text", config_parameter="willow_backend_theme_ent.light_header_muted_color", default=WILLOW_THEME_DEFAULTS["light_header_muted_color"])
    willow_light_body_text_color = fields.Char(string="Light Body Text", config_parameter="willow_backend_theme_ent.light_body_text_color", default=WILLOW_THEME_DEFAULTS["light_body_text_color"])
    willow_light_body_muted_color = fields.Char(string="Light Muted Body Text", config_parameter="willow_backend_theme_ent.light_body_muted_color", default=WILLOW_THEME_DEFAULTS["light_body_muted_color"])
    willow_dark_header_base_color = fields.Char(string="Dark Hero Base", config_parameter="willow_backend_theme_ent.dark_header_base_color", default=WILLOW_THEME_DEFAULTS["dark_header_base_color"])
    willow_dark_header_mid_color = fields.Char(string="Dark Hero Mid-tone", config_parameter="willow_backend_theme_ent.dark_header_mid_color", default=WILLOW_THEME_DEFAULTS["dark_header_mid_color"])
    willow_dark_canvas_color = fields.Char(string="Dark Canvas", config_parameter="willow_backend_theme_ent.dark_canvas_color", default=WILLOW_THEME_DEFAULTS["dark_canvas_color"])
    willow_dark_card_color = fields.Char(string="Dark Card Surface", config_parameter="willow_backend_theme_ent.dark_card_color", default=WILLOW_THEME_DEFAULTS["dark_card_color"])
    willow_dark_card_border_color = fields.Char(string="Dark Card Border", config_parameter="willow_backend_theme_ent.dark_card_border_color", default=WILLOW_THEME_DEFAULTS["dark_card_border_color"])
    willow_dark_header_text_color = fields.Char(string="Dark Header Text", config_parameter="willow_backend_theme_ent.dark_header_text_color", default=WILLOW_THEME_DEFAULTS["dark_header_text_color"])
    willow_dark_header_muted_color = fields.Char(string="Dark Header Muted Text", config_parameter="willow_backend_theme_ent.dark_header_muted_color", default=WILLOW_THEME_DEFAULTS["dark_header_muted_color"])
    willow_dark_body_text_color = fields.Char(string="Dark Body Text", config_parameter="willow_backend_theme_ent.dark_body_text_color", default=WILLOW_THEME_DEFAULTS["dark_body_text_color"])
    willow_dark_body_muted_color = fields.Char(string="Dark Muted Body Text", config_parameter="willow_backend_theme_ent.dark_body_muted_color", default=WILLOW_THEME_DEFAULTS["dark_body_muted_color"])
    willow_dashboard_show = fields.Boolean(string="Show Dashboard Menu", config_parameter="willow_backend_theme_ent.dashboard_show", default=WILLOW_THEME_DEFAULTS["dashboard_show"])
    willow_dashboard_title_size = fields.Char(string="Dashboard Title Size", config_parameter="willow_backend_theme_ent.dashboard_title_size", default=WILLOW_THEME_DEFAULTS["dashboard_title_size"])
    willow_dashboard_title_weight = fields.Char(string="Dashboard Title Weight", config_parameter="willow_backend_theme_ent.dashboard_title_weight", default=WILLOW_THEME_DEFAULTS["dashboard_title_weight"])
    willow_dashboard_subtitle_size = fields.Char(string="Dashboard Subtitle Size", config_parameter="willow_backend_theme_ent.dashboard_subtitle_size", default=WILLOW_THEME_DEFAULTS["dashboard_subtitle_size"])
    willow_dashboard_subtitle_weight = fields.Char(string="Dashboard Subtitle Weight", config_parameter="willow_backend_theme_ent.dashboard_subtitle_weight", default=WILLOW_THEME_DEFAULTS["dashboard_subtitle_weight"])
    willow_dashboard_title_color = fields.Char(string="Dashboard Hero Title Color", config_parameter="willow_backend_theme_ent.dashboard_title_color", default=WILLOW_THEME_DEFAULTS["dashboard_title_color"])
    willow_dashboard_subtitle_color = fields.Char(string="Dashboard Hero Subtitle Color", config_parameter="willow_backend_theme_ent.dashboard_subtitle_color", default=WILLOW_THEME_DEFAULTS["dashboard_subtitle_color"])
    willow_dark_dashboard_title_color = fields.Char(
        string="Dark Dashboard Hero Title Color",
        config_parameter="willow_backend_theme_ent.dark_dashboard_title_color",
        default=WILLOW_THEME_DEFAULTS["dark_dashboard_title_color"],
    )
    willow_dark_dashboard_subtitle_color = fields.Char(
        string="Dark Dashboard Hero Subtitle Color",
        config_parameter="willow_backend_theme_ent.dark_dashboard_subtitle_color",
        default=WILLOW_THEME_DEFAULTS["dark_dashboard_subtitle_color"],
    )
    willow_success_color = fields.Char(string="Success Color", config_parameter="willow_backend_theme_ent.success_color", default=WILLOW_THEME_DEFAULTS["success_color"])
    willow_info_color = fields.Char(string="Info Color", config_parameter="willow_backend_theme_ent.info_color", default=WILLOW_THEME_DEFAULTS["info_color"])
    willow_warning_color = fields.Char(string="Warning Color", config_parameter="willow_backend_theme_ent.warning_color", default=WILLOW_THEME_DEFAULTS["warning_color"])
    willow_danger_color = fields.Char(string="Danger Color", config_parameter="willow_backend_theme_ent.danger_color", default=WILLOW_THEME_DEFAULTS["danger_color"])
    willow_dark_success_color = fields.Char(string="Dark Success Color", config_parameter="willow_backend_theme_ent.dark_success_color", default=WILLOW_THEME_DEFAULTS["dark_success_color"])
    willow_dark_info_color = fields.Char(string="Dark Info Color", config_parameter="willow_backend_theme_ent.dark_info_color", default=WILLOW_THEME_DEFAULTS["dark_info_color"])
    willow_dark_warning_color = fields.Char(string="Dark Warning Color", config_parameter="willow_backend_theme_ent.dark_warning_color", default=WILLOW_THEME_DEFAULTS["dark_warning_color"])
    willow_dark_danger_color = fields.Char(string="Dark Danger Color", config_parameter="willow_backend_theme_ent.dark_danger_color", default=WILLOW_THEME_DEFAULTS["dark_danger_color"])
    willow_environment = fields.Selection(
        [("production", "Production"), ("staging", "Staging"), ("development", "Development")],
        string="Environment Label",
        config_parameter="willow_backend_theme_ent.environment",
        default=WILLOW_THEME_DEFAULTS["environment"],
    )
    willow_support_contact = fields.Char(string="Support Contact", config_parameter="willow_backend_theme_ent.support_contact", default=WILLOW_THEME_DEFAULTS["support_contact"])
    willow_build_version = fields.Char(string="Build Version", config_parameter="willow_backend_theme_ent.build_version", default=WILLOW_THEME_DEFAULTS["build_version"])
    willow_brand_subtitle = fields.Char(
        string="Brand Subtitle",
        config_parameter="willow_backend_theme_ent.brand_subtitle",
        default=WILLOW_THEME_DEFAULTS["brand_subtitle"],
    )
    willow_hero_image = fields.Binary(related="company_id.willow_hero_image", readonly=False)
    willow_hero_image_dark = fields.Binary(related="company_id.willow_hero_image_dark", readonly=False)
    willow_theme_import_file = fields.Binary(string="Import JSON")
    willow_theme_import_filename = fields.Char()

    def _reload_client_action(self):
        return {
            "type": "ir.actions.client",
            "tag": "reload",
        }

    def _check_willow_theme_admin(self):
        if not self.env.user.has_group("base.group_system"):
            raise ValidationError("Only Settings administrators can manage Willow theme settings.")

    @api.constrains(
        *(f"willow_{key}" for key in WILLOW_COLOR_KEYS),
    )
    def _check_willow_theme_colors(self):
        for record in self:
            for key in WILLOW_COLOR_KEYS:
                field_name = f"willow_{key}"
                if field_name not in record._fields:
                    continue
                color = str(record[field_name] or "").strip().upper()
                if not color or color == "#":
                    record[field_name] = WILLOW_THEME_DEFAULTS[key]
                elif not HEX_COLOR_RE.fullmatch(color):
                    record[field_name] = WILLOW_THEME_DEFAULTS[key]

    @api.constrains(
        "willow_dashboard_title_size",
        "willow_dashboard_subtitle_size",
        "willow_dashboard_title_weight",
        "willow_dashboard_subtitle_weight",
    )
    def _check_willow_dashboard_typography(self):
        for record in self:
            for field_name in ("willow_dashboard_title_size", "willow_dashboard_subtitle_size"):
                if record[field_name] and not PIXEL_SIZE_RE.match(record[field_name]):
                    raise ValidationError("Dashboard font sizes must use a px value, for example 38px.")
            for field_name in ("willow_dashboard_title_weight", "willow_dashboard_subtitle_weight"):
                if record[field_name] and not FONT_WEIGHT_RE.match(record[field_name]):
                    raise ValidationError("Dashboard font weights must use a 100-900 value.")

    @api.model
    def _set_dashboard_menu_visibility(self, visible):
        menu = self.env.ref("willow_backend_theme_ent.menu_willow_dashboard", raise_if_not_found=False) or self.env.ref(
            "willow_backend_theme_ent.menu_willow_home", raise_if_not_found=False
        )
        if menu:
            menu.sudo().write({"active": bool(visible)})

    def set_values(self):
        result = super().set_values()
        self._set_dashboard_menu_visibility(self.willow_dashboard_show)
        return result

    @api.model
    def _get_default_hero_image_binaries(self):
        # Reactive SVG is the default hero. Reset clears optional uploads.
        return {
            "willow_hero_image": False,
            "willow_hero_image_dark": False,
        }

    def action_willow_reset_all_theme_settings(self):
        self._check_willow_theme_admin()
        config = self.env["ir.config_parameter"].sudo()
        for key, value in WILLOW_THEME_DEFAULTS.items():
            config.set_param(f"willow_backend_theme_ent.{key}", value)
        self.company_id.sudo().write(self._get_default_hero_image_binaries())
        self._set_dashboard_menu_visibility(WILLOW_THEME_DEFAULTS["dashboard_show"])
        return self._reload_client_action()

    def action_willow_reset_theme_colors(self):
        self._check_willow_theme_admin()
        config = self.env["ir.config_parameter"].sudo()
        for key in WILLOW_COLOR_KEYS:
            config.set_param(f"willow_backend_theme_ent.{key}", WILLOW_THEME_DEFAULTS[key])
        return self._reload_client_action()

    def action_willow_export_theme_settings(self):
        self._check_willow_theme_admin()
        config = self.env["ir.config_parameter"].sudo()
        payload = {
            key: config.get_param(f"willow_backend_theme_ent.{key}", default)
            for key, default in WILLOW_THEME_DEFAULTS.items()
        }
        payload["dashboard_show"] = _str_to_bool(payload["dashboard_show"])
        data = base64.b64encode(
            json.dumps(payload, indent=2, sort_keys=True).encode()
        ).decode()
        return {
            "type": "ir.actions.act_url",
            "target": "self",
            "url": f"data:application/json;base64,{data}",
        }

    def action_willow_import_theme_settings(self):
        self._check_willow_theme_admin()
        self.ensure_one()
        if not self.willow_theme_import_file:
            raise ValidationError("Upload a Willow theme settings JSON file first.")
        try:
            payload = json.loads(base64.b64decode(self.willow_theme_import_file).decode())
        except (ValueError, TypeError) as error:
            raise ValidationError("The uploaded file is not a valid JSON export.") from error
        # Remap legacy home_* keys from older exports.
        for old, new in (
            ("home_show", "dashboard_show"),
            ("home_title_size", "dashboard_title_size"),
            ("home_title_weight", "dashboard_title_weight"),
            ("home_title_color", "dashboard_title_color"),
            ("home_subtitle_size", "dashboard_subtitle_size"),
            ("home_subtitle_weight", "dashboard_subtitle_weight"),
            ("home_subtitle_color", "dashboard_subtitle_color"),
            ("dark_home_title_color", "dark_dashboard_title_color"),
            ("dark_home_subtitle_color", "dark_dashboard_subtitle_color"),
        ):
            if old in payload and new not in payload:
                payload[new] = payload.pop(old)
            elif old in payload:
                payload.pop(old)
        unknown_keys = set(payload) - set(WILLOW_THEME_DEFAULTS)
        if unknown_keys:
            raise ValidationError("The uploaded file contains unsupported Willow theme settings.")
        config = self.env["ir.config_parameter"].sudo()
        for key, default in WILLOW_THEME_DEFAULTS.items():
            value = payload.get(key, default)
            if key.endswith("_color") and value and not HEX_COLOR_RE.match(str(value)):
                raise ValidationError("Imported theme colors must use the #RRGGBB format.")
            if key in {"dashboard_title_size", "dashboard_subtitle_size"} and value and not PIXEL_SIZE_RE.match(str(value)):
                raise ValidationError("Imported home font sizes must use a px value, for example 38px.")
            if key in {"dashboard_title_weight", "dashboard_subtitle_weight"} and value and not FONT_WEIGHT_RE.match(str(value)):
                raise ValidationError("Imported home font weights must use a 100-900 value.")
            if key == "environment" and value not in {"production", "staging", "development"}:
                raise ValidationError("Imported environment must be production, staging, or development.")
            if key == "dashboard_show":
                value = _str_to_bool(value)
            config.set_param(f"willow_backend_theme_ent.{key}", value)
        self._set_dashboard_menu_visibility(_str_to_bool(payload.get("dashboard_show", WILLOW_THEME_DEFAULTS["dashboard_show"])))
        return self._reload_client_action()
