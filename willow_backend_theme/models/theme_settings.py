import base64
import binascii
import json
import re

from odoo import _, api, fields, models
from odoo.exceptions import AccessError, ValidationError

from .res_config_settings import (
    FONT_WEIGHT_RE,
    HEX_COLOR_RE,
    PIXEL_SIZE_RE,
    WILLOW_THEME_DEFAULTS,
    _str_to_bool,
)


SCHEMA_VERSION = 2
MAX_ASSET_BYTES = {
    "hero_image": 5 * 1024 * 1024,
    "login_background": 5 * 1024 * 1024,
    "company_logo": 1024 * 1024,
    "favicon": 1024 * 1024,
}
ALLOWED_IMAGE_SIGNATURES = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    b"RIFF",
)

PROFILE_FIELDS = {
    "primary_color": ("light_primary_color", "dark_primary_color"),
    "dashboard_primary_color": ("dashboard_primary_color", "dark_dashboard_primary_color"),
    # home_primary_color is a legacy alias only — accepted in _validate_profile, never listed
    # here (listing it caused get_settings → save to overwrite dashboard_primary_color).
    "header_base_color": ("light_header_base_color", "dark_header_base_color"),
    "header_mid_color": ("light_header_mid_color", "dark_header_mid_color"),
    "canvas_color": ("light_canvas_color", "dark_canvas_color"),
    "card_color": ("light_card_color", "dark_card_color"),
    "card_border_color": ("light_card_border_color", "dark_card_border_color"),
    "header_text_color": ("light_header_text_color", "dark_header_text_color"),
    "header_muted_color": ("light_header_muted_color", "dark_header_muted_color"),
    "body_text_color": ("light_body_text_color", "dark_body_text_color"),
    "body_muted_color": ("light_body_muted_color", "dark_body_muted_color"),
    "dashboard_title_color": ("dashboard_title_color", "dark_dashboard_title_color"),
    "dashboard_subtitle_color": ("dashboard_subtitle_color", "dark_dashboard_subtitle_color"),
    "success_color": ("success_color", "dark_success_color"),
    "info_color": ("info_color", "dark_info_color"),
    "warning_color": ("warning_color", "dark_warning_color"),
    "danger_color": ("danger_color", "dark_danger_color"),
    "preset": ("light_preset", "dark_preset"),
}

SHARED_FIELDS = {
    "dashboard_show": "dashboard_show",
    "dashboard_title_size": "dashboard_title_size",
    "dashboard_title_weight": "dashboard_title_weight",
    "dashboard_subtitle_size": "dashboard_subtitle_size",
    "dashboard_subtitle_weight": "dashboard_subtitle_weight",
    "environment": "environment",
    "support_contact": "support_contact",
    "build_version": "build_version",
    "brand_subtitle": "brand_subtitle",
}

NEW_DEFAULTS = {
    "dark_dashboard_primary_color": "#6B8AFF",
    "dark_dashboard_title_color": "#F8FAFC",
    "dark_dashboard_subtitle_color": "#A7B4C7",
    "light_preset": "willow",
    "dark_preset": "willow",
}

PRESETS = {
    "willow": {
        "light": ["#4F6EF7", "#4F6EF7", "#061B36", "#09254A", "#F8F9FA", "#FFFFFF", "#E2E7EE", "#122033", "#5C6B7F", "#122033", "#7D8798", "#122033", "#5C6B7F", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#6B8AFF", "#6B8AFF", "#020817", "#0F172A", "#0B1120", "#111827", "#273449", "#F8FAFC", "#A7B4C7", "#E5EDF7", "#9AA7BA", "#F8FAFC", "#A7B4C7", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
    "indigo": {
        "light": ["#5B5CE2", "#5B5CE2", "#26245C", "#3A3787", "#F7F7FC", "#FFFFFF", "#E2E1EF", "#1D1C32", "#6C6A7D", "#1D1C32", "#6C6A7D", "#1D1C32", "#6C6A7D", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#8586FF", "#8586FF", "#020817", "#0F172A", "#0B1120", "#111827", "#273449", "#F8FAFC", "#A7B4C7", "#E5EDF7", "#9AA7BA", "#F8FAFC", "#A7B4C7", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
    "forest": {
        "light": ["#16896A", "#16896A", "#153B2F", "#205946", "#F4F8F6", "#FFFFFF", "#DCE7E2", "#183029", "#60756E", "#183029", "#60756E", "#183029", "#60756E", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#35B991", "#35B991", "#020817", "#0F172A", "#0B1120", "#111827", "#273449", "#F8FAFC", "#A7B4C7", "#E5EDF7", "#9AA7BA", "#F8FAFC", "#A7B4C7", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
    "sunset": {
        "light": ["#D96A3C", "#D96A3C", "#5A2440", "#7A3452", "#FCF7F4", "#FFFFFF", "#EEDFD7", "#352027", "#7A666B", "#352027", "#7A666B", "#352027", "#7A666B", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#F08A5E", "#F08A5E", "#020817", "#0F172A", "#0B1120", "#111827", "#273449", "#F8FAFC", "#A7B4C7", "#E5EDF7", "#9AA7BA", "#F8FAFC", "#A7B4C7", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
    "ocean": {
        "light": ["#1389A3", "#1389A3", "#0F3F4D", "#155E70", "#F3F8F9", "#FFFFFF", "#D9E7EA", "#173039", "#60767D", "#173039", "#60767D", "#173039", "#60767D", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#3BB9D4", "#3BB9D4", "#020817", "#0F172A", "#0B1120", "#111827", "#273449", "#F8FAFC", "#A7B4C7", "#E5EDF7", "#9AA7BA", "#F8FAFC", "#A7B4C7", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
    "slate": {
        "light": ["#526275", "#526275", "#26323F", "#3A4A5A", "#F5F6F8", "#FFFFFF", "#DDE2E7", "#1E2935", "#6A7480", "#1E2935", "#6A7480", "#1E2935", "#6A7480", "#16B978", "#8D83F6", "#FF8B3D", "#FF4D57"],
        "dark": ["#8291A4", "#8291A4", "#0B0F14", "#171E27", "#0E131A", "#161D26", "#313B48", "#EDF1F5", "#A3ADB8", "#EDF1F5", "#A3ADB8", "#EDF1F5", "#A3ADB8", "#34D399", "#A5B4FC", "#FDBA74", "#FB7185"],
    },
}


def _all_defaults():
    return {**WILLOW_THEME_DEFAULTS, **NEW_DEFAULTS}


def _normalize_hex(value, default_val=None):
    raw = str(value or "").strip()
    if not raw or raw == "#":
        raw = str(default_val or "#000000").strip()
    if not raw.startswith("#"):
        raw = f"#{raw}"
    raw = raw.upper()
    if not HEX_COLOR_RE.fullmatch(raw):
        if default_val and HEX_COLOR_RE.fullmatch(str(default_val).strip().upper()):
            return str(default_val).strip().upper()
        raise ValidationError(_("Colors must use the #RRGGBB format."))
    return raw


class WillowThemeSettings(models.AbstractModel):
    _name = "willow.theme.settings"
    _description = "Willow Theme Settings Service"

    @api.model
    def _check_system(self):
        if not self.env.user.has_group("base.group_system"):
            raise AccessError(_("Only Settings administrators can manage Willow theme settings."))

    @api.model
    def _config(self):
        return self.env["ir.config_parameter"].sudo()

    @api.model
    def _get_param(self, key):
        defaults = _all_defaults()
        config = self._config()
        value = config.get_param(f"willow_backend_theme.{key}")
        if value and str(value).strip():
            return value
        # Legacy home_* config keys (pre home→dashboard rename)
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
            legacy_value = config.get_param(f"willow_backend_theme.{legacy_key}")
            if legacy_value and str(legacy_value).strip():
                return legacy_value
        return defaults[key]

    @api.model
    def _profile(self, mode):
        index = 0 if mode == "light" else 1
        return {
            public: self._get_param(keys[index])
            for public, keys in PROFILE_FIELDS.items()
        }

    @api.model
    def _shared(self):
        values = {
            public: self._get_param(key)
            for public, key in SHARED_FIELDS.items()
        }
        values["dashboard_show"] = _str_to_bool(values["dashboard_show"])
        return values

    @api.model
    def _asset_url(self, field_name):
        company = self.env.company
        if company[field_name]:
            return f"/web/image/res.company/{company.id}/{field_name}?unique={company.write_date}"
        return False

    @api.model
    def get_settings(self):
        self._check_system()
        company = self.env.company
        return {
            "schema_version": SCHEMA_VERSION,
            "mode": self.env.user.willow_theme_mode or "system",
            "profiles": {
                "light": self._profile("light"),
                "dark": self._profile("dark"),
            },
            "shared": self._shared(),
            "assets": {
                "hero_image": self._asset_url("willow_hero_image"),
                "hero_image_dark": self._asset_url("willow_hero_image_dark"),
                "company_logo": f"/web/image/res.company/{company.id}/logo?unique={company.write_date}" if company.logo else False,
                "favicon": self._asset_url("willow_favicon"),
                "login_background": self._asset_url("willow_login_background"),
                "login_background_dark": self._asset_url("willow_login_background_dark"),
            },
            "presets": list(PRESETS),
        }

    @api.model
    def _validate_profile(self, mode, values):
        if not isinstance(values, dict):
            raise ValidationError(_("Theme profiles must be JSON objects."))
        defaults = _all_defaults()
        index = 0 if mode == "light" else 1
        incoming = dict(values)
        # Legacy export/UI key — map into dashboard_primary, then drop so it cannot
        # overwrite a newer dashboard_primary_color later in the save loop.
        if "home_primary_color" in incoming:
            if "dashboard_primary_color" not in incoming:
                incoming["dashboard_primary_color"] = incoming["home_primary_color"]
            incoming.pop("home_primary_color", None)
        result = {
            key: _normalize_hex(incoming.get(key), defaults[keys[index]])
            for key, keys in PROFILE_FIELDS.items()
            if key != "preset"
        }
        preset = incoming.get("preset", defaults[PROFILE_FIELDS["preset"][index]])
        result["preset"] = preset if preset in PRESETS else "custom"
        return result

    @api.model
    def _validate_shared(self, values):
        if not isinstance(values, dict):
            raise ValidationError(_("Shared settings must be a JSON object."))
        # Accept legacy home_* keys from older exports.
        normalized = dict(values)
        for old, new in (
            ("home_show", "dashboard_show"),
            ("home_title_size", "dashboard_title_size"),
            ("home_title_weight", "dashboard_title_weight"),
            ("home_title_color", "dashboard_title_color"),
            ("home_subtitle_size", "dashboard_subtitle_size"),
            ("home_subtitle_weight", "dashboard_subtitle_weight"),
            ("home_subtitle_color", "dashboard_subtitle_color"),
        ):
            if old in normalized and new not in normalized:
                normalized[new] = normalized[old]
        result = {}
        for key, value in normalized.items():
            if key not in SHARED_FIELDS:
                continue
            if key == "dashboard_show":
                result[key] = bool(value)
            elif key in {"dashboard_title_size", "dashboard_subtitle_size"}:
                normalized_size = str(value).strip()
                if not PIXEL_SIZE_RE.fullmatch(normalized_size):
                    raise ValidationError(_("Font sizes must use a px value."))
                number = int(normalized_size[:-2])
                lower, upper = (24, 72) if key == "dashboard_title_size" else (12, 32)
                if not lower <= number <= upper:
                    raise ValidationError(_("The selected font size is outside the supported range."))
                result[key] = normalized_size
            elif key in {"dashboard_title_weight", "dashboard_subtitle_weight"}:
                normalized_weight = str(value).strip()
                if not FONT_WEIGHT_RE.fullmatch(normalized_weight):
                    raise ValidationError(_("Font weights must be between 100 and 900."))
                result[key] = normalized_weight
            elif key == "environment":
                if value not in {"production", "staging", "development"}:
                    raise ValidationError(_("Unknown environment value."))
                result[key] = value
            else:
                result[key] = str(value or "").strip()[:255]
        return result

    @api.model
    def _decode_asset(self, name, value):
        if value in (None, False):
            return value
        if not isinstance(value, str):
            raise ValidationError(_("Uploaded assets must be base64 encoded."))
        try:
            raw = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error) as error:
            raise ValidationError(_("An uploaded asset is not valid base64 data.")) from error
        if len(raw) > MAX_ASSET_BYTES[name]:
            raise ValidationError(_("The uploaded asset exceeds the allowed size."))
        is_webp = raw.startswith(b"RIFF") and raw[8:12] == b"WEBP"
        if not any(raw.startswith(signature) for signature in ALLOWED_IMAGE_SIGNATURES[:2]) and not is_webp:
            raise ValidationError(_("Only PNG, JPEG, and WebP images are supported."))
        return value

    @api.model
    def _validate_assets(self, values):
        if not isinstance(values, dict):
            raise ValidationError(_("Assets must be a JSON object."))
        mapping = {
            "hero_image": ("willow_hero_image", "hero_image"),
            "hero_image_dark": ("willow_hero_image_dark", "hero_image"),
            "company_logo": ("logo", "company_logo"),
            "favicon": ("willow_favicon", "favicon"),
            "login_background": ("willow_login_background", "login_background"),
            "login_background_dark": ("willow_login_background_dark", "login_background"),
        }
        return {
            mapping[key][0]: self._decode_asset(mapping[key][1], value)
            for key, value in values.items()
            if key in mapping
        }

    @api.model
    def save_settings(self, payload):
        self._check_system()
        if not isinstance(payload, dict):
            raise ValidationError(_("Theme settings must be a JSON object."))
        mode = payload.get("mode")
        if mode not in {"light", "dark", "system"}:
            raise ValidationError(_("Appearance mode must be light, dark, or system."))
        profiles = payload.get("profiles", {})
        validated_profiles = {
            profile_mode: self._validate_profile(profile_mode, profiles.get(profile_mode, {}))
            for profile_mode in ("light", "dark")
        }
        shared = self._validate_shared(payload.get("shared", {}))
        assets = self._validate_assets(payload.get("assets", {}))

        config_values = {}
        for profile_mode, values in validated_profiles.items():
            index = 0 if profile_mode == "light" else 1
            for public, value in values.items():
                config_values[PROFILE_FIELDS[public][index]] = value
        config_values.update({SHARED_FIELDS[key]: value for key, value in shared.items()})

        config = self._config()
        for key, value in config_values.items():
            config.set_param(f"willow_backend_theme.{key}", value)
        if assets:
            self.env.company.sudo().write(assets)
        self.env.user.sudo().write({"willow_theme_mode": mode})
        if "dashboard_show" in shared:
            menu = self.env.ref("willow_backend_theme.menu_willow_dashboard", raise_if_not_found=False) or self.env.ref(
                "willow_backend_theme.menu_willow_home", raise_if_not_found=False
            )
            if menu:
                menu.sudo().write({"active": shared["dashboard_show"]})
        return self.get_settings()

    @api.model
    def apply_preset(self, mode, preset):
        """Return color values for *mode*. Call for light and dark to keep presets paired."""
        self._check_system()
        if mode not in {"light", "dark"} or preset not in PRESETS:
            raise ValidationError(_("Unknown Willow preset."))
        keys = [
            "primary_color", "dashboard_primary_color", "header_base_color", "header_mid_color",
            "canvas_color", "card_color", "card_border_color", "header_text_color",
            "header_muted_color", "body_text_color", "body_muted_color",
            "dashboard_title_color", "dashboard_subtitle_color",
            "success_color", "info_color", "warning_color", "danger_color",
        ]
        profile = self._profile(mode)
        profile.update(dict(zip(keys, PRESETS[preset][mode])))
        profile["preset"] = preset
        return self._validate_profile(mode, profile)

    @api.model
    def reset_settings(self, scope, mode=None):
        self._check_system()
        defaults = _all_defaults()
        config = self._config()
        if scope in {"current", "profiles", "all"}:
            modes = [mode] if scope == "current" else ["light", "dark"]
            if any(item not in {"light", "dark"} for item in modes):
                raise ValidationError(_("A valid profile is required for this reset."))
            for profile_mode in modes:
                index = 0 if profile_mode == "light" else 1
                for keys in PROFILE_FIELDS.values():
                    key = keys[index]
                    config.set_param(f"willow_backend_theme.{key}", defaults[key])
        if scope in {"shared", "all"}:
            for key in SHARED_FIELDS.values():
                config.set_param(f"willow_backend_theme.{key}", defaults[key])
            company_defaults = self.env["res.config.settings"]._get_default_hero_image_binaries()
            company_defaults.update({
                "willow_favicon": False,
                "willow_login_background": False,
                "willow_login_background_dark": False,
            })
            self.env.company.sudo().write(company_defaults)
        return self.get_settings()

    @api.model
    def export_settings(self):
        self._check_system()
        settings = self.get_settings()
        company = self.env.company.sudo()
        settings["assets"] = {
            "hero_image": company.willow_hero_image.decode() if company.willow_hero_image else False,
            "hero_image_dark": company.willow_hero_image_dark.decode() if company.willow_hero_image_dark else False,
            "company_logo": company.logo.decode() if company.logo else False,
            "favicon": company.willow_favicon.decode() if company.willow_favicon else False,
            "login_background": company.willow_login_background.decode() if company.willow_login_background else False,
            "login_background_dark": company.willow_login_background_dark.decode() if company.willow_login_background_dark else False,
        }
        settings.pop("presets", None)
        return json.dumps(settings, indent=2, sort_keys=True)

    @api.model
    def import_settings(self, content):
        self._check_system()
        try:
            payload = json.loads(content)
        except (TypeError, ValueError) as error:
            raise ValidationError(_("The selected file is not valid JSON.")) from error
        if payload.get("schema_version") != SCHEMA_VERSION:
            raise ValidationError(_("This Willow settings schema version is not supported."))
        return self.save_settings(payload)
