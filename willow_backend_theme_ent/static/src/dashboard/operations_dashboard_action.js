/** @odoo-module **/

import { _t } from "@web/core/l10n/translation";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { standardActionServiceProps } from "@web/webclient/actions/action_service";
import { Component, onMounted, onWillStart, onWillUnmount, useState } from "@odoo/owl";

const DASHBOARD_ACTION_TAG = "willow_backend_theme_ent.operations_dashboard";
const LEGACY_DASHBOARD_ACTION_TAG = "willow_backend_theme_ent.operations_home";
const FOOTER_REFRESH_EVENT = "willow-dashboard:refresh-footer";
const DASHBOARD_DATA_REFRESH_EVENT = "willow-dashboard:refresh-data";
const LEGACY_DASHBOARD_DATA_REFRESH_EVENT = "willow-home:refresh-data";

const SUMMARY_CARD_TONES = {
    due_today: "blue",
    overdue: "rose",
    this_week: "slate",
    waiting_on_you: "green",
};

const SUMMARY_CARD_ICONS = {
    due_today: "fa-calendar-check-o",
    overdue: "fa-exclamation-circle",
    this_week: "fa-calendar",
    waiting_on_you: "fa-handshake-o",
};

const APP_CATEGORY_LABELS = {
    sale: "Sales",
    crm: "CRM",
    purchase: "Purchase",
    stock: "Inventory",
    account: "Finance",
    project: "Operations",
    hr: "HR",
    mrp: "Manufacturing",
    website: "Website",
    discuss: "Workspace",
    mail: "Workspace",
};

const CHART_WIDTH = 640;
const CHART_HEIGHT = 180;
const CHART_PADDING = { top: 16, right: 18, bottom: 28, left: 40 };

const EMPTY_STATE = {
    loading: true,
    error: false,
    period: "6w",
    today: "",
    businessDashboard: null,
    header: { userName: "", companyName: "", dateLabel: "", today: "" },
    summaryCards: [],
    pills: [],
    activityChart: {
        labels: [],
        dueValues: [],
        overdueValues: [],
        gridLines: [],
        dueAreaPath: "",
        dueLinePath: "",
        overdueAreaPath: "",
        overdueLinePath: "",
        duePoints: [],
        overduePoints: [],
        plotTop: CHART_PADDING.top,
        plotLeft: CHART_PADDING.left,
        plotWidth: CHART_WIDTH - CHART_PADDING.left - CHART_PADDING.right,
        plotHeight: CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom,
        plotBottom: CHART_PADDING.top + (CHART_HEIGHT - CHART_PADDING.top - CHART_PADDING.bottom),
        hasOverdue: false,
        showPointMarkers: false,
        periodLabel: "Last 6 weeks",
        chartTitle: "Your activity over time",
        subtitle: "Due and overdue activity trend",
    },
    chartHover: null,
    weekGlance: [],
    weekGlanceMax: 1,
    attentionGroups: [],
    openByAppChart: [],
    openByAppMax: 1,
    activities: [],
    recentItems: [],
    apps: [],
    upcoming: [],
    summary: { text: "" },
    quickLinks: [],
    activityFilter: "assigned",
    upcomingFilter: "week",
    spreadsheetDashboardAvailable: false,
};

function niceChartMax(value) {
    const safe = Math.max(value, 1);
    if (safe <= 4) {
        return 4;
    }
    const magnitude = 10 ** Math.floor(Math.log10(safe));
    const normalized = safe / magnitude;
    const nice =
        normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return nice * magnitude;
}

function formatChartTick(value) {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildChartPoints(values, labels, yMax, width, height, padding) {
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const baseline = padding.top + plotHeight;
    return (values || []).map((value, index) => {
        const x =
            padding.left +
            (index * plotWidth) / Math.max(values.length - 1, 1);
        const y = padding.top + plotHeight - (Math.max(value, 0) / yMax) * plotHeight;
        return {
            x,
            y,
            value: value || 0,
            label: labels[index] || "",
            index,
            baseline,
        };
    });
}

function clampChartY(y, baseline) {
    // SVG y grows downward; values below zero visually sit below the baseline.
    return Math.min(y, baseline);
}

function buildLinePath(points) {
    if (!points.length) {
        return "";
    }
    const baseline = points[0].baseline;
    return points
        .map((point, index) => {
            const y = clampChartY(point.y, baseline);
            return `${index === 0 ? "M" : "L"} ${point.x},${y}`;
        })
        .join(" ");
}

function buildAreaPath(points) {
    if (!points.length) {
        return "";
    }
    const baseline = points[0].baseline;
    const linePath = buildLinePath(points);
    const last = points[points.length - 1];
    return `${linePath} L ${last.x},${baseline} L ${points[0].x},${baseline} Z`;
}

function buildActivityChartGeometry(labels, dueValues, overdueValues) {
    const due = dueValues || [];
    const overdue = overdueValues || [];
    const peak = Math.max(0, ...due, ...overdue);
    const yMax = niceChartMax(peak);
    const padding = CHART_PADDING;
    const plotHeight = CHART_HEIGHT - padding.top - padding.bottom;
    const gridLines = Array.from({ length: 5 }, (_, index) => {
        const value = yMax - (yMax / 4) * index;
        const ratio = value / yMax;
        const y = padding.top + (1 - ratio) * plotHeight;
        return { y, label: formatChartTick(value) };
    });
    const duePoints = buildChartPoints(
        due,
        labels,
        yMax,
        CHART_WIDTH,
        CHART_HEIGHT,
        padding
    );
    const overduePoints = buildChartPoints(
        overdue,
        labels,
        yMax,
        CHART_WIDTH,
        CHART_HEIGHT,
        padding
    );
    const hasOverdue = overdue.some((value) => value > 0);
    const showPointMarkers =
        due.filter((value) => value > 0).length <= 4 || due.length <= 6;
    const plotTop = padding.top;
    const plotLeft = padding.left;
    const plotWidth = CHART_WIDTH - padding.left - padding.right;
    const plotBottom = padding.top + plotHeight;
    return {
        gridLines,
        dueAreaPath: buildAreaPath(duePoints),
        dueLinePath: buildLinePath(duePoints),
        overdueAreaPath: hasOverdue ? buildAreaPath(overduePoints) : "",
        overdueLinePath: hasOverdue ? buildLinePath(overduePoints) : "",
        duePoints,
        overduePoints,
        plotTop,
        plotLeft,
        plotWidth,
        plotHeight,
        plotBottom,
        hasOverdue,
        showPointMarkers,
    };
}

function mapHeader(header = {}) {
    return {
        userName: header.user_name || "",
        companyName: header.company_name || "",
        dateLabel: header.date_label || "",
        today: header.today || "",
    };
}

function mapSummaryCards(cards = []) {
    return cards
        .filter((card) => card.visible !== false)
        .map((card) => ({
            key: card.key,
            label: card.label,
            value: card.value ?? 0,
            meta: card.meta || "",
            secondary: card.secondary || "",
            icon: card.icon || SUMMARY_CARD_ICONS[card.key] || "fa-circle-o",
            sharePct: Math.max(0, Math.min(100, Number(card.share_pct) || 0)),
            urgent: !!card.urgent,
            tone: SUMMARY_CARD_TONES[card.key] || "slate",
            clickable: !!card.action_xmlid,
            actionXmlid: card.action_xmlid,
            domain: card.domain || [],
        }));
}

function mapPills(pills = []) {
    return pills.map((pill) => ({
        key: pill.key,
        label: pill.label,
        value: pill.value ?? 0,
        actionXmlid: pill.action_xmlid,
    }));
}

function mapActivityChart(chart = {}, period = "6w") {
    const labels = chart.labels || [];
    const dueValues = chart.values || [];
    const overdueValues = chart.overdue_values || [];
    return {
        labels,
        dueValues,
        overdueValues,
        ...buildActivityChartGeometry(labels, dueValues, overdueValues),
        periodLabel: chart.period_label || (period === "12w" ? _t("Last 12 weeks") : _t("Last 6 weeks")),
        chartTitle: chart.chart_title || _t("Your activity over time"),
        subtitle: chart.subtitle || _t("Due and overdue activity trend"),
    };
}

function mapWeekGlance(days = []) {
    const max = Math.max(
        1,
        ...days.map((day) => (day.due || 0) + (day.overdue || 0))
    );
    return { days, max };
}

function mapAttentionGroups(groups = []) {
    return groups.map((group) => ({
        app_key: group.app_key,
        app_name: group.app_name,
        items: (group.items || []).map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count ?? 0,
            urgent: !!item.urgent,
            actionXmlid: item.action_xmlid,
            domain: item.domain || [],
        })),
    }));
}

function mapOpenByAppChart(rows = []) {
    const limited = rows.slice(0, 5);
    const max = Math.max(1, ...limited.map((row) => row.count || 0));
    return {
        rows: limited.map((row) => ({
            app_key: row.app_key,
            app_name: row.app_name,
            count: row.count ?? 0,
        })),
        max,
    };
}

function mapActivities(rows = []) {
    return rows.map((row) => ({
        id: row.id,
        summary: row.summary || "",
        resModel: row.res_model,
        resId: row.res_id,
        dueLabel: row.due_label || "",
        dueDate: row.due_label || "",
        overdue: !!row.overdue,
        appLabel: row.app_label || "",
        actionXmlid: row.action_xmlid,
    }));
}

function mapRecentItems(items = []) {
    return items.map((item) => ({
        id: item.id,
        name: item.name || "",
        model: item.model,
        appLabel: item.app_label || "",
        writeDateLabel: item.write_date_label || "",
    }));
}

function mapApps(apps = []) {
    return apps.map((app) => ({
        menu_id: app.menu_id,
        name: app.name || "",
        app_key: app.app_key || "",
        open_count: app.open_count ?? 0,
        overdue_count: app.overdue_count ?? 0,
    }));
}

function mapUpcoming(items = []) {
    return items.map((item) => ({
        key: item.key,
        label: item.label || "",
        datetimeLabel: item.datetime_label || "",
        kind: item.kind,
        scope: item.scope || "week",
        resModel: item.res_model,
        resId: item.res_id,
        actionXmlid: item.action_xmlid,
    }));
}

function mapQuickLinks(links = []) {
    return links.map((link) => ({
        key: link.key,
        label: link.label,
        actionXmlid: link.action_xmlid,
    }));
}

function mapBizAction(obj) {
    if (!obj) return null;
    return { xmlid: obj.xmlid || obj, domain: obj.domain || [] };
}

function mapBizActions(actions = {}) {
    const out = {};
    for (const [k, v] of Object.entries(actions || {})) {
        if (v) out[k] = v;
    }
    return out;
}

function mapBusinessDashboard(biz) {
    if (!biz || typeof biz !== "object") return null;
    const d = {};

    if (biz.receivables) {
        d.receivables = {
            amount: biz.receivables.amount || "",
            count: biz.receivables.count ?? 0,
            actions: mapBizActions(biz.receivables.actions),
            actionDomain: biz.receivables.action_domain || [],
        };
    }
    if (biz.payables) {
        d.payables = {
            amount: biz.payables.amount || "",
            count: biz.payables.count ?? 0,
            actions: mapBizActions(biz.payables.actions),
            actionDomain: biz.payables.action_domain || [],
        };
    }
    if (biz.sales) {
        const s = biz.sales;
        d.sales = {
            amount: s.amount || "",
            progress: s.progress
                ? {
                      pct: s.progress.pct ?? 0,
                      target: s.progress.target ?? 0,
                      targetLabel: s.progress.target_label || String(s.progress.target ?? ""),
                  }
                : null,
            orders: s.orders
                ? {
                      count: s.orders.count ?? 0,
                      actionXmlid: s.orders.action_xmlid || null,
                      actionDomain: s.orders.action_domain || [],
                  }
                : null,
            avgOrderValue: s.avg_order_value ? { amount: s.avg_order_value.amount || "" } : null,
            conversionRate: s.conversion_rate
                ? {
                      rate: s.conversion_rate.rate ?? 0,
                      confirmed: s.conversion_rate.confirmed ?? 0,
                      total: s.conversion_rate.total ?? 0,
                  }
                : null,
            actionXmlid: s.action_xmlid || null,
        };
    }
    if (biz.cash) {
        d.cash = { amount: biz.cash.amount || "" };
    }
    if (biz.open_purchase_orders) {
            const po = biz.open_purchase_orders;
            d.openPurchaseOrders = {
                count: po.count ?? 0,
                amount: po.amount || "",
                actions: mapBizActions(po.actions),
                actionDomain: po.action_domain || [],
            };
        }
        if (Array.isArray(biz.top_inventory_items)) {
        d.topInventoryItems = biz.top_inventory_items.map((item) => ({
            productId: item.product_id,
            name: item.name || "",
            defaultCode: item.default_code || "",
            qty: item.qty ?? 0,
            qtyLabel: item.qty_label || String(item.qty ?? 0),
            uom: item.uom || "",
            imageUrl: item.image_url || null,
            actionXmlid: item.action_xmlid || null,
        }));
        d.topInventoryAvailable = true;
    }
    if (Array.isArray(biz.recent_transactions)) {
        d.recentTransactions = biz.recent_transactions.map((row) => ({
            docNumber: row.doc_number || "",
            type: row.type || "",
            typeKey: row.type_key || "",
            date: row.date || "",
            party: row.party || "",
            amount: row.amount || "",
            status: row.status || "",
            statusKey: row.status_key || "",
            model: row.model || "",
            resId: row.res_id,
            actionXmlid: row.action_xmlid || null,
        }));
        d.recentTransactionsAvailable = true;
    }

    return Object.keys(d).length ? d : null;
}

export class WillowOperationsDashboardAction extends Component {
    static template = "willow_backend_theme_ent.OperationsDashboardAction";
    static props = { ...standardActionServiceProps };
    static displayName = _t("Dashboard");

    setup() {
        this.orm = useService("orm");
        this.menuService = useService("menu");
        this.actionService = useService("action");

        this.state = useState({ ...EMPTY_STATE });

        this._onRefreshDashboardData = () => this.loadDashboard(true);

        onWillStart(() => this.loadDashboard());
        onMounted(() => {
            this._triggerFooterRefresh();
            window.addEventListener(DASHBOARD_DATA_REFRESH_EVENT, this._onRefreshDashboardData);
            window.addEventListener(LEGACY_DASHBOARD_DATA_REFRESH_EVENT, this._onRefreshDashboardData);
        });
        onWillUnmount(() => {
            window.removeEventListener(DASHBOARD_DATA_REFRESH_EVENT, this._onRefreshDashboardData);
            window.removeEventListener(LEGACY_DASHBOARD_DATA_REFRESH_EVENT, this._onRefreshDashboardData);
        });
    }

    _triggerFooterRefresh() {
        window.dispatchEvent(new CustomEvent(FOOTER_REFRESH_EVENT));
    }

    async loadDashboard(silent = false) {
        if (!silent) {
            this.state.loading = true;
            this.state.error = false;
        }
        try {
            const data = await this.orm.call("res.users", "get_willow_dashboard_data", [], {
                period: this.state.period,
            });
            this._applyPayload(data);
            this.state.error = false;
        } catch {
            Object.assign(this.state, {
                ...EMPTY_STATE,
                loading: false,
                error: true,
                period: this.state.period,
                activityFilter: this.state.activityFilter,
                upcomingFilter: this.state.upcomingFilter,
                summary: { text: _t("Could not load your dashboard data. Try refreshing the page.") },
            });
        } finally {
            this.state.loading = false;
            this._triggerFooterRefresh();
        }
    }

    _applyPayload(data = {}) {
        const weekGlance = mapWeekGlance(data.week_glance || []);
        const openByApp = mapOpenByAppChart(data.open_by_app_chart || []);

        this.state.today = data.today || data.header?.today || "";
        this.state.businessDashboard = mapBusinessDashboard(data.business_dashboard || null);
        this.state.header = mapHeader(data.header);
        this.state.summaryCards = mapSummaryCards(data.summary_cards);
        this.state.pills = mapPills(data.pills);
        this.state.chartHover = null;
        this.state.activityChart = mapActivityChart(data.activity_chart, this.state.period);
        this.state.weekGlance = weekGlance.days;
        this.state.weekGlanceMax = weekGlance.max;
        this.state.attentionGroups = mapAttentionGroups(data.attention_groups);
        this.state.openByAppChart = openByApp.rows;
        this.state.openByAppMax = openByApp.max;
        this.state.activities = mapActivities(data.activities);
        this.state.recentItems = mapRecentItems(data.recent_items);
        this.state.apps = mapApps(data.apps);
        this.state.upcoming = mapUpcoming(data.upcoming);
        this.state.summary = data.summary || { text: "" };
        this.state.quickLinks = mapQuickLinks(data.quick_links);
        this.state.spreadsheetDashboardAvailable = Boolean(data.spreadsheet_dashboard_available);
    }

    weekRowMetrics(day) {
        const due = day.due || 0;
        const overdue = day.overdue || 0;
        const total = due + overdue;
        const fillWidth = Math.round((total / this.state.weekGlanceMax) * 100);
        const dueShare = total ? Math.round((due / total) * 100) : 0;
        return {
            fillWidth,
            dueShare,
            overdueShare: total ? 100 - dueShare : 0,
            total,
        };
    }

    weekFillStyle(day) {
        return `width: ${this.weekRowMetrics(day).fillWidth}%`;
    }

    weekDueSegmentStyle(day) {
        return `width: ${this.weekRowMetrics(day).dueShare}%`;
    }

    weekOverdueSegmentStyle(day) {
        return `width: ${this.weekRowMetrics(day).overdueShare}%`;
    }

    weekTotalCount(day) {
        return this.weekRowMetrics(day).total;
    }

    barFillStyle(count) {
        const width = Math.round(((count || 0) / this.state.openByAppMax) * 100);
        return `width: ${Math.max(width, count > 0 ? 8 : 0)}%`;
    }

    onChartPointEnter(point, series) {
        this.state.chartHover = { ...point, series };
    }

    onChartPointLeave() {
        this.state.chartHover = null;
    }

    chartTooltipStyle() {
        const hover = this.state.chartHover;
        if (!hover) {
            return "";
        }
        const left = (hover.x / CHART_WIDTH) * 100;
        const top = (hover.y / CHART_HEIGHT) * 100;
        return `left: ${left}%; top: ${top}%;`;
    }

    summaryCardValue(key) {
        const card = this.state.summaryCards.find((entry) => entry.key === key);
        return card?.value ?? 0;
    }

    get attentionStatusChips() {
        const attentionCount = this.state.attentionGroups.reduce(
            (total, group) => total + group.items.reduce((sum, item) => sum + (item.count || 0), 0),
            0
        );
        return [
            { key: "overdue", label: _t("Overdue"), value: this.summaryCardValue("overdue"), tone: "rose" },
            { key: "waiting", label: _t("Waiting on you"), value: this.summaryCardValue("waiting_on_you"), tone: "green" },
            { key: "attention", label: _t("Attention items"), value: attentionCount, tone: "blue" },
        ];
    }

    get summaryOverviewItems() {
        const overdue = this.summaryCardValue("overdue");
        const dueToday = this.summaryCardValue("due_today");
        const statusLabel = overdue
            ? _t("Needs follow-up")
            : dueToday
              ? _t("Due today")
              : _t("Up to date");
        return [
            {
                key: "status",
                icon: "fa-check-circle",
                label: _t("Status"),
                value: statusLabel,
                tone: overdue ? "rose" : "green",
            },
            {
                key: "overdue",
                icon: "fa-clock",
                label: _t("Overdue"),
                value: String(overdue),
                tone: overdue ? "rose" : "slate",
            },
            {
                key: "meetings",
                icon: "fa-calendar",
                label: _t("Upcoming"),
                value: String(this.state.upcoming.length),
                tone: "blue",
            },
            {
                key: "apps",
                icon: "fa-th-large",
                label: _t("Apps"),
                value: String(this.state.apps.length),
                tone: "slate",
            },
        ];
    }

    get filteredActivities() {
        const today = this.state.today || this.state.header.today || "";
        const rows = this.state.activities;
        if (this.state.activityFilter === "overdue") {
            return rows.filter((row) => row.overdue);
        }
        if (this.state.activityFilter === "today") {
            return rows.filter((row) => row.dueDate === today);
        }
        return rows;
    }

    get filteredUpcoming() {
        const rows = this.state.upcoming;
        const filter = this.state.upcomingFilter;
        if (filter === "today") {
            return rows.filter((row) => row.scope === "today");
        }
        if (filter === "deadlines") {
            return rows.filter((row) => row.kind === "activity" || row.scope === "deadlines");
        }
        // this week: today + week scopes
        return rows.filter((row) => row.scope === "today" || row.scope === "week");
    }

    setActivityFilter(filter) {
        this.state.activityFilter = filter;
    }

    setUpcomingFilter(filter) {
        this.state.upcomingFilter = filter;
    }

    appCategory(app) {
        return _t(APP_CATEGORY_LABELS[app.app_key] || "Workspace");
    }

    appIconSrc(app) {
        const menu = this.menuService.getMenu(app.menu_id);
        if (!menu) {
            return null;
        }
        if (menu.webIconData) {
            const value = String(menu.webIconData).trim();
            if (value && value !== "/web/static/img/default_icon_app.png") {
                if (value.startsWith("data:image") || value.startsWith("/") || value.startsWith("http")) {
                    return value;
                }
                return `data:image/png;base64,${value}`;
            }
        }
        if (typeof menu.webIcon === "string" && menu.webIcon.includes(",")) {
            return `/${menu.webIcon.replace(",", "/")}`;
        }
        return null;
    }

    appInitial(app) {
        return (app.name || "?").trim().charAt(0).toUpperCase();
    }

    formatDueLabel(dueLabel) {
        if (!dueLabel) {
            return _t("No date");
        }
        const today = this.state.today || this.state.header.today || "";
        if (dueLabel === today) {
            return _t("Today");
        }
        try {
            return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${dueLabel}T00:00:00`));
        } catch {
            return dueLabel;
        }
    }

    async toggleChartPeriod() {
        this.state.period = this.state.period === "6w" ? "12w" : "6w";
        await this.loadDashboard(true);
    }

    async openActionXmlid(xmlid, domain) {
        if (!xmlid) {
            return;
        }
        try {
            const action = await this.actionService.loadAction(xmlid);
            const nextAction = {
                ...action,
                domain: domain || action.domain || [],
            };
            await this.actionService.doAction(nextAction);
        } catch {
            // Action unavailable for this user.
        }
    }

    openSummaryCard(card) {
        if (!card?.clickable) {
            return;
        }
        this.openActionXmlid(card.actionXmlid, card.domain);
    }

    openPill(pill) {
        this.openActionXmlid(pill.actionXmlid);
    }

    openAttentionItem(item) {
        this.openActionXmlid(item.actionXmlid, item.domain);
    }

    openQuickLink(link) {
        this.openActionXmlid(link.actionXmlid);
    }

    async openActivityRow(row) {
        if (row.resModel && row.resId) {
            await this.actionService.doAction({
                type: "ir.actions.act_window",
                res_model: row.resModel,
                res_id: row.resId,
                views: [[false, "form"]],
                target: "current",
            });
            return;
        }
        this.openActivities();
    }

    async openRecentItem(item) {
        if (!item?.model || !item?.id) {
            return;
        }
        await this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: item.model,
            res_id: item.id,
            views: [[false, "form"]],
            target: "current",
        });
    }

    openApp(app) {
        const menu = this.menuService.getMenu(app.menu_id);
        if (menu) {
            this.menuService.selectMenu(menu);
        }
    }

    async openUpcomingItem(item) {
        if (item.resModel && item.resId) {
            await this.actionService.doAction({
                type: "ir.actions.act_window",
                res_model: item.resModel,
                res_id: item.resId,
                views: [[false, "form"]],
                target: "current",
            });
            return;
        }
        if (item.actionXmlid) {
            this.openActionXmlid(item.actionXmlid);
            return;
        }
        this.openActivities();
    }

    openActivities() {
        this.actionService.doAction("mail.mail_activity_action_my");
    }

    openSpreadsheetDashboard() {
        if (!this.state.spreadsheetDashboardAvailable) {
            return;
        }
        // Prefer menu navigation so menu_id / current app update and Willow's
        // hero subnav can show Dashboards | Configuration like other apps.
        const apps = typeof this.menuService.getApps === "function" ? this.menuService.getApps() : [];
        const spreadsheetApp =
            apps.find((menu) => String(menu?.xmlid || "").startsWith("spreadsheet_dashboard.")) ||
            apps.find((menu) => {
                const key = String(menu?.name || "")
                    .normalize("NFD")
                    .replace(/[\u0300-\u036f]/g, "")
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, "");
                return ["dashboards", "tableauxdebord", "tableros", "paineis"].includes(key);
            });
        if (spreadsheetApp) {
            this.menuService.selectMenu(spreadsheetApp);
            return;
        }
        this.actionService.doAction("spreadsheet_dashboard.ir_actions_dashboard_action");
    }

    openBizAction(xmlid, domain) {
        if (!xmlid) return;
        this.openActionXmlid(xmlid, domain);
    }

    openBizRecord(model, resId) {
        if (!model || !resId) return;
        this.actionService.doAction({
            type: "ir.actions.act_window",
            res_model: model,
            res_id: resId,
            views: [[false, "form"]],
            target: "current",
        });
    }

    openReceivables(actionKey = "view_invoices") {
        const biz = this.state.businessDashboard;
        if (!biz?.receivables) return;
        const xmlid =
            biz.receivables.actions[actionKey] ||
            biz.receivables.actions.view_invoices ||
            biz.receivables.actions.receive_payment ||
            null;
        const domain = actionKey === "receive_payment" ? [] : biz.receivables.actionDomain;
        this.openBizAction(xmlid, domain);
    }

    openPayables(actionKey = "view_bills") {
        const biz = this.state.businessDashboard;
        if (!biz?.payables) return;
        const xmlid =
            biz.payables.actions[actionKey] ||
            biz.payables.actions.view_bills ||
            biz.payables.actions.pay_bills ||
            null;
        const domain = actionKey === "pay_bills" ? [] : biz.payables.actionDomain;
        this.openBizAction(xmlid, domain);
    }

    openSalesOrders() {
        const biz = this.state.businessDashboard;
        if (!biz?.sales?.orders) return;
        this.openBizAction(
            biz.sales.orders.actionXmlid || biz.sales.actionXmlid,
            biz.sales.orders.actionDomain
        );
    }

    openBizPurchaseOrders() {
        const biz = this.state.businessDashboard;
        if (!biz?.openPurchaseOrders) return;
        const xmlid =
            biz.openPurchaseOrders.actions.view_orders || null;
        this.openBizAction(xmlid, biz.openPurchaseOrders.actionDomain);
    }

    openTransactionRow(row) {
        if (row.model && row.resId) {
            this.openBizRecord(row.model, row.resId);
            return;
        }
        if (row.actionXmlid) {
            this.openBizAction(row.actionXmlid);
        }
    }

    openInventoryItem(item) {
        if (item.actionXmlid) {
            this.openBizAction(item.actionXmlid, [["id", "=", item.productId]]);
            return;
        }
        if (item.productId) {
            this.openBizRecord("product.product", item.productId);
        }
    }

    formatBizDate(dateStr) {
        if (!dateStr) return _t("—");
        try {
            const d = new Date(dateStr);
            return new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
            }).format(d);
        } catch {
            return dateStr;
        }
    }

    salesProgressStyle() {
        const pct = this.state.businessDashboard?.sales?.progress?.pct ?? 0;
        return `width: ${pct}%`;
    }

    txnDocIconClass(typeKey) {
        const map = {
            in_invoice: "orange",
            in_refund: "orange",
            purchase_order: "orange",
            entry: "green",
            sale_order: "",
            out_invoice: "",
            out_refund: "",
        };
        return map[typeKey] || "";
    }

    txnStatusClass(statusKey) {
        const map = {
            paid: "status-paid",
            posted: "status-posted",
            unpaid: "status-unpaid",
            partial: "status-unpaid",
            confirmed: "status-approved",
            purchase: "status-approved",
            to_approve: "status-approved",
            done: "status-paid",
            draft: "status-approved",
            sent: "status-approved",
            in_payment: "status-approved",
            cancelled: "status-unpaid",
        };
        return map[statusKey] || "status-approved";
    }

    inventoryUnitsLabel(item) {
        if (!item) {
            return "";
        }
        const unit = item.uom || _t("Units");
        return `${item.qtyLabel} ${unit}`;
    }

    openAllApps() {
        const appsButton = document.querySelector('[data-wl-action="open-apps"]');
        if (appsButton) {
            appsButton.click();
            return;
        }
        window.location.assign("/odoo/apps");
    }

    openCalendar() {
        this.openActionXmlid("calendar.action_calendar_event");
    }

    openRecentRecords() {
        if (this.state.recentItems.length) {
            this.openRecentItem(this.state.recentItems[0]);
            return;
        }
        this.openAllApps();
    }
}

registry.category("actions").add(DASHBOARD_ACTION_TAG, WillowOperationsDashboardAction);
registry.category("actions").add(LEGACY_DASHBOARD_ACTION_TAG, WillowOperationsDashboardAction);
