from odoo import api, fields, models


class ResUsers(models.Model):
    _inherit = "res.users"

    @property
    def SELF_READABLE_FIELDS(self):
        return super().SELF_READABLE_FIELDS + ["chatter_position", "willow_theme_mode"]

    @property
    def SELF_WRITEABLE_FIELDS(self):
        return super().SELF_WRITEABLE_FIELDS + ["chatter_position", "willow_theme_mode"]

    chatter_position = fields.Selection(
        selection=[
            ("side", "Side"),
            ("bottom", "Bottom"),
        ],
        string="Chatter Position",
        default="side",
        required=True,
    )
    willow_theme_mode = fields.Selection(
        selection=[
            ("light", "Light"),
            ("dark", "Dark"),
            ("system", "System"),
        ],
        string="Willow Appearance",
        help="Leave empty on upgraded users to preserve their existing Willow browser preference.",
    )
    willow_favorite_menu_ids = fields.Many2many(
        "ir.ui.menu",
        "willow_user_favorite_menu_rel",
        "user_id",
        "menu_id",
        string="Willow Favorite Menus",
    )
    willow_favorites_initialized = fields.Boolean(default=False)
    willow_dashboard_action_set = fields.Boolean(default=False)

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if "color_scheme" in vals and "willow_theme_mode" not in vals:
                vals["willow_theme_mode"] = vals["color_scheme"]
            if "color_scheme" not in self._fields:
                vals.pop("color_scheme", None)
            elif "willow_theme_mode" in vals and "color_scheme" not in vals:
                vals["color_scheme"] = vals["willow_theme_mode"]
        return super().create(vals_list)

    def write(self, vals):
        vals = dict(vals)
        if "color_scheme" in vals and "willow_theme_mode" not in vals:
            vals["willow_theme_mode"] = vals["color_scheme"]
        if "color_scheme" not in self._fields:
            vals.pop("color_scheme", None)
        elif "willow_theme_mode" in vals and "color_scheme" not in vals:
            vals["color_scheme"] = vals["willow_theme_mode"]
        return super().write(vals)

    @api.model
    def _willow_visible_root_menu_ids(self):
        return set(self.env["ir.ui.menu"].get_user_roots().ids)

    @api.model
    def _willow_visible_favorite_menus(self):
        visible_root_menu_ids = self._willow_visible_root_menu_ids()
        return self.env.user.sudo().willow_favorite_menu_ids.filtered(
            lambda menu: menu.id in visible_root_menu_ids
        )

    @api.model
    def willow_toggle_favorite_menu(self, menu_id):
        menu_id = int(menu_id or 0)
        visible_root_menu_ids = self._willow_visible_root_menu_ids()
        if menu_id not in visible_root_menu_ids:
            return self.env.user.willow_get_favorite_menu_ids()

        menu = self.env["ir.ui.menu"].browse(menu_id).exists()
        if not menu:
            return self.env.user.willow_get_favorite_menu_ids()

        current_user_sudo = self.env.user.sudo()
        visible_favorites = current_user_sudo.willow_favorite_menu_ids.filtered(
            lambda favorite_menu: favorite_menu.id in visible_root_menu_ids
        )
        if menu.id in visible_favorites.ids:
            current_user_sudo.write({"willow_favorite_menu_ids": [(3, menu.id)]})
        else:
            current_user_sudo.write({"willow_favorite_menu_ids": [(4, menu.id)]})
        return self.env.user.willow_get_favorite_menu_ids()

    def willow_get_favorite_menu_ids(self):
        self.ensure_one()
        return self._willow_visible_favorite_menus().ids


class ResUsersSettings(models.Model):
    _inherit = "res.users.settings"

    def set_res_users_settings(self, new_settings):
        res = super().set_res_users_settings(new_settings)
        if "color_scheme" in new_settings:
            mode = new_settings["color_scheme"]
            if mode in ("light", "dark", "system"):
                self.env.user.sudo().write({"willow_theme_mode": mode})
        return res
