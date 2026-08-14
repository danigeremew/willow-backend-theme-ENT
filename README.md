# Willow Backend Theme (Enterprise Edition) — Odoo 19

Modern ERP backend theme for Odoo 19 Enterprise with a navy header, card-based dashboard, and Willow UI styling inspired by contemporary ERP dashboards.

## Design

- **Header:** Deep navy (`#0A1128`) with horizontal app navigation, search, notifications, and profile
- **Dashboard:** Welcome band, overview tabs, KPI cards, charts, inventory list, and transactions table
- **Content:** Light gray canvas (`#F8F9FA`) with white rounded cards and blue primary accent (`#4F6EF7`)

## What it includes

- Custom global shell with dark header navigation
- Built-in operations dashboard with ERP-style overview cards and live KPIs
- Styled list, form, kanban, graph, and control panel views
- Webclient Enterprise compatibility (`web_enterprise` integration)
- Configurable primary colors and branding via Theme Settings

## Install

1. Remove or uninstall the Community edition if it is installed
2. Copy `willow_backend_theme` into your Odoo Enterprise addons path
3. Update the apps list
4. Install **Willow Backend Theme (Enterprise Edition)** from Apps

## Dependencies

- `base_setup`, `web_enterprise`, `mail`, `web`, `spreadsheet_dashboard`

## Notes

- Designed specifically for the Odoo 19 Enterprise backend
- Uses the `willow_backend_theme` technical name and configuration namespace
- Seamlessly integrates with Enterprise services, systray tools, and navigation
- Copies missing theme settings from `willow_backend_theme_ce` during installation without deleting Community settings
- Sets the Willow dashboard as the default home action for admin on install
