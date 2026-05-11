import { ReactNode, useCallback } from 'react'

import { SupportedLocale } from '@cowprotocol/common-const'

import { Messages } from '@lingui/core'

import { useActiveLocale } from 'legacy/hooks/useActiveLocale'
import { useUserLocaleManager } from 'legacy/state/user/hooks'

import { Provider } from 'lib/i18n'

interface LanguageProviderProps {
  children: ReactNode
  messages: Messages | undefined
}

export function LanguageProvider({ children, messages }: LanguageProviderProps): ReactNode {
  const locale = useActiveLocale()
  const { setLocale } = useUserLocaleManager()

  const onActivate = useCallback(
    (locale: SupportedLocale) => {
      document.documentElement.setAttribute('lang', locale)
      setLocale(locale)
    },
    [setLocale],
  )

  return (
    <Provider locale={locale} messages={messages} onActivate={onActivate}>
      {children}
    </Provider>
  )
}
