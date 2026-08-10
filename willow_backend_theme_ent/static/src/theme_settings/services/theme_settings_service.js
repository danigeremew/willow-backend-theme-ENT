/** @odoo-module **/

export function createThemeSettingsApi(orm) {
    const call = (method, args = []) => orm.call("willow.theme.settings", method, args);
    return {
        load: () => call("get_settings"),
        save: (payload) => call("save_settings", [payload]),
        preset: (mode, preset) => call("apply_preset", [mode, preset]),
        reset: (scope, mode = null) => call("reset_settings", [scope, mode]),
        export: () => call("export_settings"),
        import: (content) => call("import_settings", [content]),
    };
}
