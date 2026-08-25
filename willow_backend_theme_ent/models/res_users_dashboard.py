from datetime import date
from urllib.parse import urlparse

from odoo import _, api, models
from odoo.modules.module import get_manifest
from odoo.tools.misc import format_date

from .willow_dashboard_widgets import WillowBusinessDashboardBuilder, WillowDashboardDataBuilder


class ResUsers(models.Model):
    _inherit = "res.users"

    @api.model
    def get_willow_dashboard_data(self, period="6w"):
        data = WillowDashboardDataBuilder(self.env, period=period).build()
        try:
            biz = WillowBusinessDashboardBuilder(self.env).build()
            if biz:
                data["business_dashboard"] = biz
        except Exception:
            pass
        return data

    @api.model
    def get_willow_home_data(self, period="6w"):
        """Legacy RPC alias kept for bookmarks / older JS."""
        return self.get_willow_dashboard_data(period=period)

    @api.model
    def get_willow_dashboard_footer_data(self):
        user = self.env.user
        company = self.env.company.sudo()
        config = self.env["ir.config_parameter"].sudo()

        base_url = config.get_param("web.base.url", default="") or ""
        hostname = (urlparse(base_url).hostname or "").lower()
        db_name = self.env.cr.dbname
        fingerprint = f"{hostname} {db_name}".lower()
        environment = (config.get_param("willow_backend_theme_ent.environment", default="") or "").strip().lower()
        if environment not in {"production", "staging", "development"}:
            if any(token in fingerprint for token in ("stag", "stage", "uat", "preprod", "sandbox", "qa")):
                environment = "staging"
            elif any(token in fingerprint for token in ("dev", "test", "local", "demo")):
                environment = "development"
            else:
                environment = "production"
        environment_labels = {
            "production": _("Production"),
            "staging": _("Staging"),
            "development": _("Development"),
        }
        environment_label = environment_labels.get(environment, environment.capitalize())

        fiscal_period = format_date(self.env, date.today())
        if "fiscalyear_last_day" in company._fields and "fiscalyear_last_month" in company._fields:
            fiscal_dates = company.compute_fiscalyear_dates(date.today())
            fiscal_period = "{} - {}".format(
                format_date(self.env, fiscal_dates["date_from"]),
                format_date(self.env, fiscal_dates["date_to"]),
            )

        support_contact = (
            config.get_param("willow_backend_theme_ent.support_contact", default="")
            or company.partner_id.email
            or company.partner_id.phone
            or ""
        )
        build_version = config.get_param("willow_backend_theme_ent.build_version", default="") or ""

        theme_version = get_manifest("willow_backend_theme_ent").get("version", "")

        can_open_users = self.env["res.users"].check_access_rights("read", raise_exception=False)
        can_open_scheduled_actions = self.env["ir.cron"].check_access_rights("read", raise_exception=False) and user._is_system()
        can_open_settings = user._is_admin() or user._is_system()
        can_toggle_debug = user._is_internal()

        if user._is_system():
            role_label = _("Administrator")
        elif user._is_admin():
            role_label = _("Access Rights")
        elif user._is_internal():
            role_label = _("Internal User")
        else:
            role_label = _("Portal User")

        footer_data = {
            "company_name": company.name,
            "database_name": db_name,
            "user_name": user.name,
            "role_label": role_label,
            "environment": {
                "key": environment,
                "label": environment_label,
            },
            "fiscal_period": fiscal_period,
            "timezone": user.tz or "UTC",
            "locale": user.lang or "en_US",
            "odoo_version": self.env["ir.http"].session_info().get("server_version", "Odoo"),
            "theme_version": theme_version,
            "build_version": build_version,
            "support_contact": support_contact,
            "quick_links": {
                "settings": can_open_settings,
                "users": can_open_users,
                "scheduled_actions": can_open_scheduled_actions,
                "developer_mode": can_toggle_debug,
            },
            "system_status": {
                "background_jobs": None,
                "mail_queue": None,
                "integrations": None,
            },
        }

        if user._is_admin() or user._is_system():
            footer_data["system_status"] = {
                "background_jobs": self.env["ir.cron"].sudo().search_count([("active", "=", True)]),
                "mail_queue": self.env["mail.mail"].sudo().search_count(
                    [("state", "in", ["outgoing", "exception"])]
                ),
                "integrations": self.env.registry.get("payment.provider")
                and self.env["payment.provider"].sudo().search_count([("state", "=", "enabled")])
                or None,
            }

        return footer_data

    @api.model
    def get_willow_home_footer_data(self):
        """Legacy RPC alias kept for bookmarks / older JS."""
        return self.get_willow_dashboard_footer_data()
