from odoo import fields, models


class ResCompany(models.Model):
    _inherit = "res.company"

    willow_hero_image = fields.Binary(string="Willow Hero Background")
    willow_hero_image_dark = fields.Binary(string="Willow Dark Hero Background")
    willow_favicon = fields.Binary(string="Willow Backend Favicon")
    willow_login_background = fields.Binary(string="Willow Login Background")
    willow_login_background_dark = fields.Binary(string="Willow Dark Login Background")
