# -*- coding: utf-8 -*-

import logging
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timedelta

from odoo import _, fields
from odoo.tools.misc import format_amount, format_date, format_datetime

_logger = logging.getLogger(__name__)

RESERVED_MENU_KEYS = {
    "apps",
    "settings",
    "parametres",
    "home",
    "dashboard",
    "dashboards",
    "tableaudebord",
    "tableauxdebord",
    "willowdashboard",
    "spreadsheet",
}

APP_KEY_ALIASES = {
    "sale_management": "sale",
    "stock": "inventory",
    "hr": "employees",
    "hr_holidays": "employees",
    "hr_recruitment": "employees",
}

# English names are source msgids; translate at use-time via _module_name().
MODULE_CONFIGS = [
    {"key": "sale", "app_keys": ["sale", "sale_management"], "name": "Sales", "model_prefixes": ["sale.", "sale_", "crm.team"]},
    {"key": "crm", "app_keys": ["crm"], "name": "CRM", "model_prefixes": ["crm."]},
    {"key": "purchase", "app_keys": ["purchase"], "name": "Purchase", "model_prefixes": ["purchase."]},
    {"key": "inventory", "app_keys": ["stock"], "name": "Inventory", "model_prefixes": ["stock."]},
    {"key": "account", "app_keys": ["account"], "name": "Accounting", "model_prefixes": ["account."]},
    {"key": "project", "app_keys": ["project", "project_todo"], "name": "Project", "model_prefixes": ["project."]},
    {"key": "employees", "app_keys": ["hr", "hr_holidays", "hr_recruitment"], "name": "HR", "model_prefixes": ["hr.", "hr_", "resource."]},
    {"key": "contacts", "app_keys": ["contacts"], "name": "Contacts", "model_prefixes": ["res.partner"]},
]

MODULE_PRIMARY_MODEL = {
    "sale": "sale.order",
    "crm": "crm.lead",
    "purchase": "purchase.order",
    "inventory": "stock.picking",
    "account": "account.move",
    "project": "project.task",
    "employees": "hr.employee",
    "contacts": "res.partner",
}


def canonical_menu_key(name):
    normalized = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()
    return "".join(character for character in normalized.lower() if character.isalnum())


def is_reserved_menu(menu, xmlid=""):
    key = canonical_menu_key(menu.name)
    return key in RESERVED_MENU_KEYS or xmlid in (
        "willow_backend_theme_ent.menu_willow_dashboard",
        "willow_backend_theme_ent.menu_willow_home",
        "base.menu_administration",
        "spreadsheet_dashboard.spreadsheet_dashboard_menu_root",
    )


def module_key_from_model(model_name):
    normalized = (model_name or "").lower()
    for config in MODULE_CONFIGS:
        if any(normalized.startswith(prefix) for prefix in config["model_prefixes"]):
            return config["key"]
    return None


def module_key_from_app_xmlid(xmlid):
    if not xmlid:
        return None
    app_key = xmlid.split(".")[0]
    return APP_KEY_ALIASES.get(app_key, app_key)


def _module_display_name(config):
    """Translate MODULE_CONFIGS English name at call time (correct lang)."""
    if not config:
        return ""
    return _(config["name"])


class WillowDashboardDataBuilder:
    """Builds permission-safe home page payloads for the current user."""

    def __init__(self, env, period="6w"):
        self.env = env
        self.user = env.user
        self.uid = env.user.id
        self.period = period if period in {"6w", "12w"} else "6w"
        self.today = fields.Date.context_today(self.user)
        self.today_str = fields.Date.to_string(self.today)
        self._installed_modules = None
        self._activity_rows = None

    def _installed_module_names(self):
        if self._installed_modules is None:
            modules = self.env["ir.module.module"].sudo().search([
                ("state", "=", "installed"),
            ])
            self._installed_modules = set(modules.mapped("name"))
        return self._installed_modules

    def _module_installed(self, module_names):
        installed = self._installed_module_names()
        return any(name in installed for name in module_names)

    def _can_read(self, model_name):
        if model_name not in self.env:
            return False
        try:
            return bool(self.env[model_name].has_access("read"))
        except Exception:
            return False

    def _safe_search_count(self, model_name, domain):
        if not self._can_read(model_name):
            return None
        try:
            return self.env[model_name].search_count(domain)
        except Exception as exc:
            _logger.debug("willow home search_count failed on %s: %s", model_name, exc)
            return None

    def _safe_search_read(self, model_name, domain, fields_list, limit=10, order=None):
        if not self._can_read(model_name):
            return []
        try:
            return self.env[model_name].search_read(
                domain,
                fields_list,
                limit=limit,
                order=order or "id desc",
            )
        except Exception as exc:
            _logger.debug("willow home search_read failed on %s: %s", model_name, exc)
            return []

    def _action_xmlid(self, *xmlids):
        for xmlid in xmlids:
            if not xmlid:
                continue
            action = self.env.ref(xmlid, raise_if_not_found=False)
            if action:
                return xmlid
        return None

    def _week_start(self, weeks_ago=0):
        day = self.today - timedelta(days=self.today.weekday() + weeks_ago * 7)
        return day

    def _date_label(self):
        return format_date_label(self.env, self.today)

    def _user_activity_rows(self):
        """Load the current user's open activities once for cards/charts/lists."""
        if self._activity_rows is not None:
            return self._activity_rows
        if not self._can_read("mail.activity"):
            self._activity_rows = []
            return self._activity_rows
        weeks = 6 if self.period == "6w" else 12
        chart_start = self._week_start(weeks - 1)
        rows = self._safe_search_read(
            "mail.activity",
            self._activity_base_domain() + [
                ("date_deadline", ">=", fields.Date.to_string(chart_start - timedelta(days=60))),
            ],
            ["id", "summary", "res_model", "res_id", "date_deadline"],
            limit=1000,
            order="date_deadline asc, id asc",
        )
        self._activity_rows = rows
        return rows

    def build_header(self):
        company = self.env.company
        return {
            "user_name": self.user.name or "",
            "company_name": company.name or "",
            "date_label": self._date_label(),
            "today": self.today_str,
        }

    def _activity_base_domain(self):
        return [("user_id", "=", self.uid)]

    def build_summary_cards(self):
        if not self._can_read("mail.activity"):
            return []

        today_str = self.today_str
        week_end = fields.Date.to_string(self.today + timedelta(days=6))
        rows = self._user_activity_rows()
        due_today = overdue = this_week = 0
        for row in rows:
            deadline = _coerce_date(row.get("date_deadline"))
            if not deadline:
                continue
            if deadline == self.today:
                due_today += 1
            if deadline < self.today:
                overdue += 1
            if self.today <= deadline <= self.today + timedelta(days=6):
                this_week += 1

        waiting = self._count_waiting_on_user()
        open_total = len(rows)
        action_xmlid = self._action_xmlid("mail.mail_activity_action_my")
        week_upcoming = max(this_week - due_today, 0)

        def _share(value, base):
            if not base:
                return 0
            return int(round(min(100, max(0, (value / base) * 100))))

        card_defs = [
            (
                "due_today",
                _("Due today"),
                due_today,
                _("Scheduled for today"),
                (
                    _("%(due)s of %(week)s this week") % {"due": due_today, "week": this_week}
                    if this_week
                    else _("Nothing else due this week")
                ),
                "fa-calendar-check-o",
                _share(due_today, this_week or open_total or 1),
                False,
                [("date_deadline", "=", today_str)],
            ),
            (
                "overdue",
                _("Overdue"),
                overdue,
                _("Past due date"),
                (
                    _("%(pct)s%% of your open work") % {"pct": _share(overdue, open_total)}
                    if open_total
                    else _("You're caught up")
                ),
                "fa-exclamation-circle",
                _share(overdue, open_total or 1),
                True,
                [("date_deadline", "<", today_str)],
            ),
            (
                "this_week",
                _("This week"),
                this_week,
                _("Due in the next 7 days"),
                _("%(today)s today · %(upcoming)s upcoming") % {
                    "today": due_today,
                    "upcoming": week_upcoming,
                },
                "fa-calendar",
                _share(this_week, open_total or 1),
                False,
                [
                    ("date_deadline", ">=", today_str),
                    ("date_deadline", "<=", week_end),
                ],
            ),
            (
                "waiting_on_you",
                _("Waiting on you"),
                waiting,
                _("Approvals and items needing your decision"),
                _("Needs your review") if waiting else _("Inbox clear"),
                "fa-handshake-o",
                100 if waiting else 0,
                waiting > 0,
                [],
            ),
        ]
        cards = []
        for key, label, value, meta, secondary, icon, share_pct, urgent, domain in card_defs:
            card_action = action_xmlid
            card_domain = domain
            if key == "waiting_on_you":
                card_action = self._waiting_action_xmlid() or action_xmlid
                card_domain = self._waiting_action_domain()
            cards.append({
                "key": key,
                "label": label,
                "value": value or 0,
                "meta": meta,
                "secondary": secondary,
                "icon": icon,
                "share_pct": share_pct,
                "urgent": bool(urgent and value),
                "visible": True,
                "action_xmlid": card_action,
                "domain": card_domain,
            })
        return cards

    def _waiting_action_xmlid(self):
        if self._module_installed(["approvals"]):
            return self._action_xmlid(
                "approvals.approval_request_action_to_review",
                "approvals.approval_request_action",
            )
        if self._module_installed(["purchase"]):
            return self._action_xmlid("purchase.purchase_form_action", "purchase.purchase_rfq")
        return None

    def _waiting_action_domain(self):
        if self._module_installed(["approvals"]) and self._can_read("approval.request"):
            return [("request_status", "=", "pending")]
        if self._module_installed(["purchase"]) and self._can_read("purchase.order"):
            return [("state", "=", "to approve")]
        return []

    def _count_waiting_on_user(self):
        """Approvals / PO approvals awaiting this user — not overdue activities."""
        total = 0
        if self._module_installed(["approvals"]) and self._can_read("approval.request"):
            Approval = self.env["approval.request"]
            domains = []
            if "request_status" in Approval._fields:
                status_domain = [("request_status", "=", "pending")]
            elif "status" in Approval._fields:
                status_domain = [("status", "=", "pending")]
            else:
                status_domain = []
            if "approver_ids" in Approval._fields:
                domains.append(status_domain + [("approver_ids.user_id", "=", self.uid)])
                domains.append(status_domain + [("approver_ids", "in", self.user.partner_id.ids)])
            elif "user_ids" in Approval._fields:
                domains.append(status_domain + [("user_ids", "in", [self.uid])])
            for domain in domains:
                try:
                    total = max(total, Approval.search_count(domain))
                    if total:
                        break
                except Exception:
                    continue
        if self._module_installed(["purchase"]) and self._can_read("purchase.order"):
            try:
                total += self.env["purchase.order"].search_count([
                    ("state", "=", "to approve"),
                    ("company_id", "in", self.env.companies.ids),
                ])
            except Exception:
                pass
        return total

    def build_pills(self):
        return []

    def build_activity_chart(self):
        weeks = 6 if self.period == "6w" else 12
        labels = []
        values = []
        overdue_values = []
        buckets = []
        for week_index in range(weeks - 1, -1, -1):
            start = self._week_start(week_index)
            end = start + timedelta(days=7)
            labels.append(format_date(self.env, start, date_format="MMM dd"))
            buckets.append((start, end, 0, 0))

        for row in self._user_activity_rows():
            deadline = _coerce_date(row.get("date_deadline"))
            if not deadline:
                continue
            for index, (start, end, due_count, overdue_count) in enumerate(buckets):
                if start <= deadline < end:
                    due_count += 1
                    if deadline < self.today:
                        overdue_count += 1
                    buckets[index] = (start, end, due_count, overdue_count)
                    break

        for _start, _end, due_count, overdue_count in buckets:
            values.append(due_count)
            overdue_values.append(overdue_count)

        return {
            "labels": labels,
            "values": values,
            "overdue_values": overdue_values,
            "period": self.period,
            "period_label": _("Last 6 weeks") if self.period == "6w" else _("Last 12 weeks"),
            "chart_title": _("Your activity over time"),
            "subtitle": _("Due and overdue activity trend"),
        }

    def build_week_glance(self):
        days = []
        week_start = self.today - timedelta(days=self.today.weekday())
        counts = defaultdict(int)
        for row in self._user_activity_rows():
            deadline = _coerce_date(row.get("date_deadline"))
            if not deadline:
                continue
            if week_start <= deadline < week_start + timedelta(days=7):
                counts[fields.Date.to_string(deadline)] += 1

        for offset in range(7):
            day = week_start + timedelta(days=offset)
            day_str = fields.Date.to_string(day)
            count = counts.get(day_str, 0)
            # Past days are overdue; today/future are still due.
            if day < self.today:
                due, overdue = 0, count
            else:
                due, overdue = count, 0
            days.append({
                "label": format_date(self.env, day, date_format="EEE"),
                "date": day_str,
                "due": due,
                "done": 0,
                "overdue": overdue,
            })
        return days

    def _attention_widget_defs(self):
        uid = self.uid
        return [
            {
                "app_key": "sale",
                "app_name": _("Sales"),
                "label": _("Quotations to send"),
                "model": "sale.order",
                "domain": [("state", "in", ["draft", "sent"]), ("user_id", "=", uid)],
                "action_xmlid": "sale.action_quotations_with_onboarding",
                "modules": ["sale", "sale_management"],
                "urgent": False,
            },
            {
                "app_key": "sale",
                "app_name": _("Sales"),
                "label": _("Orders to process"),
                "model": "sale.order",
                "domain": [("state", "=", "sale"), ("user_id", "=", uid)],
                "action_xmlid": "sale.action_orders",
                "modules": ["sale", "sale_management"],
                "urgent": False,
            },
            {
                "app_key": "crm",
                "app_name": _("CRM"),
                "label": _("Leads assigned to me"),
                "model": "crm.lead",
                "domain": [("active", "=", True), ("user_id", "=", uid)],
                "action_xmlid": "crm.crm_lead_all_leads",
                "modules": ["crm"],
                "urgent": False,
            },
            {
                "app_key": "purchase",
                "app_name": _("Purchase"),
                "label": _("RFQs in draft"),
                "model": "purchase.order",
                "domain": [("state", "=", "draft"), ("user_id", "=", uid)],
                "action_xmlid": "purchase.purchase_rfq",
                "modules": ["purchase"],
                "urgent": False,
            },
            {
                "app_key": "inventory",
                "app_name": _("Inventory"),
                "label": _("Transfers ready"),
                "model": "stock.picking",
                "domain": [("state", "=", "assigned")],
                "action_xmlid": "stock.action_picking_tree_ready",
                "modules": ["stock"],
                "urgent": False,
            },
            {
                "app_key": "account",
                "app_name": _("Accounting"),
                "label": _("Unpaid customer invoices"),
                "model": "account.move",
                "domain": [
                    ("move_type", "=", "out_invoice"),
                    ("state", "=", "posted"),
                    ("payment_state", "in", ["not_paid", "partial"]),
                    ("invoice_user_id", "=", uid),
                ],
                "action_xmlid": "account.action_move_out_invoice_type",
                "modules": ["account"],
                "urgent": True,
            },
            {
                "app_key": "project",
                "app_name": _("Project"),
                "label": _("Tasks due this week"),
                "model": "project.task",
                "domain": [
                    ("user_ids", "in", [uid]),
                    ("date_deadline", "<=", fields.Date.to_string(self.today + timedelta(days=7))),
                ],
                "action_xmlid": "project.action_view_task",
                "modules": ["project"],
                "urgent": False,
            },
        ]

    def build_attention_groups(self):
        groups_map = {}
        for widget in self._attention_widget_defs():
            if not self._module_installed(widget["modules"]):
                continue
            action_xmlid = self._action_xmlid(widget["action_xmlid"])
            if not action_xmlid:
                # Fallbacks for renamed/missing xmlids
                fallbacks = {
                    "sale.action_quotations_with_onboarding": (
                        "sale.action_quotations",
                        "sale.action_orders",
                    ),
                    "sale.action_orders": ("sale.action_quotations",),
                }
                action_xmlid = self._action_xmlid(*fallbacks.get(widget["action_xmlid"], ()))
            if not action_xmlid:
                continue
            count = self._safe_search_count(widget["model"], widget["domain"])
            if count is None:
                continue
            if not count:
                continue
            group = groups_map.setdefault(widget["app_key"], {
                "app_key": widget["app_key"],
                "app_name": widget["app_name"],
                "items": [],
            })
            group["items"].append({
                "key": f"{widget['app_key']}_{widget['label']}".replace(" ", "_").lower(),
                "label": widget["label"],
                "count": count,
                "action_xmlid": action_xmlid,
                "urgent": widget["urgent"] and count > 0,
                "domain": widget["domain"],
            })
        return [group for group in groups_map.values() if group["items"]]

    def build_open_by_app_chart(self, attention_groups):
        chart = []
        activity_counts = self._activity_counts_by_app_key()
        seen = set()
        for group in attention_groups:
            app_key = group["app_key"]
            count = sum(item["count"] for item in group["items"])
            if count <= 0:
                continue
            chart.append({
                "app_key": app_key,
                "app_name": group["app_name"],
                "count": count,
            })
            seen.add(app_key)
        for app_key, count in activity_counts.items():
            if app_key in seen or count <= 0:
                continue
            config = next((c for c in MODULE_CONFIGS if c["key"] == app_key), None)
            if not config:
                continue
            chart.append({
                "app_key": app_key,
                "app_name": _module_display_name(config),
                "count": count,
            })
        chart.sort(key=lambda row: row["count"], reverse=True)
        return [row for row in chart[:8] if row["count"] > 0]

    def _activity_counts_by_app_key(self):
        counts = {}
        for activity in self._user_activity_rows():
            app_key = module_key_from_model(activity.get("res_model"))
            if app_key:
                counts[app_key] = counts.get(app_key, 0) + 1
        return counts

    def build_activities(self):
        result = []
        for row in self._user_activity_rows()[:12]:
            app_key = module_key_from_model(row.get("res_model"))
            config = next((c for c in MODULE_CONFIGS if c["key"] == app_key), None)
            deadline_date = _coerce_date(row.get("date_deadline"))
            deadline_str = fields.Date.to_string(deadline_date) if deadline_date else ""
            result.append({
                "id": row["id"],
                "summary": row.get("summary") or row.get("res_model") or _("Activity"),
                "res_model": row.get("res_model"),
                "res_id": row.get("res_id"),
                "due_label": deadline_str,
                "overdue": bool(deadline_date and deadline_date < self.today),
                "app_label": _module_display_name(config) if config else "",
                "action_xmlid": self._action_xmlid("mail.mail_activity_action_my"),
            })
        return result

    def build_recent_items(self):
        items = []
        for app_key, model_name in MODULE_PRIMARY_MODEL.items():
            config = next((c for c in MODULE_CONFIGS if c["key"] == app_key), None)
            if not config or not self._module_installed(config["app_keys"]):
                continue
            if model_name not in self.env or "name" not in self.env[model_name]._fields:
                continue
            read_fields = ["id", "name", "write_date"]
            rows = self._safe_search_read(
                model_name,
                [("write_uid", "=", self.uid)],
                read_fields,
                limit=3,
                order="write_date desc",
            )
            for row in rows:
                write_date = row.get("write_date") or ""
                items.append({
                    "id": row["id"],
                    "name": row.get("name") or model_name,
                    "model": model_name,
                    "app_label": _module_display_name(config),
                    "write_date": write_date,
                    "write_date_label": format_datetime_label(self.env, write_date),
                })
        items.sort(key=lambda item: item.get("write_date") or "", reverse=True)
        return items[:8]

    def build_apps(self):
        menus = self.env["ir.ui.menu"].get_user_roots()
        xmlids = menus._get_menuitems_xmlids()
        activity_by_key = self._activity_counts_by_app_key()
        overdue_by_key = self._overdue_activity_counts_by_app_key()
        apps = []
        for menu in menus:
            xmlid = xmlids.get(menu.id, "")
            if is_reserved_menu(menu, xmlid):
                continue
            app_key = module_key_from_app_xmlid(xmlid)
            apps.append({
                "menu_id": menu.id,
                "name": menu.name,
                "app_key": app_key or "",
                "open_count": activity_by_key.get(app_key, 0) if app_key else 0,
                "overdue_count": overdue_by_key.get(app_key, 0) if app_key else 0,
            })
        return apps

    def _overdue_activity_counts_by_app_key(self):
        counts = {}
        for activity in self._user_activity_rows():
            deadline = _coerce_date(activity.get("date_deadline"))
            if not deadline or deadline >= self.today:
                continue
            app_key = module_key_from_model(activity.get("res_model"))
            if app_key:
                counts[app_key] = counts.get(app_key, 0) + 1
        return counts

    def build_upcoming(self):
        items = []
        today_str = self.today_str

        if self._module_installed(["calendar"]) and self._can_read("calendar.event"):
            events = self._safe_search_read(
                "calendar.event",
                [
                    ("start", ">=", f"{today_str} 00:00:00"),
                    "|",
                    ("user_id", "=", self.uid),
                    ("partner_ids", "in", self.user.partner_id.ids),
                ],
                ["id", "name", "start", "stop"],
                limit=8,
                order="start asc",
            )
            for event in events:
                start_val = event.get("start")
                start_date = _coerce_date(start_val)
                scope = "deadlines"
                if start_date == self.today:
                    scope = "today"
                elif start_date and start_date <= self.today + timedelta(days=6):
                    scope = "week"
                items.append({
                    "key": f"event_{event['id']}",
                    "label": event.get("name") or _("Meeting"),
                    "datetime_label": format_datetime_label(self.env, start_val),
                    "sort_key": _sort_key(start_val),
                    "kind": "calendar",
                    "scope": scope,
                    "res_model": "calendar.event",
                    "res_id": event["id"],
                    "action_xmlid": self._action_xmlid("calendar.action_calendar_event"),
                })

        for activity in self._user_activity_rows():
            deadline = _coerce_date(activity.get("date_deadline"))
            if not deadline or deadline < self.today:
                continue
            if deadline > self.today + timedelta(days=14):
                continue
            if deadline == self.today:
                scope = "today"
            elif deadline <= self.today + timedelta(days=6):
                scope = "week"
            else:
                scope = "deadlines"
            items.append({
                "key": f"activity_{activity['id']}",
                "label": activity.get("summary") or _("Activity"),
                "datetime_label": format_date_label(self.env, deadline),
                "sort_key": _sort_key(deadline),
                "kind": "activity",
                "scope": scope,
                "res_model": activity.get("res_model"),
                "res_id": activity.get("res_id"),
                "action_xmlid": self._action_xmlid("mail.mail_activity_action_my"),
            })

        items.sort(key=lambda item: item.get("sort_key") or "")
        for item in items:
            item.pop("sort_key", None)
        return items[:8]

    def build_summary_text(self, summary_cards, attention_groups):
        overdue = next((c["value"] for c in summary_cards if c["key"] == "overdue"), 0)
        due_today = next((c["value"] for c in summary_cards if c["key"] == "due_today"), 0)
        parts = []
        if overdue:
            parts.append(
                _("You have %(count)s overdue activity.") % {"count": overdue}
                if overdue == 1
                else _("You have %(count)s overdue activities.") % {"count": overdue}
            )
        elif due_today:
            parts.append(
                _("You have %(count)s activity due today.") % {"count": due_today}
                if due_today == 1
                else _("You have %(count)s activities due today.") % {"count": due_today}
            )
        else:
            parts.append(_("You are up to date. Nothing overdue right now."))
        if attention_groups:
            top = max(attention_groups, key=lambda g: sum(i["count"] for i in g["items"]))
            total = sum(item["count"] for item in top["items"])
            if total:
                parts.append(
                    _("%(app)s has the most open items (%(count)s).")
                    % {"app": top["app_name"], "count": total}
                )
        return " ".join(parts)

    def build_quick_links(self):
        settings_action = self._action_xmlid(
            "base_setup.action_general_configuration",
            "base.action_res_config_settings",
        )
        links = [
            {
                "key": "activities",
                "label": _("My activities"),
                "action_xmlid": self._action_xmlid("mail.mail_activity_action_my"),
                "visible": bool(self._action_xmlid("mail.mail_activity_action_my")),
            },
            {
                "key": "calendar",
                "label": _("My calendar"),
                "action_xmlid": self._action_xmlid("calendar.action_calendar_event"),
                "visible": bool(
                    self._module_installed(["calendar"])
                    and self._action_xmlid("calendar.action_calendar_event")
                ),
            },
            {
                "key": "discuss",
                "label": _("Discuss inbox"),
                "action_xmlid": self._action_xmlid("mail.action_discuss"),
                "visible": bool(self._action_xmlid("mail.action_discuss")),
            },
            {
                "key": "settings",
                "label": _("Settings"),
                "action_xmlid": settings_action,
                "visible": bool(settings_action) and (self.user._is_admin() or self.user._is_system()),
            },
        ]
        return [link for link in links if link["visible"] and link.get("action_xmlid")]

    def build(self):
        attention_groups = self.build_attention_groups()
        summary_cards = self.build_summary_cards()
        spreadsheet_dashboard_available = bool(
            self._module_installed(["spreadsheet_dashboard"])
            and self.env.ref(
                "spreadsheet_dashboard.ir_actions_dashboard_action",
                raise_if_not_found=False,
            )
        )
        return {
            "header": self.build_header(),
            "today": self.today_str,
            "summary_cards": summary_cards,
            "pills": self.build_pills(),
            "activity_chart": self.build_activity_chart(),
            "week_glance": self.build_week_glance(),
            "attention_groups": attention_groups,
            "open_by_app_chart": self.build_open_by_app_chart(attention_groups),
            "activities": self.build_activities(),
            "recent_items": self.build_recent_items(),
            "apps": self.build_apps(),
            "upcoming": self.build_upcoming(),
            "summary": {"text": self.build_summary_text(summary_cards, attention_groups)},
            "quick_links": self.build_quick_links(),
            "spreadsheet_dashboard_available": spreadsheet_dashboard_available,
            "refreshed_at": fields.Datetime.now().isoformat(),
        }


def _coerce_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        return fields.Date.from_string(value[:10])
    return None


def _sort_key(value):
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def format_date_label(env, value):
    if not value:
        return ""
    try:
        return format_date(env, value)
    except Exception:
        return str(value)


def format_datetime_label(env, value):
    if not value:
        return ""
    try:
        if isinstance(value, date) and not isinstance(value, datetime):
            return format_date(env, value)
        if isinstance(value, str) and len(value) <= 10:
            return format_date(env, fields.Date.from_string(value[:10]))
        return format_datetime(env, value)
    except Exception:
        if isinstance(value, str):
            return value[:16].replace("T", " ")
        if isinstance(value, datetime):
            return value.strftime("%Y-%m-%d %H:%M")
        return str(value)


# ── Business Dashboard ────────────────────────────────────────────────────────

_INVOICE_STATUS_LABELS = {
    "not_paid": ("Unpaid", "unpaid"),
    "partial": ("Partial", "partial"),
    "in_payment": ("In Payment", "in_payment"),
    "paid": ("Paid", "paid"),
    "reversed": ("Reversed", "reversed"),
    "cancelled": ("Cancelled", "cancelled"),
}

_SALE_STATE_LABELS = {
    "draft": ("Quotation", "draft"),
    "sent": ("Sent", "sent"),
    "sale": ("Confirmed", "confirmed"),
    "done": ("Done", "done"),
    "cancel": ("Cancelled", "cancelled"),
}

_PURCHASE_STATE_LABELS = {
    "draft": ("RFQ", "draft"),
    "sent": ("RFQ Sent", "sent"),
    "to approve": ("To Approve", "to_approve"),
    "purchase": ("Purchase Order", "confirmed"),
    "done": ("Done", "done"),
    "cancel": ("Cancelled", "cancelled"),
}


def _translate_status_label(label):
    """Translate English status msgid at use-time."""
    return _(label) if label else label

class WillowBusinessDashboardBuilder:
    """
    Builds the permission-aware business dashboard payload.

    Each build_* method returns its widget dict or None when the
    user lacks access, the module is absent, or the menu is not visible.
    Missing keys in the final payload mean 'not available'; the frontend
    must not attempt to fill them in.
    """

    def __init__(self, env):
        self.env = env
        self.user = env.user
        self.uid = env.user.id
        self.today = fields.Date.context_today(self.user)
        self.active_company = env.company
        self.active_currency = env.company.currency_id
        self._installed = None
        self._visible_menus = None

    # ── module / access helpers ───────────────────────────────────────────────

    def _modules(self):
        if self._installed is None:
            self._installed = set(
                self.env["ir.module.module"]
                .sudo()
                .search([("state", "=", "installed")])
                .mapped("name")
            )
        return self._installed

    def _mod(self, *names):
        installed = self._modules()
        return any(n in installed for n in names)

    def _mods_all(self, *names):
        installed = self._modules()
        return all(n in installed for n in names)

    def _app_ready(self, modules=(), model=None, menus=(), actions=(), require_all_modules=False):
        """
        Return True when module(s), optional model read access, and optional
        menu/action visibility requirements are satisfied for the current user.
        When both menus and actions are given, either one being available is enough.
        """
        if modules:
            installed_ok = (
                self._mods_all(*modules)
                if require_all_modules
                else self._mod(*modules)
            )
            if not installed_ok:
                return False
        if model and not self._has_read(model):
            return False
        if menus or actions:
            menu_ok = bool(menus) and self._menu_visible(*menus)
            action_ok = bool(actions) and any(self._action_ref(x) for x in actions)
            if menus and actions:
                if not (menu_ok or action_ok):
                    return False
            elif menus and not menu_ok:
                return False
            elif actions and not action_ok:
                return False
        return True

    def _read_group_count(self, group, groupby_field="company_id"):
        """Extract record count from a read_group row (Odoo 19 field names)."""
        if not group:
            return 0
        for key in (f"{groupby_field}_count", "id_count", "__count", "id"):
            value = group.get(key)
            if isinstance(value, int) and value >= 0:
                return value
        return 0

    def _has_read(self, model_name):
        if model_name not in self.env:
            return False
        try:
            return self.env[model_name].has_access("read")
        except Exception:
            try:
                return self.env[model_name].check_access_rights(
                    "read", raise_exception=False
                )
            except Exception:
                return False

    def _visible_menu_ids(self):
        if self._visible_menus is None:
            try:
                self._visible_menus = set(
                    self.env["ir.ui.menu"]._visible_menu_ids()
                )
            except Exception:
                self._visible_menus = set()
        return self._visible_menus

    def _action_ref(self, *xmlids):
        """Return the first existing xmlid string, else None."""
        for xmlid in xmlids:
            if not xmlid:
                continue
            action = self.env.ref(xmlid, raise_if_not_found=False)
            if action:
                return xmlid
        return None

    def _menu_visible(self, *xmlids):
        visible = self._visible_menu_ids()
        for xmlid in xmlids:
            menu = self.env.ref(xmlid, raise_if_not_found=False)
            if menu and menu.id in visible:
                return True
        return False

    # ── currency helpers ──────────────────────────────────────────────────────

    def _convert(self, amount, from_currency, ref_date=None):
        """Convert *amount* from *from_currency* to the active company currency."""
        if not amount or from_currency == self.active_currency:
            return amount or 0.0
        try:
            return from_currency._convert(
                amount,
                self.active_currency,
                self.active_company,
                ref_date or self.today,
            )
        except Exception:
            return amount or 0.0

    def _fmt(self, amount):
        """Format *amount* in the active company currency, locale-aware."""
        try:
            return format_amount(self.env, amount, self.active_currency)
        except Exception:
            return str(round(amount, 2))

    # ── aggregation helpers ───────────────────────────────────────────────────

    def _month_bounds(self):
        """Return (month_start, month_end_exclusive) as date objects."""
        start = self.today.replace(day=1)
        if self.today.month == 12:
            end = start.replace(year=start.year + 1, month=1)
        else:
            end = start.replace(month=start.month + 1)
        return start, end

    def _sum_by_company(self, model_name, domain, amount_field, ref_date_field=None):
        """
        Aggregate *amount_field* per company and convert to active currency.
        Returns (total_float, count) or (None, None) on access error.
        """
        if not self._has_read(model_name):
            return None, None
        base_domain = domain + [("company_id", "in", self.env.companies.ids)]
        try:
            groups = self.env[model_name]._read_group(
                base_domain,
                groupby=["company_id"],
                aggregates=[f"{amount_field}:sum", "__count"],
            )
        except Exception as exc:
            _logger.debug("willow biz _read_group failed on %s: %s", model_name, exc)
            return None, None

        total = 0.0
        count = 0
        for company, amount, group_count in groups:
            if not company:
                continue
            company_currency = company.currency_id
            total += self._convert(amount or 0.0, company_currency)
            count += group_count or 0
        return total, count

    # ── widget: receivables ───────────────────────────────────────────────────

    def build_receivables(self):
        if not self._app_ready(
            modules=["account"],
            model="account.move",
            menus=(
                "account.menu_finance",
                "account.account_accountant_menu_root",
            ),
            actions=("account.action_move_out_invoice_type",),
        ):
            return None

        domain = [
            ("move_type", "in", ["out_invoice", "out_refund"]),
            ("state", "=", "posted"),
            ("payment_state", "in", ["not_paid", "partial"]),
        ]
        total, count = self._sum_by_company(
            "account.move", domain, "amount_residual_signed"
        )
        if total is None:
            return None

        view_invoices = self._action_ref("account.action_move_out_invoice_type")
        receive_payment = self._action_ref(
            "account.action_account_payments",
            "account.action_move_out_invoice_type",
        )
        return {
            "amount": self._fmt(max(total, 0.0)),
            "count": count or 0,
            "actions": {
                k: v
                for k, v in {
                    "view_invoices": view_invoices,
                    "receive_payment": receive_payment,
                }.items()
                if v
            },
            "action_domain": [
                ["payment_state", "in", ["not_paid", "partial"]],
                ["move_type", "in", ["out_invoice", "out_refund"]],
                ["state", "=", "posted"],
            ],
        }

    # ── widget: payables ──────────────────────────────────────────────────────

    def build_payables(self):
        if not self._app_ready(
            modules=["account"],
            model="account.move",
            menus=(
                "account.menu_finance",
                "account.account_accountant_menu_root",
            ),
            actions=("account.action_move_in_invoice_type",),
        ):
            return None

        domain = [
            ("move_type", "in", ["in_invoice", "in_refund"]),
            ("state", "=", "posted"),
            ("payment_state", "in", ["not_paid", "partial"]),
        ]
        total, count = self._sum_by_company(
            "account.move", domain, "amount_residual_signed"
        )
        if total is None:
            return None

        view_bills = self._action_ref("account.action_move_in_invoice_type")
        pay_bills = self._action_ref(
            "account.action_account_payments_payable",
            "account.action_move_in_invoice_type",
        )
        return {
            "amount": self._fmt(abs(total)),
            "count": count or 0,
            "actions": {
                k: v
                for k, v in {
                    "view_bills": view_bills,
                    "pay_bills": pay_bills,
                    "vendor_invoices": view_bills,
                }.items()
                if v
            },
            "action_domain": [
                ["payment_state", "in", ["not_paid", "partial"]],
                ["move_type", "in", ["in_invoice", "in_refund"]],
                ["state", "=", "posted"],
            ],
        }

    # ── widget: sales this month ──────────────────────────────────────────────

    def build_sales(self):
        if not self._app_ready(
            modules=["sale", "sale_management"],
            model="sale.order",
            menus=("sale.sale_menu_root",),
            actions=(
                "sale.action_orders",
                "sale.action_quotations",
                "sale.action_quotations_with_onboarding",
            ),
        ):
            return None

        sale_orders_action = self._action_ref(
            "sale.action_orders",
            "sale.action_quotations_with_onboarding",
            "sale.action_quotations",
        )

        has_account = self._app_ready(modules=["account"], model="account.move")
        month_start, month_end = self._month_bounds()
        result = {}

        # Invoice total for the month (accounting), when available
        if has_account:
            inv_domain = [
                ("move_type", "in", ["out_invoice", "out_refund"]),
                ("state", "=", "posted"),
                ("invoice_date", ">=", fields.Date.to_string(month_start)),
                ("invoice_date", "<", fields.Date.to_string(month_end)),
            ]
            inv_total, _inv_count = self._sum_by_company(
                "account.move", inv_domain, "amount_untaxed_signed"
            )
            result["amount"] = self._fmt(max(inv_total or 0.0, 0.0))

            # Progress bar: sum invoiced_target from visible sales teams
            target = None
            if (
                self._mod("sale", "sale_management", "crm")
                and "crm.team" in self.env
                and "invoiced_target" in self.env["crm.team"]._fields
            ):
                try:
                    teams = self.env["crm.team"].search([])
                    raw_target = sum(
                        t.invoiced_target or 0.0 for t in teams
                    )
                    if raw_target > 0:
                        target = raw_target
                except Exception:
                    pass
            if target:
                inv_raw = max(inv_total or 0.0, 0.0)
                result["progress"] = {
                    "current": inv_raw,
                    "target": target,
                    "target_label": self._fmt(target),
                    "pct": min(round((inv_raw / target) * 100, 1), 100),
                }
        else:
            so_confirmed_domain = [
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", fields.Date.to_string(month_start)),
                ("date_order", "<", fields.Date.to_string(month_end)),
            ]
            so_total, _so_count = self._sum_by_company(
                "sale.order", so_confirmed_domain, "amount_untaxed"
            )
            result["amount"] = self._fmt(max(so_total or 0.0, 0.0))

        # Order metrics (sale)
        so_confirmed_domain = [
            ("state", "in", ["sale", "done"]),
            ("date_order", ">=", fields.Date.to_string(month_start)),
            ("date_order", "<", fields.Date.to_string(month_end)),
        ]
        so_total, so_count = self._sum_by_company(
            "sale.order", so_confirmed_domain, "amount_untaxed"
        )
        so_count = so_count or 0
        so_total = so_total or 0.0

        # All orders/quotations this month for conversion rate denominator
        so_all_domain = [
            ("date_order", ">=", fields.Date.to_string(month_start)),
            ("date_order", "<", fields.Date.to_string(month_end)),
            ("state", "!=", "cancel"),
        ]
        try:
            so_all_count = self.env["sale.order"].search_count(
                so_all_domain
                + [("company_id", "in", self.env.companies.ids)]
            )
        except Exception:
            so_all_count = 0

        avg_value = (so_total / so_count) if so_count else 0.0
        conversion_rate = (
            round((so_count / so_all_count) * 100, 1) if so_all_count else 0.0
        )

        result["orders"] = {
            "count": so_count,
            "action_xmlid": sale_orders_action,
            "action_domain": [
                ["state", "in", ["sale", "done"]],
                [
                    "date_order",
                    ">=",
                    fields.Date.to_string(month_start),
                ],
                [
                    "date_order",
                    "<",
                    fields.Date.to_string(month_end),
                ],
            ],
        }
        result["avg_order_value"] = {"amount": self._fmt(avg_value)}
        result["conversion_rate"] = {
            "rate": conversion_rate,
            "confirmed": so_count,
            "total": so_all_count,
        }
        result["action_xmlid"] = sale_orders_action

        return result or None

    # ── widget: cash in hand ──────────────────────────────────────────────────

    def build_cash(self):
        if not self._app_ready(
            modules=["account"],
            model="account.move.line",
            menus=(
                "account.menu_finance",
                "account.account_accountant_menu_root",
            ),
            actions=(
                "account.action_account_form",
                "account.action_account_payments",
                "account.action_move_journal_line",
            ),
        ):
            return None

        try:
            groups = self.env["account.move.line"]._read_group(
                [
                    ("account_id.account_type", "=", "asset_cash"),
                    ("parent_state", "=", "posted"),
                    ("company_id", "in", self.env.companies.ids),
                ],
                groupby=["company_id"],
                aggregates=["balance:sum"],
            )
        except Exception as exc:
            _logger.debug("willow cash widget failed: %s", exc)
            return None

        total = 0.0
        for company, amount in groups:
            if not company:
                continue
            total += self._convert(amount or 0.0, company.currency_id)

        return {"amount": self._fmt(total)}

    # ── widget: open purchase orders ─────────────────────────────────────────

    def build_open_purchase_orders(self):
        if not self._app_ready(
            modules=["purchase"],
            model="purchase.order",
            menus=("purchase.menu_purchase_root",),
            actions=(
                "purchase.purchase_form_action",
                "purchase.purchase_rfq",
            ),
        ):
            return None

        domain = [
            ("state", "in", ["draft", "sent", "to approve", "purchase"]),
        ]
        amount_field = (
            "amount_total_cc"
            if "amount_total_cc" in self.env["purchase.order"]._fields
            else "amount_total"
        )
        total, count = self._sum_by_company(
            "purchase.order", domain, amount_field
        )
        if total is None:
            return None

        view_orders = self._action_ref("purchase.purchase_rfq")
        orders_action = self._action_ref("purchase.purchase_form_action")
        return {
            "count": count or 0,
            "amount": self._fmt(total),
            "actions": {
                k: v
                for k, v in {
                    "view_orders": orders_action or view_orders,
                }.items()
                if v
            },
            "action_domain": [
                ["state", "in", ["draft", "sent", "to approve", "purchase"]]
            ],
        }

    # ── widget: top inventory items ───────────────────────────────────────────

    def build_top_inventory_items(self):
        if not self._app_ready(
            modules=["stock", "product"],
            model="stock.quant",
            menus=("stock.menu_stock_root",),
            actions=("stock.action_product_stock_view",),
            require_all_modules=True,
        ):
            return None
        if not self._has_read("product.product"):
            return None

        product_action = self._action_ref("stock.action_product_stock_view")
        domain = [
            ("location_id.usage", "=", "internal"),
            ("company_id", "in", self.env.companies.ids),
        ]
        if "is_storable" in self.env["product.product"]._fields:
            domain.append(("product_id.is_storable", "=", True))
        try:
            groups = self.env["stock.quant"]._read_group(
                domain,
                groupby=["product_id"],
                aggregates=["quantity:sum"],
                order="quantity:sum desc",
                limit=10,
            )
        except Exception as exc:
            _logger.debug("willow inventory widget failed: %s", exc)
            return []

        items = []
        for product, qty in groups:
            qty = qty or 0.0
            if qty <= 0 or not product:
                continue
            uom_name = ""
            if "uom_id" in product._fields:
                try:
                    uom_name = product.uom_id.name or ""
                except Exception:
                    pass
            items.append(
                {
                    "product_id": product.id,
                    "name": product.display_name or product.name or "",
                    "default_code": product.default_code or "",
                    "qty": round(qty, 2),
                    "qty_label": _format_qty(qty),
                    "uom": uom_name,
                    "image_url": (
                        f"/web/image/product.product/{product.id}/image_128"
                        if product.image_128
                        else None
                    ),
                    "action_xmlid": product_action,
                }
            )
            if len(items) >= 3:
                break

        return items

    # ── widget: recent transactions ───────────────────────────────────────────

    def build_recent_transactions(self):
        rows = []
        # account.move (invoices + bills)
        if self._app_ready(
            modules=["account"],
            model="account.move",
            menus=(
                "account.menu_finance",
                "account.account_accountant_menu_root",
            ),
            actions=(
                "account.action_move_out_invoice_type",
                "account.action_move_in_invoice_type",
            ),
        ):
            try:
                moves = self.env["account.move"].search_read(
                    [
                        ("state", "=", "posted"),
                        ("move_type", "in", [
                            "out_invoice", "out_refund",
                            "in_invoice", "in_refund",
                            "entry",
                        ]),
                        ("company_id", "in", self.env.companies.ids),
                    ],
                    [
                        "name", "move_type", "invoice_date", "date",
                        "partner_id", "amount_total_signed", "payment_state",
                    ],
                    limit=5,
                    order="date desc, id desc",
                )
            except Exception:
                moves = []
            inv_action = self._action_ref("account.action_move_out_invoice_type")
            bill_action = self._action_ref("account.action_move_in_invoice_type")
            entry_action = self._action_ref("account.action_move_journal_line")
            for m in moves:
                move_type = m.get("move_type", "entry")
                type_label, action_xmlid = _move_type_meta(
                    move_type, inv_action, bill_action, entry_action
                )
                payment_state = m.get("payment_state") or ""
                status_label, status_key = _INVOICE_STATUS_LABELS.get(
                    payment_state, (payment_state.capitalize(), payment_state)
                )
                status_label = _translate_status_label(status_label)
                if move_type == "entry":
                    status_label, status_key = _("Posted"), "posted"
                partner = m.get("partner_id")
                party = partner[1] if isinstance(partner, (list, tuple)) and len(partner) > 1 else ""
                doc_date = m.get("invoice_date") or m.get("date") or ""
                amount = m.get("amount_total_signed") or 0.0
                rows.append(
                    {
                        "doc_number": m.get("name") or "",
                        "type": type_label,
                        "type_key": move_type,
                        "date": _coerce_date_str(doc_date),
                        "party": party,
                        "amount": self._fmt(abs(amount)),
                        "status": status_label,
                        "status_key": status_key,
                        "model": "account.move",
                        "res_id": m["id"],
                        "action_xmlid": action_xmlid,
                    }
                )

        # sale.order
        if self._app_ready(
            modules=["sale", "sale_management"],
            model="sale.order",
            menus=("sale.sale_menu_root",),
            actions=(
                "sale.action_orders",
                "sale.action_quotations",
                "sale.action_quotations_with_onboarding",
            ),
        ):
            sale_action = self._action_ref(
                "sale.action_orders",
                "sale.action_quotations_with_onboarding",
                "sale.action_quotations",
            )
            try:
                so_rows = self.env["sale.order"].search_read(
                    [("company_id", "in", self.env.companies.ids)],
                    ["name", "date_order", "partner_id", "amount_total", "state"],
                    limit=3,
                    order="date_order desc, id desc",
                )
            except Exception:
                so_rows = []
            for so in so_rows:
                state = so.get("state", "draft")
                status_label, status_key = _SALE_STATE_LABELS.get(
                    state, (state.capitalize(), state)
                )
                status_label = _translate_status_label(status_label)
                partner = so.get("partner_id")
                party = partner[1] if isinstance(partner, (list, tuple)) and len(partner) > 1 else ""
                amount = so.get("amount_total") or 0.0
                rows.append(
                    {
                        "doc_number": so.get("name") or "",
                        "type": _("Sales Order"),
                        "type_key": "sale_order",
                        "date": _coerce_date_str(so.get("date_order")),
                        "party": party,
                        "amount": self._fmt(amount),
                        "status": status_label,
                        "status_key": status_key,
                        "model": "sale.order",
                        "res_id": so["id"],
                        "action_xmlid": sale_action,
                    }
                )

        # purchase.order
        if self._app_ready(
            modules=["purchase"],
            model="purchase.order",
            menus=("purchase.menu_purchase_root",),
            actions=(
                "purchase.purchase_form_action",
                "purchase.purchase_rfq",
            ),
        ):
            po_action = self._action_ref("purchase.purchase_form_action")
            try:
                po_rows = self.env["purchase.order"].search_read(
                    [("company_id", "in", self.env.companies.ids)],
                    ["name", "date_order", "partner_id", "amount_total", "state"],
                    limit=3,
                    order="date_order desc, id desc",
                )
            except Exception:
                po_rows = []
            for po in po_rows:
                state = po.get("state", "draft")
                status_label, status_key = _PURCHASE_STATE_LABELS.get(
                    state, (state.capitalize(), state)
                )
                status_label = _translate_status_label(status_label)
                partner = po.get("partner_id")
                party = partner[1] if isinstance(partner, (list, tuple)) and len(partner) > 1 else ""
                amount = po.get("amount_total") or 0.0
                rows.append(
                    {
                        "doc_number": po.get("name") or "",
                        "type": _("Purchase Order"),
                        "type_key": "purchase_order",
                        "date": _coerce_date_str(po.get("date_order")),
                        "party": party,
                        "amount": self._fmt(amount),
                        "status": status_label,
                        "status_key": status_key,
                        "model": "purchase.order",
                        "res_id": po["id"],
                        "action_xmlid": po_action,
                    }
                )

        # When account/sales/purchase access exists but there are no rows yet,
        # still return an empty list so the UI can show an empty state.
        account_ready = self._app_ready(
            modules=["account"],
            model="account.move",
            menus=(
                "account.menu_finance",
                "account.account_accountant_menu_root",
            ),
            actions=(
                "account.action_move_out_invoice_type",
                "account.action_move_in_invoice_type",
            ),
        )
        sale_ready = self._app_ready(
            modules=["sale", "sale_management"],
            model="sale.order",
            menus=("sale.sale_menu_root",),
            actions=(
                "sale.action_orders",
                "sale.action_quotations",
                "sale.action_quotations_with_onboarding",
            ),
        )
        purchase_ready = self._app_ready(
            modules=["purchase"],
            model="purchase.order",
            menus=("purchase.menu_purchase_root",),
            actions=(
                "purchase.purchase_form_action",
                "purchase.purchase_rfq",
            ),
        )
        if not rows and not (account_ready or sale_ready or purchase_ready):
            return None
        if not rows:
            return []

        rows.sort(key=lambda r: r.get("date") or "", reverse=True)
        return rows[:10]

    # ── build ─────────────────────────────────────────────────────────────────

    def build(self):
        payload = {}

        receivables = self.build_receivables()
        if receivables is not None:
            payload["receivables"] = receivables

        payables = self.build_payables()
        if payables is not None:
            payload["payables"] = payables

        sales = self.build_sales()
        if sales is not None:
            payload["sales"] = sales

        cash = self.build_cash()
        if cash is not None:
            payload["cash"] = cash

        open_pos = self.build_open_purchase_orders()
        if open_pos is not None:
            payload["open_purchase_orders"] = open_pos

        top_inv = self.build_top_inventory_items()
        if top_inv is not None:
            payload["top_inventory_items"] = top_inv

        recent = self.build_recent_transactions()
        if recent is not None:
            payload["recent_transactions"] = recent

        return payload if payload else None


# ── small private helpers for the business dashboard ─────────────────────────

def _format_qty(qty):
    """Format a quantity as an integer string when it's a whole number."""
    if qty == int(qty):
        return str(int(qty))
    return str(round(qty, 2))


def _coerce_date_str(value):
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    if isinstance(value, str):
        return value[:10]
    return str(value)


def _move_type_meta(move_type, inv_action, bill_action, entry_action):
    """Return (human_label, action_xmlid) for an account.move row."""
    mapping = {
        "out_invoice": (_("Sales Invoice"), inv_action),
        "out_refund": (_("Credit Note"), inv_action),
        "in_invoice": (_("Vendor Bill"), bill_action),
        "in_refund": (_("Vendor Refund"), bill_action),
        "entry": (_("Journal Entry"), entry_action),
    }
    return mapping.get(move_type, (move_type.replace("_", " ").title(), None))
