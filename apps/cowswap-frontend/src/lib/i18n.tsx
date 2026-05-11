import { ReactNode, useEffect } from 'react'

import { SupportedLocale } from '@cowprotocol/common-const'

import { i18n, Messages } from '@lingui/core'
import { I18nProvider } from '@lingui/react'

import { dynamicActivate } from './localeMessages'

interface ProviderProps {
  children: ReactNode
  locale: SupportedLocale
  messages: Messages | undefined
  onActivate?: (locale: SupportedLocale) => void
}

export function Provider({ locale, messages, onActivate, children }: ProviderProps): ReactNode {
  useEffect(() => {
    dynamicActivate(locale)
      .then(() => onActivate?.(locale))
      .catch((error) => {
        console.error('Failed to activate locale: ', locale, error)
      })
  }, [locale, onActivate])

  // if i18n is not activated (i18n.locale === ''), then I18nProvider renders null ("white screen") on initial render
  // that's why we detect locale and load messages BEFORE initial render
  if (!i18n.locale && messages) {
    i18n.load(locale, messages)
    i18n.activate(locale) // sets i18n.locale value, runs only one time
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
