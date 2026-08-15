import base64
import hashlib
from pathlib import Path


DEFAULT_FAVORITE_MENU_XMLIDS = [
    "willow_backend_theme_ent.menu_willow_dashboard",
    "sale.sale_menu_root",
    "stock.menu_stock_root",
    "crm.crm_menu_root",
    "purchase.menu_purchase_root",
    "account.menu_finance",
    "project.menu_main_pm",
    "mrp.menu_mrp_root",
    "hr.menu_hr_root",
    "calendar.mail_menu_calendar",
    "contacts.menu_contacts",
]
DEFAULT_FAVORITE_LIMIT = 11

DEFAULT_FAVORITE_MENU_LABELS = [
    "dashboard",
    "home",
    "sales",
    "inventory",
    "crm",
    "purchase",
    "accounting",
    "invoicing",
    "project",
    "manufacturing",
    "employees",
    "calendar",
    "contacts",
]

# Historical: dashboard → home (v1), then home → dashboard (canonical again).
THEME_XMLID_RENAMES = [
    ("action_willow_home", "action_willow_dashboard"),
    ("menu_willow_home", "menu_willow_dashboard"),
]

WILLOW_DASHBOARD_ACTION_TAG = "willow_backend_theme_ent.operations_dashboard"
LEGACY_DASHBOARD_ACTION_TAGS = (
    WILLOW_DASHBOARD_ACTION_TAG,
    "willow_backend_theme_ent.operations_home",
)

HOME_TO_DASHBOARD_CONFIG_KEYS = (
    ("home_show", "dashboard_show"),
    ("home_title_size", "dashboard_title_size"),
    ("home_title_weight", "dashboard_title_weight"),
    ("home_title_color", "dashboard_title_color"),
    ("home_subtitle_size", "dashboard_subtitle_size"),
    ("home_subtitle_weight", "dashboard_subtitle_weight"),
    ("home_subtitle_color", "dashboard_subtitle_color"),
    ("dark_home_title_color", "dark_dashboard_title_color"),
    ("dark_home_subtitle_color", "dark_dashboard_subtitle_color"),
)
MODULE_DIR = Path(__file__).resolve().parent
DEFAULT_HERO_IMAGE_PATH = MODULE_DIR / "static" / "src" / "img" / "hero_bg.png"
DEFAULT_HERO_IMAGE_DARK_PATH = MODULE_DIR / "static" / "src" / "img" / "hero_bg_dark.png"

# SHA-256 of the former packaged default PNGs (raw file bytes). Used to clear
# seeded company binaries so the reactive SVG hero becomes the default while
# preserving true custom uploads.
PACKAGED_HERO_IMAGE_SHA256 = {
    "willow_hero_image": "1d1c64ed0f95f37a4f2536172e5979cf631b48204d895a1f775ef84d299216e4",
    "willow_hero_image_dark": "209b17aa63a212b2cb784a41abcaf013069f5d740bf6699d632beaaeb6da1da4",
}


def _migrate_community_config_params(env):
    """Seed Enterprise settings from Willow Community without altering them."""
    config = env["ir.config_parameter"].sudo()
    legacy_prefix = "willow_backend_theme_ce."
    current_prefix = "willow_backend_theme_ent."
    for param in config.search([("key", "=like", f"{legacy_prefix}%")]):
        suffix = param.key[len(legacy_prefix):]
        current_key = f"{current_prefix}{suffix}"
        if config.get_param(current_key) is None:
            config.set_param(current_key, param.value)


def _binary_sha256(value):
    if not value:
        return None
    raw = value if isinstance(value, (bytes, bytearray)) else str(value).encode()
    try:
        decoded = base64.b64decode(raw, validate=False)
    except Exception:  # noqa: BLE001 — treat undecodable as non-matching
        return None
    return hashlib.sha256(decoded).hexdigest()


def _migrate_packaged_hero_images_to_svg(env):
    """Clear company hero binaries that still match the old packaged PNGs.

    Empty fields → reactive SVG hero. Custom uploads (different bytes) are kept.
    """
    config = env["ir.config_parameter"].sudo()
    if config.get_param("willow_backend_theme_ent.svg_hero_migrated"):
        return
    known_hashes = set(PACKAGED_HERO_IMAGE_SHA256.values())
    for path in (DEFAULT_HERO_IMAGE_PATH, DEFAULT_HERO_IMAGE_DARK_PATH):
        if path.exists():
            known_hashes.add(hashlib.sha256(path.read_bytes()).hexdigest())
    companies = env["res.company"].sudo().search([])
    for company in companies:
        updates = {}
        for field_name in PACKAGED_HERO_IMAGE_SHA256:
            current = company[field_name]
            if current and _binary_sha256(current) in known_hashes:
                updates[field_name] = False
        if updates:
            company.write(updates)
    config.set_param("willow_backend_theme_ent.svg_hero_migrated", "1")


def _migrate_legacy_light_header_colors(env):
    """Ensure light-mode chrome uses dark text against the pale hero surface.

    Legacy installs (and JS fallbacks) used white header text meant for a navy
    header band. Re-run when the v2 flag is missing so stored white values flip.
    """
    config = env["ir.config_parameter"].sudo()
    if config.get_param("willow_backend_theme_ent.header_colors_light_hero_v2"):
        return
    replacements = {
        "light_header_text_color": "#FFFFFF",
        "light_header_muted_color": "#BFC9D8",
        "dashboard_title_color": "#FFFFFF",
        "dashboard_subtitle_color": "#DCE5F3",
    }
    new_values = {
        "light_header_text_color": "#122033",
        "light_header_muted_color": "#5C6B7F",
        "dashboard_title_color": "#122033",
        "dashboard_subtitle_color": "#5C6B7F",
    }
    for key, old_value in replacements.items():
        param_key = f"willow_backend_theme_ent.{key}"
        current = (config.get_param(param_key) or "").strip().upper()
        if not current or current == old_value.upper():
            config.set_param(param_key, new_values[key])
    config.set_param("willow_backend_theme_ent.header_colors_migrated", "1")
    config.set_param("willow_backend_theme_ent.header_colors_light_hero_v2", "1")


def _migrate_theme_settings_v2(env):
    config = env["ir.config_parameter"].sudo()
    if config.get_param("willow_backend_theme_ent.settings_v2_migrated"):
        return
    fallbacks = {
        "dark_dashboard_primary_color": config.get_param(
            "willow_backend_theme_ent.dark_primary_color", "#6B8AFF"
        ),
        "dark_dashboard_title_color": config.get_param(
            "willow_backend_theme_ent.dark_header_text_color", "#F8FAFC"
        ),
        "dark_dashboard_subtitle_color": config.get_param(
            "willow_backend_theme_ent.dark_header_muted_color", "#A7B4C7"
        ),
        "light_preset": "willow",
        "dark_preset": "willow",
    }
    for key, value in fallbacks.items():
        param_key = f"willow_backend_theme_ent.{key}"
        if config.get_param(param_key) is None:
            config.set_param(param_key, value)
    config.set_param("willow_backend_theme_ent.settings_v2_migrated", "1")


def _repair_dashboard_primary_overwrite(env):
    """Fix dashboard primary stuck on default after legacy home_primary save overwrite.

    Older PROFILE_FIELDS listed home_primary_color after dashboard_primary_color, so
    get_settings → save rewrote dashboard primary back to the stale alias value
    (usually the Willow default) even when the UI had a new dashboard/preset color.
    """
    config = env["ir.config_parameter"].sudo()
    if config.get_param("willow_backend_theme_ent.dashboard_primary_overwrite_repaired"):
        return

    default_light = "#4F6EF7"
    default_dark = "#6B8AFF"
    repairs = (
        (
            "willow_backend_theme_ent.dashboard_primary_color",
            "willow_backend_theme_ent.light_primary_color",
            default_light,
        ),
        (
            "willow_backend_theme_ent.dark_dashboard_primary_color",
            "willow_backend_theme_ent.dark_primary_color",
            default_dark,
        ),
    )
    for dashboard_key, primary_key, default_value in repairs:
        dashboard = (config.get_param(dashboard_key) or default_value).strip().upper()
        primary = (config.get_param(primary_key) or default_value).strip().upper()
        if dashboard == default_value.upper() and primary != default_value.upper():
            config.set_param(dashboard_key, primary)

    config.set_param("willow_backend_theme_ent.dashboard_primary_overwrite_repaired", "1")


def _canonical_label(name):
    return "".join(character for character in (name or "").lower() if character.isalnum())


def _migrate_theme_xmlids(env):
    ir_model_data = env["ir.model.data"].sudo()
    for old_name, new_name in THEME_XMLID_RENAMES:
        if old_name == new_name:
            continue
        record = ir_model_data.search(
            [("module", "=", "willow_backend_theme_ent"), ("name", "=", old_name)],
            limit=1,
        )
        if not record:
            continue
        conflict = ir_model_data.search(
            [("module", "=", "willow_backend_theme_ent"), ("name", "=", new_name)],
            limit=1,
        )
        if conflict and conflict.res_id != record.res_id:
            conflict.unlink()
        record.name = new_name


def _migrate_home_config_keys(env):
    """Copy legacy willow_backend_theme_ent.home_* params onto dashboard_* keys."""
    config = env["ir.config_parameter"].sudo()
    if config.get_param("willow_backend_theme_ent.home_to_dashboard_keys_migrated"):
        return
    for old_suffix, new_suffix in HOME_TO_DASHBOARD_CONFIG_KEYS:
        old_key = f"willow_backend_theme_ent.{old_suffix}"
        new_key = f"willow_backend_theme_ent.{new_suffix}"
        old_value = config.get_param(old_key)
        if old_value is None:
            continue
        if config.get_param(new_key) is None:
            config.set_param(new_key, old_value)
    config.set_param("willow_backend_theme_ent.home_to_dashboard_keys_migrated", "1")


def _migrate_home_action_set_column(env):
    """Preserve res.users.willow_home_action_set values after the field rename."""
    cr = env.cr
    cr.execute(
        """
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'res_users'
           AND column_name = 'willow_home_action_set'
        """
    )
    if not cr.fetchone():
        return
    cr.execute(
        """
        SELECT 1
          FROM information_schema.columns
         WHERE table_name = 'res_users'
           AND column_name = 'willow_dashboard_action_set'
        """
    )
    if not cr.fetchone():
        return
    cr.execute(
        """
        UPDATE res_users
           SET willow_dashboard_action_set = TRUE
         WHERE COALESCE(willow_home_action_set, FALSE) IS TRUE
           AND COALESCE(willow_dashboard_action_set, FALSE) IS FALSE
        """
    )


def _get_dashboard_action(env):
    for xmlid in (
        "willow_backend_theme_ent.action_willow_dashboard",
        "willow_backend_theme_ent.action_willow_home",
    ):
        action = env.ref(xmlid, raise_if_not_found=False)
        if action:
            return action
    return env["ir.actions.client"]


def _get_default_favorite_menus(env):
    # Prefer xmlids only — English label ilike breaks once menus are translated.
    menus = env["ir.ui.menu"]
    for xmlid in DEFAULT_FAVORITE_MENU_XMLIDS:
        menu = env.ref(xmlid, raise_if_not_found=False)
        if menu and menu not in menus:
            menus |= menu
    return menus[:DEFAULT_FAVORITE_LIMIT]


def post_init_hook(env):
    _migrate_community_config_params(env)
    _migrate_theme_xmlids(env)
    _migrate_home_config_keys(env)
    _migrate_home_action_set_column(env)
    _migrate_legacy_light_header_colors(env)
    _migrate_theme_settings_v2(env)
    _repair_dashboard_primary_overwrite(env)
    _migrate_packaged_hero_images_to_svg(env)

    favorite_menus = _get_default_favorite_menus(env)
    if favorite_menus:
        users = env["res.users"].search([
            ("share", "=", False),
            ("willow_favorites_initialized", "=", False),
        ])
        users.write({
            "willow_favorite_menu_ids": [(6, 0, favorite_menus.ids)],
            "willow_favorites_initialized": True,
        })

    # Do not rewrite menu/action display names to English "Dashboard" —
    # that wipes ir.translation entries after localization is installed.
    home_action = _get_dashboard_action(env)
    if home_action and home_action.tag != WILLOW_DASHBOARD_ACTION_TAG:
        home_action.write({"tag": WILLOW_DASHBOARD_ACTION_TAG})

    admin_user = env.ref("base.user_admin", raise_if_not_found=False)
    if home_action and admin_user and not admin_user.action_id:
        admin_user.write({
            "action_id": home_action.id,
            "willow_dashboard_action_set": True,
        })


def uninstall_hook(env):
    home_action = _get_dashboard_action(env)
    if home_action:
        legacy_admin = env.ref("base.user_admin", raise_if_not_found=False)
        users = env["res.users"].search([
            ("willow_dashboard_action_set", "=", True),
            ("action_id", "=", home_action.id),
        ])
        if legacy_admin and legacy_admin.action_id == home_action:
            users |= legacy_admin
        users.write({
            "action_id": False,
            "willow_dashboard_action_set": False,
        })

    env["ir.config_parameter"].sudo().search([
        ("key", "=like", "willow_backend_theme_ent.%"),
    ]).unlink()
