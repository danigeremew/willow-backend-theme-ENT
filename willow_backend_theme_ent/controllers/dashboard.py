# -*- coding: utf-8 -*-

from odoo import http
from odoo.addons.web.controllers.home import Home as WebHome
from odoo.http import request


class Home(WebHome):
    @http.route(
        [
            "/apps",
            "/apps/<path:subpath>",
        ],
        type="http",
        auth="none",
    )
    def apps(self, s_action=None, subpath=None, **kw):
        if not request.session.uid:
            return request.redirect_query(
                "/web/login", query={"redirect": "/web#action=base.open_module_tree"}
            )
        return request.redirect("/web#action=base.open_module_tree")

    @http.route(
        [
            "/home",
            "/home/<path:subpath>",
            "/dashboard",
            "/dashboard/<path:subpath>",
        ],
        type="http",
        auth="none",
    )
    def dashboard(self, s_action=None, subpath=None, **kw):
        return super().web_client(s_action=s_action, **kw)
