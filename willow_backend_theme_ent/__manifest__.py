{
    "name": "Willow Backend Theme (Enterprise Edition)",
    "summary": "Modern ERP backend theme with navy header, card dashboard, and Willow UI styling for Odoo Enterprise",
    "description": """Willow Backend Theme (Enterprise Edition) brings Willow's custom
navigation shell, configurable light and dark palettes, operations
dashboard, and responsive backend styling to Odoo 17 Enterprise.

This edition depends on ``web_enterprise`` and preserves Enterprise
services and systray tools while keeping Willow's dashboard as the
default root application. It is a separate build from the Community
edition and uses the ``willow_backend_theme_ent`` technical name.
""",
    "version": "17.0.2.4.9",
    "category": "Themes/Backend",
    "license": "OPL-1",
    "price": 34.00,
    "currency": "USD",
    "author": "Beineto Labs",
    "contributors": ["Daniel Geremew"],
    "maintainer": "www.beineto.com",
    "website": "https://www.beineto.com",
    "support": "danielgeremew93@gmail.com",
    'live_test_url': 'https://willowdemo.beineto.com',
    "images": [
        "static/description/banner.png",
        "static/description/theme_screenshot.png"
    ],
    "depends": ["base_setup", "web_enterprise", "mail", "web", "spreadsheet_dashboard"],
    "data": [
        "views/webclient_templates.xml",
        "views/willow_dashboard_action.xml",
        "views/res_users_chatter.xml"
    ],
    "assets": {
        "web.assets_backend": [
            "willow_backend_theme_ent/static/src/webclient/willow_backend_theme.scss",
            "willow_backend_theme_ent/static/src/webclient/search_bar_menu.xml",
            "willow_backend_theme_ent/static/src/webclient/shell/control_panel_mobile.xml",
            "willow_backend_theme_ent/static/src/webclient/shell/global_shell.scss",
            "willow_backend_theme_ent/static/src/webclient/website_theme_bridge.js",
            "willow_backend_theme_ent/static/src/webclient/shell/webclient_enterprise.js",
            "willow_backend_theme_ent/static/src/webclient/shell/navigation_compat_17.js",
            "willow_backend_theme_ent/static/src/webclient/shell/global_shell.js",
            "willow_backend_theme_ent/static/src/views/list/list.scss",
            "willow_backend_theme_ent/static/src/views/list/list_renderer_patch.js",
            "willow_backend_theme_ent/static/src/views/kanban/kanban.scss",
            "willow_backend_theme_ent/static/src/views/form/form_renderer.js",
            "willow_backend_theme_ent/static/src/views/form/form_compiler.js",
            "willow_backend_theme_ent/static/src/views/form/button_box_patch.js",
            "willow_backend_theme_ent/static/src/views/form/form.scss",
            "willow_backend_theme_ent/static/src/views/form/statusbar.scss",
            "willow_backend_theme_ent/static/src/views/graph/graph.scss",
            "willow_backend_theme_ent/static/src/views/apps/apps.scss",
            "willow_backend_theme_ent/static/src/core/thread/thread.xml",
            "willow_backend_theme_ent/static/src/core/thread/thread.js",
            "willow_backend_theme_ent/static/src/chatter/chatter.xml",
            "willow_backend_theme_ent/static/src/chatter/chatter.scss",
            "willow_backend_theme_ent/static/src/chatter/chatter.js",
            "willow_backend_theme_ent/static/src/dashboard/operations_dashboard.scss",
            "willow_backend_theme_ent/static/src/dashboard/operations_dashboard_action.xml",
            "willow_backend_theme_ent/static/src/dashboard/operations_dashboard_action.js",
            "willow_backend_theme_ent/static/src/webclient/willow_design.scss",
            "willow_backend_theme_ent/static/src/webclient/hero/hero_background.scss",
            "willow_backend_theme_ent/static/src/webclient/hero/hero_art.js",
            "willow_backend_theme_ent/static/src/webclient/willow_accent_overrides.scss",
            "willow_backend_theme_ent/static/src/webclient/website_compat.scss",
            "willow_backend_theme_ent/static/src/scss/mobile/tablet.scss",
            "willow_backend_theme_ent/static/src/scss/mobile/mobile.scss",
            "willow_backend_theme_ent/static/src/theme_settings/**/*.js",
            "willow_backend_theme_ent/static/src/theme_settings/**/*.xml",
            "willow_backend_theme_ent/static/src/theme_settings/**/*.scss"
        ],
        "web.assets_web_dark": [
            "willow_backend_theme_ent/static/src/webclient/willow_backend_theme.dark.scss",
            "willow_backend_theme_ent/static/src/webclient/shell/global_shell.dark.scss",
            "willow_backend_theme_ent/static/src/webclient/search/search.dark.scss",
            "willow_backend_theme_ent/static/src/views/list/list.dark.scss",
            "willow_backend_theme_ent/static/src/views/kanban/kanban.dark.scss",
            "willow_backend_theme_ent/static/src/views/activity/activity.dark.scss",
            "willow_backend_theme_ent/static/src/views/pivot/pivot.dark.scss",
            "willow_backend_theme_ent/static/src/views/graph/graph.dark.scss",
            "willow_backend_theme_ent/static/src/views/calendar/calendar.dark.scss",
            "willow_backend_theme_ent/static/src/views/purchase/purchase.dark.scss",
            "willow_backend_theme_ent/static/src/views/hr/hr.dark.scss",
            "willow_backend_theme_ent/static/src/views/settings/settings.dark.scss",
            "willow_backend_theme_ent/static/src/views/apps/apps.dark.scss",
            "willow_backend_theme_ent/static/src/views/form/form.dark.scss",
            "willow_backend_theme_ent/static/src/views/form/statusbar.dark.scss",
            "willow_backend_theme_ent/static/src/chatter/chatter.dark.scss",
            "willow_backend_theme_ent/static/src/discuss/discuss.dark.scss",
            "willow_backend_theme_ent/static/src/dashboard/operations_dashboard.scss",
            "willow_backend_theme_ent/static/src/dashboard/spreadsheet/dashboard.dark.scss",
            "willow_backend_theme_ent/static/src/webclient/willow_design.scss",
            "willow_backend_theme_ent/static/src/webclient/hero/hero_background.scss",
            "willow_backend_theme_ent/static/src/webclient/willow_accent_overrides.dark.scss"
        ]
    },
    "post_init_hook": "post_init_hook",
    "uninstall_hook": "uninstall_hook",
    "installable": True,
    "application": False,
}
