import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCommon from './locales/zh/common.json'
import zhHome from './locales/zh/home.json'
import zhSettings from './locales/zh/settings.json'
import zhWidgets from './locales/zh/widgets.json'
import zhAdmin from './locales/zh/admin.json'

import enCommon from './locales/en/common.json'
import enHome from './locales/en/home.json'
import enSettings from './locales/en/settings.json'
import enWidgets from './locales/en/widgets.json'
import enAdmin from './locales/en/admin.json'

export const resources = {
    zh: {
        common: zhCommon,
        home: zhHome,
        settings: zhSettings,
        widgets: zhWidgets,
        admin: zhAdmin,
    },
    en: {
        common: enCommon,
        home: enHome,
        settings: enSettings,
        widgets: enWidgets,
        admin: enAdmin,
    },
} as const

i18n.use(initReactI18next).init({
    resources,
    lng: 'zh',
    fallbackLng: 'zh',
    defaultNS: 'common',
    ns: ['common', 'home', 'settings', 'widgets', 'admin'],
    interpolation: {
        escapeValue: false,
    },
    react: {
        useSuspense: false,
    },
})

export default i18n
