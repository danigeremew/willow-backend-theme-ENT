# Willow Enterprise Port Plan — Odoo 18

## Baseline

- Track Willow Community `18.0.2.4.8` feature-for-feature.
- Ship as the independent Odoo module `willow_backend_theme_ent`.
- Require `web_enterprise` so Willow assets load after Enterprise assets.

## Port work

1. [x] Copy the Community module without its Git metadata or generated Python caches.
2. [x] Rename module, asset, XML-ID, translation, route, and configuration namespaces to `willow_backend_theme_ent`.
3. [x] Preserve Willow's existing CSS custom properties and narrowly scoped Odoo selectors.
4. [x] Adapt Enterprise startup via `webclient_enterprise.js` so the sequence-0 Willow dashboard opens instead of the fullscreen Enterprise Home Menu.
5. [x] Keep Enterprise systray registrations intact and move their rendered container into Willow's topbar using Willow's existing systray mount.
6. [x] Copy missing Community configuration parameters into the Enterprise namespace during post-install migration without deleting the source values.
7. [x] Validate manifests, Python, XML, JavaScript imports, asset paths, translation headers, and configuration.
8. [x] Install and upgrade the module in an isolated Odoo 18 Enterprise database (`wlw18_ent`), compile production assets, and exercise the shell in a real browser.

## Compatibility boundaries

- Do not modify Odoo Community or Enterprise core modules.
- Do not install Community and Enterprise Willow editions together in the same database.
- Keep Enterprise-only view structures outside Willow's selector assumptions.
- Exercise app-specific views again in representative workflows.
