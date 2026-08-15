from odoo import models
from odoo.http import request

from ..hooks import (
    _migrate_legacy_light_header_colors,
    _migrate_packaged_hero_images_to_svg,
    _migrate_theme_settings_v2,
    _repair_dashboard_primary_overwrite,
)
from .res_config_settings import WILLOW_THEME_DEFAULTS


class IrHttp(models.AbstractModel):
    _inherit = "ir.http"

    def color_scheme(self):
        cookie_scheme = request.httprequest.cookies.get("color_scheme") if request else None
        if cookie_scheme in ("dark", "light"):
            return cookie_scheme
        user_theme_mode = self.env.user.willow_theme_mode or getattr(self.env.user, "color_scheme", None)
        if user_theme_mode in ("dark", "light"):
            return user_theme_mode
        return super().color_scheme()

    def session_info(self):
        _migrate_legacy_light_header_colors(self.env)
        _migrate_theme_settings_v2(self.env)
        _repair_dashboard_primary_overwrite(self.env)
        _migrate_packaged_hero_images_to_svg(self.env)
        result = super().session_info()
        config = self.env["ir.config_parameter"].sudo()
        company = self.env.company

        def get_param(key):
            value = config.get_param(f"willow_backend_theme_ent.{key}")
            if value is not None:
                return value
            legacy_key = {
                "dashboard_show": "home_show",
                "dashboard_title_size": "home_title_size",
                "dashboard_title_weight": "home_title_weight",
                "dashboard_title_color": "home_title_color",
                "dashboard_subtitle_size": "home_subtitle_size",
                "dashboard_subtitle_weight": "home_subtitle_weight",
                "dashboard_subtitle_color": "home_subtitle_color",
                "dark_dashboard_title_color": "dark_home_title_color",
                "dark_dashboard_subtitle_color": "dark_home_subtitle_color",
            }.get(key)
            if legacy_key:
                legacy_value = config.get_param(f"willow_backend_theme_ent.{legacy_key}")
                if legacy_value is not None:
                    return legacy_value
            return WILLOW_THEME_DEFAULTS[key]

        result["chatter_position"] = self.env.user.chatter_position
        result["willow_favorite_menu_ids"] = self.env.user.willow_get_favorite_menu_ids()
        user_theme_mode = self.env.user.willow_theme_mode or getattr(self.env.user, "color_scheme", None)
        result["willow_theme_mode"] = user_theme_mode or "light"
        willow_theme = {
            key: get_param(key)
            for key in WILLOW_THEME_DEFAULTS
            if key not in {"dashboard_show", "environment", "support_contact", "build_version"}
        }
        result["willow_theme"] = willow_theme
        result["willow_theme_colors"] = {
            key: value
            for key, value in willow_theme.items()
            if key.endswith("_color")
        }
        # Empty → reactive SVG hero. Only company uploads become raster overrides.
        result["willow_theme_assets"] = {
            "hero_image": (
                f"/web/image/res.company/{company.id}/willow_hero_image"
                if company.willow_hero_image
                else False
            ),
            "hero_image_dark": (
                f"/web/image/res.company/{company.id}/willow_hero_image_dark"
                if company.willow_hero_image_dark
                else False
            ),
        }
        result["willow_theme_is_system_admin"] = self.env.user.has_group("base.group_system")
        return result
