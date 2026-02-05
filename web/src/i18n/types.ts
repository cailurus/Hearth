import 'i18next'

import type zhCommon from './locales/zh/common.json'
import type zhHome from './locales/zh/home.json'
import type zhSettings from './locales/zh/settings.json'
import type zhWidgets from './locales/zh/widgets.json'
import type zhAdmin from './locales/zh/admin.json'

declare module 'i18next' {
    interface CustomTypeOptions {
        defaultNS: 'common'
        resources: {
            common: typeof zhCommon
            home: typeof zhHome
            settings: typeof zhSettings
            widgets: typeof zhWidgets
            admin: typeof zhAdmin
        }
    }
}
